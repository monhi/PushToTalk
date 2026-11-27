#Push-to-Talk Audio Recorder


A minimal push-to-talk web app: hold the round button to record, release to keep the clip, play it back in the browser, and send it to an HTTPS Node.js server. The server converts the audio to WAV, transcribes it locally with Whisper, and streams the result back to the UI via Server-Sent Events (SSE). Sent clips are removed from the list automatically.

Built with vanilla HTML/CSS/JavaScript on the frontend and Node.js + Express + Multer + whisper-node on the backend, served over HTTPS with a self-signed (or provided) certificate.

Features

Hold-to-record circular push-to-talk button (mouse + touch support)

Live recording state feedback (pulsing red button, status badge)

Audio list with an inline audio player for each clip

Send button uploads the clip to the server (multipart/form-data) and removes it from the list on success

Delete button to discard a clip without uploading it

HTTPS support using keys/cert.pem and keys/key.pem

Automatic uploads folder creation and file-size limit (20 MB)

Graceful microphone permission handling and error messages

Server-side audio conversion to 16 kHz mono WAV via ffmpeg

Local Whisper transcription (offline after first model download)

SSE streaming of pipeline stages (upload, convert, transcribe, done)

Settings panel in the UI to choose language (Japanese, Persian, English) and model (base, small)

Settings persisted in localStorage

Transcript result card shown under the recordings list

Project structure

push-to-talk/
server.mjs HTTPS Express + SSE server (ESM)
package.json
nodemon.json
README.md
.gitignore
keys/
cert.pem TLS certificate
key.pem TLS private key
public/
index.html UI markup
style.css UI styles
script.js Recorder + SSE client logic
dspcom.svg Logo shown at the top of the page
uploads/ Created automatically (received audio)

Quick start

Install dependencies

npm install

Provide TLS keys

Place your certificate and key inside the keys/ folder:

keys/cert.pem
keys/key.pem

If you don't have one for local development, generate a self-signed pair:

mkdir -p keys
openssl req -x509 -newkey rsa:2048 -nodes
-keyout keys/key.pem
-out keys/cert.pem
-days 365
-subj "/CN=localhost"

Download Whisper models (once)

The base and small models must be present locally. Download them with:

npx @lumen-labs-dev/whisper-node

Or manually place the files in:

node_modules/@lumen-labs-dev/whisper-node/lib/whisper.cpp/models/

Expected filenames:

ggml-base.bin
ggml-small.bin

Run the server

Development (auto-reload with nodemon):

npm run dev

Production:

npm start

Then open:

https://localhost:3443

Note: the browser will warn about a self-signed certificate the first time. Click "Advanced -> Proceed" (Chrome/Edge), "Advanced -> Accept the Risk and Continue" (Firefox), or "Show Details -> visit this website" (Safari). After that, microphone access works normally because the page is on https://.

How it works

Frontend (public/script.js)

Press the button: requests mic access (once), starts a MediaRecorder with a 100 ms timeslice

Release the button: stops recording, builds a Blob, creates an object URL, appends a new item to the list

Play a clip: uses the native audio controls element pointing at the blob URL

Send a clip: POSTs a FormData (audio, timestamp, language, model) to /transcribe and reads the SSE stream to update the status badge and show the transcript

Delete a clip: revokes the blob URL and removes the item

Settings: language and model dropdowns are saved to localStorage and sent with every upload

Object URLs are revoked on delete and on page unload to avoid memory leaks.

Backend (server.mjs)

GET / Serves the static frontend from public/

GET /api/health Returns { status: "ok", secure: true }

POST /upload-audio Debug endpoint: converts the upload to WAV and returns JSON

POST /transcribe Full pipeline, streamed as SSE:
stage: upload
stage: convert
stage: transcribe
transcript
done / error

Pipeline details:

Multer saves the upload to uploads/received.webm (constant filename).

ffmpeg converts it to uploads/received.wav (16 kHz, mono).

whisper() runs with the model and language chosen in the UI.

Each stage is sent to the browser as an SSE event.

Model and language are validated against a whitelist on the server:

Languages: ja, fa, en

Models: base, small

Configuration

Port server.mjs (PORT) default 3443
Max upload size server.mjs (limits.fileSize) default 20 MB
TLS cert keys/cert.pem required
TLS key keys/key.pem required
Key passphrase env KEY_PASSPHRASE unset
Default language UI settings (localStorage) ja
Default model UI settings (localStorage) base

To use a different port:

PORT=8443 npm run dev

If your private key is passphrase-protected, set the environment variable and uncomment the passphrase line in tlsOptions inside server.mjs.

Settings panel

The page shows a collapsible "Settings" panel above the mic button with two dropdowns:

Language: Japanese (ja), Persian (fa), English (en)

Model: base (fast) or small (more accurate)

Choices are stored in localStorage under ptt.lang and ptt.model, and sent to the server on every transcription request. The status badge confirms "settings saved" when changed.

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

The /transcribe endpoint has no authentication. Add auth (session, JWT, API key, etc.) before exposing it publicly.

Uploaded files are stored on disk under uploads/ with fixed names. You can plug in S3, GCS, or a DB blob store by swapping the Multer storage engine.

The language and model values are whitelisted on the server to prevent arbitrary input.

Testing with curl (optional)

Send an audio file and print the SSE stream:
```bash
curl -k -N
-F "audio=@sample.webm"
-F "language=ja"
-F "model=base"
https://localhost:3443/transcribe
```
The -k flag skips certificate verification for the self-signed cert. The -N flag disables buffering so SSE events appear as they arrive.

Dependencies

express HTTP server and routing
multer multipart form-data handling for audio uploads
@lumen-labs-dev/whisper-node local Whisper transcription (precompiled Windows fork)
nodemon (dev) auto-reload during development

# External tools:

ffmpeg required on the server PATH for audio conversion

Node.js 18 or newer recommended (uses ESM and top-level await is not required but ESM is mandatory).

Development notes

server.mjs is ESM ("type": "module" in package.json)

nodemon.json watches server.mjs and public/, ignores uploads/ and keys/

After editing frontend files, hard reload the browser (Ctrl+Shift+R)

The first transcription is slower because the model warms up on first use

# License

MIT. Do whatever you like. Attribution appreciated but not required.