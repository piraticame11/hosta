const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'hestia.json');

const DEFAULT_CONFIG = {
  hestiaHost: process.env.HESTIA_HOST || 'https://hostia.site:8083',
  hestiaPort: parseInt(process.env.HESTIA_PORT || '8083', 10),
  authType: process.env.HESTIA_AUTH_TYPE || 'access_key', // 'access_key' or 'user_pass'
  accessKey: process.env.HESTIA_ACCESS_KEY || process.env.HESTIA_ACCESS_KEY_ID || '',
  secretKey: process.env.HESTIA_SECRET_KEY || process.env.HESTIA_SECRET_ACCESS_KEY || '',
  username: process.env.HESTIA_USERNAME || 'admin',
  password: process.env.HESTIA_PASSWORD || '',
  defaultUser: process.env.HESTIA_DEFAULT_USER || 'admin',
  defaultPackage: process.env.HESTIA_DEFAULT_PACKAGE || 'default',
  allowSelfSignedSsl: process.env.HESTIA_ALLOW_SELF_SIGNED === 'false' ? false : true
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(data);
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (err) {
      console.error('[Config] Error reading config file, falling back to defaults:', err.message);
    }
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(newConfig) {
  ensureConfigDir();
  const current = loadConfig();
  const updated = {
    ...current,
    ...newConfig,
    hestiaPort: parseInt(newConfig.hestiaPort || current.hestiaPort, 10),
    allowSelfSignedSsl: Boolean(newConfig.allowSelfSignedSsl)
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

module.exports = {
  loadConfig,
  saveConfig
};
