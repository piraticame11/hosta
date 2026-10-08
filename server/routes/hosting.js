const express = require('express');
const router = express.Router();
const hestiaService = require('../services/hestiaService');
const db = require('../db');

/**
 * Authentication & session resolution middleware
 * Extracts bearer token or session header and resolves user from DB,
 * or allows explicit target user in body/query.
 */
async function attachAuthUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else {
      token = req.headers['x-session-token'] || req.query.token || null;
    }

    if (token) {
      const user = await db.validateSession(token);
      if (user) {
        req.user = user;
      }
    }
  } catch (err) {
    // Non-blocking: will fall back to default user or request params
  }
  next();
}

router.use(attachAuthUser);

/**
 * Helper to determine the target system user
 */
function getTargetUser(req) {
  return (req.user && req.user.username) || req.body.user || req.query.user || process.env.HESTIA_DEFAULT_USER || 'hostb';
}

/**
 * POST /api/hosting/domains
 * Provisions a new web domain + triggers Let's Encrypt SSL
 */
router.post('/domains', async (req, res) => {
  try {
    const { domain, enableSsl = true } = req.body;

    if (!domain) {
      return res.status(400).json({
        success: false,
        error: 'Domain name is required.'
      });
    }

    const rawUser = getTargetUser(req);
    const sanitizedUser = hestiaService.sanitizeUsername(rawUser);
    const sanitizedDomain = hestiaService.sanitizeDomain(domain);

    // 1. Provision Web Domain
    const domainResult = await hestiaService.createWebDomain(sanitizedUser, sanitizedDomain);

    // 2. Trigger Let's Encrypt SSL
    let sslStatus = 'disabled';
    let sslDetails = null;

    if (enableSsl !== false) {
      try {
        console.log(`[Hosting Router] Enabling Let's Encrypt SSL for '${sanitizedDomain}'...`);
        sslDetails = await hestiaService.enableSSL(sanitizedUser, sanitizedDomain);
        sslStatus = 'enabled';
      } catch (sslErr) {
        sslStatus = 'pending_dns';
        sslDetails = {
          warning: 'Domain was created, but Let\'s Encrypt SSL activation is pending DNS propagation or validation.',
          reason: sslErr.message
        };
        console.warn(`[Hosting Router] SSL Notice for '${sanitizedDomain}': ${sslErr.message}`);
      }
    }

    res.status(201).json({
      success: true,
      data: {
        user: sanitizedUser,
        domain: sanitizedDomain,
        sslStatus,
        sslDetails,
        domainResult
      },
      message: `Domain '${sanitizedDomain}' provisioned successfully.`
    });
  } catch (err) {
    console.error('[Hosting Router Error - POST /domains]', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/hosting/domains
 * Lists active web domains for the authenticated user
 */
router.get('/domains', async (req, res) => {
  try {
    const rawUser = getTargetUser(req);
    const sanitizedUser = hestiaService.sanitizeUsername(rawUser);

    const domains = await hestiaService.listWebDomains(sanitizedUser);

    res.json({
      success: true,
      data: domains
    });
  } catch (err) {
    console.error('[Hosting Router Error - GET /domains]', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/hosting/databases
 * Provisions a new MySQL database + database user
 */
router.post('/databases', async (req, res) => {
  try {
    const { database, dbUser, dbPass, password, type = 'mysql' } = req.body;
    const finalPassword = dbPass || password;

    if (!database) {
      return res.status(400).json({ success: false, error: 'Database name is required.' });
    }
    if (!dbUser) {
      return res.status(400).json({ success: false, error: 'Database username is required.' });
    }
    if (!finalPassword) {
      return res.status(400).json({ success: false, error: 'Database password (dbPass) is required.' });
    }

    const rawUser = getTargetUser(req);
    const sanitizedUser = hestiaService.sanitizeUsername(rawUser);
    const sanitizedDbName = hestiaService.sanitizeDatabaseName(database);
    const sanitizedDbUser = hestiaService.sanitizeDatabaseUser(dbUser);

    const result = await hestiaService.createDatabase(
      sanitizedUser,
      sanitizedDbName,
      sanitizedDbUser,
      finalPassword,
      type
    );

    res.status(201).json({
      success: true,
      data: {
        user: sanitizedUser,
        database: sanitizedDbName,
        dbUser: sanitizedDbUser,
        type: type.toLowerCase(),
        result
      },
      message: `Database '${sanitizedDbName}' and user '${sanitizedDbUser}' created successfully.`
    });
  } catch (err) {
    console.error('[Hosting Router Error - POST /databases]', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/hosting/databases
 * Fetches database list and connection details
 */
router.get('/databases', async (req, res) => {
  try {
    const rawUser = getTargetUser(req);
    const sanitizedUser = hestiaService.sanitizeUsername(rawUser);

    const databases = await hestiaService.listDatabases(sanitizedUser);

    res.json({
      success: true,
      data: databases
    });
  } catch (err) {
    console.error('[Hosting Router Error - GET /databases]', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/hosting/emails
 * Creates a domain email inbox
 */
router.post('/emails', async (req, res) => {
  try {
    const { domain, emailUser, email, password } = req.body;

    let targetDomain = domain;
    let targetEmailUser = emailUser;

    // Handle payload if full email address was supplied in either field
    if (!targetDomain && email && email.includes('@')) {
      const parts = email.split('@');
      targetEmailUser = parts[0];
      targetDomain = parts[1];
    } else if (targetEmailUser && targetEmailUser.includes('@')) {
      const parts = targetEmailUser.split('@');
      targetEmailUser = parts[0];
      if (!targetDomain) targetDomain = parts[1];
    }

    if (!targetDomain) {
      return res.status(400).json({ success: false, error: 'Domain is required.' });
    }
    if (!targetEmailUser) {
      return res.status(400).json({ success: false, error: 'Email user/mailbox prefix is required.' });
    }
    if (!password) {
      return res.status(400).json({ success: false, error: 'Email account password is required.' });
    }

    const rawUser = getTargetUser(req);
    const sanitizedUser = hestiaService.sanitizeUsername(rawUser);
    const sanitizedDomain = hestiaService.sanitizeDomain(targetDomain);
    const sanitizedEmailUser = hestiaService.sanitizeEmailUser(targetEmailUser);

    const result = await hestiaService.createEmailAccount(
      sanitizedUser,
      sanitizedDomain,
      sanitizedEmailUser,
      password
    );

    res.status(201).json({
      success: true,
      data: {
        user: sanitizedUser,
        domain: sanitizedDomain,
        emailUser: sanitizedEmailUser,
        fullEmail: `${sanitizedEmailUser}@${sanitizedDomain}`,
        result
      },
      message: `Email inbox '${sanitizedEmailUser}@${sanitizedDomain}' created successfully.`
    });
  } catch (err) {
    console.error('[Hosting Router Error - POST /emails]', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /api/hosting/stats
 * Returns disk, bandwidth, database, and email quota usage
 */
router.get('/stats', async (req, res) => {
  try {
    const rawUser = getTargetUser(req);
    const sanitizedUser = hestiaService.sanitizeUsername(rawUser);

    const usageData = await hestiaService.getUserUsage(sanitizedUser);

    // Hestia returns an object keyed by username or direct object
    const userStats = (usageData && usageData[sanitizedUser]) ? usageData[sanitizedUser] : (usageData || {});

    const stats = {
      user: sanitizedUser,
      disk: {
        usedMb: userStats.U_DISK !== undefined ? parseFloat(userStats.U_DISK) : 0,
        quotaMb: userStats.DISK_QUOTA !== undefined ? parseFloat(userStats.DISK_QUOTA) : 0,
        unlimited: userStats.DISK_QUOTA === 'unlimited' || userStats.DISK_QUOTA === '0'
      },
      bandwidth: {
        usedMb: userStats.U_BANDWIDTH !== undefined ? parseFloat(userStats.U_BANDWIDTH) : 0,
        quotaMb: userStats.BANDWIDTH !== undefined ? parseFloat(userStats.BANDWIDTH) : 0,
        unlimited: userStats.BANDWIDTH === 'unlimited' || userStats.BANDWIDTH === '0'
      },
      databases: {
        used: userStats.U_DATABASES !== undefined ? parseInt(userStats.U_DATABASES, 10) : 0,
        quota: userStats.DATABASES !== undefined ? parseInt(userStats.DATABASES, 10) : 0
      },
      webDomains: {
        used: userStats.U_WEB_DOMAINS !== undefined ? parseInt(userStats.U_WEB_DOMAINS, 10) : 0,
        quota: userStats.WEB_DOMAINS !== undefined ? parseInt(userStats.WEB_DOMAINS, 10) : 0
      },
      mailAccounts: {
        used: userStats.U_MAIL_ACCOUNTS !== undefined ? parseInt(userStats.U_MAIL_ACCOUNTS, 10) : 0,
        quota: userStats.MAIL_ACCOUNTS !== undefined ? parseInt(userStats.MAIL_ACCOUNTS, 10) : 0
      },
      mailDomains: {
        used: userStats.U_MAIL_DOMAINS !== undefined ? parseInt(userStats.U_MAIL_DOMAINS, 10) : 0,
        quota: userStats.MAIL_DOMAINS !== undefined ? parseInt(userStats.MAIL_DOMAINS, 10) : 0
      },
      suspended: userStats.SUSPENDED === 'yes',
      raw: userStats
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    console.error('[Hosting Router Error - GET /stats]', err.message);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
