const express = require('express');
const router = express.Router();
const { loadConfig, saveConfig } = require('../config-manager');
const HestiaClient = require('../hestia-client');
const db = require('../db');
const emailService = require('../email-service');
const crypto = require('crypto');

const CAPTCHA_SECRET = process.env.CAPTCHA_SECRET || 'hosta_ph_chat_secret_2026';

function generateCaptcha() {
  const n1 = Math.floor(Math.random() * 8) + 2;
  const n2 = Math.floor(Math.random() * 8) + 1;
  const answer = String(n1 + n2);
  const expires = Date.now() + 10 * 60 * 1000;
  const payload = `${answer}:${expires}`;
  const hmac = crypto.createHmac('sha256', CAPTCHA_SECRET).update(payload).digest('hex');
  const token = Buffer.from(`${payload}:${hmac}`).toString('base64');
  return {
    question: `What is ${n1} + ${n2}?`,
    token
  };
}

function verifyCaptcha(answer, token) {
  if (!answer || !token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [expectedAnswer, expiresStr, hmac] = decoded.split(':');
    const expires = parseInt(expiresStr, 10);
    if (Date.now() > expires) return false;
    const expectedHmac = crypto.createHmac('sha256', CAPTCHA_SECRET).update(`${expectedAnswer}:${expiresStr}`).digest('hex');
    if (hmac !== expectedHmac) return false;
    return String(answer).trim() === expectedAnswer;
  } catch {
    return false;
  }
}

// Initialize client
let currentConfig = loadConfig();
let client = new HestiaClient(currentConfig);

// Helper to sanitize config for public/UI consumption
function sanitizeConfig(cfg) {
  return {
    hestiaHost: cfg.hestiaHost,
    hestiaPort: cfg.hestiaPort,
    authType: cfg.authType,
    username: cfg.username,
    accessKey: cfg.accessKey ? `${cfg.accessKey.substring(0, 4)}...${cfg.accessKey.slice(-3)}` : '',
    hasSecretKey: Boolean(cfg.secretKey),
    hasPassword: Boolean(cfg.password),
    defaultUser: cfg.defaultUser,
    defaultPackage: cfg.defaultPackage,
    allowSelfSignedSsl: cfg.allowSelfSignedSsl
  };
}

// Token extractor helper
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return req.headers['x-session-token'] || req.query.token || null;
}

// Authentication Middlewares
async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
    }
    const user = await db.validateSession(token);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Your session has expired or is invalid. Please log in again.' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
    }
    const user = await db.validateSession(token);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Your session has expired or is invalid. Please log in again.' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Administrator privilege required.' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      const user = await db.validateSession(token);
      if (user) req.user = user;
    }
    next();
  } catch {
    next();
  }
}

/**
 * =====================================================================
 * AUTHENTICATION ROUTES (Live Login / Logout / Me)
 * =====================================================================
 */

router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username/Email and Password are required.' });
    }

    const user = await db.authenticateUser(username, password);
    const session = await db.createSession(user.id, req.ip, req.headers['user-agent'] || '');

    // Set client default context to authenticated user
    client.defaultUser = user.username;

    res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      token: session.token,
      user
    });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message });
  }
});

// Helper to generate a unique hosting username from student name or email
async function generateUniqueUsername(firstName, lastName, email) {
  let base = `${firstName || ''}_${lastName || ''}`.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!base || base.length < 3) {
    base = (email || 'student').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  }
  if (!base || base.length < 3) base = 'student';
  base = base.substring(0, 18);

  let candidate = base;
  let counter = 1;
  while (true) {
    const existing = await db.pool.query('SELECT id FROM users WHERE LOWER(username) = $1', [candidate]);
    if (existing.rowCount === 0) {
      return candidate;
    }
    candidate = `${base.substring(0, 16)}${counter}`;
    counter++;
  }
}

// Registration Captcha challenge
router.get('/auth/register-captcha', (req, res) => {
  const challenge = generateCaptcha();
  res.json({ success: true, challenge });
});

// 1. Step 1: Send registration confirmation code via email
router.post('/auth/register-send-code', async (req, res) => {
  try {
    const { firstName, lastName, birthdate, email, password, passwordConfirm, captchaAnswer, captchaToken } = req.body || {};

    if (!firstName || !firstName.trim()) {
      return res.status(400).json({ success: false, error: 'First Name is required.' });
    }
    if (!lastName || !lastName.trim()) {
      return res.status(400).json({ success: false, error: 'Last Name is required.' });
    }
    if (!birthdate || !birthdate.trim()) {
      return res.status(400).json({ success: false, error: 'Birthdate is required.' });
    }

    // Validate minimum age: must be at least 12 years old
    const bDate = new Date(birthdate.trim());
    if (isNaN(bDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Please enter a valid birthdate.' });
    }
    const minAgeDate = new Date();
    minAgeDate.setFullYear(minAgeDate.getFullYear() - 12);
    if (bDate > minAgeDate) {
      return res.status(400).json({ success: false, error: 'You must be at least 12 years old to create an account.' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Student Email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    if (!password) {
      return res.status(400).json({ success: false, error: 'Password is required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }
    if (passwordConfirm !== undefined && password !== passwordConfirm) {
      return res.status(400).json({ success: false, error: 'Password confirmation does not match.' });
    }

    // Validate security captcha
    if (!verifyCaptcha(captchaAnswer, captchaToken)) {
      return res.status(400).json({ success: false, error: 'Incorrect security captcha. Please solve the challenge again.' });
    }

    // Check collision in existing users
    const existingUser = await db.pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (existingUser.rowCount > 0) {
      return res.status(400).json({ success: false, error: 'An account with this email address already exists. Please Sign In.' });
    }

    // Generate unique username
    const username = await generateUniqueUsername(firstName.trim(), lastName.trim(), cleanEmail);

    // Generate 6-digit numeric verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Store in registration_verifications table (expires in 15 mins)
    await db.saveRegistrationVerification({
      email: cleanEmail,
      code,
      registrationData: {
        username,
        password,
        email: cleanEmail,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        birthdate: birthdate.trim(),
        fullName: `${firstName.trim()} ${lastName.trim()}`,
        role: 'student',
        package: 'student-pass'
      },
      expiresMinutes: 15
    });

    // Send code through email
    const emailResult = await emailService.sendVerificationCode(cleanEmail, code, firstName.trim());

    res.json({
      success: true,
      message: `A 6-digit confirmation code has been sent to ${cleanEmail}. Please enter the code to activate your account.`,
      email: cleanEmail,
      candidateUsername: username,
      expiresInMinutes: 15,
      devCode: emailResult.previewCode || null,
      emailSent: emailResult.sent
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Step 2: Verify code and finalize registration
router.post('/auth/register-verify-code', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and verification code are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = String(code).trim();

    const verification = await db.getRegistrationVerification(cleanEmail, cleanCode);
    if (!verification) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired verification code. Please check your code or request a new one.'
      });
    }

    const regData = typeof verification.registration_data === 'string'
      ? JSON.parse(verification.registration_data)
      : verification.registration_data;

    // Double check user doesn't already exist
    const collision = await db.pool.query('SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2', [cleanEmail, regData.username.toLowerCase()]);
    if (collision.rowCount > 0) {
      await db.deleteRegistrationVerification(cleanEmail);
      return res.status(400).json({ success: false, error: 'An account with this email or username was already registered. Please Sign In.' });
    }

    const newUser = await db.createUser(regData);

    // Delete verification record
    await db.deleteRegistrationVerification(cleanEmail);

    // Create authenticated session
    const session = await db.createSession(newUser.id, req.ip, req.headers['user-agent'] || '');
    client.defaultUser = newUser.username;

    res.json({
      success: true,
      message: `Welcome to Hosta, ${newUser.name}! Your account has been verified and activated.`,
      token: session.token,
      user: newUser
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 3. Resend code
router.post('/auth/register-resend-code', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const pending = await db.getPendingVerificationByEmail(cleanEmail);
    if (!pending) {
      return res.status(400).json({ success: false, error: 'No active pending registration found for this email. Please fill out the registration form again.' });
    }

    const regData = typeof pending.registration_data === 'string' ? JSON.parse(pending.registration_data) : pending.registration_data;
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();

    await db.saveRegistrationVerification({
      email: cleanEmail,
      code: newCode,
      registrationData: regData,
      expiresMinutes: 15
    });

    const emailResult = await emailService.sendVerificationCode(cleanEmail, newCode, regData.firstName || 'Student');

    res.json({
      success: true,
      message: `A new 6-digit confirmation code has been sent to ${cleanEmail}.`,
      email: cleanEmail,
      devCode: emailResult.previewCode || null,
      emailSent: emailResult.sent
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Backward compatibility direct register
router.post('/auth/register', async (req, res) => {
  try {
    const { username, name, email, password, firstName, lastName, birthdate } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const finalUsername = username ? username.trim().toLowerCase() : await generateUniqueUsername(firstName, lastName, cleanEmail);

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }

    const newUser = await db.createUser({
      username: finalUsername,
      password,
      email: cleanEmail,
      fullName: name || ([firstName, lastName].filter(Boolean).join(' ') || finalUsername),
      firstName: firstName || null,
      lastName: lastName || null,
      birthdate: birthdate || null,
      role: 'student',
      package: 'student-pass'
    });

    const session = await db.createSession(newUser.id, req.ip, req.headers['user-agent'] || '');
    client.defaultUser = newUser.username;

    res.json({
      success: true,
      message: `Account created successfully! Welcome to Hosta, ${newUser.name}.`,
      token: session.token,
      user: newUser
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/auth/logout', async (req, res) => {
  try {
    const token = extractToken(req);
    if (token) {
      await db.destroySession(token);
    }
    res.json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/auth/me', async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'No active session token provided.' });
    }
    const user = await db.validateSession(token);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Session expired or invalid.' });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Profile & Settings (Personal Information & Password)
router.put('/auth/profile', requireAuth, async (req, res) => {
  try {
    const { firstName, lastName, email, birthdate, currentPassword, newPassword } = req.body || {};
    const userId = req.user.id;
    const username = req.user.username;

    const userRes = await db.pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const userRow = userRes.rows[0];
    if (!userRow) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const updates = {};

    if (firstName !== undefined && firstName.trim()) {
      if (firstName.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'First Name must be at least 2 characters.' });
      }
      updates.firstName = firstName.trim();
    }

    if (lastName !== undefined && lastName.trim()) {
      if (lastName.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'Last Name must be at least 2 characters.' });
      }
      updates.lastName = lastName.trim();
    }

    if (updates.firstName || updates.lastName) {
      const f = updates.firstName || userRow.first_name || '';
      const l = updates.lastName || userRow.last_name || '';
      updates.name = `${f} ${l}`.trim() || username;
    }

    if (birthdate !== undefined && birthdate.trim()) {
      const bDate = new Date(birthdate.trim());
      if (isNaN(bDate.getTime())) {
        return res.status(400).json({ success: false, error: 'Please enter a valid birthdate.' });
      }
      const minAgeDate = new Date();
      minAgeDate.setFullYear(minAgeDate.getFullYear() - 12);
      if (bDate > minAgeDate) {
        return res.status(400).json({ success: false, error: 'You must be at least 12 years old.' });
      }
      updates.birthdate = birthdate.trim();
    }

    if (email && email.trim()) {
      const cleanEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
      }
      if (cleanEmail !== userRow.email.toLowerCase()) {
        const checkCollision = await db.pool.query('SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2', [cleanEmail, userId]);
        if (checkCollision.rowCount > 0) {
          return res.status(400).json({ success: false, error: 'Email is already used by another account.' });
        }
        updates.email = cleanEmail;
      }
    }

    // Password change (optional)
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, error: 'Current password is required to set a new password.' });
      }
      if (!db.verifyPassword(currentPassword, userRow.password_hash, userRow.salt)) {
        return res.status(400).json({ success: false, error: 'Current password is incorrect.' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long.' });
      }
      updates.password = newPassword;
    }

    const updatedUser = await db.updateUser(username, updates);
    res.json({
      success: true,
      message: 'Profile settings updated successfully.',
      user: updatedUser
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/roles', (req, res) => {
  res.json({
    success: true,
    roles: [
      { id: 1, name: 'admin', description: 'Full Platform Administrator' },
      { id: 2, name: 'student', description: 'Student Hosting Account' },
      { id: 3, name: 'instructor', description: 'Academic Faculty / Reviewer' }
    ]
  });
});

/**
 * =====================================================================
 * STATUS & CONFIG ROUTES
 * =====================================================================
 */

router.get('/status', optionalAuth, async (req, res) => {
  try {
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const summary = await client.getDashboardSummary(targetUser);
    res.json({
      success: true,
      config: sanitizeConfig(currentConfig),
      summary
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/config', (req, res) => {
  res.json({
    success: true,
    config: sanitizeConfig(currentConfig)
  });
});

router.post('/config', requireAdmin, (req, res) => {
  try {
    const payload = req.body || {};
    const updated = saveConfig(payload);
    currentConfig = updated;
    client.updateConfig(currentConfig);

    res.json({
      success: true,
      message: 'Configuration updated successfully.',
      config: sanitizeConfig(updated)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/test-connection', async (req, res) => {
  try {
    let testClient = client;
    if (req.body && (req.body.hestiaHost || req.body.accessKey || req.body.password)) {
      testClient = new HestiaClient({
        ...currentConfig,
        ...req.body
      });
    }
    const result = await testClient.testConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/system', (req, res) => {
  try {
    const sys = db.getSystemInfo();
    res.json({ success: true, system: sys });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/plans', async (req, res) => {
  try {
    const plans = await db.listPlans();
    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/order', optionalAuth, async (req, res) => {
  try {
    const { planId, domain } = req.body;
    if (!domain) {
      return res.status(400).json({ success: false, error: 'Domain name is required.' });
    }

    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.addWebDomain(targetUser, domain, `www.${domain}`, true, '8.3');
    res.json({
      success: true,
      message: `Account provisioned! Plan ${planId} with domain ${domain} is now active.`,
      domain: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * =====================================================================
 * STUDENT / HOSTING USER ACCOUNTS CRUD
 * =====================================================================
 */

router.get('/accounts', optionalAuth, async (req, res) => {
  try {
    const accounts = await client.listUsers();
    res.json({
      success: true,
      activeUser: req.user ? req.user.username : client.defaultUser,
      accounts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/accounts/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const account = await client.getUser(username);
    if (!account) return res.status(404).json({ success: false, error: `Account '${username}' not found.` });
    res.json({ success: true, account });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/accounts', async (req, res) => {
  try {
    const { username, name, email, password, package: packageId, role } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'Username, student email, and password are required.' });
    }
    const newAccount = await client.addUser(username, password, email, packageId, name, role || 'student');
    res.json({
      success: true,
      account: newAccount,
      message: `Student account '${username}' created successfully.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/accounts/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { name, email, package: packageId, password, suspended } = req.body;
    const updated = await client.updateUser(username, { name, email, packageId, password, suspended });
    res.json({
      success: true,
      account: updated,
      message: `Student account '${username}' updated successfully.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/accounts/:username/suspend', async (req, res) => {
  try {
    const { username } = req.params;
    const result = await client.toggleSuspendUser(username);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/accounts/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const result = await client.deleteUser(username);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/accounts/:username/switch-context', async (req, res) => {
  try {
    const { username } = req.params;
    client.defaultUser = username;
    const summary = await client.getDashboardSummary(username);
    res.json({
      success: true,
      activeUser: username,
      summary,
      message: `Active session switched to '${username}'.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * =====================================================================
 * WEB DOMAINS
 * =====================================================================
 */

router.get('/domains', optionalAuth, async (req, res) => {
  try {
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const domains = await client.listWebDomains(targetUser);
    res.json({ success: true, domains });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/domains', optionalAuth, async (req, res) => {
  try {
    const { domain, aliases, ssl, phpVersion } = req.body;
    if (!domain) return res.status(400).json({ success: false, error: 'Domain is required.' });
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.addWebDomain(targetUser, domain, aliases, ssl, phpVersion);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/domains/:domain', optionalAuth, async (req, res) => {
  try {
    const { domain } = req.params;
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.deleteWebDomain(targetUser, domain);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/domains/:domain/ssl', optionalAuth, async (req, res) => {
  try {
    const { domain } = req.params;
    const { ssl } = req.body;
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.toggleWebDomainSsl(targetUser, domain, ssl !== false);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * =====================================================================
 * DATABASES
 * =====================================================================
 */

router.get('/databases', optionalAuth, async (req, res) => {
  try {
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const databases = await client.listDatabases(targetUser);
    res.json({ success: true, databases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/databases', optionalAuth, async (req, res) => {
  try {
    const { database, dbuser, password, charset } = req.body;
    if (!database) return res.status(400).json({ success: false, error: 'Database name is required.' });
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.addDatabase(targetUser, database, dbuser, password, charset);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/databases/:database', optionalAuth, async (req, res) => {
  try {
    const { database } = req.params;
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.deleteDatabase(targetUser, database);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * =====================================================================
 * DNS RECORDS
 * =====================================================================
 */

router.get('/dns/:domain', optionalAuth, async (req, res) => {
  try {
    const { domain } = req.params;
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const records = await client.listDnsRecords(targetUser, domain);
    res.json({ success: true, records });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/dns/:domain', optionalAuth, async (req, res) => {
  try {
    const { domain } = req.params;
    const { record, type, value, priority, ttl } = req.body;
    if (!record || !value) return res.status(400).json({ success: false, error: 'Record and value required.' });
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.addDnsRecord(targetUser, domain, { record, type, value, priority, ttl });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/dns/:domain/:recordId', optionalAuth, async (req, res) => {
  try {
    const { domain, recordId } = req.params;
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.deleteDnsRecord(targetUser, domain, recordId);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * =====================================================================
 * CRON JOBS
 * =====================================================================
 */

router.get('/cron', optionalAuth, async (req, res) => {
  try {
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const cronJobs = await client.listCronJobs(targetUser);
    res.json({ success: true, cronJobs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/cron', optionalAuth, async (req, res) => {
  try {
    const { min, hour, day, month, wday, cmd, comment } = req.body;
    if (!cmd) return res.status(400).json({ success: false, error: 'Command required.' });
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.addCronJob(targetUser, { min, hour, day, month, wday, cmd, comment });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/cron/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.deleteCronJob(targetUser, id);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * =====================================================================
 * BACKUPS
 * =====================================================================
 */

router.get('/backups', optionalAuth, async (req, res) => {
  try {
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const backups = await client.listBackups(targetUser);
    res.json({ success: true, backups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/backups', optionalAuth, async (req, res) => {
  try {
    const targetUser = req.user ? req.user.username : client.defaultUser;
    const result = await client.createBackup(targetUser);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * =====================================================================
 * LIVE CHAT & CAPTCHA SYSTEM
 * =====================================================================
 */

// Get Captcha challenge
router.get('/chat/captcha', (req, res) => {
  const challenge = generateCaptcha();
  res.json({ success: true, challenge });
});

// Start chat session (requires captcha verification for guests; auto-connects for authenticated users)
router.post('/chat/start', optionalAuth, async (req, res) => {
  try {
    let { visitorName, visitorEmail, captchaAnswer, captchaToken, sessionId } = req.body || {};

    if (req.user) {
      // Authenticated user: bypass captcha, link to user account
      sessionId = sessionId || `hosta_user_${req.user.id}`;
      visitorName = req.user.name || `@${req.user.username}`;
      visitorEmail = req.user.email || '';
    } else if (sessionId && sessionId.startsWith('hosta_user_')) {
      const parsedUserId = parseInt(sessionId.replace('hosta_user_', ''), 10);
      if (!isNaN(parsedUserId)) {
        const u = await db.getUser(parsedUserId);
        if (u) {
          req.user = u;
          visitorName = u.name || `@${u.username}`;
          visitorEmail = u.email || '';
        }
      }
    } else {
      if (!sessionId) {
        return res.status(400).json({ success: false, error: 'Session ID is required.' });
      }
      if (!verifyCaptcha(captchaAnswer, captchaToken)) {
        return res.status(400).json({ success: false, error: 'Incorrect captcha answer. Please try again.' });
      }
    }

    const thread = await db.getOrCreateChatThread({
      sessionId,
      visitorName: visitorName || (req.user ? req.user.name : 'Student Visitor'),
      visitorEmail: visitorEmail || (req.user ? req.user.email : ''),
      userId: req.user ? req.user.id : null
    });

    const messages = await db.getChatMessages(thread.id, req.user ? req.user.id : null);
    if (messages.length === 0) {
      await db.addChatMessage({
        threadIdOrSession: thread.id,
        senderType: 'admin',
        senderName: 'Hosta Support',
        message: '👋 Hello! Welcome to Hosta LiveChat. How can our administrator help you with your web hosting or school project today?',
        userId: req.user ? req.user.id : null
      });
    }

    const updatedMessages = await db.getChatMessages(thread.id, req.user ? req.user.id : null);
    res.json({
      success: true,
      thread,
      messages: updatedMessages
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get messages for visitor's active session
router.get('/chat/session/:sessionId/messages', optionalAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    let userId = req.user ? req.user.id : null;
    if (!userId && sessionId && sessionId.startsWith('hosta_user_')) {
      const parsed = parseInt(sessionId.replace('hosta_user_', ''), 10);
      if (!isNaN(parsed)) userId = parsed;
    }
    const messages = await db.getChatMessages(sessionId, userId);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Visitor sends a message
router.post('/chat/session/:sessionId/message', optionalAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, senderName } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message cannot be empty.' });
    }

    let userId = req.user ? req.user.id : null;
    if (!userId && sessionId && sessionId.startsWith('hosta_user_')) {
      const parsed = parseInt(sessionId.replace('hosta_user_', ''), 10);
      if (!isNaN(parsed)) userId = parsed;
    }

    const effectiveSender = req.user 
      ? (req.user.name || `@${req.user.username}`)
      : (senderName || 'Visitor');

    const newMsg = await db.addChatMessage({
      threadIdOrSession: sessionId,
      senderType: 'visitor',
      senderName: effectiveSender,
      message: message.trim(),
      userId
    });

    res.json({ success: true, message: newMsg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: list all chat threads
router.get('/chat/admin/threads', requireAdmin, async (req, res) => {
  try {
    const threads = await db.listChatThreads();
    res.json({ success: true, threads });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: get messages in thread
router.get('/chat/admin/threads/:threadId/messages', requireAdmin, async (req, res) => {
  try {
    const { threadId } = req.params;
    await db.markThreadMessagesRead(threadId, 'admin');
    const messages = await db.getChatMessages(threadId);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: reply to thread
router.post('/chat/admin/threads/:threadId/reply', requireAdmin, async (req, res) => {
  try {
    const { threadId } = req.params;
    const { message } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Reply message cannot be empty.' });
    }

    const replyMsg = await db.addChatMessage({
      threadIdOrSession: threadId,
      senderType: 'admin',
      senderName: req.user.name || 'Administrator',
      message: message.trim()
    });

    res.json({ success: true, message: replyMsg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: resolve thread
router.post('/chat/admin/threads/:threadId/resolve', requireAdmin, async (req, res) => {
  try {
    const { threadId } = req.params;
    await db.resolveChatThread(threadId);
    res.json({ success: true, message: 'Thread marked as resolved.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
