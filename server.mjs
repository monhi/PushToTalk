import https from 'node:https';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { whisper } from '@lumen-labs-dev/whisper-node';
console.log('[whisper] loaded as:', typeof whisper);

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3443;

// ---------- TLS keys ----------
const KEYS_DIR = path.join(__dirname, 'keys');
const tlsOptions = {
  cert: fs.readFileSync(path.join(KEYS_DIR, 'cert.pem')),
  key:  fs.readFileSync(path.join(KEYS_DIR, 'key.pem')),
};

// ---------- Folders ----------
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const RECEIVED_WEBM = path.join(UPLOAD_DIR, 'received.webm');
const RECEIVED_WAV  = path.join(UPLOAD_DIR, 'received.wav');

// ---------- Multer: constant filename, overwrite each time ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, 'received.webm'),
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ---------- ffmpeg helper ----------
function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-f', 'wav',
      outputPath,
    ];
    execFile('ffmpeg', args, { timeout: 30000 }, (err, _stdout, stderr) => {
      if (err) {
        console.error('ffmpeg failed:', stderr || err.message);
        return reject(new Error('ffmpeg conversion failed'));
      }
      resolve();
    });
  });
}

// ---------- SSE helpers ----------
function sseInit(res) {
  res.set({
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': connected\n\n');
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------- Middleware ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Routes ----------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', secure: true });
});

// Optional: keep the plain JSON endpoint for debugging
app.post('/upload-audio', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file received.' });
  try {
    await convertToWav(RECEIVED_WEBM, RECEIVED_WAV);
    const wavStat = await fs.promises.stat(RECEIVED_WAV);
    res.json({ ok: true, wav: RECEIVED_WAV, wavSize: wavStat.size });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- SSE pipeline ----------
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file received.' });
  }

  sseInit(res);

  let aborted = false;
  req.on('close', () => { aborted = true; });

  const send = (event, data) => { if (!aborted) sseSend(res, event, data); };
  const end  = () => { if (!aborted) res.end(); };

  try {
    // 1) upload
    send('stage', {
      stage: 'upload',
      message: 'audio received',
      bytes: req.file.size,
    });

    // 2) convert
    send('stage', { stage: 'convert', message: 'converting to wav...' });
    await convertToWav(RECEIVED_WEBM, RECEIVED_WAV);
    const wavStat = await fs.promises.stat(RECEIVED_WAV);
    send('stage', {
      stage: 'convert',
      message: 'wav ready',
      bytes: wavStat.size,
    });

    // 3) transcribe (language & model come from the client)
    const requestedLang  = (req.body.language || 'ja').toLowerCase();
    const requestedModel = (req.body.model    || 'base').toLowerCase();

    const ALLOWED_LANG  = new Set(['ja', 'fa', 'en']);
    const ALLOWED_MODEL = new Set(['base', 'small']);

    const language = ALLOWED_LANG.has(requestedLang)   ? requestedLang  : 'ja';
    const model    = ALLOWED_MODEL.has(requestedModel) ? requestedModel : 'base';

    send('stage', {
      stage: 'transcribe',
      message: `transcribing with ${model} (${language})...`,
      language,
      model,
    });

    const segments = await whisper(RECEIVED_WAV, {
      modelName: model,
      whisperOptions: { language },
    });

    const fullText = segments
      .map(s => (s.speech || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();

    if (!fullText) {
      send('transcript', { text: '', language, note: 'no speech detected' });
    } else {
      send('transcript', { text: fullText, language });
    }

    // 4) done
    send('done', { ok: true });
    end();
  } catch (err) {
    console.error('Pipeline error:', err);
    send('error', { message: err.message });
    end();
  }
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

// ---------- Start ----------
https.createServer(tlsOptions, app).listen(PORT, () => {
  console.log(`🔒 HTTPS server running at https://localhost:${PORT}`);
  console.log('   Uploads dir:', UPLOAD_DIR);
});