const express = require('express');
const cors = require('cors');
const path = require('node:path');
const os = require('node:os');
const db = require('./database');
const mailAuth = require('./mailAuth');

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
// MOTIVATIONAL QUOTES API (DAILY ROTATION)
// ==========================================

// GET /api/quote-of-the-day - Get today's daily motivational quote (rotates daily)
app.get(['/api/quote-of-the-day', '/api/quotes/daily'], (req, res) => {
  try {
    const quote = db.getDailyQuote();
    res.json({ success: true, quote });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/quotes - Get all 15 motivational quotes
app.get('/api/quotes', (req, res) => {
  try {
    const quotes = db.getAllQuotes();
    res.json({ success: true, count: quotes.length, quotes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/quotes/random - Get a random inspirational quote
app.get('/api/quotes/random', (req, res) => {
  try {
    const quote = db.getRandomQuote();
    res.json({ success: true, quote });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

// POST /api/auth/register - Register a new member with Mail Authenticity Verification
app.post('/api/auth/register', async (req, res) => {
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

    // Step 1: Mail Authenticity & Domain Legitimacy Check
    const authCheck = mailAuth.validateEmailAuthenticity(email);
    if (!authCheck.isValid) {
      console.log(`[MAIL AUTH BLOCKED] Registration rejected for "${email}": ${authCheck.error}`);
      return res.status(400).json({
        success: false,
        error: authCheck.error,
        isDisposable: authCheck.isDisposable || false
      });
    }

    // Step 2: Create Member with pending authenticity verification
    const member = db.createMember({
      name: name.trim(),
      email: authCheck.email,
      password,
      isInstitutional: authCheck.isInstitutional ? 1 : 0,
      isVerified: 0
    });

    // Step 3: Generate 6-digit cryptographic verification code
    const verificationCode = mailAuth.generateVerificationCode();
    db.saveVerificationCode(member.email, verificationCode, 15);

    // Step 4: Dispatch verification email (SMTP or Interactive Simulator)
    await mailAuth.sendVerificationMail({
      email: member.email,
      name: member.name,
      code: verificationCode,
      isInstitutional: authCheck.isInstitutional
    });

    console.log(`[DATA COLLECTED] Member Registered (Pending Mail Verification): "${member.name}" <${member.email}>`);

    res.status(201).json({
      success: true,
      requiresVerification: true,
      message: `Verification code sent to ${member.email}. Please verify your email authenticity to complete registration.`,
      email: member.email,
      isInstitutional: authCheck.isInstitutional,
      institutionName: authCheck.institutionName,
      previewOtp: verificationCode
    });
  } catch (err) {
    if (err.code === 'EMAIL_EXISTS') {
      return res.status(409).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/auth/verify-email - Authenticate and verify email OTP code
app.post('/api/auth/verify-email', (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: 'Email and 6-digit verification code are required.'
      });
    }

    const result = db.verifyEmailCode(email, code);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    console.log(`[MAIL AUTH VERIFIED] Email Authenticity Confirmed for: "${result.member.name}" <${result.member.email}>`);

    res.json({
      success: true,
      message: 'Email authenticity verified! Your account is active.',
      member: result.member
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/auth/resend-code - Resend a fresh verification code
app.post('/api/auth/resend-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email address is required.' });
    }

    const member = db.findMemberByEmail(email);
    if (!member) {
      return res.status(404).json({ success: false, error: 'No account found with this email address.' });
    }

    if (member.is_verified) {
      return res.status(400).json({ success: false, error: 'This email is already verified. You can log in directly.' });
    }

    const newCode = mailAuth.generateVerificationCode();
    db.saveVerificationCode(member.email, newCode, 15);

    await mailAuth.sendVerificationMail({
      email: member.email,
      name: member.name,
      code: newCode,
      isInstitutional: Boolean(member.is_institutional)
    });

    res.json({
      success: true,
      message: `Fresh verification code dispatched to ${member.email}.`,
      previewOtp: newCode
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/auth/verification-preview/:email - Evaluator live preview of dispatched verification email
app.get('/api/auth/verification-preview/:email', (req, res) => {
  const dispatch = mailAuth.getLatestDispatch(req.params.email);
  if (!dispatch) {
    return res.status(404).send('<h3>No recent verification email found for this address.</h3>');
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(dispatch.html);
});

// POST /api/auth/login - Log in an existing member with Mail Authenticity enforcement
app.post('/api/auth/login', async (req, res) => {
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

    // Enforce email authenticity verification
    if (!member.is_verified) {
      let activeCode = db.getLatestVerificationCode(member.email);
      let previewOtp = activeCode ? activeCode.code : null;

      // Only generate and dispatch a new code if no active code exists or has expired
      if (!activeCode || new Date(activeCode.expires_at) <= new Date()) {
        const newCode = mailAuth.generateVerificationCode();
        db.saveVerificationCode(member.email, newCode, 15);
        await mailAuth.sendVerificationMail({
          email: member.email,
          name: member.name,
          code: newCode,
          isInstitutional: Boolean(member.is_institutional)
        });
        previewOtp = newCode;
      }

      console.log(`[LOGIN BLOCKED] Unverified account attempt: <${member.email}>`);
      return res.status(403).json({
        success: false,
        requiresVerification: true,
        email: member.email,
        error: 'Email authenticity not verified. A 6-digit security code has been dispatched to your email.',
        previewOtp
      });
    }

    console.log(`[USER LOGIN] Authenticated Member: "${member.name}" <${member.email}>`);
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

// GET /api/rru-info - Rashtriya Raksha University LLRB official data & metrics
app.get('/api/rru-info', (req, res) => {
  res.json({
    success: true,
    institution: {
      name: 'Rashtriya Raksha University (RRU)',
      subtitle: 'An Institution of National Importance, Ministry of Home Affairs, Government of India',
      branch: 'Library & Learning Resources Branch (LLRB)',
      campus: 'Lavad, Dehgam, Gandhinagar - 382305, Gujarat, India',
      officialUrl: 'https://rru.ac.in/campus-life/library',
      opacUrl: 'https://opac.rru.ac.in',
      email: 'llrb@rru.ac.in'
    },
    collectionMetrics: {
      printBooks: '15,131+',
      ebooks: '5,12,324+',
      ejournals: '17,533+',
      databases: '56+',
      eperiodicals: '11,116+',
      printPeriodicals: '43+',
      system: 'Koha Integrated Library Management System (LMS)',
      remoteAccess: 'MyLOFT Platform'
    },
    timings: {
      weekdays: 'Monday – Friday: 08:00 AM – 08:00 PM',
      weekends: 'Saturday – Sunday: 10:00 AM – 06:00 PM',
      examPeriod: 'Extended study hours up to 11:00 PM',
      digitalAccess: '24/7 Remote Access via MyLOFT & Web OPAC'
    },
    keyPersonnel: [
      { name: 'Dr. Upendra Pandya', role: 'Deputy Librarian', responsibility: 'Library Administration', email: 'dyl.llrb@rru.ac.in' },
      { name: 'Mr. Pragneshkumar Parekh', role: 'Assistant Librarian', responsibility: 'Overall Library Activities', email: 'library@rru.ac.in' },
      { name: 'Mr. Gaurang Raval', role: 'Library & Information Officer', responsibility: 'Online Resources, Databases, Remote Access, Koha-LMS', email: 'lio2.llrb@rru.ac.in' }
    ]
  });
});

// ==========================================
// BOOK ISSUES & WHATSAPP AUTO-REMINDER API
// ==========================================

// GET /api/issues - List all issued books with loan metrics & reminder status
app.get('/api/issues', (req, res) => {
  try {
    const filter = req.query.filter || 'all';
    const issues = db.getAllIssues(filter);
    res.json({ success: true, count: issues.length, issues });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/issues/:id - Get a single issue record
app.get('/api/issues/:id', (req, res) => {
  try {
    const issue = db.getIssueById(req.params.id);
    if (!issue) return res.status(404).json({ success: false, error: 'Issue record not found' });
    res.json({ success: true, issue });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/issues - Issue a book to a student
app.post('/api/issues', (req, res) => {
  try {
    const { book_id, student_name, student_roll_no, student_phone, issue_date, due_date } = req.body;
    if (!book_id || !student_name || !student_roll_no || !student_phone) {
      return res.status(400).json({
        success: false,
        error: 'Please provide book_id, student_name, student_roll_no, and student_phone (WhatsApp number).'
      });
    }

    const newIssue = db.createIssue({
      book_id: Number(book_id),
      student_name,
      student_roll_no,
      student_phone,
      issue_date,
      due_date
    });

    console.log(`[BOOK ISSUED] "${newIssue.book_title}" issued to ${newIssue.student_name} (${newIssue.student_roll_no}), WhatsApp: ${newIssue.student_phone}. Due: ${newIssue.due_date} (15 days loan)`);
    res.status(201).json({ success: true, message: 'Book successfully issued to student.', issue: newIssue });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/issues/:id/return - Return an issued book
app.post('/api/issues/:id/return', (req, res) => {
  try {
    const updated = db.returnBook(req.params.id);
    if (!updated) return res.status(404).json({ success: false, error: 'Issue record not found' });
    console.log(`[BOOK RETURNED] "${updated.book_title}" returned by ${updated.student_name}. Marked available in catalog.`);
    res.json({ success: true, message: 'Book marked as returned.', issue: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/issues/:id - Delete an issue record
app.delete('/api/issues/:id', (req, res) => {
  try {
    const deleted = db.deleteIssue(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Issue record not found' });
    res.json({ success: true, message: 'Issue record deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/issues/:id/simulate - Fast-forward / simulate loan scenario
app.post('/api/issues/:id/simulate', (req, res) => {
  try {
    const { scenario } = req.body; // 'day14', 'day15', 'overdue', 'day1'
    if (!scenario) return res.status(400).json({ success: false, error: 'Please specify scenario: day14, day15, overdue, or day1.' });
    const simulated = db.simulateIssueScenario(req.params.id, scenario);
    if (!simulated) return res.status(404).json({ success: false, error: 'Issue record not found' });
    console.log(`[SIMULATION TRIGGERED] Issue #${simulated.id} simulated to scenario "${scenario}" -> Status: ${simulated.badgeText}`);
    res.json({ success: true, message: `Simulated to ${scenario}.`, issue: simulated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/reminders/scan - Automated scheduler scanner to evaluate all loans
app.post('/api/reminders/scan', (req, res) => {
  try {
    const triggered = db.scanAndTriggerReminders();
    console.log(`[REMINDER SCAN] Evaluated active loans. Triggered ${triggered.length} automated WhatsApp reminders.`);
    res.json({ success: true, count: triggered.length, triggered });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/reminders/logs - Get all sent reminder logs
app.get('/api/reminders/logs', (req, res) => {
  try {
    const logs = db.getAllReminderLogs();
    res.json({ success: true, count: logs.length, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/reminders/generate-whatsapp - Generate WhatsApp click-to-chat URL and preview text
app.post('/api/reminders/generate-whatsapp', (req, res) => {
  try {
    const { issue_id, reminder_type } = req.body;
    const issue = db.getIssueById(issue_id);
    if (!issue) return res.status(404).json({ success: false, error: 'Issue record not found' });

    const type = reminder_type || (issue.daysRemaining === 1 ? 'day14_prior' : (issue.daysRemaining === 0 ? 'due_date' : 'overdue'));
    const message = db.generateWhatsAppMessage(issue, type);
    const cleanPhone = String(issue.student_phone).replace(/[^\d]/g, '');
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

    // Log the reminder
    const log = db.logReminder({
      issue_id: issue.id,
      student_name: issue.student_name,
      student_phone: issue.student_phone,
      book_title: issue.book_title,
      reminder_type: type,
      message_text: message,
      channel: 'WhatsApp'
    });

    res.json({
      success: true,
      issue,
      reminder_type: type,
      message,
      whatsappUrl,
      phone: cleanPhone,
      log
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Periodic background auto-reminder scanner (every 30 minutes)
setInterval(() => {
  try {
    const alerts = db.scanAndTriggerReminders();
    if (alerts.length > 0) {
      console.log(`[AUTO-SCHEDULER] Periodic background scan triggered ${alerts.length} WhatsApp reminders.`);
    }
  } catch (err) {
    console.error('[AUTO-SCHEDULER ERROR]', err.message);
  }
}, 30 * 60 * 1000);

// ==========================================
// ADMIN PORTAL API
// ==========================================

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin1234';

// POST /api/admin/login - Authenticate admin credentials
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    console.log(`[ADMIN ACCESS] Admin successfully logged in at ${new Date().toLocaleTimeString()}`);
    return res.json({
      success: true,
      message: 'Admin authentication successful.',
      admin: {
        username: ADMIN_USER,
        role: 'superadmin',
        token: 'adm_session_' + Buffer.from(`${ADMIN_USER}:${Date.now()}`).toString('base64')
      }
    });
  }

  console.warn(`[ADMIN ACCESS ATTEMPT] Failed admin login attempt for username: "${username}"`);
  return res.status(401).json({ success: false, error: 'Invalid admin credentials. Access denied.' });
});

// DELETE /api/admin/members/:id - Admin delete a registered member
app.delete('/api/admin/members/:id', (req, res) => {
  try {
    const deleted = db.deleteMember(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Member not found.' });
    }
    console.log(`[ADMIN ACTION] Deleted member: "${deleted.name}" <${deleted.email}> [ID: ${deleted.id}]`);
    res.json({ success: true, message: `Member "${deleted.name}" removed from database.`, member: deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/admin/subscribers/:id - Admin remove a newsletter subscriber
app.delete('/api/admin/subscribers/:id', (req, res) => {
  try {
    const deleted = db.deleteSubscriber(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Subscriber not found.' });
    }
    console.log(`[ADMIN ACTION] Removed newsletter subscriber: <${deleted.email}> [ID: ${deleted.id}]`);
    res.json({ success: true, message: `Subscriber <${deleted.email}> removed.`, subscriber: deleted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve admin portal webpage
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Root handler to always serve library.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'library.html'));
});

// Start Server listening on 0.0.0.0 (when running locally or on non-serverless hosts)
if (!process.env.VERCEL) {
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
}

// Export Express app for Vercel Serverless Functions
module.exports = app;

