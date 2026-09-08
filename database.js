const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = path.join(__dirname, 'library.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high performance and durability
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    category TEXT NOT NULL,
    year TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'coral',
    tag TEXT DEFAULT '',
    available INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    book_title TEXT NOT NULL,
    member_name TEXT NOT NULL,
    member_email TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    reserved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Password hashing helpers
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, storedHash, salt) {
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

// Seed initial books from library.json if books table is empty
function seedBooksIfEmpty() {
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM books').get();
  if (countRow && countRow.count === 0) {
    const jsonPath = path.join(__dirname, 'library.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        const books = JSON.parse(raw);
        const insertStmt = db.prepare(`
          INSERT INTO books (title, author, category, year, color, tag, available)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `);
        for (const b of books) {
          insertStmt.run(b.title, b.author, b.category, String(b.year), b.color || 'coral', b.tag || '');
        }
        console.log(`[Database] Successfully seeded ${books.length} books from library.json`);
      } catch (err) {
        console.error('[Database] Failed to seed books from library.json:', err.message);
      }
    }
  }
}

seedBooksIfEmpty();

// Data Access Methods

// Books
function getAllBooks(category, search) {
  let query = 'SELECT * FROM books WHERE 1=1';
  const params = [];

  if (category && category !== 'all') {
    query += ' AND category = ?';
    params.push(category);
  }

  if (search) {
    query += ' AND (LOWER(title) LIKE ? OR LOWER(author) LIKE ?)';
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term);
  }

  query += ' ORDER BY id ASC';
  return db.prepare(query).all(...params);
}

function getBookById(id) {
  return db.prepare('SELECT * FROM books WHERE id = ?').get(id);
}

function createBook({ title, author, category, year, color = 'coral', tag = '' }) {
  const stmt = db.prepare(`
    INSERT INTO books (title, author, category, year, color, tag, available)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const result = stmt.run(title, author, category, String(year), color, tag);
  return getBookById(result.lastInsertRowid);
}

function updateBook(id, fields) {
  const allowed = ['title', 'author', 'category', 'year', 'color', 'tag', 'available'];
  const setClauses = [];
  const params = [];

  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      setClauses.push(`${key} = ?`);
      params.push(val);
    }
  }

  if (setClauses.length === 0) return getBookById(id);

  params.push(id);
  db.prepare(`UPDATE books SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
  return getBookById(id);
}

function deleteBook(id) {
  const book = getBookById(id);
  if (!book) return null;
  db.prepare('DELETE FROM books WHERE id = ?').run(id);
  return book;
}

// Members / Authentication
function createMember({ name, email, password, role = 'member' }) {
  const existing = findMemberByEmail(email);
  if (existing) {
    const error = new Error('An account with this email already exists.');
    error.code = 'EMAIL_EXISTS';
    throw error;
  }
  const { hash, salt } = hashPassword(password);
  const stmt = db.prepare(`
    INSERT INTO members (name, email, password_hash, salt, role)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(name, email.toLowerCase().trim(), hash, salt, role);
  return {
    id: result.lastInsertRowid,
    name,
    email: email.toLowerCase().trim(),
    role,
    created_at: new Date().toISOString()
  };
}

function findMemberByEmail(email) {
  return db.prepare('SELECT * FROM members WHERE email = ?').get(email.toLowerCase().trim());
}

function authenticateMember(email, password) {
  const member = findMemberByEmail(email);
  if (!member) return null;
  const match = verifyPassword(password, member.password_hash, member.salt);
  if (!match) return null;

  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    created_at: member.created_at
  };
}

function getAllMembers() {
  return db.prepare('SELECT id, name, email, role, created_at FROM members ORDER BY id DESC').all();
}

// Reservations
function createReservation({ book_id, member_name, member_email }) {
  const book = getBookById(book_id);
  if (!book) {
    const error = new Error('Book not found.');
    error.code = 'BOOK_NOT_FOUND';
    throw error;
  }

  // Set 2 days hold expiry
  const now = new Date();
  const expires = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const stmt = db.prepare(`
    INSERT INTO reservations (book_id, book_title, member_name, member_email, status, reserved_at, expires_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `);
  const result = stmt.run(
    book.id,
    book.title,
    member_name.trim(),
    member_email.toLowerCase().trim(),
    now.toISOString(),
    expires.toISOString()
  );

  return {
    id: result.lastInsertRowid,
    book_id: book.id,
    book_title: book.title,
    member_name: member_name.trim(),
    member_email: member_email.toLowerCase().trim(),
    status: 'active',
    reserved_at: now.toISOString(),
    expires_at: expires.toISOString()
  };
}

function getReservations(member_email = null) {
  if (member_email) {
    return db.prepare(`
      SELECT * FROM reservations
      WHERE LOWER(member_email) = ?
      ORDER BY id DESC
    `).all(member_email.toLowerCase().trim());
  }
  return db.prepare('SELECT * FROM reservations ORDER BY id DESC').all();
}

function cancelReservation(id) {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!reservation) return null;
  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
  return reservation;
}

// Newsletter
function subscribeNewsletter(email) {
  const cleanEmail = email.toLowerCase().trim();
  const existing = db.prepare('SELECT * FROM newsletter_subscribers WHERE email = ?').get(cleanEmail);
  if (existing) {
    return { email: cleanEmail, alreadySubscribed: true };
  }
  const stmt = db.prepare('INSERT INTO newsletter_subscribers (email) VALUES (?)');
  const res = stmt.run(cleanEmail);
  return { id: res.lastInsertRowid, email: cleanEmail, alreadySubscribed: false };
}

function getNewsletterSubscribers() {
  return db.prepare('SELECT * FROM newsletter_subscribers ORDER BY id DESC').all();
}

// Stats
function getStats() {
  const totalBooks = db.prepare('SELECT COUNT(*) AS count FROM books').get().count;
  const availableBooks = db.prepare('SELECT COUNT(*) AS count FROM books WHERE available = 1').get().count;
  const totalMembers = db.prepare('SELECT COUNT(*) AS count FROM members').get().count;
  const activeReservations = db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE status = 'active'").get().count;
  const totalSubscribers = db.prepare('SELECT COUNT(*) AS count FROM newsletter_subscribers').get().count;

  return {
    totalBooks,
    availableBooks,
    totalMembers,
    activeReservations,
    totalSubscribers
  };
}

module.exports = {
  db,
  getAllBooks,
  getBookById,
  createBook,
  updateBook,
  deleteBook,
  createMember,
  findMemberByEmail,
  authenticateMember,
  getAllMembers,
  createReservation,
  getReservations,
  cancelReservation,
  subscribeNewsletter,
  getNewsletterSubscribers,
  getStats
};

