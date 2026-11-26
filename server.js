const https = require('https');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3443;

// ---------- Load TLS keys ----------
const KEYS_DIR = path.join(__dirname, 'keys');
const certPath = path.join(KEYS_DIR, 'cert.pem');
const keyPath  = path.join(KEYS_DIR, 'key.pem');

// Fail fast if keys are missing
if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error('❌ Missing TLS keys.');
  console.error(`   Expected: ${certPath}`);
  console.error(`   Expected: ${keyPath}`);
  process.exit(1);
}

const tlsOptions = {
  cert: fs.readFileSync(certPath),
  key:  fs.readFileSync(keyPath),
  // Optional — uncomment if you have a passphrase-protected key
  // passphrase: process.env.KEY_PASSPHRASE
};

// ---------- Ensure uploads folder exists ----------
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ---------- Multer storage ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    const uniqueName = `audio-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});

// ---------- Middleware ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Routes ----------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', secure: true });
});

app.post('/upload-audio', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file received.' });
  }

  console.log('✅ Received audio');
  console.log('   File     :', req.file.filename);
  console.log('   Size     :', req.file.size, 'bytes');
  console.log('   Timestamp:', req.body.timestamp || 'n/a');

  res.status(200).json({
    message: 'Audio received successfully.',
    file: req.file.filename,
    size: req.file.size
  });
});

app.get('/api/audio', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Unable to read uploads.' });
    res.json({ files });
  });
});

// ---------- Multer / generic error handler ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

// ---------- Start HTTPS server ----------
https.createServer(tlsOptions, app).listen(PORT, () => {
  console.log(`🔒 HTTPS server running at https://localhost:${PORT}`);
  console.log('   ⚠️  Your browser will warn about the self‑signed cert.');
  console.log('   Click "Advanced → Proceed" once, or import cert.pem into your trust store.');
});