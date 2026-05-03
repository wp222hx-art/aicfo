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

// 上传文件服务：/api/files/:fname → data/uploads/ 下的实际文件
app.get('/api/files/:fname', (req, res) => {
  const fname = req.params.fname;
  // 防目录穿越
  if (!/^[A-Za-z0-9_\-.]+$/.test(fname)) return res.status(400).send('bad filename');
  const abs = path.join(__dirname, '..', 'data', 'uploads', fname);
  if (!fs.existsSync(abs)) return res.status(404).send('not found');
  res.sendFile(abs);
});

// API
app.use('/api', api);

// Static frontend
app.use('/', express.static(path.join(__dirname, '..', 'frontend')));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// Upload Portal public page: /upload/UP-XXXXXXXX  → 渲染上传页（token 前端 JS 读取）
app.get('/upload/:token', (req, res, next) => {
  const file = path.join(__dirname, '..', 'frontend', 'upload-portal.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  next();
});
app.use('/upload', express.static(path.join(__dirname, '..', 'frontend')));

// SPA fallback for customer app (non-api, non-admin, non-upload)
app.get(/^\/(?!api|admin|upload).*/, (req, res, next) => {
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
