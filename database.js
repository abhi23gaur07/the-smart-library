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

  CREATE TABLE IF NOT EXISTS book_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    book_title TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_roll_no TEXT NOT NULL,
    student_phone TEXT NOT NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    return_date DATE DEFAULT NULL,
    status TEXT DEFAULT 'issued',
    day14_reminder_sent INTEGER DEFAULT 0,
    due_day_reminder_sent INTEGER DEFAULT 0,
    overdue_reminder_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reminder_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL,
    student_name TEXT NOT NULL,
    student_phone TEXT NOT NULL,
    book_title TEXT NOT NULL,
    reminder_type TEXT NOT NULL,
    message_text TEXT NOT NULL,
    channel TEXT DEFAULT 'WhatsApp',
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'sent',
    FOREIGN KEY(issue_id) REFERENCES book_issues(id) ON DELETE CASCADE
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

// Seed and sync books from library.json into books table
function syncBooksFromCatalog() {
  const jsonPath = path.join(__dirname, 'library.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const books = JSON.parse(raw);
      const checkStmt = db.prepare('SELECT id FROM books WHERE title = ?');
      const insertStmt = db.prepare(`
        INSERT INTO books (title, author, category, year, color, tag, available)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `);
      let added = 0;
      for (const b of books) {
        const existing = checkStmt.get(b.title);
        if (!existing) {
          insertStmt.run(b.title, b.author, b.category, String(b.year), b.color || 'coral', b.tag || '');
          added++;
        }
      }
      if (added > 0) {
        console.log(`[Database] Successfully synced ${added} new books from library.json`);
      }
    } catch (err) {
      console.error('[Database] Failed to sync books from library.json:', err.message);
    }
  }
}

syncBooksFromCatalog();

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

function deleteMember(id) {
  const member = db.prepare('SELECT id, name, email FROM members WHERE id = ?').get(id);
  if (!member) return null;
  db.prepare('DELETE FROM members WHERE id = ?').run(id);
  return member;
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

function deleteSubscriber(id) {
  const subscriber = db.prepare('SELECT * FROM newsletter_subscribers WHERE id = ?').get(id);
  if (!subscriber) return null;
  db.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').run(id);
  return subscriber;
}

// ==========================================
// BOOK ISSUES & AUTOMATED WHATSAPP REMINDERS
// ==========================================

function formatDateString(d) {
  const date = new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return formatDateString(d);
}

function calculateLoanMetrics(issueDateStr, dueDateStr, returnDateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const issueDate = new Date(issueDateStr);
  issueDate.setHours(0, 0, 0, 0);

  const dueDate = new Date(dueDateStr);
  dueDate.setHours(0, 0, 0, 0);

  const referenceDate = returnDateStr ? new Date(returnDateStr) : now;
  referenceDate.setHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysElapsed = Math.floor((referenceDate - issueDate) / msPerDay);
  const currentLoanDay = Math.max(1, daysElapsed + 1); // e.g. Day 1, Day 14, Day 15
  const daysRemaining = Math.floor((dueDate - referenceDate) / msPerDay);

  let loanStatus = 'active';
  let badgeText = `Day ${currentLoanDay} of 15`;
  let badgeClass = 'status-normal';

  if (returnDateStr) {
    loanStatus = 'returned';
    badgeText = 'Returned';
    badgeClass = 'status-returned';
  } else if (daysRemaining < 0) {
    loanStatus = 'overdue';
    const overdueDays = Math.abs(daysRemaining);
    badgeText = `Overdue (${overdueDays}d late)`;
    badgeClass = 'status-overdue';
  } else if (daysRemaining === 0) {
    loanStatus = 'due_today';
    badgeText = 'Due Today (Day 15)';
    badgeClass = 'status-due-today';
  } else if (daysRemaining === 1) {
    loanStatus = 'day14_reminder'; // Exactly 1 day before 15-day due date (Day 14)
    badgeText = 'Day 14 (1d to Due)';
    badgeClass = 'status-day14';
  }

  const finePerDay = 5;
  const fineAmount = (daysRemaining < 0 && !returnDateStr) ? Math.abs(daysRemaining) * finePerDay : 0;

  return {
    daysElapsed,
    currentLoanDay,
    daysRemaining,
    loanStatus,
    badgeText,
    badgeClass,
    fineAmount
  };
}

function generateWhatsAppMessage(issue, reminderType) {
  const student = issue.student_name || 'Student';
  const roll = issue.student_roll_no || 'N/A';
  const book = issue.book_title || 'Library Book';
  const issued = issue.issue_date;
  const due = issue.due_date;
  const fine = issue.fineAmount || 5;

  if (reminderType === 'day14_prior') {
    return (
      `📚 *THE SMART LIBRARY · RRU LLRB*\n` +
      `*Automated Return Reminder* 🔔\n\n` +
      `Hello *${student}* (Enrollment No: *${roll}*),\n\n` +
      `This is an automated 24-hour reminder regarding your borrowed library book:\n` +
      `📖 *${book}*\n` +
      `📅 *Date of Issue:* ${issued}\n` +
      `⏰ *Return Due Date:* *Tomorrow, ${due}* (Day 14 of 15-day loan)\n\n` +
      `Tomorrow is the last date of your loan period. Please renew or return the book back to the Central Circulation Desk to prevent late fines.\n\n` +
      `_Break the forgetfulness link — Prevention over punishment._`
    );
  } else if (reminderType === 'due_date') {
    return (
      `📚 *THE SMART LIBRARY · RRU LLRB*\n` +
      `*Urgent Notice: Book Due Today* 🚨\n\n` +
      `Hello *${student}* (Enrollment No: *${roll}*),\n\n` +
      `Your borrowed library book:\n` +
      `📖 *${book}*\n` +
      `⏰ *Due Date:* *TODAY (${due}) by 8:00 PM*\n\n` +
      `Today is the final day. Please return the book to the Circulation Desk today before closing hours to avoid overdue charges.\n\n` +
      `_RRU Library & Learning Resources Branch_`
    );
  } else if (reminderType === 'overdue') {
    return (
      `📚 *THE SMART LIBRARY · RRU LLRB*\n` +
      `*Overdue Alert & Late Fine Warning* ❗\n\n` +
      `Hello *${student}* (Enrollment No: *${roll}*),\n\n` +
      `Your borrowed library book is now OVERDUE:\n` +
      `📖 *${book}*\n` +
      `⚠️ *Was Due On:* ${due}\n` +
      `💰 *Accrued Late Fine:* ₹${fine} (₹5 per day)\n\n` +
      `Please return this volume immediately to the Circulation Desk to clear your library account.\n\n` +
      `_RRU Library & Learning Resources Branch_`
    );
  }
  return '';
}

function createIssue({ book_id, student_name, student_roll_no, student_phone, issue_date, due_date }) {
  let cleanPhone = String(student_phone).replace(/[^\d]/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }
  const finalIssueDate = issue_date ? formatDateString(issue_date) : formatDateString(new Date());
  const finalDueDate = due_date ? formatDateString(due_date) : addDays(finalIssueDate, 15);

  const book = db.prepare('SELECT title FROM books WHERE id = ?').get(book_id);
  const book_title = book ? book.title : 'Library Book';

  const stmt = db.prepare(`
    INSERT INTO book_issues (book_id, book_title, student_name, student_roll_no, student_phone, issue_date, due_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'issued')
  `);
  const res = stmt.run(book_id, book_title, student_name.trim(), student_roll_no.trim(), cleanPhone, finalIssueDate, finalDueDate);

  // Mark book unavailable
  db.prepare('UPDATE books SET available = 0 WHERE id = ?').run(book_id);

  return getIssueById(res.lastInsertRowid);
}

function getIssueById(id) {
  const issue = db.prepare('SELECT * FROM book_issues WHERE id = ?').get(id);
  if (!issue) return null;
  const metrics = calculateLoanMetrics(issue.issue_date, issue.due_date, issue.return_date);
  return { ...issue, ...metrics };
}

function getAllIssues(filter = 'all') {
  let query = 'SELECT * FROM book_issues';
  if (filter === 'active') {
    query += " WHERE status = 'issued'";
  } else if (filter === 'returned') {
    query += " WHERE status = 'returned'";
  }
  query += ' ORDER BY id DESC';

  const rows = db.prepare(query).all();
  return rows.map(issue => {
    const metrics = calculateLoanMetrics(issue.issue_date, issue.due_date, issue.return_date);
    return { ...issue, ...metrics };
  });
}

function returnBook(issue_id) {
  const issue = db.prepare('SELECT * FROM book_issues WHERE id = ?').get(issue_id);
  if (!issue) return null;

  const return_date = formatDateString(new Date());
  db.prepare("UPDATE book_issues SET status = 'returned', return_date = ? WHERE id = ?").run(return_date, issue_id);
  db.prepare('UPDATE books SET available = 1 WHERE id = ?').run(issue.book_id);

  return getIssueById(issue_id);
}

function deleteIssue(issue_id) {
  const issue = db.prepare('SELECT * FROM book_issues WHERE id = ?').get(issue_id);
  if (!issue) return null;

  db.prepare('DELETE FROM book_issues WHERE id = ?').run(issue_id);
  db.prepare('UPDATE books SET available = 1 WHERE id = ?').run(issue.book_id);
  return issue;
}

function simulateIssueScenario(issue_id, scenario) {
  const issue = db.prepare('SELECT * FROM book_issues WHERE id = ?').get(issue_id);
  if (!issue) return null;

  const now = new Date();
  let newIssueDate;
  let newDueDate;

  if (scenario === 'day14') {
    // Exactly Day 14 of 15-day period (1 day before due date)
    const d = new Date(now);
    d.setDate(d.getDate() - 14);
    newIssueDate = formatDateString(d);
    newDueDate = addDays(formatDateString(now), 1); // Due tomorrow!
    db.prepare("UPDATE book_issues SET issue_date = ?, due_date = ?, day14_reminder_sent = 0, status = 'issued', return_date = NULL WHERE id = ?")
      .run(newIssueDate, newDueDate, issue_id);
  } else if (scenario === 'day15') {
    // Day 15 (Due today!)
    const d = new Date(now);
    d.setDate(d.getDate() - 15);
    newIssueDate = formatDateString(d);
    newDueDate = formatDateString(now); // Due today
    db.prepare("UPDATE book_issues SET issue_date = ?, due_date = ?, due_day_reminder_sent = 0, status = 'issued', return_date = NULL WHERE id = ?")
      .run(newIssueDate, newDueDate, issue_id);
  } else if (scenario === 'overdue') {
    // 18 days elapsed (3 days overdue)
    const d = new Date(now);
    d.setDate(d.getDate() - 18);
    newIssueDate = formatDateString(d);
    newDueDate = addDays(formatDateString(now), -3); // Due 3 days ago
    db.prepare("UPDATE book_issues SET issue_date = ?, due_date = ?, overdue_reminder_sent = 0, status = 'issued', return_date = NULL WHERE id = ?")
      .run(newIssueDate, newDueDate, issue_id);
  } else if (scenario === 'day1') {
    // Just issued today
    newIssueDate = formatDateString(now);
    newDueDate = addDays(newIssueDate, 15);
    db.prepare("UPDATE book_issues SET issue_date = ?, due_date = ?, day14_reminder_sent = 0, due_day_reminder_sent = 0, overdue_reminder_sent = 0, status = 'issued', return_date = NULL WHERE id = ?")
      .run(newIssueDate, newDueDate, issue_id);
  }

  return getIssueById(issue_id);
}

function logReminder({ issue_id, student_name, student_phone, book_title, reminder_type, message_text, channel = 'WhatsApp' }) {
  const stmt = db.prepare(`
    INSERT INTO reminder_logs (issue_id, student_name, student_phone, book_title, reminder_type, message_text, channel)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(issue_id, student_name, student_phone, book_title, reminder_type, message_text, channel);
  return db.prepare('SELECT * FROM reminder_logs WHERE id = ?').get(res.lastInsertRowid);
}

function getAllReminderLogs() {
  return db.prepare('SELECT * FROM reminder_logs ORDER BY id DESC').all();
}

// Automated Scanner: Detects Day 14 prior reminders, Due Date reminders, and Overdue alerts
function scanAndTriggerReminders() {
  const activeIssues = db.prepare("SELECT * FROM book_issues WHERE status = 'issued'").all();
  const triggered = [];

  for (const raw of activeIssues) {
    const issue = { ...raw, ...calculateLoanMetrics(raw.issue_date, raw.due_date, raw.return_date) };

    // Day 14 Check (1 Day Before Due Date)
    if (issue.daysRemaining === 1 && !issue.day14_reminder_sent) {
      const msg = generateWhatsAppMessage(issue, 'day14_prior');
      const log = logReminder({
        issue_id: issue.id,
        student_name: issue.student_name,
        student_phone: issue.student_phone,
        book_title: issue.book_title,
        reminder_type: 'day14_prior',
        message_text: msg,
        channel: 'WhatsApp'
      });
      db.prepare('UPDATE book_issues SET day14_reminder_sent = 1 WHERE id = ?').run(issue.id);
      triggered.push({ ...log, issue, alertName: 'Day 14 (1 Day Before Due Date)' });
    }

    // Due Date Check (Day 15 - Due Today)
    if (issue.daysRemaining === 0 && !issue.due_day_reminder_sent) {
      const msg = generateWhatsAppMessage(issue, 'due_date');
      const log = logReminder({
        issue_id: issue.id,
        student_name: issue.student_name,
        student_phone: issue.student_phone,
        book_title: issue.book_title,
        reminder_type: 'due_date',
        message_text: msg,
        channel: 'WhatsApp'
      });
      db.prepare('UPDATE book_issues SET due_day_reminder_sent = 1 WHERE id = ?').run(issue.id);
      triggered.push({ ...log, issue, alertName: 'Day 15 (Due Today)' });
    }

    // Overdue Check (Day 16+)
    if (issue.daysRemaining < 0 && !issue.overdue_reminder_sent) {
      const msg = generateWhatsAppMessage(issue, 'overdue');
      const log = logReminder({
        issue_id: issue.id,
        student_name: issue.student_name,
        student_phone: issue.student_phone,
        book_title: issue.book_title,
        reminder_type: 'overdue',
        message_text: msg,
        channel: 'WhatsApp'
      });
      db.prepare('UPDATE book_issues SET overdue_reminder_sent = 1 WHERE id = ?').run(issue.id);
      triggered.push({ ...log, issue, alertName: 'Overdue Alert' });
    }
  }

  return triggered;
}

// Seed sample student issues demonstrating all key phases (especially Day 14!)
function seedSampleIssuesIfEmpty() {
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM book_issues').get();
  if (countRow && countRow.count === 0) {
    const now = new Date();

    // 1. Day 14 Student (Issued 13 days ago -> Due tomorrow, Day 14 reminder ready!)
    const d14Issue = new Date(now);
    d14Issue.setDate(d14Issue.getDate() - 13);
    const d14Due = addDays(formatDateString(d14Issue), 15);

    // 2. Due Today Student (Issued 15 days ago -> Due today!)
    const d15Issue = new Date(now);
    d15Issue.setDate(d15Issue.getDate() - 15);
    const d15Due = formatDateString(now);

    // 3. Normal Active Student (Issued 2 days ago -> 13 days remaining)
    const d3Issue = new Date(now);
    d3Issue.setDate(d3Issue.getDate() - 2);
    const d3Due = addDays(formatDateString(d3Issue), 15);

    // 4. Overdue Student (Issued 19 days ago -> 4 days overdue)
    const dOverdueIssue = new Date(now);
    dOverdueIssue.setDate(dOverdueIssue.getDate() - 19);
    const dOverdueDue = addDays(formatDateString(dOverdueIssue), 15);

    const samples = [
      {
        book_id: 12,
        book_title: 'Cyber Security & Digital Forensics: Investigation Blueprint',
        student_name: 'Rahul Sharma',
        student_roll_no: '2026RRU-CS042',
        student_phone: '919876543210',
        issue_date: formatDateString(d14Issue),
        due_date: d14Due
      },
      {
        book_id: 14,
        book_title: 'Forensic Science in Criminal Investigation & Trials',
        student_name: 'Priya Patel',
        student_roll_no: '2026RRU-FS019',
        student_phone: '919812345678',
        issue_date: formatDateString(d15Issue),
        due_date: d15Due
      },
      {
        book_id: 11,
        book_title: 'Internal Security in India: Issues and Perspectives',
        student_name: 'Aditya Verma',
        student_roll_no: '2026RRU-NS008',
        student_phone: '919899001122',
        issue_date: formatDateString(d3Issue),
        due_date: d3Due
      },
      {
        book_id: 15,
        book_title: 'The Indian Penal Code with Criminal Procedure',
        student_name: 'Vikram Rathore',
        student_roll_no: '2026RRU-LW031',
        student_phone: '919777888999',
        issue_date: formatDateString(dOverdueIssue),
        due_date: dOverdueDue
      }
    ];

    const insertStmt = db.prepare(`
      INSERT INTO book_issues (book_id, book_title, student_name, student_roll_no, student_phone, issue_date, due_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'issued')
    `);

    for (const s of samples) {
      insertStmt.run(s.book_id, s.book_title, s.student_name, s.student_roll_no, s.student_phone, s.issue_date, s.due_date);
      db.prepare('UPDATE books SET available = 0 WHERE id = ?').run(s.book_id);
    }

    console.log('[Database] Seeded 4 sample book issues demonstrating Day 14, Due Today, Normal, and Overdue states');
  }
}

seedSampleIssuesIfEmpty();

// Stats
function getStats() {
  const totalBooks = db.prepare('SELECT COUNT(*) AS count FROM books').get().count;
  const availableBooks = db.prepare('SELECT COUNT(*) AS count FROM books WHERE available = 1').get().count;
  const totalMembers = db.prepare('SELECT COUNT(*) AS count FROM members').get().count;
  const activeReservations = db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE status = 'active'").get().count;
  const totalSubscribers = db.prepare('SELECT COUNT(*) AS count FROM newsletter_subscribers').get().count;

  // Book issue & reminder stats
  const allIssues = getAllIssues('active');
  const activeIssuesCount = allIssues.length;
  let day14Count = 0;
  let dueTodayCount = 0;
  let overdueCount = 0;

  for (const iss of allIssues) {
    if (iss.daysRemaining === 1) day14Count++;
    else if (iss.daysRemaining === 0) dueTodayCount++;
    else if (iss.daysRemaining < 0) overdueCount++;
  }

  const totalRemindersSent = db.prepare('SELECT COUNT(*) AS count FROM reminder_logs').get().count;

  return {
    totalBooks,
    availableBooks,
    totalMembers,
    activeReservations,
    totalSubscribers,
    activeIssuesCount,
    day14Count,
    dueTodayCount,
    overdueCount,
    totalRemindersSent
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
  deleteMember,
  createReservation,
  getReservations,
  cancelReservation,
  subscribeNewsletter,
  getNewsletterSubscribers,
  deleteSubscriber,
  getStats,
  syncBooksFromCatalog,
  // Book Issues & Auto-Reminders
  createIssue,
  getIssueById,
  getAllIssues,
  returnBook,
  deleteIssue,
  simulateIssueScenario,
  generateWhatsAppMessage,
  logReminder,
  getAllReminderLogs,
  scanAndTriggerReminders
};

