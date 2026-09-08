const express = require('express');
const cors = require('cors');
const path = require('node:path');
const os = require('node:os');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

// ==========================================
// BOOKS API
// ==========================================

// GET /api/books - Get all books with optional category or search filters
app.get('/api/books', (req, res) => {
  try {
    const { category, search } = req.query;
    const books = db.getAllBooks(category, search);
    res.json({ success: true, count: books.length, books });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/books/:id - Get a single book by ID
app.get('/api/books/:id', (req, res) => {
  try {
    const book = db.getBookById(req.params.id);
    if (!book) {
      return res.status(404).json({ success: false, error: 'Book not found' });
    }
    res.json({ success: true, book });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/books - Add a new book to catalog
app.post('/api/books', (req, res) => {
  try {
    const { title, author, category, year, color, tag } = req.body;
    if (!title || !author || !category || !year) {
      return res.status(400).json({
        success: false,
        error: 'Please provide title, author, category, and year.'
      });
    }

    const newBook = db.createBook({
      title: title.trim(),
      author: author.trim(),
      category: category.toLowerCase().trim(),
      year: String(year).trim(),
      color: color || 'coral',
      tag: tag ? tag.trim() : 'New arrival'
    });

    console.log(`[DATA COLLECTED] Catalog Book Added: "${newBook.title}" by ${newBook.author} (${newBook.year})`);

    res.status(201).json({
      success: true,
      message: 'Book successfully added to catalog.',
      book: newBook
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/books/:id - Update book details
app.put('/api/books/:id', (req, res) => {
  try {
    const updated = db.updateBook(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Book not found' });
    }
    res.json({ success: true, message: 'Book updated.', book: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/books/:id - Delete a book
app.delete('/api/books/:id', (req, res) => {
  try {
    const deleted = db.deleteBook(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Book not found' });
    }
    res.json({ success: true, message: 'Book deleted from catalog.', book: deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// AUTHENTICATION & MEMBERS API
// ==========================================

// POST /api/auth/register - Register a new member
app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Full name, email, and password are required.'
      });
    }

    if (password.length < 4) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 4 characters long.'
      });
    }

    const member = db.createMember({ name, email, password });
    console.log(`[DATA COLLECTED] Member Registered: "${member.name}" <${member.email}> (ID: ${member.id})`);
    res.status(201).json({
      success: true,
      message: 'Membership created successfully.',
      member
    });
  } catch (err) {
    if (err.code === 'EMAIL_EXISTS') {
      return res.status(409).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/auth/login - Log in an existing member
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.'
      });
    }

    const member = db.authenticateMember(email, password);
    if (!member) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.'
      });
    }

    console.log(`[USER LOGIN] Member Logged In: "${member.name}" <${member.email}>`);
    res.json({
      success: true,
      message: `Welcome back, ${member.name}.`,
      member
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/auth/members - View all registered members
app.get('/api/auth/members', (req, res) => {
  try {
    const members = db.getAllMembers();
    res.json({ success: true, count: members.length, members });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// RESERVATIONS API
// ==========================================

// GET /api/reservations - Get reservations (optionally filtered by ?email=...)
app.get('/api/reservations', (req, res) => {
  try {
    const { email } = req.query;
    const reservations = db.getReservations(email);
    res.json({ success: true, count: reservations.length, reservations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/reservations - Reserve a book
app.post('/api/reservations', (req, res) => {
  try {
    const { book_id, member_name, member_email } = req.body;
    if (!book_id || !member_name || !member_email) {
      return res.status(400).json({
        success: false,
        error: 'Book ID, member name, and email are required.'
      });
    }

    const reservation = db.createReservation({ book_id, member_name, member_email });
    console.log(`[DATA COLLECTED] Book Reservation: "${reservation.book_title}" reserved by "${reservation.member_name}" <${reservation.member_email}> (Hold ID: ${reservation.id})`);
    res.status(201).json({
      success: true,
      message: `Successfully reserved "${reservation.book_title}". We will hold it for 2 days.`,
      reservation
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/reservations/:id - Cancel a reservation
app.delete('/api/reservations/:id', (req, res) => {
  try {
    const cancelled = db.cancelReservation(req.params.id);
    if (!cancelled) {
      return res.status(404).json({ success: false, error: 'Reservation not found' });
    }
    console.log(`[DATA UPDATED] Reservation Cancelled: ID ${req.params.id}`);
    res.json({ success: true, message: 'Reservation cancelled.', reservation: cancelled });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// NEWSLETTER API
// ==========================================

// POST /api/newsletter - Subscribe to the reading list
app.post('/api/newsletter', (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address.'
      });
    }

    const result = db.subscribeNewsletter(email);
    console.log(`[DATA COLLECTED] Newsletter Subscriber: <${email}> (${result.alreadySubscribed ? 'already subscribed' : 'new member added'})`);
    if (result.alreadySubscribed) {
      return res.json({
        success: true,
        message: 'You are already on our reading list!'
      });
    }

    res.status(201).json({
      success: true,
      message: 'You have been added to the reading list. Welcome in!'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/newsletter - Get reading list subscribers
app.get('/api/newsletter', (req, res) => {
  try {
    const subscribers = db.getNewsletterSubscribers();
    res.json({ success: true, count: subscribers.length, subscribers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// STATS / HEALTH CHECK API
// ==========================================

// GET /api/stats - High-level statistics
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Root handler to always serve library.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'library.html'));
});

// Start Server listening on 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const localIps = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIps.push(net.address);
      }
    }
  }

  console.log(`====================================================`);
  console.log(`🚀 THE SMART LIBRARY is LIVE & COLLECTING DATA!`);
  console.log(`📍 Local access:    http://localhost:${PORT}`);
  localIps.forEach(ip => {
    console.log(`🌐 Network access:  http://${ip}:${PORT}`);
  });
  console.log(`📂 Database:        library.db (SQLite with WAL mode)`);
  console.log(`📚 Catalog API:     http://localhost:${PORT}/api/books`);
  console.log(`📊 Statistics API:  http://localhost:${PORT}/api/stats`);
  console.log(`====================================================`);
});

