const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('./db');

class HestiaClient {
  constructor(config = {}) {
    this.updateConfig(config);
  }

  updateConfig(config = {}) {
    this.host = config.hestiaHost || 'https://hostia.site:8083';
    this.port = parseInt(config.hestiaPort || '8083', 10);
    this.authType = config.authType || 'access_key';
    this.accessKey = config.accessKey || '';
    this.secretKey = config.secretKey || '';
    this.username = config.username || 'admin';
    this.password = config.password || '';
    this.defaultUser = config.defaultUser || 'admin';
    this.defaultPackage = config.defaultPackage || 'default';
    this.allowSelfSignedSsl = config.allowSelfSignedSsl !== false;

    // Prepare HTTPS agent that can ignore self-signed certs if configured
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: !this.allowSelfSignedSsl
    });
  }

  /**
   * Determine if live credentials are configured for HestiaCP
   */
  hasLiveCredentials() {
    return (this.authType === 'access_key' && Boolean(this.accessKey) && Boolean(this.secretKey)) ||
           (this.authType === 'user_pass' && Boolean(this.username) && Boolean(this.password));
  }

  /**
   * Core request dispatcher to HestiaCP API
   */
  async executeCommand(cmd, args = [], options = {}) {
    if (!this.hasLiveCredentials()) {
      return await this._handleLocalCommand(cmd, args);
    }

    try {
      let baseUrl = this.host.trim();
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = `https://${baseUrl}`;
      }
      
      const parsedUrl = new URL(baseUrl);
      if (this.port && !parsedUrl.port) {
        parsedUrl.port = String(this.port);
      }
      parsedUrl.pathname = '/api/';

      const params = new URLSearchParams();
      if (this.authType === 'access_key' && this.accessKey && this.secretKey) {
        params.append('hash', `${this.accessKey}:${this.secretKey}`);
      } else if (this.username && this.password) {
        params.append('user', this.username);
        params.append('password', this.password);
      }

      params.append('cmd', cmd);
      args.forEach((arg, index) => {
        params.append(`arg${index + 1}`, String(arg));
      });

      const postData = params.toString();
      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Hosta-WebHosting-Client/1.0'
        },
        timeout: options.timeout || 15000
      };

      if (isHttps) {
        requestOptions.agent = this.httpsAgent;
      }

      return await new Promise((resolve, reject) => {
        const req = transport.request(requestOptions, (res) => {
          let responseBody = '';

          res.on('data', (chunk) => {
            responseBody += chunk;
          });

          res.on('end', () => {
            const trimmed = responseBody.trim();

            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              try {
                const parsed = JSON.parse(trimmed);
                return resolve(parsed);
              } catch {
                // Return text if parsing fails
              }
            }

            if (trimmed === '0' || trimmed === 'OK' || trimmed === '') {
              return resolve({ status: 'ok', raw: trimmed });
            }

            const errorCode = parseInt(trimmed, 10);
            if (!isNaN(errorCode) && errorCode > 0) {
              const errMessage = this._mapHestiaError(errorCode, cmd);
              const error = new Error(`HestiaCP Error [${errorCode}]: ${errMessage}`);
              error.code = errorCode;
              return reject(error);
            }

            resolve({ status: 'ok', raw: trimmed });
          });
        });

        req.on('error', (err) => {
          reject(new Error(`HestiaCP Connection Error: ${err.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`HestiaCP connection timed out after ${options.timeout || 15000}ms`));
        });

        req.write(postData);
        req.end();
      });
    } catch (err) {
      if (options.fallbackToLocal !== false) {
        console.warn(`[HestiaClient] Remote command notice: ${err.message}. Using Neon DB records.`);
        return await this._handleLocalCommand(cmd, args);
      }
      throw err;
    }
  }

  /**
   * Database dispatcher matching HestiaCP command outputs
   */
  async _handleLocalCommand(cmd, args = []) {
    switch (cmd) {
      case 'v-list-sys-info':
        return db.getSystemInfo();

      case 'v-list-users': {
        const result = {};
        const users = await db.listUsers();
        users.forEach(u => {
          result[u.username] = {
            NAME: u.name,
            PACKAGE: u.package,
            EMAIL: u.email,
            ROLE: u.role || 'student',
            U_DISK: Math.round(u.quota.disk.usedMB),
            DISK_QUOTA: Math.round(u.quota.disk.totalMB),
            U_BANDWIDTH: Math.round(u.quota.bandwidth.usedMB),
            BANDWIDTH: Math.round(u.quota.bandwidth.totalMB),
            U_WEB_DOMAINS: u.quota.webDomains.used,
            U_DATABASES: u.quota.databases.used,
            SUSPENDED: u.suspended ? 'yes' : 'no',
            DATE: u.created
          };
        });
        return result;
      }

      case 'v-list-user': {
        const target = args[0] || this.defaultUser;
        const u = await db.getUser(target);
        if (!u) return {};
        return {
          [target]: {
            NAME: u.name,
            PACKAGE: u.package,
            EMAIL: u.email,
            ROLE: u.role || 'student',
            U_DISK: Math.round(u.quota.disk.usedMB),
            DISK_QUOTA: Math.round(u.quota.disk.totalMB),
            U_BANDWIDTH: Math.round(u.quota.bandwidth.usedMB),
            BANDWIDTH: Math.round(u.quota.bandwidth.totalMB),
            U_WEB_DOMAINS: u.quota.webDomains.used,
            U_DATABASES: u.quota.databases.used,
            U_MAIL_ACCOUNTS: 0,
            U_CRON_JOBS: u.quota.cronJobs.used,
            U_BACKUPS: u.quota.backups.used,
            DATE: u.created,
            SUSPENDED: u.suspended ? 'yes' : 'no'
          }
        };
      }

      case 'v-add-user': {
        const username = args[0];
        const password = args[1];
        const email = args[2];
        const packageId = args[3] || 'student-pass';
        const name = [args[4], args[5]].filter(Boolean).join(' ') || username;
        return await db.createUser({ username, fullName: name, email, password, package: packageId });
      }

      case 'v-delete-user': {
        return await db.deleteUser(args[0]);
      }

      case 'v-suspend-user': {
        return await db.updateUser(args[0], { suspended: true });
      }

      case 'v-unsuspend-user': {
        return await db.updateUser(args[0], { suspended: false });
      }

      case 'v-change-user-package': {
        return await db.updateUser(args[0], { packageId: args[1] });
      }

      case 'v-change-user-name': {
        const username = args[0];
        const name = [args[1], args[2]].filter(Boolean).join(' ');
        return await db.updateUser(username, { name });
      }

      case 'v-change-user-email': {
        return await db.updateUser(args[0], { email: args[1] });
      }

      case 'v-list-web-domains': {
        const result = {};
        const domains = await db.listDomains(args[0] || null);
        domains.forEach(d => {
          result[d.domain] = {
            IP: d.ip,
            ALIAS: d.aliases,
            SSL: d.ssl ? 'yes' : 'no',
            SSL_HOME: 'same',
            STATS: d.stats,
            U_DISK: d.diskUsageMB,
            U_BANDWIDTH: d.bandwidthMB,
            SUSPENDED: d.suspended ? 'yes' : 'no',
            DATE: d.created,
            PHP_VERSION: d.phpVersion,
            BACKEND: d.backend
          };
        });
        return result;
      }

      case 'v-add-web-domain': {
        return await db.addDomain({ username: args[0], domain: args[1], aliases: args[2] || '' });
      }

      case 'v-delete-web-domain': {
        return await db.deleteDomain(args[1]);
      }

      case 'v-add-web-domain-ssl': {
        return await db.toggleDomainSsl(args[1], true);
      }

      case 'v-delete-web-domain-ssl': {
        return await db.toggleDomainSsl(args[1], false);
      }

      case 'v-list-databases': {
        const result = {};
        const dbs = await db.listDatabases(args[0] || null);
        dbs.forEach(dbRow => {
          result[dbRow.database] = {
            DATABASE: dbRow.database,
            DBUSER: dbRow.dbuser,
            HOST: dbRow.host,
            TYPE: dbRow.type,
            CHARSET: dbRow.charset,
            U_DISK: dbRow.diskUsageMB,
            DATE: dbRow.created
          };
        });
        return result;
      }

      case 'v-add-database': {
        return await db.addDatabase({ username: args[0], database: args[1], dbuser: args[2], password: args[3] });
      }

      case 'v-delete-database': {
        return await db.deleteDatabase(args[1]);
      }

      case 'v-list-dns-records': {
        const domain = args[1];
        const recs = await db.listDnsRecords(domain);
        const result = {};
        recs.forEach(r => {
          result[r.id] = {
            ID: r.id,
            RECORD: r.record,
            TYPE: r.type,
            VALUE: r.value,
            TTL: r.ttl,
            PRIORITY: r.priority
          };
        });
        return result;
      }

      case 'v-add-dns-record': {
        return await db.addDnsRecord(args[1], { record: args[2], type: args[3], value: args[4], priority: args[5] || '' });
      }

      case 'v-delete-dns-record': {
        return await db.deleteDnsRecord(args[1], args[2]);
      }

      case 'v-list-cron-jobs': {
        const result = {};
        const jobs = await db.listCronJobs(args[0] || null);
        jobs.forEach(c => {
          result[c.id] = {
            JOB: c.id,
            MIN: c.min,
            HOUR: c.hour,
            DAY: c.day,
            MONTH: c.month,
            WDAY: c.wday,
            CMD: c.cmd,
            COMMENT: c.comment
          };
        });
        return result;
      }

      case 'v-add-cron-job': {
        return await db.addCronJob({ username: args[0], min: args[1], hour: args[2], day: args[3], month: args[4], wday: args[5], cmd: args[6] });
      }

      case 'v-delete-cron-job': {
        return await db.deleteCronJob(args[1]);
      }

      case 'v-list-user-backups': {
        const result = {};
        const backups = await db.listBackups(args[0] || null);
        backups.forEach(b => {
          result[b.filename] = {
            BACKUP: b.filename,
            SIZE: b.sizeMB,
            DATE: b.date,
            TYPE: b.type,
            RUNTIME: b.runtime
          };
        });
        return result;
      }

      case 'v-backup-user': {
        return await db.createBackup(args[0] || this.defaultUser);
      }

      default:
        return { status: 'ok', command: cmd, args };
    }
  }

  // --- High Level API Methods ---

  async testConnection() {
    try {
      if (!this.hasLiveCredentials()) {
        return {
          success: true,
          mode: 'cloud',
          message: 'Connected to Neon Cloud PostgreSQL Database.',
          system: db.getSystemInfo()
        };
      }
      const sysInfo = await this.executeCommand('v-list-sys-info', ['json'], { timeout: 8000 });
      return {
        success: true,
        mode: 'live',
        message: 'Successfully connected to HestiaCP Server.',
        systemInfo: sysInfo
      };
    } catch (err) {
      return {
        success: false,
        mode: 'live',
        message: `Failed to connect to HestiaCP: ${err.message}`,
        error: err.message
      };
    }
  }

  async getDashboardSummary(user = this.defaultUser) {
    const userData = (await db.getUser(user)) || (await db.getUser(this.defaultUser)) || (await db.getUser('admin'));
    const sysData = db.getSystemInfo();
    const webDomains = await db.listDomains(user);
    const databases = await db.listDatabases(user);
    const cronJobs = await db.listCronJobs(user);
    const backups = await db.listBackups(user);

    return {
      user: userData,
      system: sysData,
      counts: {
        domains: webDomains.length,
        databases: databases.length,
        mailAccounts: 0,
        cronJobs: cronJobs.length,
        backups: backups.length
      }
    };
  }

  async listWebDomains(user = this.defaultUser) {
    if (!this.hasLiveCredentials()) return await db.listDomains(user);
    try {
      const raw = await this.executeCommand('v-list-web-domains', [user, 'json'], { fallbackToLocal: true });
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'object' && raw !== null) {
        return Object.entries(raw).map(([domain, info]) => ({
          domain,
          aliases: info.ALIAS || '',
          ip: info.IP || '',
          ssl: info.SSL === 'yes',
          sslProvider: info.SSL === 'yes' ? "Let's Encrypt" : 'None',
          stats: info.STATS || 'AWStats',
          diskUsageMB: parseInt(info.U_DISK || 0, 10),
          bandwidthMB: parseInt(info.U_BANDWIDTH || 0, 10),
          suspended: info.SUSPENDED === 'yes',
          phpVersion: info.PHP_VERSION || '8.3',
          created: info.DATE || ''
        }));
      }
      return await db.listDomains(user);
    } catch {
      return await db.listDomains(user);
    }
  }

  async addWebDomain(user = this.defaultUser, domain, aliases = '', ssl = true, phpVersion = '8.3') {
    const localResult = await db.addDomain({ username: user, domain, aliases, phpVersion, ssl });
    if (this.hasLiveCredentials()) {
      try {
        await this.executeCommand('v-add-web-domain', [user, domain, aliases]);
        if (ssl) {
          await this.executeCommand('v-add-web-domain-ssl', [user, domain]);
        }
      } catch (liveErr) {
        console.warn(`Hestia remote domain creation notice: ${liveErr.message}`);
      }
    }
    return localResult;
  }

  async deleteWebDomain(user = this.defaultUser, domain) {
    const localResult = await db.deleteDomain(domain);
    if (this.hasLiveCredentials()) {
      try {
        await this.executeCommand('v-delete-web-domain', [user, domain]);
      } catch (err) {
        console.warn(`Hestia delete notice: ${err.message}`);
      }
    }
    return localResult;
  }

  async toggleWebDomainSsl(user = this.defaultUser, domain, enableSsl) {
    const localResult = await db.toggleDomainSsl(domain, enableSsl);
    if (this.hasLiveCredentials()) {
      try {
        const cmd = enableSsl ? 'v-add-web-domain-ssl' : 'v-delete-web-domain-ssl';
        await this.executeCommand(cmd, [user, domain]);
      } catch (err) {
        console.warn(`Hestia SSL notice: ${err.message}`);
      }
    }
    return localResult;
  }

  async listDatabases(user = this.defaultUser) {
    if (!this.hasLiveCredentials()) return await db.listDatabases(user);
    try {
      const raw = await this.executeCommand('v-list-databases', [user, 'json'], { fallbackToLocal: true });
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'object' && raw !== null) {
        return Object.entries(raw).map(([database, info]) => ({
          database,
          dbuser: info.DBUSER || database,
          host: info.HOST || 'localhost',
          type: info.TYPE || 'mysql',
          charset: info.CHARSET || 'utf8mb4',
          diskUsageMB: parseFloat(info.U_DISK || 0),
          created: info.DATE || ''
        }));
      }
      return await db.listDatabases(user);
    } catch {
      return await db.listDatabases(user);
    }
  }

  async addDatabase(user = this.defaultUser, database, dbuser, password, charset = 'utf8mb4') {
    const localResult = await db.addDatabase({ username: user, database, dbuser, password, charset });
    if (this.hasLiveCredentials()) {
      try {
        await this.executeCommand('v-add-database', [user, database, dbuser, password, 'mysql', 'localhost', charset]);
      } catch (err) {
        console.warn(`Hestia remote db creation notice: ${err.message}`);
      }
    }
    return localResult;
  }

  async deleteDatabase(user = this.defaultUser, database) {
    const localResult = await db.deleteDatabase(database);
    if (this.hasLiveCredentials()) {
      try {
        await this.executeCommand('v-delete-database', [user, database]);
      } catch (err) {
        console.warn(`Hestia remote db delete notice: ${err.message}`);
      }
    }
    return localResult;
  }

  async listDnsRecords(user = this.defaultUser, domain) {
    return await db.listDnsRecords(domain);
  }

  async addDnsRecord(user = this.defaultUser, domain, { record, type, value, priority = '', ttl = 14400 }) {
    const localResult = await db.addDnsRecord(domain, { record, type, value, priority, ttl });
    if (this.hasLiveCredentials()) {
      try {
        await this.executeCommand('v-add-dns-record', [user, domain, record, type, value, priority || '0']);
      } catch (err) {
        console.warn(`Hestia DNS notice: ${err.message}`);
      }
    }
    return localResult;
  }

  async deleteDnsRecord(user = this.defaultUser, domain, recordId) {
    const localResult = await db.deleteDnsRecord(domain, recordId);
    if (this.hasLiveCredentials()) {
      try {
        await this.executeCommand('v-delete-dns-record', [user, domain, recordId]);
      } catch (err) {
        console.warn(`Hestia DNS delete notice: ${err.message}`);
      }
    }
    return localResult;
  }

  async listCronJobs(user = this.defaultUser) {
    return await db.listCronJobs(user);
  }

  async addCronJob(user = this.defaultUser, { min = '0', hour = '0', day = '*', month = '*', wday = '*', cmd, comment = '' }) {
    const localResult = await db.addCronJob({ username: user, min, hour, day, month, wday, cmd, comment });
    if (this.hasLiveCredentials()) {
      try {
        await this.executeCommand('v-add-cron-job', [user, min, hour, day, month, wday, cmd]);
      } catch (err) {
        console.warn(`Hestia Cron notice: ${err.message}`);
      }
    }
    return localResult;
  }

  async deleteCronJob(user = this.defaultUser, jobId) {
    const localResult = await db.deleteCronJob(jobId);
    if (this.hasLiveCredentials()) {
      try {
        await this.executeCommand('v-delete-cron-job', [user, jobId]);
      } catch (err) {
        console.warn(`Hestia Cron delete notice: ${err.message}`);
      }
    }
    return localResult;
  }

  async listBackups(user = this.defaultUser) {
    return await db.listBackups(user);
  }

  async createBackup(user = this.defaultUser) {
    const localResult = await db.createBackup(user);
    if (this.hasLiveCredentials()) {
      try {
        await this.executeCommand('v-backup-user', [user]);
      } catch (err) {
        console.warn(`Hestia Backup notice: ${err.message}`);
      }
    }
    return localResult;
  }

  // --- Student / User Accounts CRUD ---

  async listUsers() {
    return await db.listUsers();
  }

  async getUser(username) {
    return await db.getUser(username);
  }

  async addUser(username, password, email, packageId = 'student-pass', name = '', role = 'student') {
    const localResult = await db.createUser({ username, password, email, package: packageId, fullName: name, role });
    if (this.hasLiveCredentials()) {
      try {
        const nameParts = (name || username).trim().split(' ');
        const firstName = nameParts[0] || username;
        const lastName = nameParts.slice(1).join(' ') || '';
        await this.executeCommand('v-add-user', [username, password, email, packageId, firstName, lastName]);
      } catch (err) {
        console.warn(`Hestia v-add-user notice: ${err.message}`);
      }
    }
    return localResult;
  }

  async updateUser(username, details = {}) {
    const localResult = await db.updateUser(username, details);
    if (this.hasLiveCredentials()) {
      try {
        if (details.name) {
          const parts = details.name.trim().split(' ');
          await this.executeCommand('v-change-user-name', [username, parts[0] || username, parts.slice(1).join(' ') || '']);
        }
        if (details.email) {
          await this.executeCommand('v-change-user-email', [username, details.email]);
        }
        if (details.packageId) {
          await this.executeCommand('v-change-user-package', [username, details.packageId]);
        }
        if (details.password) {
          await this.executeCommand('v-change-user-password', [username, details.password]);
        }
        if (details.suspended !== undefined) {
          const cmd = details.suspended ? 'v-suspend-user' : 'v-unsuspend-user';
          await this.executeCommand(cmd, [username]);
        }
      } catch (err) {
        console.warn(`Hestia user update notice: ${err.message}`);
      }
    }
    return localResult;
  }

  async toggleSuspendUser(username) {
    const result = await db.toggleSuspendUser(username);
    if (this.hasLiveCredentials()) {
      try {
        const cmd = result.status === 'suspended' ? 'v-suspend-user' : 'v-unsuspend-user';
        await this.executeCommand(cmd, [username]);
      } catch (err) {
        console.warn(`Hestia suspend notice: ${err.message}`);
      }
    }
    return result;
  }

  async deleteUser(username) {
    const result = await db.deleteUser(username);
    if (this.hasLiveCredentials()) {
      try {
        await this.executeCommand('v-delete-user', [username]);
      } catch (err) {
        console.warn(`Hestia delete user notice: ${err.message}`);
      }
    }
    return result;
  }

  _mapHestiaError(code, cmd) {
    const errorMap = {
      1: 'General argument error or insufficient permissions.',
      2: 'Invalid command or arguments supplied.',
      3: 'Object already exists on HestiaCP server.',
      4: 'Object does not exist.',
      5: 'Resource limit or disk/bandwidth quota exceeded.',
      6: 'Invalid password or authentication failed.',
      7: 'Unable to connect to service daemon.',
      8: 'Invalid configuration file or syntax error.'
    };
    return errorMap[code] || `Command '${cmd}' failed with exit code ${code}.`;
  }
}

module.exports = HestiaClient;
