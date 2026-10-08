require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./server/routes/api');
const hostingRoutes = require('./server/routes/hosting');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Documentation & Guide routes (mounted before static to avoid trailing slash redirects)
app.get(['/docs', '/docs/', '/docs.html', '/guides/hosting', '/help'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

// Serve uploaded files (e.g. GCash receipts) and frontend assets
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Mount API routes
app.use('/api/hosting', hostingRoutes);
app.use('/api', apiRoutes);

// Fallback to index.html for client-side navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.stack || err.message);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 Hosta Webhosting Platform running at: http://localhost:${PORT}`);
  console.log(`🔌 HestiaCP API connector initialized`);
  console.log(`🛡️  Ready for web domains, databases, emails & DNS`);
  console.log('====================================================');
});
