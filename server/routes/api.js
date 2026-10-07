const express = require('express');
const router = express.Router();
const { loadConfig, saveConfig } = require('../config-manager');
const HestiaClient = require('../hestia-client');
const db = require('../db');

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

router.post('/auth/register', async (req, res) => {
  try {
    const { username, name, email, password } = req.body || {};
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'Username, email, and password are required.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3 || cleanUsername.length > 24) {
      return res.status(400).json({ success: false, error: 'Username must be between 3 and 24 characters.' });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(cleanUsername)) {
      return res.status(400).json({ success: false, error: 'Username may only contain letters, numbers, hyphens, and underscores.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }

    const newUser = await db.createUser({
      username: cleanUsername,
      password,
      email: email.trim().toLowerCase(),
      fullName: name ? name.trim() : cleanUsername,
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

// Get Captcha challenge
router.get('/chat/captcha', (req, res) => {
  const challenge = generateCaptcha();
  res.json({ success: true, challenge });
});

// Start chat session (requires captcha verification)
router.post('/chat/start', optionalAuth, async (req, res) => {
  try {
    const { visitorName, visitorEmail, captchaAnswer, captchaToken, sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required.' });
    }

    if (!verifyCaptcha(captchaAnswer, captchaToken)) {
      return res.status(400).json({ success: false, error: 'Incorrect captcha answer. Please try again.' });
    }

    const thread = await db.getOrCreateChatThread({
      sessionId,
      visitorName: visitorName || (req.user ? req.user.name : 'Student Visitor'),
      visitorEmail: visitorEmail || (req.user ? req.user.email : ''),
      userId: req.user ? req.user.id : null
    });

    const messages = await db.getChatMessages(thread.id);
    if (messages.length === 0) {
      await db.addChatMessage({
        threadIdOrSession: thread.id,
        senderType: 'admin',
        senderName: 'Hosta Support',
        message: '👋 Hello! Welcome to Hosta Philippines LiveChat. How can our administrator help you with your web hosting or school project today?'
      });
    }

    const updatedMessages = await db.getChatMessages(thread.id);
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
router.get('/chat/session/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const messages = await db.getChatMessages(sessionId);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Visitor sends a message
router.post('/chat/session/:sessionId/message', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, senderName } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message cannot be empty.' });
    }

    const newMsg = await db.addChatMessage({
      threadIdOrSession: sessionId,
      senderType: 'visitor',
      senderName: senderName || 'Visitor',
      message: message.trim()
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
