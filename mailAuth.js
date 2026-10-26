/**
 * Mail Authenticity & Verification System
 * The Smart Library - Institutional & Member Verification Engine
 */

const crypto = require('node:crypto');
const nodemailer = require('nodemailer');

// Known disposable and temporary email domain blacklist
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com',
  'sharklasers.com', 'throwawaymail.com', 'yopmail.com', 'getairmail.com',
  'temp-mail.org', 'dispostable.com', 'trashmail.com', 'fakemailgenerator.com',
  'generator.email', 'crazymailing.com', 'mohmal.com', 'maildrop.cc',
  'nada.ltd', 'emailondeck.com', 'inboxkitten.com', 'mytemp.email',
  'tempmailo.com', 'burnermail.io', 'dropmail.me', 'tempail.com'
]);

// Institutional / Academic Domain Suffixes
const INSTITUTIONAL_DOMAINS = [
  'rru.ac.in',
  '.ac.in',
  '.edu.in',
  '.edu',
  '.ernet.in',
  '.res.in'
];

/**
 * Validate email structure, domain legitimacy, and disposable status
 */
function validateEmailAuthenticity(email) {
  if (!email || typeof email !== 'string') {
    return { isValid: false, error: 'Email address is required.' };
  }

  const cleanEmail = email.trim().toLowerCase();

  // RFC 5322 compliant regex for basic syntax
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(cleanEmail)) {
    return { isValid: false, error: 'Invalid email address format (e.g., student@university.edu).' };
  }

  const parts = cleanEmail.split('@');
  if (parts.length !== 2) {
    return { isValid: false, error: 'Malformed email structure.' };
  }

  const domain = parts[1].toLowerCase();

  // Check disposable blacklist
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      isValid: false,
      isDisposable: true,
      error: `The email domain "${domain}" is a temporary/disposable provider. Please provide an authentic personal or university email address.`
    };
  }

  // Check institutional domain
  const isInstitutional = INSTITUTIONAL_DOMAINS.some(inst => domain.endsWith(inst));

  return {
    isValid: true,
    email: cleanEmail,
    domain,
    isDisposable: false,
    isInstitutional,
    institutionName: isInstitutional ? (domain.includes('rru') ? 'Rashtriya Raksha University' : 'Academic Institution') : null
  };
}

/**
 * Generate a cryptographically secure 6-digit verification code
 */
function generateVerificationCode() {
  return crypto.randomInt(100000, 999999).toString();
}

// In-memory simulation cache for hackathon evaluator preview
const recentDispatches = new Map();

/**
 * Build HTML email template for verification
 */
function buildVerificationEmailHtml({ name, code, email, isInstitutional, expiresMinutes = 15 }) {
  const badgeText = isInstitutional ? '🎓 INSTITUTIONAL VERIFICATION' : '🛡️ MEMBER AUTHENTICITY';
  const badgeColor = isInstitutional ? '#0ea5e9' : '#10b981';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>The Smart Library - Email Verification</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 28px; text-align: center; color: #ffffff; }
    .logo-badge { display: inline-block; font-size: 24px; margin-bottom: 8px; }
    .title { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; margin: 0; }
    .subtitle { font-size: 13px; color: #94a3b8; margin-top: 6px; letter-spacing: 1px; text-transform: uppercase; }
    .content { padding: 32px 28px; }
    .greeting { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
    .text { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 0.8px; color: #ffffff; background-color: ${badgeColor}; margin-bottom: 20px; }
    .otp-box { background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .otp-label { font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px; }
    .otp-code { font-size: 34px; font-weight: 900; letter-spacing: 10px; color: #0f172a; font-family: 'Courier New', monospace; }
    .expiry { font-size: 12px; color: #64748b; margin-top: 8px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 28px; text-align: center; font-size: 12px; color: #94a3b8; }
    .highlight { color: #0284c7; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-badge">📚 🛡️</div>
      <h1 class="title">THE SMART LIBRARY</h1>
      <div class="subtitle">Automated Circulation &amp; Learning Resources</div>
    </div>
    <div class="content">
      <span class="badge">${badgeText}</span>
      <div class="greeting">Hello, ${name || 'Reader'}!</div>
      <p class="text">
        Welcome to <strong>The Smart Library</strong>. To complete your registration and activate your student circulation privileges, please authenticate your email address using the one-time code below.
      </p>
      <div class="otp-box">
        <div class="otp-label">Your Authenticity Code</div>
        <div class="otp-code">${code}</div>
        <div class="expiry">⏱️ Valid for ${expiresMinutes} minutes</div>
      </div>
      <p class="text" style="font-size: 13px; color: #64748b;">
        This code ensures your account is protected against automated bots and unauthorized identity claims. If you did not initiate this registration, please disregard this notice.
      </p>
    </div>
    <div class="footer">
      <div>Rashtriya Raksha University (RRU) &bull; Library &amp; Learning Resources Branch</div>
      <div style="margin-top: 6px;">Prevention over Punishment &bull; Smart India Hackathon</div>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Dispatch verification email (Real SMTP if configured, Simulated for evaluation/hackathons)
 */
async function sendVerificationMail({ email, name, code, isInstitutional }) {
  const htmlContent = buildVerificationEmailHtml({ name, code, email, isInstitutional });

  // Store in simulation cache
  recentDispatches.set(email.toLowerCase(), {
    email: email.toLowerCase(),
    name,
    code,
    isInstitutional,
    html: htmlContent,
    dispatchedAt: new Date().toISOString()
  });

  // Check if real SMTP credentials are provided in environment
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: smtpUser, pass: smtpPass }
      });

      await transporter.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'The Smart Library'}" <${process.env.SMTP_FROM_EMAIL || smtpUser}>`,
        to: email,
        subject: `Your Smart Library Authenticity Code: ${code}`,
        text: `Hello ${name || 'Reader'},\n\nYour Smart Library email authenticity verification code is: ${code}\nThis code is valid for 15 minutes.\n\nHappy reading!`,
        html: htmlContent
      });

      console.log(`[MAIL AUTH] Dispatched REAL verification email via SMTP to <${email}>`);
      return { success: true, mode: 'smtp', email };
    } catch (err) {
      console.error('[MAIL AUTH] SMTP Delivery error, falling back to simulated dispatch:', err.message);
    }
  }

  // Simulated dispatch (Demo / Hackathon evaluation mode)
  console.log(`====================================================`);
  console.log(`✉️ [MAIL AUTHENTICITY] Verification Code Generated`);
  console.log(`👤 Recipient:  "${name}" <${email}>`);
  console.log(`🔑 OTP Code:   ${code}`);
  console.log(`🎓 Category:   ${isInstitutional ? 'Institutional/Academic' : 'Standard Member'}`);
  console.log(`🌐 Preview:    http://localhost:3000/api/auth/verification-preview/${encodeURIComponent(email)}`);
  console.log(`====================================================`);

  return { success: true, mode: 'simulated', email, code };
}

function getLatestDispatch(email) {
  return recentDispatches.get(email.toLowerCase()) || null;
}

module.exports = {
  validateEmailAuthenticity,
  generateVerificationCode,
  sendVerificationMail,
  getLatestDispatch
};

