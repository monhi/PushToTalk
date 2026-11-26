## Push-to-Talk Audio Recorder


A minimal push-to-talk web app: hold the round button to record, release to keep the clip, play it back in the browser, and send it to an HTTPS Node.js server. Sent clips are removed from the list automatically.

Built with vanilla HTML/CSS/JavaScript on the frontend and Node.js + Express + Multer on the backend, served over HTTPS with a self-signed (or provided) certificate.

## Features

Hold-to-record circular push-to-talk button (mouse + touch support)

Live recording state feedback (pulsing red button, status badge)

Audio list with an inline audio player for each clip

Send button uploads the clip to the server (multipart/form-data) and removes it from the list on success

Delete button to discard a clip without uploading it

HTTPS support using keys/cert.pem and keys/key.pem

Automatic uploads folder creation and file-size limit (20 MB)

Graceful microphone permission handling and error messages

## Project structure

push-to-talk/
*server.js HTTPS Express server
*package.json
*README.md
*keys/
**cert.pem TLS certificate
**key.pem TLS private key
*public/
**index.html UI markup
**style.css UI styles
**script.js Recorder + upload logic
*uploads/ Created automatically (received audio)

## Quick start

Install dependencies
```bash
npm install
```
## Provide TLS keys

Place your certificate and key inside the keys/ folder:
```text
keys/cert.pem
keys/key.pem
```
If you don't have one for local development, generate a self-signed pair:
```bash
mkdir -p keys
openssl req -x509 -newkey rsa:2048 -nodes
-keyout keys/key.pem
-out keys/cert.pem
-days 365
-subj "/CN=localhost"
```
## Run the server
```bash
npm start
```
Then open:
```text
https://localhost:3443
```
> **Note:** the browser will warn about a self-signed certificate the first time. Click "Advanced -> Proceed" (Chrome/Edge), "Advanced -> Accept the Risk and Continue" (Firefox), or "Show Details -> visit this website" (Safari). After that, microphone access works normally because the page is on https://.

# How it works

Frontend (public/script.js)

Press the button: requests mic access (once), starts a MediaRecorder

Release the button: stops recording, builds a Blob, creates an object URL, appends a new item to the list

Play a clip: uses the native audio controls element pointing at the blob URL

Send a clip: POSTs a FormData with the blob to /upload-audio; on success the item is removed and its object URL is revoked

Delete a clip: revokes the blob URL and removes the item

Object URLs are revoked on delete and on page unload to avoid memory leaks.

Backend (server.js)

GET / Serves the static frontend from public/

GET /api/health Returns { status: "ok", secure: true }

POST /upload-audio Accepts one file field named "audio" (and optional "timestamp"), saves it to uploads/, returns JSON

GET /api/audio Lists filenames currently in uploads/ (debug helper)

Files are stored with a collision-resistant name: audio-<timestamp>-<random>.<ext>
Maximum upload size: 20 MB (configurable in server.js)
uploads/ is created automatically at startup if missing

## Configuration

Port server.js (PORT) default 3443
Max upload size server.js (limits.fileSize) default 20 MB
TLS cert keys/cert.pem required
TLS key keys/key.pem required
Key passphrase env KEY_PASSPHRASE unset

To use a different port:
```bash
PORT=8443 npm start
```
If your private key is passphrase-protected, set the environment variable and uncomment the passphrase line in tlsOptions inside server.js.

Browser support

Requires MediaRecorder and getUserMedia:

Chrome / Edge (desktop & Android): supported

Firefox (desktop & Android): supported

Safari 14.1+ (desktop & iOS): supported (falls back to audio/mp4)

Older browsers: not supported

Microphone access requires https:// or http://localhost. Plain HTTP on a LAN IP will not work.

Security notes

The TLS keys in keys/ are secrets. Never commit real production keys to GitHub. Add them to .gitignore:

node_modules/
uploads/
keys/*.pem

The included /upload-audio endpoint has no authentication. Add auth (session, JWT, API key, etc.) before exposing it publicly.

Uploaded files are stored on disk under uploads/ with generated names. You can plug in S3, GCS, or a DB blob store by swapping the Multer storage engine.

Testing with curl (optional)
```bash
curl -k -F "audio=@sample.webm" -F "timestamp=test" https://localhost:3443/upload-audio
```
The `-k` flag skips certificate verification for the self-signed cert.

## Dependencies

`express`: HTTP server and routing

`multer`: multipart form-data handling for audio uploads

Node.js 14 or newer recommended (uses fs.mkdirSync with recursive option).