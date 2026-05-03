// AiCFO Platform - Main Express Server
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Initialize DB + seed
require('./db/schema');
const { seed } = require('./db/seed');
try { seed(); } catch (e) { console.warn('[SEED] skip:', e.message); }

const api = require('./routes/api');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request log
app.use((req, res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.url}`);
  next();
});

// API
app.use('/api', api);

// Static frontend
app.use('/', express.static(path.join(__dirname, '..', 'frontend')));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// SPA fallback for customer app (non-api, non-admin)
app.get(/^\/(?!api|admin).*/, (req, res, next) => {
  const file = path.join(__dirname, '..', 'frontend', 'index.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  AiCFO Platform running on http://0.0.0.0:${PORT}`);
  console.log(`  Customer App   → http://0.0.0.0:${PORT}/`);
  console.log(`  Admin Console  → http://0.0.0.0:${PORT}/admin/`);
  console.log(`  API Base       → http://0.0.0.0:${PORT}/api\n`);
});
