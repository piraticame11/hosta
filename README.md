# Hosta — Student Web Hosting Philippines (HestiaCP)

**Hosta** is an affordable Philippine-based web hosting platform and client control portal designed specifically for Filipino IT, Computer Science, and Engineering students. Tailored for school assignments, midterm lab activities, capstone systems, and thesis projects, Hosta connects seamlessly to **HestiaCP (Hestia Control Panel)** on your server.

---

## 🌟 Student-Centric Features & Specifications

### 1. Student Pricing & Realistic Quotas
- **Student Monthly Pass**: Only **₱150 / month** (budget-friendly for students, project demonstrations, and capstones).
- **Exact Student Quotas**:
  - **100 MB** Fast SSD Storage (ideal for PHP, HTML, CSS, JavaScript, and asset files).
  - **20 GB** Monthly Bandwidth (high-speed transfer for capstone projects and thesis defense).
  - **1 MariaDB / MySQL Database** with instant **phpMyAdmin** access.
  - **1 Web Domain** (includes free `.hosta.site` student subdomain and custom domains).
  - **Free Let's Encrypt SSL** (HTTPS security out-of-the-box).
  - **No Mailbox Overhead**: Removed email accounts to eliminate spam risks and simplify setup.

### 2. Student LiveChat Support
- Embedded **Floating LiveChat Widget with Security Captcha** and Admin Chat Inbox.
- Real-time communication between students and administrators.

### 3. Philippine Infrastructure & Peering
- Hosted on a **Philippines Datacenter Node** (`119.92.128.45`).
- Optimized local routing for Philippine ISPs:
  - **PLDT Fiber**: ~8 ms
  - **Globe Telecom**: ~11 ms
  - **Converge ICT**: ~9 ms
  - **DITO Telecommunity**: ~14 ms

### 4. Dual Theme Design (White Theme Default)
- **Default White Theme**: Clean, accessible white interface with high-contrast text and crisp typography.
- **One-Click Theme Switcher**: Toggle button in the header (Sun/Moon icon) allows students to switch between White (Light) and Cyber Dark mode. Preference is saved automatically in `localStorage`.

### 5. Client Portal & HestiaCP Management
- **Dashboard Overview**: Real-time quota gauges displaying exact usage in MB (e.g. `28.5 MB / 100 MB` SSD and `42.0 MB / 200 MB` Bandwidth).
- **Web Domain**: Manage domains, PHP versions (PHP 7.4 through PHP 8.3), and SSL.
- **MariaDB Database**: Create and drop databases, generate secure passwords, and launch phpMyAdmin.
- **DNS Zone Management**: Configure A, CNAME, and TXT records for custom domains.
- **Backups**: Download `.tar` project snapshots or trigger instant backups before code edits.
- **Server Setup**: Connect to your live HestiaCP server via API access keys or run in interactive student sandbox demo mode.

---

## 🚀 Quick Start

### Prerequisites
- Node.js (v18.0.0 or higher)
- npm

### Installation & Launch

1. Clone or navigate to the repository directory:
   ```bash
   cd hosta
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the application:
   ```bash
   npm start
   ```
   Or in development mode with auto-reload:
   ```bash
   npm run dev
   ```

4. Open your browser and visit:
   ```
   http://localhost:3000
   ```

---

## 🔌 Connecting to Your Live HestiaCP Server

You can configure your HestiaCP connection either directly in the web UI (**Student Portal > Server Setup**) or via environment variables in `.env` / `config/hestia.json`.

### Step 1: Create an API Access Key in HestiaCP
In HestiaCP:
- In HestiaCP Web Admin: Go to **Server Settings (Gear icon) > Users > admin > API Access Keys** and click **Add Access Key**.
- Or via server SSH terminal:
  ```bash
  v-add-access-key admin hosta-api
  ```
  Copy the generated **Access Key** and **Secret Key**.

### Step 2: Open Port 8083 in Server Firewall
Ensure incoming TCP connections on port **8083** are permitted:
```bash
ufw allow 8083/tcp
```

### Step 3: Configure Hosta
In the web UI, go to **Student Portal > Server Setup**:
- **HestiaCP Server IP or Hostname**: `https://your-server-ip:8083` (or `https://hestia.yourdomain.ph:8083`)
- **Port**: `8083`
- **Authentication**: Access Key / Secret Key (or Username / Password)
- **Self-Signed SSL**: Checked (default in HestiaCP)
- Click **"Test Server Connection"** to verify round-trip latency to your server.

---

## 📁 Project Architecture

```
hosta/
├── config/
│   └── hestia.json          # Persistent HestiaCP connection settings
├── public/
│   ├── css/
│   │   └── style.css        # Clean design system (White default + Dark mode)
│   ├── js/
│   │   └── app.js           # Student portal controller, livechat & API handlers
│   └── index.html           # Landing page, ₱150/mo plan, livechat & student dashboard
├── server/
│   ├── routes/
│   │   └── api.js           # Express REST endpoints
│   ├── config-manager.js    # Safe JSON configuration manager
│   ├── hestia-client.js     # HestiaCP Command API connector
│   └── mock-data.js         # PH student store (100MB/20GB/1DB, Philippines node)
├── server.js                # Main Express server entry point
├── package.json
└── README.md
```

---

## 📄 License
MIT License. Built for Filipino students and educators using HestiaCP.
