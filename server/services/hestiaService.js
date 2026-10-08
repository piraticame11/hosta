require('dotenv').config();
const axios = require('axios');
const https = require('https');

/**
 * HestiaService
 * Centralized service module to handle HTTPS requests to the HestiaCP REST API.
 */
class HestiaService {
  /**
   * @param {Object} [config] Optional override configuration
   */
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || process.env.HESTIA_API_URL || (process.env.HESTIA_HOST ? `${process.env.HESTIA_HOST.replace(/\/+$/, '')}/api/` : 'https://127.0.0.1:8083/api/');
    this.accessKey = config.accessKey || process.env.HESTIA_ACCESS_KEY || process.env.HESTIA_ACCESS_KEY_ID || '';
    this.secretKey = config.secretKey || process.env.HESTIA_SECRET_KEY || process.env.HESTIA_SECRET_ACCESS_KEY || '';
    this.defaultUser = config.defaultUser || process.env.HESTIA_DEFAULT_USER || 'hostb';
    this.defaultPackage = config.defaultPackage || process.env.HESTIA_DEFAULT_PACKAGE || 'default';

    // HTTPS agent configured to bypass self-signed SSL warnings on port 8083
    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false
    });
  }

  /**
   * Refresh runtime configuration from environment or parameters
   */
  configure(config = {}) {
    if (config.apiUrl) this.apiUrl = config.apiUrl;
    if (config.accessKey) this.accessKey = config.accessKey;
    if (config.secretKey) this.secretKey = config.secretKey;
    if (config.defaultUser) this.defaultUser = config.defaultUser;
    if (config.defaultPackage) this.defaultPackage = config.defaultPackage;
  }

  // =========================================================================
  // PARAMETER SANITIZATION HELPERS
  // =========================================================================

  /**
   * Sanitize system username (alphanumeric, lowercase, hyphens, underscores)
   */
  sanitizeUsername(username) {
    if (!username || typeof username !== 'string') {
      throw new Error('Invalid username: Username must be a non-empty string.');
    }
    const sanitized = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!sanitized) {
      throw new Error('Invalid username: Username must contain valid alphanumeric characters.');
    }
    return sanitized;
  }

  /**
   * Sanitize fully-qualified domain name (lowercase, remove protocols, valid chars)
   */
  sanitizeDomain(domain) {
    if (!domain || typeof domain !== 'string') {
      throw new Error('Invalid domain: Domain name must be a non-empty string.');
    }
    let sanitized = domain.trim().toLowerCase();
    // Strip protocol and path/query/port
    sanitized = sanitized.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
    // Remove characters that aren't letters, numbers, hyphens, or dots
    sanitized = sanitized.replace(/[^a-z0-9.-]/g, '');
    // Strip leading/trailing dots and hyphens
    sanitized = sanitized.replace(/^[.-]+|[.-]+$/g, '');

    if (!sanitized || !sanitized.includes('.')) {
      throw new Error(`Invalid domain name: "${domain}". Must be a valid domain (e.g., example.com).`);
    }
    return sanitized;
  }

  /**
   * Sanitize MySQL database name (alphanumeric, lowercase, underscores)
   */
  sanitizeDatabaseName(dbName) {
    if (!dbName || typeof dbName !== 'string') {
      throw new Error('Invalid database name: Database name must be a non-empty string.');
    }
    const sanitized = dbName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!sanitized) {
      throw new Error('Invalid database name: Must contain valid alphanumeric characters or underscores.');
    }
    return sanitized;
  }

  /**
   * Sanitize MySQL database username (alphanumeric, lowercase, underscores)
   */
  sanitizeDatabaseUser(dbUser) {
    if (!dbUser || typeof dbUser !== 'string') {
      throw new Error('Invalid database user: Database username must be a non-empty string.');
    }
    const sanitized = dbUser.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!sanitized) {
      throw new Error('Invalid database user: Must contain valid alphanumeric characters or underscores.');
    }
    return sanitized;
  }

  /**
   * Sanitize email mailbox prefix (alphanumeric, dots, hyphens, underscores)
   */
  sanitizeEmailUser(emailUser) {
    if (!emailUser || typeof emailUser !== 'string') {
      throw new Error('Invalid email user: Mailbox name must be a non-empty string.');
    }
    const localPart = emailUser.includes('@') ? emailUser.split('@')[0] : emailUser;
    const sanitized = localPart.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!sanitized) {
      throw new Error('Invalid email user: Must contain valid alphanumeric characters.');
    }
    return sanitized;
  }

  // =========================================================================
  // CORE API DISPATCHER
  // =========================================================================

  /**
   * Dispatches raw command request to HestiaCP API via axios POST.
   * Constructs URLSearchParams payload containing hash, cmd, returncode, arg1...argN.
   * 
   * @param {string} cmd Hestia CLI command name (e.g. 'v-add-web-domain')
   * @param {Array<string|number>} args List of arguments for the command
   * @returns {Promise<any>} Parsed JSON response or execution confirmation
   */
  async executeCommand(cmd, args = []) {
    if (!this.accessKey || !this.secretKey) {
      const warningMsg = 'HestiaCP API credentials are not set. Please ensure HESTIA_ACCESS_KEY and HESTIA_SECRET_KEY are defined in .env.';
      console.warn(`[HestiaService] ${warningMsg}`);
      throw new Error(warningMsg);
    }

    const payload = new URLSearchParams();
    const hash = `${this.accessKey}:${this.secretKey}`;
    payload.append('hash', hash);
    payload.append('cmd', cmd);
    payload.append('returncode', '0');

    args.forEach((arg, index) => {
      payload.append(`arg${index + 1}`, arg !== undefined && arg !== null ? String(arg) : '');
    });

    console.log(`[HestiaService] POST ${this.apiUrl} -> ${cmd} (Args: [${args.join(', ')}])`);

    try {
      const response = await axios.post(this.apiUrl, payload.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Hosta-HestiaService/1.0'
        },
        httpsAgent: this.httpsAgent,
        timeout: 35000 // 35 seconds to allow Let's Encrypt challenge generation
      });

      return this._handleResponse(response.data, cmd);
    } catch (error) {
      return this._handleError(error, cmd);
    }
  }

  /**
   * Internal parser for HestiaCP response body
   */
  _handleResponse(data, cmd) {
    if (typeof data === 'object' && data !== null) {
      return data;
    }

    if (typeof data === 'string') {
      const trimmed = data.trim();

      // Check if response is JSON formatted
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return JSON.parse(trimmed);
        } catch {
          // Fall through to plain text handling
        }
      }

      // '0', 'OK', or empty response represents successful execution in Hestia CLI
      if (trimmed === '0' || trimmed === 'OK' || trimmed === '') {
        return { success: true, code: 0, output: trimmed };
      }

      // Check for numeric exit code
      const numericCode = parseInt(trimmed, 10);
      if (!isNaN(numericCode) && String(numericCode) === trimmed) {
        if (numericCode === 0) {
          return { success: true, code: 0, output: trimmed };
        }
        const errorMsg = this.mapHestiaError(numericCode, cmd);
        const err = new Error(`HestiaCP Error [${numericCode}]: ${errorMsg}`);
        err.code = numericCode;
        err.cmd = cmd;
        console.error(`[HestiaService Error] Command '${cmd}' returned code ${numericCode}: ${errorMsg}`);
        throw err;
      }

      // Check for explicit error prefix
      if (trimmed.toLowerCase().startsWith('error:')) {
        const err = new Error(trimmed);
        err.cmd = cmd;
        console.error(`[HestiaService Error] Command '${cmd}' output: ${trimmed}`);
        throw err;
      }

      return { success: true, output: trimmed };
    }

    return { success: true, data };
  }

  /**
   * Internal error mapper for HTTP and transport failures
   */
  _handleError(error, cmd) {
    // Re-throw custom errors already thrown by _handleResponse
    if (error.code && typeof error.code === 'number') {
      throw error;
    }

    if (error.response) {
      const status = error.response.status;
      const responseData = error.response.data;
      console.error(`[HestiaService HTTP Error] ${status} on '${cmd}':`, responseData);

      const responseText = typeof responseData === 'string' ? responseData.trim() : '';

      if (responseText.toLowerCase().includes('ip is not allowed')) {
        throw new Error(`HestiaCP API rejected request: ${responseText}. Please add your machine's IP address to the Allowed IP Addresses list for this Access Key in HestiaCP.`);
      }

      if (status === 401 || status === 403) {
        const detail = responseText ? ` (${responseText})` : '';
        throw new Error(`HestiaCP API authentication failed (HTTP ${status})${detail}. Please verify HESTIA_ACCESS_KEY, HESTIA_SECRET_KEY, and IP whitelist.`);
      }
      if (status === 404) {
        throw new Error(`HestiaCP API endpoint not found (HTTP 404) at ${this.apiUrl}. Check HESTIA_API_URL.`);
      }
      throw new Error(`HestiaCP API responded with HTTP status ${status}: ${typeof responseData === 'string' ? responseData : JSON.stringify(responseData)}`);
    }

    if (error.code === 'ECONNREFUSED') {
      console.error(`[HestiaService Connection Error] Connection refused at ${this.apiUrl}`);
      throw new Error(`Connection to HestiaCP refused at ${this.apiUrl}. Ensure HestiaCP is active and port 8083 is accessible.`);
    }

    if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      console.error(`[HestiaService Timeout] Command '${cmd}' timed out`);
      throw new Error(`HestiaCP request timed out executing command '${cmd}'.`);
    }

    console.error(`[HestiaService Error] Command '${cmd}' failed:`, error.message);
    throw new Error(`HestiaCP request failed: ${error.message}`);
  }

  /**
   * Map Hestia return codes to human-readable error descriptions
   */
  mapHestiaError(code, cmd = '') {
    const errorMap = {
      1: 'Not enough arguments or invalid arguments provided (E_ARGS)',
      2: 'Invalid command or argument syntax (E_INVALID)',
      3: 'Object does not exist (E_NOTEXIST)',
      4: 'Object already exists on the server (E_EXISTS)',
      5: 'Object or account is suspended (E_SUSPENDED)',
      6: 'Object or account is already unsuspended (E_UNSUSPENDED)',
      7: 'Object is currently in use (E_INUSE)',
      8: 'Resource limit reached (disk, domains, or databases) (E_LIMIT)',
      9: 'Password is too weak or invalid (E_PASSWORD)',
      10: 'Action forbidden or insufficient permissions (E_FORBIDDEN)',
      11: 'Feature is disabled on the server (E_DISABLED)',
      12: 'Parsing or configuration error (E_PARSING)',
      13: 'Disk quota exceeded (E_DISK)',
      14: 'Bandwidth quota exceeded (E_BANDWIDTH)',
      15: 'Service restart failed (E_RESTART)',
      16: 'Connection to server daemon failed (E_CONNECT)',
      17: 'FTP configuration error (E_FTP)',
      18: 'Database service error (E_DB)',
      19: 'RRD metrics error (E_RRD)',
      20: 'Update/upgrade error (E_UPDATE)'
    };
    return errorMap[code] || `Command '${cmd}' failed with return code ${code}.`;
  }

  // =========================================================================
  // HIGH-LEVEL SERVICE WRAPPER METHODS
  // =========================================================================

  /**
   * Create a new HestiaCP system user account
   * CLI: v-add-user USER PASSWORD EMAIL [PACKAGE]
   * 
   * @param {string} username Desired system username
   * @param {string} password Account password
   * @param {string} email User contact email
   * @param {string} [pkg] Hestia hosting package name
   */
  async createSystemUser(username, password, email, pkg) {
    const sanitizedUser = this.sanitizeUsername(username);
    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }
    if (!email || !email.includes('@')) {
      throw new Error('A valid email address is required.');
    }
    const selectedPackage = pkg || this.defaultPackage;
    return await this.executeCommand('v-add-user', [
      sanitizedUser,
      password,
      email.trim().toLowerCase(),
      selectedPackage
    ]);
  }

  /**
   * Provision a new web domain for a user
   * CLI: v-add-web-domain USER DOMAIN
   * 
   * @param {string} user Target system user
   * @param {string} domain Domain name (e.g. 'myhost.com')
   */
  async createWebDomain(user, domain) {
    const sanitizedUser = this.sanitizeUsername(user || this.defaultUser);
    const sanitizedDomain = this.sanitizeDomain(domain);
    return await this.executeCommand('v-add-web-domain', [sanitizedUser, sanitizedDomain]);
  }

  /**
   * Enable Let's Encrypt SSL certificate for a web domain
   * CLI: v-add-letsencrypt-domain USER DOMAIN
   * 
   * @param {string} user Target system user
   * @param {string} domain Domain name
   */
  async enableSSL(user, domain) {
    const sanitizedUser = this.sanitizeUsername(user || this.defaultUser);
    const sanitizedDomain = this.sanitizeDomain(domain);
    return await this.executeCommand('v-add-letsencrypt-domain', [sanitizedUser, sanitizedDomain]);
  }

  /**
   * Provision a new MySQL / MariaDB database and user
   * CLI: v-add-database USER DATABASE DBUSER DBPASS [TYPE]
   * 
   * @param {string} user Target system user
   * @param {string} dbName Database name suffix or full name
   * @param {string} dbUser Database username suffix or full name
   * @param {string} dbPass Database user password
   * @param {string} [type='mysql'] Database engine type
   */
  async createDatabase(user, dbName, dbUser, dbPass, type = 'mysql') {
    const sanitizedUser = this.sanitizeUsername(user || this.defaultUser);
    const sanitizedDbName = this.sanitizeDatabaseName(dbName);
    const sanitizedDbUser = this.sanitizeDatabaseUser(dbUser);

    if (!dbPass || typeof dbPass !== 'string') {
      throw new Error('Database password must be provided.');
    }

    const dbType = (type || 'mysql').trim().toLowerCase();
    return await this.executeCommand('v-add-database', [
      sanitizedUser,
      sanitizedDbName,
      sanitizedDbUser,
      dbPass,
      dbType
    ]);
  }

  /**
   * List all databases for a specific user
   * CLI: v-list-databases USER [FORMAT]
   * 
   * @param {string} user Target system user
   */
  async listDatabases(user) {
    const sanitizedUser = this.sanitizeUsername(user || this.defaultUser);
    return await this.executeCommand('v-list-databases', [sanitizedUser, 'json']);
  }

  /**
   * Create an email account under a domain
   * CLI: v-add-mail-account USER DOMAIN ACCOUNT PASSWORD
   * 
   * @param {string} user Target system user
   * @param {string} domain Target domain
   * @param {string} emailUser Email prefix / mailbox
   * @param {string} password Mailbox password
   */
  async createEmailAccount(user, domain, emailUser, password) {
    const sanitizedUser = this.sanitizeUsername(user || this.defaultUser);
    const sanitizedDomain = this.sanitizeDomain(domain);
    const sanitizedEmailUser = this.sanitizeEmailUser(emailUser);

    if (!password || typeof password !== 'string') {
      throw new Error('Email account password is required.');
    }

    try {
      return await this.executeCommand('v-add-mail-account', [
        sanitizedUser,
        sanitizedDomain,
        sanitizedEmailUser,
        password
      ]);
    } catch (err) {
      // If the mail domain does not exist yet (Error code 3), provision mail domain and retry
      if (err.code === 3 || (err.message && err.message.toLowerCase().includes('domain'))) {
        try {
          console.log(`[HestiaService] Mail domain '${sanitizedDomain}' does not exist. Adding mail domain first...`);
          await this.executeCommand('v-add-mail-domain', [sanitizedUser, sanitizedDomain]);
          return await this.executeCommand('v-add-mail-account', [
            sanitizedUser,
            sanitizedDomain,
            sanitizedEmailUser,
            password
          ]);
        } catch (domainErr) {
          throw err;
        }
      }
      throw err;
    }
  }

  /**
   * List active web domains for a specific user
   * CLI: v-list-web-domains USER [FORMAT]
   * 
   * @param {string} user Target system user
   */
  async listWebDomains(user) {
    const sanitizedUser = this.sanitizeUsername(user || this.defaultUser);
    return await this.executeCommand('v-list-web-domains', [sanitizedUser, 'json']);
  }

  /**
   * Get server usage, quota, and system metrics for a user
   * CLI: v-list-user USER [FORMAT]
   * 
   * @param {string} user Target system user
   */
  async getUserUsage(user) {
    const sanitizedUser = this.sanitizeUsername(user || this.defaultUser);
    return await this.executeCommand('v-list-user', [sanitizedUser, 'json']);
  }

  /**
   * Test API connectivity to HestiaCP
   */
  async testConnection() {
    const target = this.defaultUser;
    try {
      const usage = await this.getUserUsage(target);
      return {
        connected: true,
        apiUrl: this.apiUrl,
        user: target,
        usage
      };
    } catch (err) {
      return {
        connected: false,
        apiUrl: this.apiUrl,
        user: target,
        error: err.message
      };
    }
  }
}

// Export singleton instance as default and class definition
const hestiaServiceInstance = new HestiaService();
hestiaServiceInstance.HestiaService = HestiaService;
module.exports = hestiaServiceInstance;
