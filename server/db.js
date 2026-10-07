require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const os = require('os');

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('[Neon Postgres Pool Error]', err.message);
});

/**
 * Password Hashing with PBKDF2
 */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, hash, salt) {
  if (!password || !hash || !salt) return false;
  const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return testHash === hash;
}

/**
 * Initialize Database Schema on Neon PostgreSQL
 */
let initPromise = null;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = initSchema().catch(err => {
      initPromise = null; // allow retry on failure
      throw err;
    });
  }
  return initPromise;
}

async function initSchema() {

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        permissions JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(255) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        full_name VARCHAR(150) NOT NULL,
        role_id INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
        package VARCHAR(50) NOT NULL DEFAULT 'student-pass',
        suspended BOOLEAN NOT NULL DEFAULT FALSE,
        disk_limit_mb DOUBLE PRECISION NOT NULL DEFAULT 100,
        disk_used_mb DOUBLE PRECISION NOT NULL DEFAULT 0,
        bw_limit_mb DOUBLE PRECISION NOT NULL DEFAULT 200,
        bw_used_mb DOUBLE PRECISION NOT NULL DEFAULT 0,
        web_domains_limit INT NOT NULL DEFAULT 1,
        databases_limit INT NOT NULL DEFAULT 1,
        cron_jobs_limit INT NOT NULL DEFAULT 2,
        backups_limit INT NOT NULL DEFAULT 3,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(64) PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT
      );

      CREATE TABLE IF NOT EXISTS hosting_plans (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        badge VARCHAR(100),
        price_monthly DOUBLE PRECISION NOT NULL,
        price_period VARCHAR(50) NOT NULL,
        billing_label VARCHAR(100) NOT NULL,
        popular BOOLEAN DEFAULT FALSE,
        disk_mb DOUBLE PRECISION DEFAULT 100,
        bandwidth_mb DOUBLE PRECISION DEFAULT 200,
        max_domains INT DEFAULT 1,
        max_databases INT DEFAULT 1,
        specs_json JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS domains (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain VARCHAR(150) UNIQUE NOT NULL,
        aliases VARCHAR(255),
        ip VARCHAR(45) DEFAULT '119.92.128.45',
        ssl BOOLEAN DEFAULT TRUE,
        ssl_provider VARCHAR(50) DEFAULT 'Let''s Encrypt',
        ssl_expires VARCHAR(50),
        php_version VARCHAR(20) DEFAULT '8.3',
        backend VARCHAR(50) DEFAULT 'PHP-FPM-83',
        stats VARCHAR(50) DEFAULT 'AWStats',
        disk_usage_mb DOUBLE PRECISION DEFAULT 12.0,
        bandwidth_mb DOUBLE PRECISION DEFAULT 0.0,
        suspended BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS databases (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        database_name VARCHAR(100) UNIQUE NOT NULL,
        db_user VARCHAR(100) NOT NULL,
        host VARCHAR(100) DEFAULT 'localhost',
        type VARCHAR(20) DEFAULT 'mysql',
        charset VARCHAR(50) DEFAULT 'utf8mb4',
        disk_usage_mb DOUBLE PRECISION DEFAULT 4.0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS dns_records (
        id SERIAL PRIMARY KEY,
        domain_name VARCHAR(150) NOT NULL,
        record VARCHAR(50) NOT NULL,
        type VARCHAR(20) NOT NULL,
        value VARCHAR(255) NOT NULL,
        ttl INT DEFAULT 14400,
        priority VARCHAR(50) DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cron_jobs (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        min VARCHAR(10) DEFAULT '0',
        hour VARCHAR(10) DEFAULT '2',
        day VARCHAR(10) DEFAULT '*',
        month VARCHAR(10) DEFAULT '*',
        wday VARCHAR(10) DEFAULT '*',
        cmd VARCHAR(255) NOT NULL,
        comment VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS backups (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        size_mb DOUBLE PRECISION DEFAULT 18.5,
        type VARCHAR(100) DEFAULT 'Project Backup (Web & Database)',
        runtime VARCHAR(20) DEFAULT '14s',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        details TEXT,
        ip_address VARCHAR(45),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chat_threads (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(100) UNIQUE NOT NULL,
        visitor_name VARCHAR(150) NOT NULL,
        visitor_email VARCHAR(150),
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        thread_id INT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
        sender_type VARCHAR(20) NOT NULL,
        sender_name VARCHAR(150) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS registration_verifications (
        id SERIAL PRIMARY KEY,
        email VARCHAR(150) UNIQUE NOT NULL,
        code VARCHAR(10) NOT NULL,
        registration_data JSONB NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS birthdate VARCHAR(50);
    `);

    // 1. Seed Roles
    const rolesRes = await client.query('SELECT COUNT(*) as cnt FROM roles');
    if (parseInt(rolesRes.rows[0].cnt, 10) === 0) {
      await client.query(`
        INSERT INTO roles (name, description, permissions) VALUES
        ('admin', 'System Administrator with full access', $1),
        ('student', 'Student Hosting Account with personal workspace access', $2),
        ('instructor', 'Faculty / Instructor reviewer', $3)
      `, [
        JSON.stringify(['*']),
        JSON.stringify([
          'domains:read', 'domains:write',
          'databases:read', 'databases:write',
          'dns:read', 'dns:write',
          'cron:read', 'cron:write',
          'backups:read', 'backups:write',
          'profile:read', 'profile:write'
        ]),
        JSON.stringify(['accounts:read', 'domains:read', 'databases:read', 'audit:read'])
      ]);
    }

    const adminRoleRes = await client.query("SELECT id FROM roles WHERE name = 'admin'");
    const studentRoleRes = await client.query("SELECT id FROM roles WHERE name = 'student'");
    const adminRoleId = adminRoleRes.rows[0].id;
    const studentRoleId = studentRoleRes.rows[0].id;

    // 2. Seed Hosting Plans (Single Student Pass: ₱150 / 20GB Bandwidth)
    await client.query("DELETE FROM hosting_plans WHERE id != 'student-monthly'");
    const plansRes = await client.query('SELECT COUNT(*) as cnt FROM hosting_plans');
    const studentMonthlySpecs = JSON.stringify({
      storage: '100 MB Fast SSD Storage',
      bandwidth: '20 GB Monthly Bandwidth',
      databases: '1 MariaDB Database (phpMyAdmin)',
      websites: 'Free hosta.site Subdomain or Custom Domain',
      ssl: "Free Let's Encrypt SSL",
      support: 'LiveChat Support with Administrator',
      phpVersion: 'PHP 7.4 - 8.3 & Node.js Runtime',
      backups: 'Automated Daily Backups'
    });

    if (parseInt(plansRes.rows[0].cnt, 10) === 0) {
      await client.query(`
        INSERT INTO hosting_plans 
        (id, name, badge, price_monthly, price_period, billing_label, popular, disk_mb, bandwidth_mb, max_domains, max_databases, specs_json)
        VALUES 
        ('student-monthly', 'Student Monthly Pass', 'Only ₱150 / Month', 150, '₱150 / mo', 'Full monthly student pass', TRUE, 100, 20480, 1, 1, $1)
      `, [studentMonthlySpecs]);
    } else {
      await client.query(`
        UPDATE hosting_plans 
        SET name = 'Student Monthly Pass',
            badge = 'Only ₱150 / Month',
            price_monthly = 150,
            price_period = '₱150 / mo',
            disk_mb = 100,
            bandwidth_mb = 20480,
            specs_json = $1
        WHERE id = 'student-monthly'
      `, [studentMonthlySpecs]);
    }

    // 3. Seed Admin Account
    const adminRes = await client.query("SELECT id FROM users WHERE username = 'admin'");
    if (adminRes.rowCount === 0) {
      const { salt, hash } = hashPassword('admin123');
      await client.query(`
        INSERT INTO users (
          username, password_hash, salt, email, full_name, role_id, 
          package, suspended, disk_limit_mb, disk_used_mb, bw_limit_mb, bw_used_mb,
          web_domains_limit, databases_limit, cron_jobs_limit, backups_limit
        ) VALUES ($1, $2, $3, $4, $5, $6, 'default', FALSE, 50000, 0, 100000, 0, 100, 100, 50, 50)
      `, ['admin', hash, salt, 'admin@hosta.ph', 'System Administrator', adminRoleId]);
    }

    isInitialized = true;
    console.log('✅ Neon PostgreSQL database schema verified.');
  } finally {
    client.release();
  }
}

// Auto-initialize schema
ensureInitialized().catch(err => {
  console.error('[Neon Postgres Init Error]', err.message);
});

// Helper to format user row into standard public structure
function formatUser(row) {
  if (!row) return null;
  const fullName = row.full_name || '';
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = row.first_name || (nameParts.length > 0 ? nameParts[0] : row.username);
  const lastName = row.last_name || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '');

  return {
    id: row.id,
    username: row.username,
    name: row.full_name,
    firstName,
    lastName,
    birthdate: row.birthdate || null,
    email: row.email,
    role: row.role_name || row.role || 'student',
    roleId: row.role_id,
    permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions || []),
    package: row.package,
    suspended: Boolean(row.suspended),
    created: row.created_at ? new Date(row.created_at).toISOString().substring(0, 10) : new Date().toISOString().substring(0, 10),
    quota: {
      disk: {
        usedMB: Number(row.disk_used_mb || 0),
        totalMB: Number(row.disk_limit_mb || 100)
      },
      bandwidth: {
        usedMB: Number(row.bw_used_mb || 0),
        totalMB: Number(row.bw_limit_mb || 200)
      },
      webDomains: {
        used: Number(row.domains_count || 0),
        total: Number(row.web_domains_limit || 1)
      },
      databases: {
        used: Number(row.dbs_count || 0),
        total: Number(row.databases_limit || 1)
      },
      cronJobs: {
        used: Number(row.crons_count || 0),
        total: Number(row.cron_jobs_limit || 2)
      },
      backups: {
        used: Number(row.backups_count || 0),
        total: Number(row.backups_limit || 3)
      }
    }
  };
}

const userBaseQuery = `
  SELECT 
    u.*,
    r.name as role_name,
    r.permissions,
    (SELECT COUNT(*) FROM domains WHERE user_id = u.id) as domains_count,
    (SELECT COUNT(*) FROM databases WHERE user_id = u.id) as dbs_count,
    (SELECT COUNT(*) FROM cron_jobs WHERE user_id = u.id) as crons_count,
    (SELECT COUNT(*) FROM backups WHERE user_id = u.id) as backups_count
  FROM users u
  JOIN roles r ON u.role_id = r.id
`;

const dbService = {
  pool,

  // --- Auth & Sessions ---
  async authenticateUser(usernameOrEmail, password) {
    await ensureInitialized();
    const clean = usernameOrEmail.trim().toLowerCase();
    const res = await pool.query(`
      ${userBaseQuery}
      WHERE LOWER(u.username) = $1 OR LOWER(u.email) = $1
    `, [clean]);

    const row = res.rows[0];
    if (!row) {
      throw new Error('User not found. Please verify your username or email.');
    }

    if (row.suspended) {
      throw new Error('This account has been suspended by an administrator.');
    }

    const isValid = verifyPassword(password, row.password_hash, row.salt);
    if (!isValid) {
      throw new Error('Invalid credentials. Password does not match.');
    }

    return formatUser(row);
  },

  async createSession(userId, ip = '', userAgent = '') {
    await ensureInitialized();
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await pool.query(`
      INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5)
    `, [token, userId, expires, ip, userAgent]);

    return { token, expiresAt: expires.toISOString() };
  },

  async validateSession(token) {
    if (!token) return null;
    await ensureInitialized();
    const res = await pool.query(`
      SELECT s.*, u.id as u_id, u.username, u.suspended
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.id = $1 AND s.expires_at > NOW()
    `, [token]);

    const session = res.rows[0];
    if (!session) return null;
    if (session.suspended) {
      await this.destroySession(token);
      return null;
    }

    const userRes = await pool.query(`${userBaseQuery} WHERE u.id = $1`, [session.user_id]);
    return formatUser(userRes.rows[0]);
  },

  async destroySession(token) {
    if (!token) return;
    await pool.query('DELETE FROM sessions WHERE id = $1', [token]);
  },

  async destroyUserSessions(userId) {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  },

  // --- Users / Accounts CRUD ---
  async listUsers() {
    await ensureInitialized();
    const res = await pool.query(`${userBaseQuery} ORDER BY u.id ASC`);
    return res.rows.map(formatUser);
  },

  async getUser(usernameOrId) {
    await ensureInitialized();
    let res;
    if (typeof usernameOrId === 'number' || (!isNaN(Number(usernameOrId)) && String(usernameOrId).trim() !== '')) {
      res = await pool.query(`${userBaseQuery} WHERE u.id = $1`, [Number(usernameOrId)]);
    } else {
      res = await pool.query(`${userBaseQuery} WHERE LOWER(u.username) = LOWER($1)`, [String(usernameOrId).trim()]);
    }
    return formatUser(res.rows[0]);
  },

  async createUser({ username, password, email, fullName, firstName, lastName, birthdate, role = 'student', package: packageId = 'student-pass' }) {
    if (!username || !password || !email) {
      throw new Error('Username, password, and email are required.');
    }

    await ensureInitialized();
    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    // Check collision
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $2', [cleanUsername, cleanEmail]);
    if (existing.rowCount > 0) {
      throw new Error(`An account with username "${cleanUsername}" or email "${cleanEmail}" already exists.`);
    }

    const roleRes = await pool.query('SELECT id FROM roles WHERE LOWER(name) = LOWER($1)', [role]);
    const roleId = roleRes.rowCount > 0 ? roleRes.rows[0].id : (await pool.query("SELECT id FROM roles WHERE name = 'student'")).rows[0].id;

    // Package quota defaults: 100MB SSD, 20GB Bandwidth, 1 Domain, 1 DB
    const diskMB = 100;
    const bwMB = 20480; // 20GB
    const domainsLimit = 1;
    const dbsLimit = 1;

    const computedFullName = fullName ? fullName.trim() : ([firstName, lastName].filter(Boolean).join(' ') || cleanUsername);
    const { salt, hash } = hashPassword(password);
    const result = await pool.query(`
      INSERT INTO users (
        username, password_hash, salt, email, full_name, first_name, last_name, birthdate, role_id, 
        package, suspended, disk_limit_mb, disk_used_mb, bw_limit_mb, bw_used_mb,
        web_domains_limit, databases_limit, cron_jobs_limit, backups_limit
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, 0, $12, 0, $13, $14, 2, 3)
      RETURNING id
    `, [
      cleanUsername,
      hash,
      salt,
      cleanEmail,
      computedFullName,
      firstName ? firstName.trim() : null,
      lastName ? lastName.trim() : null,
      birthdate ? String(birthdate).trim() : null,
      roleId,
      packageId || 'student-pass',
      diskMB,
      bwMB,
      domainsLimit,
      dbsLimit
    ]);

    return this.getUser(result.rows[0].id);
  },

  async updateUser(username, updates = {}) {
    await ensureInitialized();
    const userRes = await pool.query('SELECT id, first_name, last_name FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = userRes.rows[0];
    if (!user) throw new Error(`User "${username}" not found.`);

    if (updates.firstName !== undefined) {
      await pool.query('UPDATE users SET first_name = $1, updated_at = NOW() WHERE id = $2', [updates.firstName ? updates.firstName.trim() : null, user.id]);
    }
    if (updates.lastName !== undefined) {
      await pool.query('UPDATE users SET last_name = $1, updated_at = NOW() WHERE id = $2', [updates.lastName ? updates.lastName.trim() : null, user.id]);
    }
    if (updates.birthdate !== undefined) {
      await pool.query('UPDATE users SET birthdate = $1, updated_at = NOW() WHERE id = $2', [updates.birthdate ? String(updates.birthdate).trim() : null, user.id]);
    }
    if (updates.name || updates.fullName) {
      const fn = updates.name || updates.fullName;
      await pool.query('UPDATE users SET full_name = $1, updated_at = NOW() WHERE id = $2', [fn.trim(), user.id]);
    } else if (updates.firstName !== undefined || updates.lastName !== undefined) {
      const fn = updates.firstName !== undefined ? (updates.firstName ? updates.firstName.trim() : '') : (user.first_name || '');
      const ln = updates.lastName !== undefined ? (updates.lastName ? updates.lastName.trim() : '') : (user.last_name || '');
      const combined = `${fn} ${ln}`.trim() || username;
      await pool.query('UPDATE users SET full_name = $1, updated_at = NOW() WHERE id = $2', [combined, user.id]);
    }

    if (updates.email) {
      await pool.query('UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2', [updates.email.trim().toLowerCase(), user.id]);
    }
    if (updates.packageId || updates.package) {
      const pkg = updates.packageId || updates.package;
      let disk = 100, bw = 200, doms = 1, dbs = 1;
      if (pkg === 'semester-pass') { disk = 250; bw = 500; doms = 2; dbs = 2; }
      if (pkg === 'thesis-pass') { disk = 500; bw = 1000; doms = 3; dbs = 3; }
      await pool.query(`
        UPDATE users 
        SET package = $1, disk_limit_mb = $2, bw_limit_mb = $3, web_domains_limit = $4, databases_limit = $5, updated_at = NOW() 
        WHERE id = $6
      `, [pkg, disk, bw, doms, dbs, user.id]);
    }
    if (updates.password) {
      const { salt, hash } = hashPassword(updates.password);
      await pool.query('UPDATE users SET password_hash = $1, salt = $2, updated_at = NOW() WHERE id = $3', [hash, salt, user.id]);
    }
    if (updates.suspended !== undefined) {
      await pool.query('UPDATE users SET suspended = $1, updated_at = NOW() WHERE id = $2', [Boolean(updates.suspended), user.id]);
      if (updates.suspended) {
        await this.destroyUserSessions(user.id);
      }
    }

    return this.getUser(user.id);
  },

  async toggleSuspendUser(username) {
    await ensureInitialized();
    const userRes = await pool.query('SELECT id, suspended FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = userRes.rows[0];
    if (!user) throw new Error(`User "${username}" not found.`);

    const newStatus = !user.suspended;
    await pool.query('UPDATE users SET suspended = $1, updated_at = NOW() WHERE id = $2', [newStatus, user.id]);

    if (newStatus) {
      await this.destroyUserSessions(user.id);
    }

    const updated = await this.getUser(user.id);
    return {
      success: true,
      message: `Account @${username} is now ${newStatus ? 'suspended' : 'active'}.`,
      status: newStatus ? 'suspended' : 'active',
      user: updated
    };
  },

  async deleteUser(username) {
    if (username.toLowerCase() === 'admin') {
      throw new Error('The primary admin account cannot be deleted.');
    }
    await ensureInitialized();
    const userRes = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = userRes.rows[0];
    if (!user) throw new Error(`User "${username}" not found.`);

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    return { success: true, message: `Account @${username} deleted successfully.` };
  },

  // --- Web Domains ---
  async listDomains(username = null) {
    await ensureInitialized();
    let sql = `
      SELECT d.*, u.username as owner
      FROM domains d
      JOIN users u ON d.user_id = u.id
    `;
    const params = [];
    if (username && username.toLowerCase() !== 'admin') {
      sql += ' WHERE LOWER(u.username) = LOWER($1)';
      params.push(username.trim());
    }
    sql += ' ORDER BY d.id DESC';
    const res = await pool.query(sql, params);
    return res.rows.map(r => ({
      domain: r.domain,
      aliases: r.aliases || '',
      ip: r.ip,
      ssl: Boolean(r.ssl),
      sslProvider: r.ssl_provider,
      sslExpires: r.ssl_expires || 'N/A',
      phpVersion: r.php_version,
      backend: r.backend,
      stats: r.stats,
      diskUsageMB: Number(r.disk_usage_mb || 0),
      bandwidthMB: Number(r.bandwidth_mb || 0),
      suspended: Boolean(r.suspended),
      created: r.created_at ? new Date(r.created_at).toISOString().substring(0, 10) : '2026-02-10',
      owner: r.owner
    }));
  },

  async getDomain(domain) {
    await ensureInitialized();
    const res = await pool.query(`
      SELECT d.*, u.username as owner
      FROM domains d
      JOIN users u ON d.user_id = u.id
      WHERE LOWER(d.domain) = LOWER($1)
    `, [domain.trim()]);
    const row = res.rows[0];
    if (!row) return null;
    return {
      domain: row.domain,
      aliases: row.aliases || '',
      ip: row.ip,
      ssl: Boolean(row.ssl),
      sslProvider: row.ssl_provider,
      sslExpires: row.ssl_expires || 'N/A',
      phpVersion: row.php_version,
      backend: row.backend,
      stats: row.stats,
      diskUsageMB: Number(row.disk_usage_mb || 0),
      bandwidthMB: Number(row.bandwidth_mb || 0),
      suspended: Boolean(row.suspended),
      created: row.created_at ? new Date(row.created_at).toISOString().substring(0, 10) : '2026-02-10',
      owner: row.owner
    };
  },

  async addDomain({ username = 'admin', domain, aliases = '', phpVersion = '8.3', ssl = true }) {
    await ensureInitialized();
    const userRes = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = userRes.rows[0] || (await pool.query("SELECT id FROM users WHERE username = 'admin'")).rows[0];
    if (!user) throw new Error(`User "${username}" not found.`);

    const cleanDomain = domain.trim().toLowerCase();
    const existing = await pool.query('SELECT id FROM domains WHERE LOWER(domain) = LOWER($1)', [cleanDomain]);
    if (existing.rowCount > 0) {
      throw new Error(`Domain "${cleanDomain}" is already hosted.`);
    }

    const cleanAliases = aliases ? aliases.trim() : `www.${cleanDomain}`;
    const sslExpires = ssl ? new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0] : 'N/A';

    await pool.query(`
      INSERT INTO domains (
        user_id, domain, aliases, ip, ssl, ssl_provider, ssl_expires, 
        php_version, backend, stats, disk_usage_mb, bandwidth_mb, suspended
      ) VALUES ($1, $2, $3, '119.92.128.45', $4, $5, $6, $7, $8, 'AWStats', 12.0, 0.0, FALSE)
    `, [
      user.id,
      cleanDomain,
      cleanAliases,
      Boolean(ssl),
      ssl ? "Let's Encrypt" : 'None',
      sslExpires,
      phpVersion || '8.3',
      `PHP-FPM-${(phpVersion || '8.3').replace('.', '')}`
    ]);

    // Auto-create default DNS A & CNAME records
    await pool.query('INSERT INTO dns_records (domain_name, record, type, value, ttl, priority) VALUES ($1, $2, $3, $4, $5, $6)', [cleanDomain, '@', 'A', '119.92.128.45', 14400, '']);
    await pool.query('INSERT INTO dns_records (domain_name, record, type, value, ttl, priority) VALUES ($1, $2, $3, $4, $5, $6)', [cleanDomain, 'www', 'CNAME', cleanDomain, 14400, '']);

    return this.getDomain(cleanDomain);
  },

  async deleteDomain(domain) {
    await ensureInitialized();
    const cleanDomain = domain.trim().toLowerCase();
    await pool.query('DELETE FROM dns_records WHERE LOWER(domain_name) = LOWER($1)', [cleanDomain]);
    await pool.query('DELETE FROM domains WHERE LOWER(domain) = LOWER($1)', [cleanDomain]);
    return { success: true, message: `Domain "${cleanDomain}" removed.` };
  },

  async toggleDomainSsl(domain, enableSsl = true) {
    await ensureInitialized();
    const cleanDomain = domain.trim().toLowerCase();
    const sslExpires = enableSsl ? new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0] : 'N/A';
    await pool.query(`
      UPDATE domains 
      SET ssl = $1, ssl_provider = $2, ssl_expires = $3
      WHERE LOWER(domain) = LOWER($4)
    `, [
      Boolean(enableSsl),
      enableSsl ? "Let's Encrypt" : 'None',
      sslExpires,
      cleanDomain
    ]);
    return this.getDomain(cleanDomain);
  },

  // --- Databases ---
  async listDatabases(username = null) {
    await ensureInitialized();
    let sql = `
      SELECT d.*, u.username as owner
      FROM databases d
      JOIN users u ON d.user_id = u.id
    `;
    const params = [];
    if (username && username.toLowerCase() !== 'admin') {
      sql += ' WHERE LOWER(u.username) = LOWER($1)';
      params.push(username.trim());
    }
    sql += ' ORDER BY d.id DESC';
    const res = await pool.query(sql, params);
    return res.rows.map(r => ({
      database: r.database_name,
      dbuser: r.db_user,
      host: r.host,
      type: r.type,
      charset: r.charset,
      diskUsageMB: Number(r.disk_usage_mb || 0),
      created: r.created_at ? new Date(r.created_at).toISOString().substring(0, 10) : '2026-02-10',
      owner: r.owner
    }));
  },

  async addDatabase({ username = 'admin', database, dbuser, password, charset = 'utf8mb4' }) {
    await ensureInitialized();
    const userRes = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = userRes.rows[0] || (await pool.query("SELECT id FROM users WHERE username = 'admin'")).rows[0];
    if (!user) throw new Error(`User "${username}" not found.`);

    const cleanDb = database.trim().toLowerCase();
    const cleanUser = dbuser ? dbuser.trim().toLowerCase() : cleanDb;

    const existing = await pool.query('SELECT id FROM databases WHERE LOWER(database_name) = LOWER($1)', [cleanDb]);
    if (existing.rowCount > 0) {
      throw new Error(`Database "${cleanDb}" already exists.`);
    }

    await pool.query(`
      INSERT INTO databases (user_id, database_name, db_user, host, type, charset, disk_usage_mb)
      VALUES ($1, $2, $3, 'localhost', 'mysql', $4, 4.0)
    `, [user.id, cleanDb, cleanUser, charset || 'utf8mb4']);

    return {
      database: cleanDb,
      dbuser: cleanUser,
      host: 'localhost',
      type: 'mysql',
      charset: charset || 'utf8mb4',
      diskUsageMB: 4.0,
      created: new Date().toISOString().split('T')[0]
    };
  },

  async deleteDatabase(databaseName) {
    await ensureInitialized();
    const cleanDb = databaseName.trim().toLowerCase();
    await pool.query('DELETE FROM databases WHERE LOWER(database_name) = LOWER($1)', [cleanDb]);
    return { success: true, message: `Database "${cleanDb}" removed.` };
  },

  // --- DNS Records ---
  async listDnsRecords(domainName) {
    await ensureInitialized();
    const clean = domainName.trim().toLowerCase();
    const res = await pool.query('SELECT * FROM dns_records WHERE LOWER(domain_name) = LOWER($1) ORDER BY id ASC', [clean]);
    return res.rows.map(r => ({
      id: String(r.id),
      record: r.record,
      type: r.type,
      value: r.value,
      ttl: r.ttl,
      priority: r.priority || ''
    }));
  },

  async addDnsRecord(domainName, { record, type, value, priority = '', ttl = 14400 }) {
    await ensureInitialized();
    const cleanDomain = domainName.trim().toLowerCase();
    const res = await pool.query(`
      INSERT INTO dns_records (domain_name, record, type, value, ttl, priority)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [cleanDomain, record.trim(), type.trim().toUpperCase(), value.trim(), ttl || 14400, priority || '']);

    return {
      id: String(res.rows[0].id),
      record: record.trim(),
      type: type.trim().toUpperCase(),
      value: value.trim(),
      ttl: ttl || 14400,
      priority: priority || ''
    };
  },

  async deleteDnsRecord(domainName, recordId) {
    await ensureInitialized();
    await pool.query('DELETE FROM dns_records WHERE LOWER(domain_name) = LOWER($1) AND id = $2', [domainName.trim().toLowerCase(), Number(recordId)]);
    return { success: true, message: `DNS Record #${recordId} deleted.` };
  },

  // --- Cron Jobs ---
  async listCronJobs(username = null) {
    await ensureInitialized();
    let sql = `
      SELECT c.*, u.username as owner
      FROM cron_jobs c
      JOIN users u ON c.user_id = u.id
    `;
    const params = [];
    if (username && username.toLowerCase() !== 'admin') {
      sql += ' WHERE LOWER(u.username) = LOWER($1)';
      params.push(username.trim());
    }
    sql += ' ORDER BY c.id ASC';
    const res = await pool.query(sql, params);
    return res.rows.map(r => ({
      id: String(r.id),
      min: r.min,
      hour: r.hour,
      day: r.day,
      month: r.month,
      wday: r.wday,
      cmd: r.cmd,
      comment: r.comment || '',
      owner: r.owner
    }));
  },

  async addCronJob({ username = 'admin', min = '0', hour = '0', day = '*', month = '*', wday = '*', cmd, comment = '' }) {
    await ensureInitialized();
    const userRes = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = userRes.rows[0] || (await pool.query("SELECT id FROM users WHERE username = 'admin'")).rows[0];
    if (!user) throw new Error(`User "${username}" not found.`);

    const res = await pool.query(`
      INSERT INTO cron_jobs (user_id, min, hour, day, month, wday, cmd, comment)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [user.id, min, hour, day, month, wday, cmd, comment]);

    return {
      id: String(res.rows[0].id),
      min, hour, day, month, wday, cmd, comment
    };
  },

  async deleteCronJob(id) {
    await ensureInitialized();
    await pool.query('DELETE FROM cron_jobs WHERE id = $1', [Number(id)]);
    return { success: true, message: `Cron job #${id} deleted.` };
  },

  // --- Backups ---
  async listBackups(username = null) {
    await ensureInitialized();
    let sql = `
      SELECT b.*, u.username as owner
      FROM backups b
      JOIN users u ON b.user_id = u.id
    `;
    const params = [];
    if (username && username.toLowerCase() !== 'admin') {
      sql += ' WHERE LOWER(u.username) = LOWER($1)';
      params.push(username.trim());
    }
    sql += ' ORDER BY b.id DESC';
    const res = await pool.query(sql, params);
    return res.rows.map(r => ({
      filename: r.filename,
      date: r.created_at ? new Date(r.created_at).toISOString().replace('T', ' ').substring(0, 19) : '2026-10-04 02:00:00',
      sizeMB: Number(r.size_mb || 0),
      type: r.type,
      runtime: r.runtime,
      owner: r.owner
    }));
  },

  async createBackup(username = 'admin') {
    await ensureInitialized();
    const userRes = await pool.query('SELECT id, username FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = userRes.rows[0] || (await pool.query("SELECT id, username FROM users WHERE username = 'admin'")).rows[0];
    if (!user) throw new Error(`User "${username}" not found.`);

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '_').substring(0, 19);
    const filename = `${user.username}.${timestamp}.tar`;
    const size = +(Math.random() * 5 + 16).toFixed(1);
    const runtime = `${Math.floor(Math.random() * 8 + 8)}s`;

    await pool.query(`
      INSERT INTO backups (user_id, filename, size_mb, type, runtime)
      VALUES ($1, $2, $3, 'Project Backup (Web & Database)', $4)
    `, [user.id, filename, size, runtime]);

    return {
      filename,
      date: new Date().toISOString().replace('T', ' ').substring(0, 19),
      sizeMB: size,
      type: 'Project Backup (Web & Database)',
      runtime
    };
  },

  // --- Hosting Plans ---
  async listPlans() {
    await ensureInitialized();
    const res = await pool.query('SELECT * FROM hosting_plans ORDER BY price_monthly ASC');
    return res.rows.map(r => ({
      id: r.id,
      name: r.name,
      badge: r.badge,
      priceMonthly: r.price_monthly,
      pricePeriod: r.price_period,
      billingLabel: r.billing_label,
      popular: Boolean(r.popular),
      specs: typeof r.specs_json === 'string' ? JSON.parse(r.specs_json) : (r.specs_json || {})
    }));
  },

  // --- Live System Info ---
  getSystemInfo() {
    const totalMem = Math.round(os.totalmem() / (1024 * 1024));
    const freeMem = Math.round(os.freemem() / (1024 * 1024));
    const usedMem = totalMem - freeMem;
    const cpus = os.cpus();
    const cpuModel = cpus && cpus.length ? cpus[0].model : 'Cloud CPU';
    const uptimeSecs = Math.floor(os.uptime());
    const uptimeDays = Math.floor(uptimeSecs / 86400);
    const uptimeHours = Math.floor((uptimeSecs % 86400) / 3600);

    return {
      hostname: 'ph-node01.hosta.ph',
      os: 'Ubuntu 22.04 LTS (Hosted in Philippines)',
      databaseEngine: 'Neon Cloud PostgreSQL (ap-southeast-1)',
      hestiaVersion: '1.8.12',
      uptime: `${uptimeDays} days, ${uptimeHours} hours`,
      loadAverage: os.loadavg().map(n => n.toFixed(2)).join(', '),
      cpuModel: `${cpuModel} (${cpus.length} vCPU)`,
      memoryTotal: `${totalMem} MB`,
      memoryUsed: `${usedMem} MB`,
      memoryFree: `${freeMem} MB`,
      diskTotal: '50 GB SSD',
      diskUsed: '12 GB',
      diskFree: '38 GB',
      nginxVersion: '1.24.0',
      phpVersions: ['7.4', '8.0', '8.1', '8.2', '8.3'],
      mysqlVersion: '10.11-MariaDB',
      status: 'ONLINE'
    };
  },

  // --- Live Chat System Queries ---
  async getOrCreateChatThread({ sessionId, visitorName, visitorEmail = '', userId = null }) {
    await ensureInitialized();
    let existing;
    if (userId) {
      existing = await pool.query('SELECT * FROM chat_threads WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userId]);
    }
    if (!existing || existing.rowCount === 0) {
      existing = await pool.query('SELECT * FROM chat_threads WHERE session_id = $1', [sessionId]);
    }
    if (existing && existing.rowCount > 0) {
      const thread = existing.rows[0];
      const updates = [];
      const params = [];
      let idx = 1;
      if (visitorName && thread.visitor_name !== visitorName) {
        updates.push(`visitor_name = $${idx++}`);
        params.push(visitorName);
      }
      if (visitorEmail && thread.visitor_email !== visitorEmail) {
        updates.push(`visitor_email = $${idx++}`);
        params.push(visitorEmail);
      }
      if (userId && !thread.user_id) {
        updates.push(`user_id = $${idx++}`);
        params.push(userId);
      }
      if (updates.length > 0) {
        params.push(thread.id);
        await pool.query(`UPDATE chat_threads SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, params);
      }
      return thread;
    }
    const res = await pool.query(`
      INSERT INTO chat_threads (session_id, visitor_name, visitor_email, user_id, status)
      VALUES ($1, $2, $3, $4, 'open')
      RETURNING *
    `, [sessionId, visitorName || 'Visitor', visitorEmail, userId]);
    return res.rows[0];
  },

  async listChatThreads() {
    await ensureInitialized();
    const res = await pool.query(`
      SELECT t.*, 
        (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id AND m.sender_type = 'visitor' AND m.is_read = FALSE) as unread_count,
        (SELECT message FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) as last_message,
        (SELECT created_at FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) as last_message_at
      FROM chat_threads t
      ORDER BY t.updated_at DESC
    `);
    return res.rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      visitorName: r.visitor_name,
      visitorEmail: r.visitor_email,
      status: r.status,
      unreadCount: parseInt(r.unread_count || 0, 10),
      lastMessage: r.last_message || 'Chat started',
      lastMessageAt: r.last_message_at || r.created_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  },

  async getChatMessages(threadIdOrSession) {
    await ensureInitialized();
    let threadId = threadIdOrSession;
    if (typeof threadIdOrSession === 'string' && isNaN(Number(threadIdOrSession))) {
      const threadRes = await pool.query('SELECT id FROM chat_threads WHERE session_id = $1', [threadIdOrSession]);
      if (threadRes.rowCount === 0) return [];
      threadId = threadRes.rows[0].id;
    }
    const res = await pool.query(`
      SELECT * FROM chat_messages
      WHERE thread_id = $1
      ORDER BY id ASC
    `, [Number(threadId)]);
    return res.rows.map(r => ({
      id: r.id,
      threadId: r.thread_id,
      senderType: r.sender_type,
      senderName: r.sender_name,
      message: r.message,
      isRead: Boolean(r.is_read),
      createdAt: r.created_at
    }));
  },

  async addChatMessage({ threadIdOrSession, senderType, senderName, message }) {
    await ensureInitialized();
    let threadId = threadIdOrSession;
    if (typeof threadIdOrSession === 'string' && isNaN(Number(threadIdOrSession))) {
      const threadRes = await pool.query('SELECT id FROM chat_threads WHERE session_id = $1', [threadIdOrSession]);
      if (threadRes.rowCount === 0) throw new Error('Chat thread not found');
      threadId = threadRes.rows[0].id;
    }

    const res = await pool.query(`
      INSERT INTO chat_messages (thread_id, sender_type, sender_name, message, is_read)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [Number(threadId), senderType, senderName, message, senderType === 'admin']);

    await pool.query('UPDATE chat_threads SET updated_at = NOW() WHERE id = $1', [Number(threadId)]);

    return {
      id: res.rows[0].id,
      threadId: res.rows[0].thread_id,
      senderType: res.rows[0].sender_type,
      senderName: res.rows[0].sender_name,
      message: res.rows[0].message,
      isRead: Boolean(res.rows[0].is_read),
      createdAt: res.rows[0].created_at
    };
  },

  async markThreadMessagesRead(threadId, readerType = 'admin') {
    await ensureInitialized();
    const oppositeType = readerType === 'admin' ? 'visitor' : 'admin';
    await pool.query(`
      UPDATE chat_messages 
      SET is_read = TRUE 
      WHERE thread_id = $1 AND sender_type = $2
    `, [Number(threadId), oppositeType]);
  },

  async resolveChatThread(threadId) {
    await ensureInitialized();
    await pool.query("UPDATE chat_threads SET status = 'resolved', updated_at = NOW() WHERE id = $1", [Number(threadId)]);
    return { success: true };
  },

  // --- Registration Verification Codes ---
  async saveRegistrationVerification({ email, code, registrationData, expiresMinutes = 15 }) {
    await ensureInitialized();
    const cleanEmail = email.trim().toLowerCase();
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    await pool.query(`
      INSERT INTO registration_verifications (email, code, registration_data, expires_at, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (email) 
      DO UPDATE SET code = $2, registration_data = $3, expires_at = $4, created_at = NOW()
    `, [cleanEmail, String(code).trim(), JSON.stringify(registrationData), expiresAt]);

    return { email: cleanEmail, expiresAt };
  },

  async getRegistrationVerification(email, code) {
    await ensureInitialized();
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = String(code).trim();

    const res = await pool.query(`
      SELECT * FROM registration_verifications
      WHERE LOWER(email) = $1 AND code = $2 AND expires_at > NOW()
    `, [cleanEmail, cleanCode]);

    if (res.rowCount === 0) return null;
    return res.rows[0];
  },

  async getPendingVerificationByEmail(email) {
    await ensureInitialized();
    const cleanEmail = email.trim().toLowerCase();
    const res = await pool.query(`
      SELECT * FROM registration_verifications
      WHERE LOWER(email) = $1 AND expires_at > NOW()
    `, [cleanEmail]);
    if (res.rowCount === 0) return null;
    return res.rows[0];
  },

  async deleteRegistrationVerification(email) {
    await ensureInitialized();
    const cleanEmail = email.trim().toLowerCase();
    await pool.query('DELETE FROM registration_verifications WHERE LOWER(email) = $1', [cleanEmail]);
  }
};

module.exports = dbService;
