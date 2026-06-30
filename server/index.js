require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const { ensureDir, readJson, writeJson } = require('./utils');

const DATA_DIR = path.resolve(__dirname, 'data');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const SAMPLE_DIR = path.resolve(__dirname, 'sample_docs');
ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DOCS_FILE = path.join(DATA_DIR, 'docs.json');

function loadUsers() {
  const users = readJson(USERS_FILE);
  return users ? users : [];
}

function saveUsers(users) {
  writeJson(USERS_FILE, users);
}

function loadDocs() {
  const docs = readJson(DOCS_FILE);
  return docs ? docs : [];
}

function saveDocs(docs) {
  writeJson(DOCS_FILE, docs);
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

function genId(prefix = '') {
  return prefix + Date.now() + Math.floor(Math.random() * 1000);
}

function authMiddleware(req, res, next) {
  // Accept token in Authorization header `Bearer <token>` or as query `?token=...` or `?access_token=...`
  let token;
  const auth = req.headers.authorization;
  if (auth) {
    const parts = auth.split(' ');
    if (parts.length === 2) token = parts[1];
  }
  if (!token && req.query) {
    token = req.query.token || req.query.access_token;
  }
  if (!token && req.cookies) {
    token = req.cookies.authToken;
  }
  console.log('AUTH middleware', { method: req.method, path: req.path, authHeader: auth, query: req.query, cookie: req.cookies, token: token ? token.slice(0, 10) + '...' : null });
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Multer setup: store in uploads folder
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage });

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const users = loadUsers();
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email taken' });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: genId('u_'), email, password: hash, name: name || '', createdAt: new Date().toISOString() };
  users.push(user);
  saveUsers(users);
  res.json({ ok: true });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('authToken', token, { httpOnly: true, sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get('/api/documents', authMiddleware, (req, res) => {
  const docs = loadDocs().filter(d => d.userId === req.user.id);
  res.json(docs);
});

app.post('/api/documents/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const docs = loadDocs();
  const doc = {
    id: genId('d_'),
    userId: req.user.id,
    originalName: req.file.originalname,
    storageKey: req.file.filename,
    mime: req.file.mimetype,
    size: req.file.size,
    createdAt: new Date().toISOString()
  };
  docs.push(doc);
  saveDocs(docs);
  res.json({ ok: true, doc });
});

app.get('/api/documents/:id/download', authMiddleware, (req, res) => {
  const docs = loadDocs();
  const doc = docs.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (doc.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const filePath = path.join(UPLOADS_DIR, doc.storageKey);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
  const download = req.query.download === '1';
  if (download) {
    res.download(filePath, doc.originalName);
  } else {
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Disposition', `inline; filename="${doc.originalName}"`);
    res.sendFile(filePath);
  }
});

// Delete a document (remove file + metadata)
app.delete('/api/documents/:id', authMiddleware, (req, res) => {
  const docs = loadDocs();
  const idx = docs.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const doc = docs[idx];
  if (doc.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const filePath = path.join(UPLOADS_DIR, doc.storageKey);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    docs.splice(idx, 1);
    saveDocs(docs);
    return res.json({ ok: true });
  } catch (e) {
    console.error('Delete error', e);
    return res.status(500).json({ error: 'Delete failed' });
  }
});

// Serve frontend static
app.use('/', express.static(path.join(__dirname, '..', 'public')));

// Initialize sample data if none exists
function createSamplePdf(filePath, title) {
  const doc = new PDFDocument({ size: 'A4', margin: 72 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);
  doc.fontSize(24).fillColor('#1e40af').text(title, { align: 'center' });
  doc.moveDown();
  doc.fontSize(14).fillColor('#334155').text('This is a sample document generated for the demo portal.', { align: 'left' });
  doc.moveDown();
  doc.fontSize(12).text('You can view this file in the browser or download it using the portal.', { align: 'left' });
  doc.end();
}

function seedSample() {
  const users = loadUsers();
  if (users.length === 0) {
    const sampleUser = { id: 'u_demo', email: 'demo@example.com', password: bcrypt.hashSync('password', 10), name: 'Demo User', createdAt: new Date().toISOString() };
    users.push(sampleUser);
    saveUsers(users);
    ensureDir(SAMPLE_DIR);
    const samples = ['adhar.pdf', 'resume.pdf', 'pan.pdf'];
    samples.forEach(f => {
      const sPath = path.join(SAMPLE_DIR, f);
      if (!fs.existsSync(sPath)) createSamplePdf(sPath, f.replace('.pdf', '').toUpperCase());
      const destName = Date.now() + '-' + f;
      const destPath = path.join(UPLOADS_DIR, destName);
      fs.copyFileSync(sPath, destPath);
      const docs = loadDocs();
      docs.push({ id: genId('d_'), userId: sampleUser.id, originalName: f, storageKey: destName, mime: 'application/pdf', size: fs.statSync(destPath).size, createdAt: new Date().toISOString() });
      saveDocs(docs);
    });
    console.log('Seeded demo user: demo@example.com / password');
  }
}

seedSample();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('Server running on port', PORT));
