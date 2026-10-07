/**
 * Hosta - Web Hosting & HestiaCP Management Platform
 * Frontend Application Controller
 */

// Global Fetch Interceptor to automatically attach Bearer Auth Token
const _originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const opts = { ...options };
  const headers = new Headers(opts.headers || {});
  if (AppState.authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${AppState.authToken}`);
  }
  opts.headers = headers;
  return _originalFetch(url, opts);
};

// Application State
const AppState = {
  theme: 'light',
  activeView: 'landing', // 'landing' | 'dashboard'
  activeDashTab: 'overview', // 'overview' | 'accounts' | 'domains' | 'databases' | 'mail' | 'dns' | 'backups' | 'settings' | 'chat'
  billingCycle: 'monthly', // 'monthly' | 'yearly'
  config: null,
  summary: null,
  accounts: [],
  activeUser: 'admin',
  currentUser: null,
  authToken: localStorage.getItem('hosta_token') || null,
  isAuthenticated: false,
  domains: [],
  databases: [],
  mailAccounts: [],
  backups: [],
  selectedDnsDomain: '',
  dnsRecords: [],
  // Live Chat & Admin Support state
  chatSessionId: localStorage.getItem('hosta_chat_session') || null,
  chatCaptchaToken: null,
  chatPollInterval: null,
  adminChatActiveThreadId: null,
  adminChatPollInterval: null,
  adminChatFilter: 'all',
  adminChatThreads: [],
  // Registration flow state
  pendingRegisterEmail: '',
  pendingDevCode: null,
  resendCountdownTimer: null
};

// --- DOM Ready Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initBillingToggle();
  initDomainSearch();
  initModals();
  initAuth();
  initForms();
  initAccounts();
  initServerSettings();
  initFloatingChatWidget();
  initAdminChat();
  loadInitialData();
});

// --- Theme Management (Default: White / Light) ---
function initTheme() {
  const savedTheme = localStorage.getItem('hosta_theme') || 'light';
  AppState.theme = savedTheme;
  document.documentElement.setAttribute('data-theme', savedTheme);

  const toggleBtn = document.getElementById('themeToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('hosta_theme', nextTheme);
      AppState.theme = nextTheme;
      showToast('Theme Updated', `Switched to ${nextTheme === 'dark' ? 'Dark' : 'White (Light)'} mode`, 'info');
    });
  }
}

// --- Toast System ---
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  } else {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }

  toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    setTimeout(() => toast.remove(), 300);
  }, 4200);
}

// --- Navigation & View Switching ---
function initNavigation() {
  // Top nav buttons
  document.querySelectorAll('[data-view-target]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const target = btn.getAttribute('data-view-target');
      switchMainView(target);
    });
  });

  // Client Area Dashboard sub-navigation
  document.querySelectorAll('.subnav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchDashTab(tab);
    });
  });

  // Quick Action Buttons inside overview
  document.querySelectorAll('[data-dash-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-dash-action');
      handleQuickAction(action);
    });
  });

  // Mobile Menu Toggle & Drawer Controls
  const mobileToggle = document.getElementById('mobileMenuToggle');
  const mobileDrawer = document.getElementById('mobileDrawer');
  const drawerClose = document.getElementById('mobileDrawerClose');
  const drawerBackdrop = document.getElementById('mobileDrawerBackdrop');

  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileDrawer?.classList.contains('active');
      if (isOpen) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });
  }

  if (drawerClose) drawerClose.addEventListener('click', closeMobileMenu);
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeMobileMenu);
}

function openMobileMenu() {
  const drawer = document.getElementById('mobileDrawer');
  const toggle = document.getElementById('mobileMenuToggle');
  if (drawer) drawer.classList.add('active');
  if (toggle) {
    toggle.classList.add('active');
    toggle.setAttribute('aria-expanded', 'true');
  }
}

function closeMobileMenu() {
  const drawer = document.getElementById('mobileDrawer');
  const toggle = document.getElementById('mobileMenuToggle');
  if (drawer) drawer.classList.remove('active');
  if (toggle) {
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
  }
}

function switchMainView(viewName) {
  if (viewName === 'dashboard' && !AppState.isAuthenticated) {
    openLoginModal();
    return;
  }

  AppState.activeView = viewName;

  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-view-target') === viewName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const activeSec = document.getElementById(`view-${viewName}`);
  if (activeSec) {
    activeSec.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Adaptive Header Topbar adjustments
  const navLanding = document.getElementById('headerNavLanding');
  const portalContext = document.getElementById('headerPortalContext');
  const viewToggleText = document.getElementById('headerViewToggleText');

  if (viewName === 'dashboard') {
    if (navLanding) navLanding.style.display = 'none';
    if (portalContext) portalContext.style.display = 'flex';
    if (viewToggleText) viewToggleText.textContent = 'View Website';
    refreshDashboardData();
  } else {
    if (navLanding) navLanding.style.display = 'flex';
    if (portalContext) portalContext.style.display = 'none';
    if (viewToggleText) viewToggleText.textContent = 'Portal';
  }
}

function switchDashTab(tabName) {
  AppState.activeDashTab = tabName;

  document.querySelectorAll('.subnav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.dash-view').forEach(view => view.classList.remove('active'));
  const targetView = document.getElementById(`dash-${tabName}`);
  if (targetView) targetView.classList.add('active');

  // Trigger data loading for specific tab
  if (tabName === 'accounts') loadAccounts();
  if (tabName === 'domains') loadWebDomains();
  if (tabName === 'databases') loadDatabases();
  if (tabName === 'dns') loadDnsDomains();
  if (tabName === 'backups') loadBackups();
  if (tabName === 'settings') loadSettingsForm();
  if (tabName === 'chat') loadAdminChatThreads();
}

function handleQuickAction(action) {
  switch (action) {
    case 'add-domain':
      openModal('modalAddDomain');
      break;
    case 'add-database':
      openModal('modalAddDatabase');
      break;
    case 'create-backup':
      triggerBackupCreation();
      break;
    case 'phpmyadmin':
      const phpMyAdminUrl = `${AppState.config?.hestiaHost || 'https://localhost:8083'}/phpmyadmin/`;
      window.open(phpMyAdminUrl, '_blank');
      break;
    case 'livechat':
      if (AppState.isAuthenticated && AppState.currentUser?.role === 'admin') {
        switchDashTab('chat');
      } else {
        toggleFloatingChat();
      }
      break;
  }
}

// --- Initial Data Loading ---
async function loadInitialData() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success) {
      AppState.summary = data.summary;
      AppState.config = data.config;
      updateHeaderStatusBadge(data);
      renderDashboardSummary(data.summary);
      loadAccounts();
    }
  } catch (err) {
    console.warn('Initial status fetch warning:', err.message);
  }
}

function updateHeaderStatusBadge(data) {
  const badge = document.getElementById('serverStatusBadge');
  if (!badge) return;
  const dot = badge.querySelector('.status-dot');
  const text = badge.querySelector('.status-text');

  if (!dot || !text) return;

  dot.className = 'status-dot online pulse';
  text.textContent = 'Philippines Node (Online)';
}

// --- Dashboard Overview Rendering ---
async function refreshDashboardData() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success) {
      AppState.summary = data.summary;
      AppState.config = data.config;
      renderDashboardSummary(data.summary);
      updateHeaderStatusBadge(data);
    }
  } catch (err) {
    showToast('Sync Error', 'Could not refresh dashboard summary from server', 'error');
  }
}

function renderDashboardSummary(summary) {
  if (!summary) return;

  const quota = summary.user?.quota || {};
  const disk = quota.disk || { usedMB: 0, totalMB: 50000 };
  const bandwidth = quota.bandwidth || { usedMB: 0, totalMB: 20480 };

  const diskUsed = Number(disk.usedMB || 0);
  const diskTotal = Number(disk.totalMB || 100);
  const diskPercent = diskTotal > 0 ? Math.min(100, Math.round((diskUsed / diskTotal) * 100)) : 0;
  setText('dashDiskUsageText', `${diskUsed.toFixed(1)} MB / ${diskTotal} MB`);
  setText('dashDiskPercentText', `${diskPercent}%`);
  setBarWidth('dashDiskProgressBar', `${diskPercent}%`);

  const bwUsed = Number(bandwidth.usedMB || 0);
  const bwTotal = Number(bandwidth.totalMB || 20480);
  const bwPercent = bwTotal > 0 ? Math.min(100, Math.round((bwUsed / bwTotal) * 100)) : 0;
  const bwDisplayTotal = bwTotal >= 1024 ? `${(bwTotal / 1024).toFixed(0)} GB` : `${bwTotal} MB`;
  const bwDisplayUsed = bwUsed >= 1024 ? `${(bwUsed / 1024).toFixed(1)} GB` : `${bwUsed.toFixed(1)} MB`;
  setText('dashBwUsageText', `${bwDisplayUsed} / ${bwDisplayTotal}`);
  setText('dashBwPercentText', `${bwPercent}%`);
  setBarWidth('dashBwProgressBar', `${bwPercent}%`);

  const domainsCount = summary.counts?.domains || 0;
  const databasesCount = summary.counts?.databases || 0;
  const backupsCount = summary.counts?.backups || 0;

  const maxDomains = quota.webDomains?.total || (summary.user?.role === 'admin' ? 100 : 1);
  const maxDatabases = quota.databases?.total || (summary.user?.role === 'admin' ? 100 : 1);

  setText('dashDomainsCount', `${domainsCount} / ${maxDomains}`);
  setText('dashDatabasesCount', `${databasesCount} / ${maxDatabases}`);
  setText('dashBackupsCount', String(backupsCount));

  setText('pillDomainsCount', String(domainsCount));
  setText('pillDatabasesCount', String(databasesCount));
  setText('pillBackupsCount', String(backupsCount));

  if (summary.user) {
    const user = summary.user;
    const isAdmin = user.role === 'admin';
    setText('topbarActiveUserTag', `@${user.username || 'admin'}`);
    let pkgLabel = isAdmin ? 'System Administrator' : 'Student Monthly Pass';
    if (user.package === 'default' && !isAdmin) pkgLabel = 'Student Monthly Pass';
    setText('topbarUserPackageBadge', pkgLabel);

    setText('dashUserPlanTitle', isAdmin ? 'System Administrator' : pkgLabel);
    setText('dashUserPlanLimits', isAdmin ? '50 GB Storage • 100 GB Bandwidth • 100 Databases' : `${diskTotal} MB Storage • ${bwDisplayTotal} Bandwidth • ${maxDatabases} DB`);
  }

  // System Specs
  if (summary.system) {
    setText('sysInfoHostname', summary.system.hostname || 'ph-node01.hosta.ph');
    setText('sysInfoOs', summary.system.os || 'Ubuntu 22.04 LTS (Hosted on Philippines)');
    setText('sysInfoVersion', summary.system.hestiaVersion ? `v${summary.system.hestiaVersion}` : 'v1.8.12');
    setText('sysInfoUptime', summary.system.uptime || '18 days, 9 hours');
    setText('sysInfoLoad', summary.system.loadAverage || '0.14, 0.20, 0.16');
    setText('sysInfoMem', summary.system.memoryTotal ? `${summary.system.memoryUsed} / ${summary.system.memoryTotal}` : '1140 MB / 4096 MB');
  }
}

// --- Web Domains Management ---
async function loadWebDomains() {
  const tableBody = document.getElementById('domainsTableBody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 32px;"><span style="color: var(--text-muted)">Loading domains from HestiaCP...</span></td></tr>`;

  try {
    const res = await fetch('/api/domains');
    const data = await res.json();
    if (data.success) {
      AppState.domains = data.domains;
      renderDomainsTable(data.domains);
    } else {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 24px;">Failed to load domains: ${escapeHtml(data.error)}</td></tr>`;
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 24px;">Connection error</td></tr>`;
  }
}

function renderDomainsTable(domains) {
  const tableBody = document.getElementById('domainsTableBody');
  if (!tableBody) return;

  if (!domains || domains.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted)">No web domains hosted yet. Click "Add Web Domain" to get started.</td></tr>`;
    return;
  }

  tableBody.innerHTML = domains.map(d => `
    <tr>
      <td>
        <div class="table-domain-cell">
          <div class="domain-globe-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <div>
            <div class="domain-main-text">${escapeHtml(d.domain)}</div>
            <div class="domain-sub-text">${escapeHtml(d.aliases || 'No aliases')}</div>
          </div>
        </div>
      </td>
      <td>
        ${d.ssl ? `
          <span class="badge badge-success" title="SSL Active">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Let's Encrypt
          </span>
        ` : `
          <button class="btn btn-sm btn-outline" onclick="toggleDomainSsl('${escapeHtml(d.domain)}', true)">
            Enable SSL
          </button>
        `}
      </td>
      <td>
        <span class="badge badge-info">PHP ${escapeHtml(d.phpVersion || '8.3')}</span>
      </td>
      <td>
        <div style="font-size: 0.85rem; color: var(--text-main); font-weight: 600;">${d.diskUsageMB || 0} MB</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${d.bandwidthMB || 0} MB BW</div>
      </td>
      <td>
        <span class="badge ${d.suspended ? 'badge-warning' : 'badge-success'}">${d.suspended ? 'Suspended' : 'Active'}</span>
      </td>
      <td>
        <div class="actions-cell">
          <a href="https://${escapeHtml(d.domain)}" target="_blank" class="action-icon-btn" title="Visit Website">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
          <button class="action-icon-btn" onclick="openDomainDns('${escapeHtml(d.domain)}')" title="Manage DNS Zone">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          </button>
          <button class="action-icon-btn danger" onclick="deleteDomain('${escapeHtml(d.domain)}')" title="Delete Domain">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function deleteDomain(domain) {
  if (!confirm(`Are you sure you want to permanently delete the domain "${domain}" and all associated web files?`)) {
    return;
  }
  try {
    const res = await fetch(`/api/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Domain Deleted', `Domain ${domain} removed successfully`, 'success');
      loadWebDomains();
      refreshDashboardData();
    } else {
      showToast('Error', data.error || 'Failed to delete domain', 'error');
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function toggleDomainSsl(domain, enable) {
  try {
    showToast('SSL Configuration', `Requesting Let's Encrypt SSL certificate for ${domain}...`, 'info');
    const res = await fetch(`/api/domains/${encodeURIComponent(domain)}/ssl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable })
    });
    const data = await res.json();
    if (data.success) {
      showToast('SSL Active', `SSL certificate successfully provisioned for ${domain}!`, 'success');
      loadWebDomains();
    } else {
      showToast('SSL Error', data.error || 'Could not issue SSL certificate', 'error');
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// --- Databases Management ---
async function loadDatabases() {
  const tableBody = document.getElementById('databasesTableBody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 32px;"><span style="color: var(--text-muted)">Loading MariaDB databases...</span></td></tr>`;

  try {
    const res = await fetch('/api/databases');
    const data = await res.json();
    if (data.success) {
      AppState.databases = data.databases;
      renderDatabasesTable(data.databases);
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 24px;">Connection error</td></tr>`;
  }
}

function renderDatabasesTable(dbs) {
  const tableBody = document.getElementById('databasesTableBody');
  if (!tableBody) return;

  if (!dbs || dbs.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted)">No databases found. Click "Create Database" to create one.</td></tr>`;
    return;
  }

  tableBody.innerHTML = dbs.map(db => `
    <tr>
      <td>
        <div style="font-weight: 700; color: var(--text-main); font-family: var(--font-mono);">${escapeHtml(db.database)}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(db.charset || 'utf8mb4')}</div>
      </td>
      <td>
        <span class="code-snippet" style="margin: 0; display: inline-block; font-size: 0.78rem;">${escapeHtml(db.dbuser)}</span>
      </td>
      <td>
        <span style="font-size: 0.88rem; color: var(--text-secondary);">${escapeHtml(db.host || 'localhost')}</span>
      </td>
      <td>
        <span class="badge badge-info">${escapeHtml(db.type || 'MariaDB')}</span>
      </td>
      <td>
        <span style="font-size: 0.88rem; color: var(--text-main); font-weight: 600;">${db.diskUsageMB || 0.1} MB</span>
      </td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-sm btn-secondary" onclick="handleQuickAction('phpmyadmin')" title="Open in phpMyAdmin">
            phpMyAdmin
          </button>
          <button class="action-icon-btn danger" onclick="deleteDatabase('${escapeHtml(db.database)}')" title="Delete Database">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function deleteDatabase(database) {
  if (!confirm(`Are you sure you want to permanently drop the database "${database}"? ALL DATA WILL BE LOST.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/databases/${encodeURIComponent(database)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Database Dropped', `Database ${database} deleted`, 'success');
      loadDatabases();
      refreshDashboardData();
    } else {
      showToast('Error', data.error || 'Failed to delete database', 'error');
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// --- Student User Accounts Management CRUD ---
async function loadAccounts() {
  const tableBody = document.getElementById('accountsTableBody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 36px;"><span style="color: var(--text-muted)">Loading student accounts...</span></td></tr>`;

  try {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    if (data.success) {
      AppState.accounts = data.accounts || [];
      AppState.activeUser = data.activeUser || 'admin';
      updateAccountsSummaryMetrics(AppState.accounts);
      renderAccountsTable(AppState.accounts);
    } else {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 24px;">Failed to load accounts: ${escapeHtml(data.error || 'Server error')}</td></tr>`;
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 24px;">Connection error loading accounts</td></tr>`;
  }
}

function updateAccountsSummaryMetrics(accounts) {
  const studentAccounts = accounts.filter(a => a.role !== 'admin');
  const total = studentAccounts.length;
  const active = studentAccounts.filter(a => !a.suspended).length;
  const suspended = studentAccounts.filter(a => a.suspended).length;
  const totalStorageMB = studentAccounts.reduce((sum, a) => sum + (a.quota?.disk?.totalMB || 100), 0);

  setText('metricTotalAccounts', String(total));
  setText('metricActiveAccounts', String(active));
  setText('metricSuspendedAccounts', String(suspended));
  setText('metricTotalStorage', `${totalStorageMB} MB`);
  setText('pillAccountsCount', String(total));
}

function filterAccountsList() {
  const query = (getValue('accountsSearchInput') || '').toLowerCase().trim();
  const pkgFilter = getValue('accountsFilterPackage') || 'all';
  const statusFilter = getValue('accountsFilterStatus') || 'all';

  let filtered = AppState.accounts || [];

  if (query) {
    filtered = filtered.filter(a => 
      a.username.toLowerCase().includes(query) ||
      (a.name && a.name.toLowerCase().includes(query)) ||
      (a.email && a.email.toLowerCase().includes(query))
    );
  }

  if (pkgFilter !== 'all') {
    filtered = filtered.filter(a => a.package === pkgFilter);
  }

  if (statusFilter === 'active') {
    filtered = filtered.filter(a => !a.suspended);
  } else if (statusFilter === 'suspended') {
    filtered = filtered.filter(a => a.suspended);
  }

  renderAccountsTable(filtered);
}

function renderAccountsTable(accounts) {
  const tableBody = document.getElementById('accountsTableBody');
  if (!tableBody) return;

  if (!accounts || accounts.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 48px; color: var(--text-muted);">
          <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 6px; color: var(--text-main);">No student accounts found</div>
          <p style="font-size: 0.88rem; max-width: 400px; margin: 0 auto 16px;">No accounts match your current filter criteria.</p>
          <button class="btn btn-primary btn-sm" onclick="openAddAccountModal()">Create New Student Account</button>
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = accounts.map(acc => {
    const isActiveSession = (AppState.activeUser || '').toLowerCase() === acc.username.toLowerCase();
    const diskUsed = Number(acc.quota?.disk?.usedMB || 0).toFixed(1);
    const diskTotal = acc.quota?.disk?.totalMB || 100;
    const diskPercent = Math.min(100, Math.round((diskUsed / diskTotal) * 100));

    const bwUsed = Number(acc.quota?.bandwidth?.usedMB || 0).toFixed(1);
    const bwTotal = acc.quota?.bandwidth?.totalMB || 200;
    const bwPercent = Math.min(100, Math.round((bwUsed / bwTotal) * 100));

    let packageLabel = 'Student Pass (₱150)';
    let packageBadgeClass = 'badge-info';
    if (acc.package === 'semester-pass') {
      packageLabel = 'Semester Pass (₱700)';
      packageBadgeClass = 'badge-cyan';
    } else if (acc.package === 'thesis-pass') {
      packageLabel = 'Thesis Pass (₱1,500)';
      packageBadgeClass = 'badge-primary';
    } else if (acc.package === 'system-admin' || acc.package === 'default') {
      packageLabel = 'Standard Package';
      packageBadgeClass = 'badge-neutral';
    }

    const initials = (acc.name || acc.username).split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() || 'ST';

    return `
      <tr>
        <td>
          <div class="student-profile-cell">
            <div class="student-avatar ${acc.suspended ? 'suspended' : ''}">
              ${escapeHtml(initials)}
            </div>
            <div>
              <div class="student-info-name">
                ${escapeHtml(acc.name || acc.username)}
                ${isActiveSession ? '<span class="badge badge-success" style="font-size: 0.68rem; margin-left: 6px;">Active Session</span>' : ''}
              </div>
              <div class="student-info-meta">
                <span class="student-username">@${escapeHtml(acc.username)}</span>
                <span>•</span>
                <span>${escapeHtml(acc.email)}</span>
              </div>
            </div>
          </div>
        </td>
        <td>
          <span class="badge ${packageBadgeClass}">${escapeHtml(packageLabel)}</span>
        </td>
        <td>
          <div class="student-quota-cell">
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
              <span>${diskUsed} MB</span>
              <span style="color: var(--text-muted);">${diskTotal} MB</span>
            </div>
            <div class="progress-track" style="height: 5px;">
              <div class="progress-fill ${diskPercent > 85 ? 'danger' : ''}" style="width: ${diskPercent}%;"></div>
            </div>
          </div>
        </td>
        <td>
          <div class="student-quota-cell">
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
              <span>${bwUsed} MB</span>
              <span style="color: var(--text-muted);">${bwTotal} MB</span>
            </div>
            <div class="progress-track" style="height: 5px;">
              <div class="progress-fill" style="width: ${bwPercent}%;"></div>
            </div>
          </div>
        </td>
        <td>
          <span class="badge ${acc.suspended ? 'badge-warning' : 'badge-success'}">
            <span class="status-dot ${acc.suspended ? 'offline' : ''}" style="width: 6px; height: 6px; margin-right: 4px; display: inline-block;"></span>
            ${acc.suspended ? 'Suspended' : 'Active'}
          </span>
        </td>
        <td>
          <span style="font-size: 0.82rem; color: var(--text-secondary);">${escapeHtml(acc.created || '2026-02-10')}</span>
        </td>
        <td>
          <div class="actions-cell">
            ${isActiveSession ? `
              <span class="action-btn-switch active" title="Currently managing this student profile">Active</span>
            ` : `
              <button class="action-btn-switch" onclick="switchActiveStudentContext('${escapeHtml(acc.username)}')" title="Switch active portal session to this student">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                Manage
              </button>
            `}
            <button class="action-icon-btn" onclick="openEditAccountModal('${escapeHtml(acc.username)}')" title="Edit Student Details">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="action-icon-btn ${acc.suspended ? 'success' : 'warning'}" onclick="toggleSuspendAccount('${escapeHtml(acc.username)}')" title="${acc.suspended ? 'Activate Account' : 'Suspend Account'}">
              ${acc.suspended ? `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              ` : `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              `}
            </button>
            <button class="action-icon-btn danger" onclick="deleteAccount('${escapeHtml(acc.username)}')" title="Delete Account">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openAddAccountModal() {
  const form = document.getElementById('formAddAccount');
  if (form) form.reset();
  const passInput = document.getElementById('inputAccountPassword');
  if (passInput) passInput.value = generateRandomPassword();
  openModal('modalAddAccount');
}

async function openEditAccountModal(username) {
  try {
    const res = await fetch(`/api/accounts/${encodeURIComponent(username)}`);
    const data = await res.json();
    if (!data.success || !data.account) {
      showToast('Error', data.error || 'Failed to fetch account info', 'error');
      return;
    }
    const acc = data.account;
    setValue('editAccountUsername', acc.username);
    setValue('editAccountName', acc.name || '');
    setValue('editAccountEmail', acc.email || '');
    setValue('editAccountPackage', acc.package || 'student-pass');
    setValue('editAccountStatus', acc.suspended ? 'suspended' : 'active');
    setValue('editAccountPassword', '');
    openModal('modalEditAccount');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function toggleSuspendAccount(username) {
  try {
    const res = await fetch(`/api/accounts/${encodeURIComponent(username)}/suspend`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Status Updated', data.message || data.result?.message || `Account ${username} status changed`, 'info');
      loadAccounts();
    } else {
      showToast('Error', data.error || 'Failed to update account status', 'error');
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function deleteAccount(username) {
  if (!confirm(`Are you sure you want to delete student account "${username}"? All associated files, databases, and configuration will be permanently erased.`)) {
    return;
  }
  try {
    const res = await fetch(`/api/accounts/${encodeURIComponent(username)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Account Removed', data.message || data.result?.message || `Student account ${username} was deleted`, 'success');
      loadAccounts();
      refreshDashboardData();
    } else {
      showToast('Delete Failed', data.error || 'Could not delete student account', 'error');
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function switchActiveStudentContext(username) {
  showToast('Switching Session', `Loading portal for @${username}...`, 'info');
  try {
    const res = await fetch(`/api/accounts/${encodeURIComponent(username)}/switch-context`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      AppState.activeUser = username;
      showToast('Session Active', `Now managing @${username}`, 'success');
      loadAccounts();
      refreshDashboardData();
      loadWebDomains();
      loadDatabases();
    } else {
      showToast('Switch Failed', data.error || 'Could not switch active student', 'error');
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

function generateRandomPassword(length = 12) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

// --- DNS Records Management ---
async function loadDnsDomains() {
  const select = document.getElementById('dnsDomainSelect');
  if (!select) return;

  if (AppState.domains.length === 0) {
    const res = await fetch('/api/domains');
    const data = await res.json();
    if (data.success) AppState.domains = data.domains;
  }

  select.innerHTML = AppState.domains.map(d => `<option value="${escapeHtml(d.domain)}">${escapeHtml(d.domain)}</option>`).join('');

  if (AppState.domains.length > 0) {
    AppState.selectedDnsDomain = AppState.selectedDnsDomain || AppState.domains[0].domain;
    select.value = AppState.selectedDnsDomain;
    loadDnsRecordsForDomain(AppState.selectedDnsDomain);
  }

  select.onchange = (e) => {
    AppState.selectedDnsDomain = e.target.value;
    loadDnsRecordsForDomain(AppState.selectedDnsDomain);
  };
}

async function loadDnsRecordsForDomain(domain) {
  const tableBody = document.getElementById('dnsTableBody');
  if (!tableBody || !domain) return;

  tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 24px;"><span style="color: var(--text-muted)">Loading DNS records for ${escapeHtml(domain)}...</span></td></tr>`;

  try {
    const res = await fetch(`/api/dns/${encodeURIComponent(domain)}`);
    const data = await res.json();
    if (data.success) {
      AppState.dnsRecords = data.records;
      renderDnsTable(data.records);
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 24px;">Failed to load DNS records</td></tr>`;
  }
}

function renderDnsTable(records) {
  const tableBody = document.getElementById('dnsTableBody');
  if (!tableBody) return;

  if (!records || records.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 32px; color: var(--text-muted)">No DNS records found for this domain.</td></tr>`;
    return;
  }

  tableBody.innerHTML = records.map(r => `
    <tr>
      <td><span style="font-family: var(--font-mono); font-weight: 600; color: var(--text-main);">${escapeHtml(r.record)}</span></td>
      <td><span class="badge badge-info">${escapeHtml(r.type)}</span></td>
      <td><span style="font-family: var(--font-mono); font-size: 0.85rem; word-break: break-all;">${escapeHtml(r.value)}</span></td>
      <td><span style="font-size: 0.85rem; color: var(--text-muted);">${r.priority ? escapeHtml(r.priority) : '-'}</span></td>
      <td><span style="font-size: 0.85rem; color: var(--text-muted);">${r.ttl || 14400}</span></td>
      <td>
        <button class="action-icon-btn danger" onclick="deleteDnsRecord('${escapeHtml(r.id)}')" title="Delete Record">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

async function deleteDnsRecord(recordId) {
  if (!confirm('Are you sure you want to remove this DNS record?')) return;
  try {
    const res = await fetch(`/api/dns/${encodeURIComponent(AppState.selectedDnsDomain)}/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('DNS Updated', 'Record removed successfully', 'success');
      loadDnsRecordsForDomain(AppState.selectedDnsDomain);
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

function openDomainDns(domain) {
  AppState.selectedDnsDomain = domain;
  switchDashTab('dns');
  const select = document.getElementById('dnsDomainSelect');
  if (select) select.value = domain;
  loadDnsRecordsForDomain(domain);
}

// --- Backups Management ---
async function loadBackups() {
  const tableBody = document.getElementById('backupsTableBody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 32px;"><span style="color: var(--text-muted)">Loading server backups...</span></td></tr>`;

  try {
    const res = await fetch('/api/backups');
    const data = await res.json();
    if (data.success) {
      AppState.backups = data.backups;
      renderBackupsTable(data.backups);
    }
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger); padding: 24px;">Connection error</td></tr>`;
  }
}

function renderBackupsTable(backups) {
  const tableBody = document.getElementById('backupsTableBody');
  if (!tableBody) return;

  if (!backups || backups.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted)">No backups generated yet. Click "Generate Backup Now" to create an instant snapshot.</td></tr>`;
    return;
  }

  tableBody.innerHTML = backups.map(b => `
    <tr>
      <td>
        <div style="font-weight: 700; color: var(--text-main); font-family: var(--font-mono); font-size: 0.9rem;">${escapeHtml(b.filename)}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(b.type || 'Full Backup')}</div>
      </td>
      <td>
        <span style="font-size: 0.88rem; color: var(--text-secondary);">${escapeHtml(b.date)}</span>
      </td>
      <td>
        <span style="font-weight: 600; color: var(--text-main); font-size: 0.9rem;">${b.sizeMB || 0} MB</span>
      </td>
      <td>
        <span class="badge badge-success">Completed</span>
      </td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-sm btn-outline" onclick="showToast('Backup Download', 'Downloading ${escapeHtml(b.filename)} archive...', 'info')">
            Download .tar
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function triggerBackupCreation() {
  const btn = document.getElementById('btnCreateBackup');
  if (btn) btn.disabled = true;

  showToast('Backup Initiated', 'HestiaCP has queued a full user archive backup task. This usually takes 1-3 minutes.', 'info');

  try {
    const res = await fetch('/api/backups', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Backup Complete', 'New backup archive generated successfully!', 'success');
      loadBackups();
      refreshDashboardData();
    } else {
      showToast('Backup Error', data.error || 'Failed to trigger backup', 'error');
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- Server Settings & Configuration ---
async function loadSettingsForm() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.success && data.config) {
      const cfg = data.config;
      setValue('cfgHestiaHost', cfg.hestiaHost);
      setValue('cfgHestiaPort', cfg.hestiaPort);
      setValue('cfgAuthType', cfg.authType);
      setValue('cfgUsername', cfg.username);
      setValue('cfgDefaultUser', cfg.defaultUser);
      setValue('cfgDefaultPackage', cfg.defaultPackage);
      setCheckbox('cfgAllowSelfSigned', cfg.allowSelfSignedSsl);

      toggleAuthFields(cfg.authType);
    }
  } catch (err) {
    console.warn('Failed to load settings:', err.message);
  }
}

function initServerSettings() {
  const authSelect = document.getElementById('cfgAuthType');
  if (authSelect) {
    authSelect.addEventListener('change', (e) => {
      toggleAuthFields(e.target.value);
    });
  }

  // Save Settings Form
  const form = document.getElementById('serverConfigForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('btnSaveConfig');
      if (saveBtn) saveBtn.disabled = true;

      const payload = {
        hestiaHost: getValue('cfgHestiaHost'),
        hestiaPort: parseInt(getValue('cfgHestiaPort'), 10) || 8083,
        authType: getValue('cfgAuthType'),
        accessKey: getValue('cfgAccessKey'),
        secretKey: getValue('cfgSecretKey'),
        username: getValue('cfgUsername'),
        password: getValue('cfgPassword'),
        defaultUser: getValue('cfgDefaultUser') || 'admin',
        defaultPackage: getValue('cfgDefaultPackage') || 'default',
        allowSelfSignedSsl: getCheckbox('cfgAllowSelfSigned')
      };

      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('Settings Saved', 'HestiaCP server configuration updated successfully', 'success');
          AppState.config = data.config;
          refreshDashboardData();
        } else {
          showToast('Save Error', data.error || 'Could not update settings', 'error');
        }
      } catch (err) {
        showToast('Error', err.message, 'error');
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  // Test Connection Button
  const testBtn = document.getElementById('btnTestConnection');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Pinging Server...';

      const resultBox = document.getElementById('connectionTestResult');
      if (resultBox) {
        resultBox.style.display = 'none';
        resultBox.className = 'test-result-box';
      }

      const payload = {
        hestiaHost: getValue('cfgHestiaHost'),
        hestiaPort: parseInt(getValue('cfgHestiaPort'), 10) || 8083,
        authType: getValue('cfgAuthType'),
        accessKey: getValue('cfgAccessKey'),
        secretKey: getValue('cfgSecretKey'),
        username: getValue('cfgUsername'),
        password: getValue('cfgPassword'),
        allowSelfSignedSsl: getCheckbox('cfgAllowSelfSigned')
      };

      try {
        const res = await fetch('/api/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (resultBox) {
          resultBox.style.display = 'block';
          if (data.success) {
            resultBox.className = 'test-result-box success';
            resultBox.innerHTML = `
              <div style="font-weight: 700; color: var(--success); margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                ${escapeHtml(data.message)}
              </div>
              <div style="font-size: 0.85rem; color: var(--text-secondary);">
                ${data.latencyMs ? `Round-trip Latency: <strong>${data.latencyMs} ms</strong><br>` : ''}
                Server Hostname: <strong>${escapeHtml(data.systemInfo?.hostname || 'Unknown')}</strong><br>
                OS: <strong>${escapeHtml(data.systemInfo?.os || 'Linux')}</strong> | Hestia Version: <strong>${escapeHtml(data.systemInfo?.hestiaVersion || '1.8.x')}</strong>
              </div>
            `;
            showToast('Connection Successful', data.message, 'success');
          } else {
            resultBox.className = 'test-result-box error';
            resultBox.innerHTML = `
              <div style="font-weight: 700; color: var(--danger); margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                Connection Failed
              </div>
              <div style="font-size: 0.85rem; color: var(--text-secondary);">
                ${escapeHtml(data.message)}<br>
                <em>Check that port 8083 is open in your server firewall and that your API keys are correct.</em>
              </div>
            `;
            showToast('Connection Failed', data.message, 'error');
          }
        }
      } catch (err) {
        showToast('Error', err.message, 'error');
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Server Connection';
      }
    });
  }
}

function toggleAuthFields(type) {
  const groupKeys = document.getElementById('groupAccessKeys');
  const groupPass = document.getElementById('groupUserPass');

  if (type === 'access_key') {
    if (groupKeys) groupKeys.style.display = 'block';
    if (groupPass) groupPass.style.display = 'none';
  } else {
    if (groupKeys) groupKeys.style.display = 'none';
    if (groupPass) groupPass.style.display = 'block';
  }
}

// --- Billing Cycle & Plan Order ---
function initBillingToggle() {
  const toggle = document.getElementById('billingSwitch');
  if (!toggle) return;

  toggle.addEventListener('change', (e) => {
    AppState.billingCycle = e.target.checked ? 'yearly' : 'monthly';
    updatePlanPricesDisplay();
  });
}

function updatePlanPricesDisplay() {
  const isYearly = AppState.billingCycle === 'yearly';

  document.querySelectorAll('.billing-toggle-label').forEach(lbl => {
    if (lbl.getAttribute('data-cycle') === AppState.billingCycle) {
      lbl.classList.add('active');
    } else {
      lbl.classList.remove('active');
    }
  });

  const prices = {
    starter: isYearly ? '3.19' : '3.99',
    pro: isYearly ? '7.19' : '8.99',
    business: isYearly ? '15.19' : '18.99',
    enterprise: isYearly ? '39.99' : '49.99'
  };

  Object.entries(prices).forEach(([plan, price]) => {
    const el = document.getElementById(`price-${plan}`);
    if (el) el.textContent = price;
  });
}

function openOrderModal(planId, planName) {
  setValue('orderPlanId', planId);
  setText('orderPlanNameText', planName);
  openModal('modalOrderPlan');
}

// --- Domain Search Simulation ---
function initDomainSearch() {
  const input = document.getElementById('domainSearchInput');
  const btn = document.getElementById('btnSearchDomain');
  const resultsArea = document.getElementById('domainSearchResults');

  if (!btn || !input) return;

  const runSearch = () => {
    let query = input.value.trim().toLowerCase();
    if (!query) return;

    // Remove http/https and trailing slash
    query = query.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!query.includes('.')) {
      query = `${query}.com`;
    }

    if (resultsArea) {
      resultsArea.style.display = 'block';
      const isAvailable = true;
      const tld = query.split('.').slice(1).join('.');
      let price = '₱650/yr';
      if (tld === 'ph') price = '₱1,400/yr';
      if (tld === 'com.ph') price = '₱850/yr';
      if (tld === 'hosta.ph') price = 'Free for Students';

      resultsArea.innerHTML = `
        <div class="domain-result-card">
          <div class="domain-result-name">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <strong>${escapeHtml(query)}</strong> is available!
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="domain-result-price">${price}</div>
            <button class="btn btn-sm btn-primary" onclick="openOrderModal('student-monthly', 'Student Monthly Pass (₱150/mo)'); setValue('orderDomainInput', '${escapeHtml(query)}')">
              Claim &amp; Host (₱150/mo)
            </button>
          </div>
        </div>
      `;
    }
  };

  btn.addEventListener('click', runSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
  });

  // TLD Chip clicks
  document.querySelectorAll('.domain-tld-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tld = chip.getAttribute('data-tld') || '.ph';
      let current = input.value.trim().split('.')[0] || 'mycapstone';
      input.value = `${current}${tld}`;
      runSearch();
    });
  });
}

// --- Modals Management ---
function initModals() {
  document.querySelectorAll('[data-modal-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllModals();
    });
  });

  // Close modal when clicking backdrop
  document.querySelectorAll('.modal-backdrop, .modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAllModals();
    });
  });

  // ESC key to close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });
}

function openModal(modalId) {
  closeAllModals();
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}
window.openModal = openModal;

function closeModal(modalId) {
  if (!modalId) {
    closeAllModals();
    return;
  }
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}
window.closeModal = closeModal;

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop, .modal').forEach(modal => modal.classList.remove('active'));
}
window.closeAllModals = closeAllModals;

function populateDomainSelectOptions() {
  const select = document.getElementById('mailDomainSelect');
  if (!select) return;

  select.innerHTML = AppState.domains.map(d => `<option value="${escapeHtml(d.domain)}">${escapeHtml(d.domain)}</option>`).join('');
}

// --- Authentication & Live Session Management ---
async function initAuth() {
  if (!AppState.authToken) {
    updateAuthUI();
    return;
  }

  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.success && data.user) {
      AppState.currentUser = data.user;
      AppState.isAuthenticated = true;
      AppState.activeUser = data.user.username;
      updateAuthUI();
    } else {
      localStorage.removeItem('hosta_token');
      AppState.authToken = null;
      AppState.currentUser = null;
      AppState.isAuthenticated = false;
      updateAuthUI();
    }
  } catch (err) {
    console.warn('Session check failed:', err);
    updateAuthUI();
  }
}

function updateAuthUI() {
  const guestGroup = document.getElementById('headerAuthGuest');
  const userGroup = document.getElementById('headerAuthUser');
  const userNameEl = document.getElementById('headerUserName');
  const userRoleEl = document.getElementById('headerUserRoleBadge');
  const userAvatarEl = document.getElementById('headerUserAvatar');
  const mobileBannerGuest = document.getElementById('mobileBannerGuest');
  const mobileBannerUser = document.getElementById('mobileBannerUser');
  const mobileUserName = document.getElementById('mobileUserName');
  const mobileUserRoleBadge = document.getElementById('mobileUserRoleBadge');
  const mobileUserAvatar = document.getElementById('mobileUserAvatar');
  const subnavAccountsBtn = document.querySelector('[data-tab="accounts"]');
  const subnavChatBtn = document.querySelector('[data-tab="chat"]');

  if (AppState.isAuthenticated && AppState.currentUser) {
    const user = AppState.currentUser;
    const isAdmin = user.role === 'admin';

    if (guestGroup) guestGroup.style.display = 'none';
    if (userGroup) userGroup.style.display = 'flex';

    if (userNameEl) userNameEl.textContent = `@${user.username}`;
    if (userRoleEl) {
      userRoleEl.textContent = user.role.toUpperCase();
      userRoleEl.className = `badge badge-sm badge-role ${isAdmin ? 'admin' : 'student'}`;
    }
    if (userAvatarEl) {
      userAvatarEl.textContent = user.username.charAt(0).toUpperCase();
      userAvatarEl.className = `user-chip-avatar ${isAdmin ? 'admin' : ''}`;
    }

    if (mobileBannerGuest) mobileBannerGuest.style.display = 'none';
    if (mobileBannerUser) mobileBannerUser.style.display = 'block';
    if (mobileUserName) mobileUserName.textContent = `@${user.username} (${user.name})`;
    if (mobileUserRoleBadge) {
      mobileUserRoleBadge.textContent = user.role.toUpperCase();
      mobileUserRoleBadge.className = `badge badge-sm badge-role ${isAdmin ? 'admin' : 'student'}`;
    }
    if (mobileUserAvatar) {
      mobileUserAvatar.textContent = user.username.charAt(0).toUpperCase();
      mobileUserAvatar.className = `user-chip-avatar ${isAdmin ? 'admin' : ''}`;
    }

    setText('topbarActiveUserTag', `@${user.username}`);

    if (subnavAccountsBtn) {
      subnavAccountsBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }
    if (subnavChatBtn) {
      subnavChatBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }

    const mobileNavAccounts = document.getElementById('mobileNavAccounts');
    const mobileNavChat = document.getElementById('mobileNavChat');
    if (mobileNavAccounts) mobileNavAccounts.style.display = isAdmin ? 'flex' : 'none';
    if (mobileNavChat) mobileNavChat.style.display = isAdmin ? 'flex' : 'none';

    const quickChatText = document.getElementById('btnQuickLiveChatText');
    if (quickChatText) quickChatText.textContent = isAdmin ? 'Chat Inbox' : 'Live Chat Support';

    if (isAdmin) {
      loadAdminChatThreads(false);
    }
  } else {
    if (guestGroup) guestGroup.style.display = 'flex';
    if (userGroup) userGroup.style.display = 'none';

    if (mobileBannerGuest) mobileBannerGuest.style.display = 'block';
    if (mobileBannerUser) mobileBannerUser.style.display = 'none';

    if (subnavAccountsBtn) {
      subnavAccountsBtn.style.display = 'none';
    }
    if (subnavChatBtn) {
      subnavChatBtn.style.display = 'none';
    }

    const mobileNavAccounts = document.getElementById('mobileNavAccounts');
    const mobileNavChat = document.getElementById('mobileNavChat');
    if (mobileNavAccounts) mobileNavAccounts.style.display = 'none';
    if (mobileNavChat) mobileNavChat.style.display = 'none';
  }
}

function switchAuthTab(tab) {
  const tabLogin = document.getElementById('authTabLogin');
  const tabRegister = document.getElementById('authTabRegister');
  const panelLogin = document.getElementById('authPanelLogin');
  const panelRegister = document.getElementById('authPanelRegister');
  const subtitle = document.getElementById('modalLoginSubtitle');
  const loginAlert = document.getElementById('loginErrorAlert');
  const registerAlert = document.getElementById('registerErrorAlert');
  const verifyAlert = document.getElementById('verifyErrorAlert');

  if (loginAlert) loginAlert.style.display = 'none';
  if (registerAlert) registerAlert.style.display = 'none';
  if (verifyAlert) verifyAlert.style.display = 'none';

  if (tab === 'register') {
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabRegister) tabRegister.classList.add('active');
    if (panelLogin) panelLogin.style.display = 'none';
    if (panelRegister) {
      panelRegister.style.display = 'flex';
      const stepForm = document.getElementById('authRegStepForm');
      const stepVerify = document.getElementById('authRegStepVerify');
      if (stepForm) stepForm.style.display = 'block';
      if (stepVerify) stepVerify.style.display = 'none';
    }
    if (subtitle) subtitle.textContent = 'Create your student account with 100MB SSD & MariaDB.';
  } else {
    if (tabLogin) tabLogin.classList.add('active');
    if (tabRegister) tabRegister.classList.remove('active');
    if (panelLogin) panelLogin.style.display = 'flex';
    if (panelRegister) panelRegister.style.display = 'none';
    if (subtitle) subtitle.textContent = 'Sign in to access your student hosting control panel.';
  }
}
window.switchAuthTab = switchAuthTab;

function openLoginModal() {
  const alertEl = document.getElementById('loginErrorAlert');
  if (alertEl) alertEl.style.display = 'none';
  const regAlert = document.getElementById('registerErrorAlert');
  if (regAlert) regAlert.style.display = 'none';
  switchAuthTab('login');
  openModal('modalLogin');
}
window.openLoginModal = openLoginModal;

function fillLoginCredentials(username, password) {
  setValue('loginUsername', username);
  setValue('loginPassword', password);
  const alertEl = document.getElementById('loginErrorAlert');
  if (alertEl) alertEl.style.display = 'none';
  showToast('Credentials Filled', `Ready to sign in as @${username}`, 'info');
}
window.fillLoginCredentials = fillLoginCredentials;

async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = getValue('loginUsername').trim();
  const password = getValue('loginPassword');
  const alertEl = document.getElementById('loginErrorAlert');
  const submitBtn = document.getElementById('btnLoginSubmit');
  const submitText = document.getElementById('btnLoginText');

  if (alertEl) alertEl.style.display = 'none';

  if (!username || !password) {
    if (alertEl) {
      alertEl.textContent = 'Please enter both username/email and password.';
      alertEl.style.display = 'block';
    }
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (submitText) submitText.textContent = 'Authenticating...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success && data.token) {
      localStorage.setItem('hosta_token', data.token);
      AppState.authToken = data.token;
      AppState.currentUser = data.user;
      AppState.isAuthenticated = true;
      AppState.activeUser = data.user.username;

      updateAuthUI();
      closeModal('modalLogin');
      showToast('Welcome to Hosta', data.message || `Logged in as ${data.user.name}`, 'success');

      switchMainView('dashboard');
      refreshDashboardData();
      if (data.user.role === 'admin') {
        loadAccounts();
        loadAdminChatThreads(false);
      }
    } else {
      if (alertEl) {
        alertEl.textContent = data.error || 'Login failed. Please check your credentials.';
        alertEl.style.display = 'block';
      }
    }
  } catch (err) {
    if (alertEl) {
      alertEl.textContent = err.message || 'Connection error. Please try again.';
      alertEl.style.display = 'block';
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitText) submitText.textContent = 'Sign In to Hosta';
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const firstName = getValue('regFirstName').trim();
  const lastName = getValue('regLastName').trim();
  const birthdate = getValue('regBirthdate').trim();
  const email = getValue('regEmail').trim();
  const password = getValue('regPassword');
  const passwordConfirm = getValue('regPasswordConfirm');
  const alertEl = document.getElementById('registerErrorAlert');
  const submitBtn = document.getElementById('btnRegisterSubmit');
  const submitText = document.getElementById('btnRegisterText');

  if (alertEl) alertEl.style.display = 'none';

  if (!firstName || !lastName || !birthdate || !email || !password || !passwordConfirm) {
    if (alertEl) {
      alertEl.textContent = 'Please fill in all required fields.';
      alertEl.style.display = 'block';
    }
    return;
  }

  if (password.length < 6) {
    if (alertEl) {
      alertEl.textContent = 'Password must be at least 6 characters long.';
      alertEl.style.display = 'block';
    }
    return;
  }

  if (password !== passwordConfirm) {
    if (alertEl) {
      alertEl.textContent = 'Password confirmation does not match password.';
      alertEl.style.display = 'block';
    }
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (submitText) submitText.textContent = 'Sending code...';

  try {
    const res = await fetch('/api/auth/register-send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, birthdate, email, password, passwordConfirm })
    });
    const data = await res.json();
    if (data.success) {
      AppState.pendingRegisterEmail = email;
      AppState.pendingDevCode = data.devCode || null;

      const emailDisplay = document.getElementById('verifyEmailDisplay');
      if (emailDisplay) emailDisplay.textContent = email;

      const devBox = document.getElementById('devCodeHelperBox');
      const devVal = document.getElementById('devCodeValue');
      if (data.devCode) {
        if (devVal) devVal.textContent = data.devCode;
        if (devBox) devBox.style.display = 'block';
      } else {
        if (devBox) devBox.style.display = 'none';
      }

      const stepForm = document.getElementById('authRegStepForm');
      const stepVerify = document.getElementById('authRegStepVerify');
      if (stepForm) stepForm.style.display = 'none';
      if (stepVerify) stepVerify.style.display = 'block';

      const codeInp = document.getElementById('regVerifyCode');
      if (codeInp) {
        codeInp.value = '';
        setTimeout(() => codeInp.focus(), 100);
      }

      startResendCountdown(30);
      showToast('Confirmation Code Sent', data.message || `Code sent to ${email}`, 'info');
    } else {
      if (alertEl) {
        alertEl.textContent = data.error || 'Failed to start registration.';
        alertEl.style.display = 'block';
      }
    }
  } catch (err) {
    if (alertEl) {
      alertEl.textContent = err.message || 'Connection error. Please try again.';
      alertEl.style.display = 'block';
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitText) submitText.textContent = 'Continue & Send Code';
  }
}
window.handleRegisterSubmit = handleRegisterSubmit;

async function handleVerifyRegistrationCode(e) {
  if (e) e.preventDefault();
  const email = AppState.pendingRegisterEmail || getValue('regEmail').trim();
  const code = getValue('regVerifyCode').trim();
  const alertEl = document.getElementById('verifyErrorAlert');
  const submitBtn = document.getElementById('btnVerifySubmit');
  const submitText = document.getElementById('btnVerifyText');

  if (alertEl) alertEl.style.display = 'none';

  if (!code || code.length !== 6) {
    if (alertEl) {
      alertEl.textContent = 'Please enter the 6-digit confirmation code.';
      alertEl.style.display = 'block';
    }
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (submitText) submitText.textContent = 'Verifying...';

  try {
    const res = await fetch('/api/auth/register-verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const data = await res.json();
    if (data.success && data.token) {
      localStorage.setItem('hosta_token', data.token);
      AppState.authToken = data.token;
      AppState.currentUser = data.user;
      AppState.isAuthenticated = true;
      AppState.activeUser = data.user.username;

      updateAuthUI();
      closeModal('modalLogin');
      showToast('Welcome to Hosta', data.message || `Account created for @${data.user.username}!`, 'success');

      switchMainView('dashboard');
      refreshDashboardData();
    } else {
      if (alertEl) {
        alertEl.textContent = data.error || 'Invalid confirmation code. Please check and try again.';
        alertEl.style.display = 'block';
      }
    }
  } catch (err) {
    if (alertEl) {
      alertEl.textContent = err.message || 'Connection error. Please try again.';
      alertEl.style.display = 'block';
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitText) submitText.textContent = 'Confirm & Register';
  }
}
window.handleVerifyRegistrationCode = handleVerifyRegistrationCode;

function backToRegStepForm() {
  const stepForm = document.getElementById('authRegStepForm');
  const stepVerify = document.getElementById('authRegStepVerify');
  const verifyAlert = document.getElementById('verifyErrorAlert');
  if (verifyAlert) verifyAlert.style.display = 'none';
  if (stepVerify) stepVerify.style.display = 'none';
  if (stepForm) stepForm.style.display = 'block';
}
window.backToRegStepForm = backToRegStepForm;

function fillDevCode() {
  const val = document.getElementById('devCodeValue')?.textContent;
  if (val) {
    setValue('regVerifyCode', val);
    const codeInp = document.getElementById('regVerifyCode');
    if (codeInp) codeInp.focus();
  }
}
window.fillDevCode = fillDevCode;

function startResendCountdown(seconds = 30) {
  const btn = document.getElementById('btnResendCode');
  const countdownEl = document.getElementById('resendCountdown');
  if (!btn) return;

  if (AppState.resendCountdownTimer) {
    clearInterval(AppState.resendCountdownTimer);
  }

  let remaining = seconds;
  btn.disabled = true;
  btn.style.opacity = '0.5';
  btn.style.pointerEvents = 'none';
  if (countdownEl) {
    countdownEl.style.display = 'inline';
    countdownEl.textContent = `(${remaining}s)`;
  }

  AppState.resendCountdownTimer = setInterval(() => {
    remaining--;
    if (countdownEl) countdownEl.textContent = `(${remaining}s)`;
    if (remaining <= 0) {
      clearInterval(AppState.resendCountdownTimer);
      AppState.resendCountdownTimer = null;
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      if (countdownEl) countdownEl.style.display = 'none';
    }
  }, 1000);
}

async function handleResendVerificationCode() {
  const email = AppState.pendingRegisterEmail || getValue('regEmail').trim();
  const alertEl = document.getElementById('verifyErrorAlert');
  if (alertEl) alertEl.style.display = 'none';

  if (!email) {
    backToRegStepForm();
    return;
  }

  try {
    const res = await fetch('/api/auth/register-resend-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (data.success) {
      if (data.devCode) {
        const devVal = document.getElementById('devCodeValue');
        const devBox = document.getElementById('devCodeHelperBox');
        if (devVal) devVal.textContent = data.devCode;
        if (devBox) devBox.style.display = 'block';
      }
      startResendCountdown(30);
      showToast('Code Resent', data.message || `Fresh code sent to ${email}`, 'success');
    } else {
      if (alertEl) {
        alertEl.textContent = data.error || 'Failed to resend code.';
        alertEl.style.display = 'block';
      }
    }
  } catch (err) {
    if (alertEl) {
      alertEl.textContent = err.message || 'Connection error. Please try again.';
      alertEl.style.display = 'block';
    }
  }
}
window.handleResendVerificationCode = handleResendVerificationCode;

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.warn('Logout network error:', err);
  } finally {
    localStorage.removeItem('hosta_token');
    AppState.authToken = null;
    AppState.currentUser = null;
    AppState.isAuthenticated = false;
    AppState.activeUser = 'admin';

    updateAuthUI();
    switchMainView('landing');
    showToast('Signed Out', 'You have been securely logged out.', 'info');
  }
}
window.handleLogout = handleLogout;

function toggleMainPortalView() {
  if (!AppState.isAuthenticated) {
    openLoginModal();
    return;
  }
  if (AppState.activeView === 'dashboard') {
    switchMainView('landing');
  } else {
    switchMainView('dashboard');
  }
}
window.toggleMainPortalView = toggleMainPortalView;

function handleServerStatusClick() {
  if (!AppState.isAuthenticated) {
    openLoginModal();
    return;
  }
  switchMainView('dashboard');
  switchDashTab('settings');
}
window.handleServerStatusClick = handleServerStatusClick;

// --- Forms Submission Handlers ---
function initForms() {
  // Login Trigger & Form
  const headerLoginBtn = document.getElementById('headerLoginBtn');
  if (headerLoginBtn) {
    headerLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openLoginModal();
    });
  }

  const formLogin = document.getElementById('formLogin');
  if (formLogin) {
    formLogin.addEventListener('submit', handleLoginSubmit);
  }
  const formRegister = document.getElementById('formRegister');
  if (formRegister) {
    formRegister.addEventListener('submit', handleRegisterSubmit);
  }
  const formVerify = document.getElementById('formVerifyCode');
  if (formVerify) {
    formVerify.addEventListener('submit', handleVerifyRegistrationCode);
  }
  const btnToggleLoginPass = document.getElementById('btnToggleLoginPass');
  if (btnToggleLoginPass) {
    btnToggleLoginPass.addEventListener('click', () => {
      const inp = document.getElementById('loginPassword');
      if (inp) {
        const isPass = inp.type === 'password';
        inp.type = isPass ? 'text' : 'password';
        btnToggleLoginPass.textContent = isPass ? 'Hide password' : 'Show password';
      }
    });
  }

  // Add Web Domain Form
  const formAddDomain = document.getElementById('formAddDomain');
  if (formAddDomain) {
    formAddDomain.addEventListener('submit', async (e) => {
      e.preventDefault();
      const domain = getValue('inputDomainName').trim();
      const aliases = getValue('inputDomainAliases').trim();
      const ssl = getCheckbox('inputDomainSsl');
      const phpVersion = getValue('inputDomainPhp');

      if (!domain) return;

      showToast('Creating Domain', `Adding ${domain} to HestiaCP...`, 'info');

      try {
        const res = await fetch('/api/domains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, aliases, ssl, phpVersion })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Domain Added', `Domain ${domain} is now active on the server!`, 'success');
          closeAllModals();
          formAddDomain.reset();
          loadWebDomains();
          refreshDashboardData();
        } else {
          showToast('Error', data.error || 'Failed to add domain', 'error');
        }
      } catch (err) {
        showToast('Error', err.message, 'error');
      }
    });
  }

  // Create Database Form
  const formAddDb = document.getElementById('formAddDatabase');
  if (formAddDb) {
    formAddDb.addEventListener('submit', async (e) => {
      e.preventDefault();
      const database = getValue('inputDbName').trim();
      const dbuser = getValue('inputDbUser').trim();
      const password = getValue('inputDbPassword').trim();
      const charset = getValue('inputDbCharset') || 'utf8mb4';

      if (!database || !dbuser || !password) return;

      showToast('Creating Database', `Provisioning MariaDB database admin_${database}...`, 'info');

      try {
        const res = await fetch('/api/databases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ database, dbuser, password, charset })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Database Created', `Database created with user admin_${dbuser}!`, 'success');
          closeAllModals();
          formAddDb.reset();
          loadDatabases();
          refreshDashboardData();
        } else {
          showToast('Error', data.error || 'Failed to create database', 'error');
        }
      } catch (err) {
        showToast('Error', err.message, 'error');
      }
    });
  }

  // Create Student Account Form
  const formAddAccount = document.getElementById('formAddAccount');
  if (formAddAccount) {
    formAddAccount.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = getValue('inputAccountUsername').trim();
      const name = getValue('inputAccountName').trim();
      const email = getValue('inputAccountEmail').trim();
      const password = getValue('inputAccountPassword').trim();
      const packageId = getValue('selectAccountPackage');

      if (!username || !email || !password) return;

      showToast('Creating Account', `Setting up @${username}...`, 'info');

      try {
        const res = await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, name, email, password, package: packageId })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Account Created', `Student account @${username} is ready!`, 'success');
          closeAllModals();
          formAddAccount.reset();
          loadAccounts();
          refreshDashboardData();
        } else {
          showToast('Error', data.error || 'Failed to create account', 'error');
        }
      } catch (err) {
        showToast('Error', err.message, 'error');
      }
    });
  }

  // Edit Student Account Form
  const formEditAccount = document.getElementById('formEditAccount');
  if (formEditAccount) {
    formEditAccount.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = getValue('editAccountUsername').trim();
      const name = getValue('editAccountName').trim();
      const email = getValue('editAccountEmail').trim();
      const packageId = getValue('editAccountPackage');
      const status = getValue('editAccountStatus');
      const password = getValue('editAccountPassword').trim();

      if (!username) return;

      const payload = {
        name,
        email,
        packageId,
        suspended: status === 'suspended'
      };
      if (password) payload.password = password;

      showToast('Saving Changes', `Updating @${username}...`, 'info');

      try {
        const res = await fetch(`/api/accounts/${encodeURIComponent(username)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast('Account Updated', `Changes saved for @${username}`, 'success');
          closeAllModals();
          loadAccounts();
          refreshDashboardData();
        } else {
          showToast('Error', data.error || 'Failed to update account', 'error');
        }
      } catch (err) {
        showToast('Error', err.message, 'error');
      }
    });
  }

  // Add DNS Record Form
  const formAddDns = document.getElementById('formAddDns');
  if (formAddDns) {
    formAddDns.addEventListener('submit', async (e) => {
      e.preventDefault();
      const domain = AppState.selectedDnsDomain;
      const record = getValue('inputDnsRecord').trim();
      const type = getValue('inputDnsType');
      const value = getValue('inputDnsValue').trim();
      const priority = getValue('inputDnsPriority').trim();
      const ttl = parseInt(getValue('inputDnsTtl'), 10) || 14400;

      if (!value) return;

      try {
        const res = await fetch(`/api/dns/${encodeURIComponent(domain)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record, type, value, priority, ttl })
        });
        const data = await res.json();
        if (data.success) {
          showToast('DNS Record Added', `Record added to zone ${domain}!`, 'success');
          closeAllModals();
          formAddDns.reset();
          loadDnsRecordsForDomain(domain);
        } else {
          showToast('Error', data.error || 'Failed to add DNS record', 'error');
        }
      } catch (err) {
        showToast('Error', err.message, 'error');
      }
    });
  }

  // Order Plan Form
  const formOrder = document.getElementById('formOrderPlan');
  if (formOrder) {
    formOrder.addEventListener('submit', async (e) => {
      e.preventDefault();
      const planId = getValue('orderPlanId');
      const domain = getValue('orderDomainInput').trim();
      const adminEmail = getValue('orderEmailInput').trim();

      if (!domain) return;

      showToast('Provisioning Account', `Deploying cloud hosting plan for ${domain}...`, 'info');

      try {
        const res = await fetch('/api/order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId, domain, adminEmail, billingCycle: AppState.billingCycle })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Plan Deployed', `Account successfully provisioned for ${domain}!`, 'success');
          closeAllModals();
          formOrder.reset();
          // Switch to dashboard view automatically
          switchMainView('dashboard');
          switchDashTab('domains');
        } else {
          showToast('Order Error', data.error || 'Could not provision plan', 'error');
        }
      } catch (err) {
        showToast('Error', err.message, 'error');
      }
    });
  }
}

// --- Accounts Search, Filter, and Password Handlers ---
function initAccounts() {
  const searchInput = document.getElementById('accountsSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', filterAccountsList);
  }

  const pkgFilter = document.getElementById('accountsFilterPackage');
  if (pkgFilter) {
    pkgFilter.addEventListener('change', filterAccountsList);
  }

  const statusFilter = document.getElementById('accountsFilterStatus');
  if (statusFilter) {
    statusFilter.addEventListener('change', filterAccountsList);
  }

  const btnGenPass = document.getElementById('btnGenAccountPass');
  if (btnGenPass) {
    btnGenPass.addEventListener('click', () => {
      const pass = generateRandomPassword();
      setValue('inputAccountPassword', pass);
      const input = document.getElementById('inputAccountPassword');
      if (input) input.type = 'text';
      setText('btnToggleAccountPass', 'Hide');
    });
  }

  const btnTogglePass = document.getElementById('btnToggleAccountPass');
  if (btnTogglePass) {
    btnTogglePass.addEventListener('click', () => {
      const input = document.getElementById('inputAccountPassword');
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btnTogglePass.textContent = 'Hide';
      } else {
        input.type = 'password';
        btnTogglePass.textContent = 'Show';
      }
    });
  }

  const btnGenEditPass = document.getElementById('btnGenEditAccountPass');
  if (btnGenEditPass) {
    btnGenEditPass.addEventListener('click', () => {
      const pass = generateRandomPassword();
      setValue('editAccountPassword', pass);
      const input = document.getElementById('editAccountPassword');
      if (input) input.type = 'text';
    });
  }
}

// Password Generator Helper
function generateSecurePassword(targetInputId) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*?';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  setValue(targetInputId, password);
  showToast('Password Generated', 'New secure password generated', 'info');
}

// DOM Helpers
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val !== undefined && val !== null ? val : '';
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function setCheckbox(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = Boolean(checked);
}

function getCheckbox(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function setBarWidth(id, width) {
  const el = document.getElementById(id);
  if (el) el.style.width = width;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =====================================================================
// FLOATING LIVE CHAT & ADMIN SUPPORT SYSTEM
// =====================================================================

function initFloatingChatWidget() {
  const formStart = document.getElementById('formStartChat');
  if (formStart) {
    formStart.addEventListener('submit', handleStartChat);
  }

  const formSend = document.getElementById('formSendVisitorMsg');
  if (formSend) {
    formSend.addEventListener('submit', handleSendVisitorMessage);
  }

  if (AppState.chatSessionId) {
    checkVisitorChatSession();
  }
}

async function toggleFloatingChat() {
  const widget = document.getElementById('floatingChatWidget');
  if (!widget) return;

  const isActive = widget.classList.contains('active');
  if (isActive) {
    widget.classList.remove('active');
    if (AppState.chatPollInterval) {
      clearInterval(AppState.chatPollInterval);
      AppState.chatPollInterval = null;
    }
  } else {
    widget.classList.add('active');
    const badge = document.getElementById('floatingChatBadge');
    if (badge) badge.style.display = 'none';

    if (AppState.chatSessionId) {
      const screenCaptcha = document.getElementById('chatScreenCaptcha');
      const screenMessages = document.getElementById('chatScreenMessages');
      if (screenCaptcha) screenCaptcha.style.display = 'none';
      if (screenMessages) screenMessages.style.display = 'flex';
      await loadVisitorMessages();
      startVisitorChatPolling();
    } else {
      const screenCaptcha = document.getElementById('chatScreenCaptcha');
      const screenMessages = document.getElementById('chatScreenMessages');
      if (screenCaptcha) screenCaptcha.style.display = 'block';
      if (screenMessages) screenMessages.style.display = 'none';
      fetchChatCaptcha();
    }
  }
}
window.toggleFloatingChat = toggleFloatingChat;

async function fetchChatCaptcha() {
  const qEl = document.getElementById('chatCaptchaQuestion');
  const tokenEl = document.getElementById('chatCaptchaToken');
  const ansEl = document.getElementById('chatCaptchaAnswer');
  const errEl = document.getElementById('chatCaptchaError');

  if (qEl) qEl.textContent = 'Loading challenge...';
  if (ansEl) ansEl.value = '';
  if (errEl) errEl.style.display = 'none';

  try {
    const res = await fetch('/api/chat/captcha');
    const data = await res.json();
    if (data.success && data.challenge) {
      if (qEl) qEl.textContent = data.challenge.question;
      if (tokenEl) tokenEl.value = data.challenge.token;
      AppState.chatCaptchaToken = data.challenge.token;
    }
  } catch (err) {
    if (qEl) qEl.textContent = 'Could not load captcha. Click to retry.';
  }
}
window.fetchChatCaptcha = fetchChatCaptcha;

async function handleStartChat(e) {
  if (e) e.preventDefault();
  const name = getValue('chatVisitorName').trim();
  const email = getValue('chatVisitorEmail').trim();
  const captchaAnswer = getValue('chatCaptchaAnswer').trim();
  const captchaToken = getValue('chatCaptchaToken') || AppState.chatCaptchaToken;
  const errEl = document.getElementById('chatCaptchaError');
  const btn = document.getElementById('btnStartChatSubmit');
  const btnText = document.getElementById('btnStartChatText');

  if (errEl) errEl.style.display = 'none';

  if (!name) {
    if (errEl) {
      errEl.textContent = 'Please enter your name.';
      errEl.style.display = 'block';
    }
    return;
  }

  if (!captchaAnswer) {
    if (errEl) {
      errEl.textContent = 'Please solve the math verification.';
      errEl.style.display = 'block';
    }
    return;
  }

  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Connecting to Admin...';

  if (!AppState.chatSessionId) {
    AppState.chatSessionId = 'hosta_sess_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
    localStorage.setItem('hosta_chat_session', AppState.chatSessionId);
  }

  try {
    const res = await fetch('/api/chat/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: AppState.chatSessionId,
        visitorName: name,
        visitorEmail: email,
        captchaAnswer,
        captchaToken
      })
    });
    const data = await res.json();
    if (data.success) {
      const screenCaptcha = document.getElementById('chatScreenCaptcha');
      const screenMessages = document.getElementById('chatScreenMessages');
      if (screenCaptcha) screenCaptcha.style.display = 'none';
      if (screenMessages) screenMessages.style.display = 'flex';

      renderVisitorMessages(data.messages || []);
      startVisitorChatPolling();
      showToast('Chat Connected', 'Connected to Hosta Philippines admin support', 'success');
    } else {
      if (errEl) {
        errEl.textContent = data.error || 'Verification failed. Try again.';
        errEl.style.display = 'block';
      }
      fetchChatCaptcha();
    }
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message || 'Connection error. Please try again.';
      errEl.style.display = 'block';
    }
    fetchChatCaptcha();
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Start Live Chat';
  }
}
window.handleStartChat = handleStartChat;

async function checkVisitorChatSession() {
  if (!AppState.chatSessionId) return;
  try {
    const res = await fetch(`/api/chat/session/${AppState.chatSessionId}/messages`);
    const data = await res.json();
    if (data.success && data.messages && data.messages.length > 0) {
      const lastMsg = data.messages[data.messages.length - 1];
      if (lastMsg && lastMsg.sender_type === 'admin' && !lastMsg.is_read) {
        const badge = document.getElementById('floatingChatBadge');
        if (badge) badge.style.display = 'inline-flex';
      }
    }
  } catch {
    // Ignore background check failure
  }
}

async function loadVisitorMessages() {
  if (!AppState.chatSessionId) return;
  try {
    const res = await fetch(`/api/chat/session/${AppState.chatSessionId}/messages`);
    const data = await res.json();
    if (data.success && data.messages) {
      renderVisitorMessages(data.messages);
    }
  } catch (err) {
    console.warn('Could not fetch visitor messages:', err);
  }
}

function renderVisitorMessages(messages) {
  const container = document.getElementById('chatMessagesScroll');
  if (!container) return;

  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px 16px; color: var(--text-muted); font-size: 0.85rem;">
        No messages yet. Send a message below to talk with our administrator.
      </div>
    `;
    return;
  }

  container.innerHTML = messages.map(msg => {
    const senderType = msg.senderType || msg.sender_type;
    const isVisitor = senderType === 'visitor';
    const senderName = msg.senderName || msg.sender_name || (isVisitor ? 'You' : 'Hosta Admin');
    const createdAt = msg.createdAt || msg.created_at;
    const time = formatChatTime(createdAt);
    return `
      <div class="chat-bubble-wrap ${isVisitor ? 'visitor' : 'admin'}">
        <div class="chat-bubble-sender">${escapeHtml(senderName)}</div>
        <div class="chat-bubble-text">${escapeHtml(msg.message)}</div>
        <div class="chat-bubble-time">${time}</div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

async function handleSendVisitorMessage(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('chatVisitorInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text || !AppState.chatSessionId) return;

  input.value = '';
  const btn = document.getElementById('btnVisitorSend');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/chat/session/${AppState.chatSessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, senderName: getValue('chatVisitorName') || 'Visitor' })
    });
    const data = await res.json();
    if (data.success) {
      await loadVisitorMessages();
    } else {
      showToast('Chat Error', data.error || 'Failed to send message', 'error');
    }
  } catch (err) {
    showToast('Chat Error', err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
    input.focus();
  }
}
window.handleSendVisitorMessage = handleSendVisitorMessage;

function startVisitorChatPolling() {
  if (AppState.chatPollInterval) clearInterval(AppState.chatPollInterval);
  AppState.chatPollInterval = setInterval(() => {
    const widget = document.getElementById('floatingChatWidget');
    if (widget && widget.classList.contains('active')) {
      loadVisitorMessages();
    }
  }, 3500);
}

function formatChatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// =====================================================================
// ADMIN PORTAL CHAT INBOX MANAGEMENT
// =====================================================================

function initAdminChat() {
  const form = document.getElementById('adminChatReplyForm');
  if (form) {
    form.addEventListener('submit', handleAdminSendReply);
  }

  const replyInput = document.getElementById('adminChatReplyInput');
  if (replyInput) {
    replyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAdminSendReply(e);
      }
    });
  }

  // Periodic poll if admin is logged in (keeps unread count live across all tabs)
  setInterval(() => {
    if (AppState.isAuthenticated && AppState.currentUser?.role === 'admin') {
      loadAdminChatThreads(AppState.activeDashTab === 'chat');
    }
  }, 4000);
}

async function loadAdminChatThreads(autoSelectFirst = true) {
  if (!AppState.isAuthenticated || AppState.currentUser?.role !== 'admin') return;

  const listEl = document.getElementById('adminChatThreadsList');

  try {
    const res = await fetch('/api/chat/admin/threads');
    const data = await res.json();
    if (data.success && data.threads) {
      AppState.adminChatThreads = data.threads;
      if (listEl) {
        renderAdminChatThreads();
      }

      const unreadTotal = data.threads.reduce((acc, t) => acc + (parseInt(t.unreadCount || t.unread_admin_count, 10) || 0), 0);
      const pill = document.getElementById('pillChatCount');
      if (pill) {
        if (unreadTotal > 0) {
          pill.textContent = unreadTotal;
          pill.style.display = 'inline-flex';
        } else {
          pill.style.display = 'none';
        }
      }

      if (AppState.activeDashTab === 'chat') {
        if (AppState.adminChatActiveThreadId) {
          loadAdminThreadMessages(AppState.adminChatActiveThreadId, false);
        } else if (autoSelectFirst && data.threads.length > 0) {
          selectAdminChatThread(data.threads[0].id);
        }
      }
    }
  } catch (err) {
    console.warn('Could not load chat threads:', err);
  }
}
window.loadAdminChatThreads = loadAdminChatThreads;

function renderAdminChatThreads() {
  const listEl = document.getElementById('adminChatThreadsList');
  if (!listEl) return;

  let threads = AppState.adminChatThreads || [];

  if (AppState.adminChatFilter === 'active') {
    threads = threads.filter(t => t.status === 'open' || t.status === 'active');
  } else if (AppState.adminChatFilter === 'resolved') {
    threads = threads.filter(t => t.status === 'resolved');
  }

  if (threads.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
        No conversations found ${AppState.adminChatFilter !== 'all' ? `for filter "${AppState.adminChatFilter}"` : ''}.
      </div>
    `;
    return;
  }

  listEl.innerHTML = threads.map(t => {
    const isSelected = AppState.adminChatActiveThreadId === t.id;
    const unread = parseInt(t.unreadCount || t.unread_admin_count, 10) || 0;
    const isResolved = t.status === 'resolved';
    const visitorName = t.visitorName || t.visitor_name || 'Student Visitor';
    const visitorEmail = t.visitorEmail || t.visitor_email || '';
    const lastMsg = t.lastMessage || t.last_message || 'New conversation started';
    const msgTime = t.lastMessageAt || t.last_message_at || t.createdAt || t.created_at;
    const time = msgTime ? formatChatTime(msgTime) : '';

    return `
      <div class="admin-thread-item ${isSelected ? 'active' : ''}" onclick="selectAdminChatThread(${t.id});">
        <div class="admin-thread-item-top">
          <span class="admin-thread-name">${escapeHtml(visitorName)}</span>
          <span class="admin-thread-time">${time}</span>
        </div>
        <div class="admin-thread-preview">${escapeHtml(lastMsg)}</div>
        <div class="admin-thread-meta">
          <span style="color: var(--text-muted); font-size: 0.74rem;">${escapeHtml(visitorEmail || 'Visitor')}</span>
          <div style="display: flex; gap: 6px; align-items: center;">
            ${unread > 0 ? `<span class="badge badge-danger badge-sm" style="font-size: 0.68rem; padding: 2px 6px;">${unread} new</span>` : ''}
            ${isResolved ? `<span class="badge badge-secondary badge-sm" style="font-size: 0.68rem; padding: 2px 6px;">Resolved</span>` : `<span class="badge badge-success badge-sm" style="font-size: 0.68rem; padding: 2px 6px;">Active</span>`}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function filterChatThreads(filter, btnEl) {
  AppState.adminChatFilter = filter;
  document.querySelectorAll('.chat-filter-pill').forEach(btn => btn.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  renderAdminChatThreads();
}
window.filterChatThreads = filterChatThreads;

async function selectAdminChatThread(threadId) {
  AppState.adminChatActiveThreadId = threadId;

  renderAdminChatThreads();

  const emptyState = document.getElementById('adminChatEmptyState');
  const activeContainer = document.getElementById('adminChatActiveContainer');
  if (emptyState) emptyState.style.display = 'none';
  if (activeContainer) activeContainer.style.display = 'flex';

  const thread = AppState.adminChatThreads.find(t => t.id === threadId);
  if (thread) {
    const vName = thread.visitorName || thread.visitor_name || 'Student Visitor';
    const vEmail = thread.visitorEmail || thread.visitor_email || 'No email provided';
    const initial = vName.charAt(0).toUpperCase();
    setText('adminActiveThreadAvatar', initial);
    setText('adminActiveThreadName', vName);
    setText('adminActiveThreadEmail', vEmail);

    const badge = document.getElementById('adminActiveThreadStatusBadge');
    const isResolved = thread.status === 'resolved';
    if (badge) {
      badge.textContent = isResolved ? 'Resolved' : 'Active';
      badge.className = `badge ${isResolved ? 'badge-secondary' : 'badge-success'}`;
    }

    const resolveBtn = document.getElementById('btnResolveThread');
    if (resolveBtn) {
      resolveBtn.innerHTML = isResolved
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg><span>Reopen</span>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>Resolve Thread</span>`;
    }
  }

  await loadAdminThreadMessages(threadId, true);
}
window.selectAdminChatThread = selectAdminChatThread;

async function loadAdminThreadMessages(threadId, autoScroll = false) {
  if (!threadId) return;
  const streamEl = document.getElementById('adminChatMessagesStream');
  if (!streamEl) return;

  try {
    const res = await fetch(`/api/chat/admin/threads/${threadId}/messages`);
    const data = await res.json();
    if (data.success && data.messages) {
      streamEl.innerHTML = data.messages.map(msg => {
        const senderType = msg.senderType || msg.sender_type;
        const senderName = msg.senderName || msg.sender_name;
        const createdAt = msg.createdAt || msg.created_at;
        const isAdmin = senderType === 'admin';
        const time = formatChatTime(createdAt);
        return `
          <div class="admin-msg-bubble-wrap ${isAdmin ? 'admin' : 'visitor'}">
            <div class="admin-msg-sender">${escapeHtml(senderName || (isAdmin ? 'Admin' : 'Visitor'))}</div>
            <div class="admin-msg-bubble">${escapeHtml(msg.message)}</div>
            <div class="admin-msg-time">${time}</div>
          </div>
        `;
      }).join('');

      if (autoScroll) {
        streamEl.scrollTop = streamEl.scrollHeight;
      }
    }
  } catch (err) {
    console.warn('Could not load thread messages:', err);
  }
}

async function handleAdminSendReply(e) {
  if (e) e.preventDefault();
  if (!AppState.adminChatActiveThreadId) return;

  const input = document.getElementById('adminChatReplyInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const btn = document.getElementById('adminChatSendBtn');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(`/api/chat/admin/threads/${AppState.adminChatActiveThreadId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    if (data.success) {
      input.value = '';
      await loadAdminThreadMessages(AppState.adminChatActiveThreadId, true);
      await loadAdminChatThreads();
    } else {
      showToast('Reply Error', data.error || 'Failed to send reply', 'error');
    }
  } catch (err) {
    showToast('Reply Error', err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
    input.focus();
  }
}
window.handleAdminSendReply = handleAdminSendReply;

async function handleResolveCurrentThread() {
  if (!AppState.adminChatActiveThreadId) return;

  try {
    const res = await fetch(`/api/chat/admin/threads/${AppState.adminChatActiveThreadId}/resolve`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      showToast('Thread Updated', 'Thread status updated', 'success');
      await loadAdminChatThreads();
      selectAdminChatThread(AppState.adminChatActiveThreadId);
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}
window.handleResolveCurrentThread = handleResolveCurrentThread;

