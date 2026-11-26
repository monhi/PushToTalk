(function () {
  // ---------- DOM ----------
  const pttButton     = document.getElementById('pttButton');
  const pttLabel      = document.getElementById('pttLabel');
  const statusBadge   = document.getElementById('statusBadge');
  const audioList     = document.getElementById('audioList');
  const countBadge    = document.getElementById('countBadge');

  // ---------- State ----------
  let mediaRecorder   = null;
  let audioChunks     = [];
  let isRecording     = false;
  let records         = [];   // { id, blob, url, timestamp }
  let activeStream    = null;

  const uid = () => Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  // ---------- Count badge ----------
  function updateCount() {
    countBadge.textContent = records.length;
  }

  // ---------- Render list ----------
  function renderAudioList() {
    if (records.length === 0) {
      audioList.innerHTML =
        '<div class="empty-message">no recordings yet — hold the button</div>';
      updateCount();
      return;
    }

    const fragment = document.createDocumentFragment();

    records.forEach(record => {
      const item = document.createElement('div');
      item.className = 'audio-item';
      item.dataset.id = record.id;

      // meta
      const metaDiv = document.createElement('div');
      metaDiv.className = 'meta';

      const ts = document.createElement('span');
      ts.className = 'timestamp';
      ts.textContent = record.timestamp;

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'actions';

      // send
      const sendBtn = document.createElement('button');
      sendBtn.className = 'send-btn';
      sendBtn.innerHTML = '📤 Send';
      sendBtn.addEventListener('click', e => {
        e.stopPropagation();
        sendToServer(record.id);
      });

      // delete
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = '✕';
      deleteBtn.title = 'Delete recording';
      deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        removeRecord(record.id);
      });

      actionsDiv.append(sendBtn, deleteBtn);
      metaDiv.append(ts, actionsDiv);

      // audio player
      const audioEl = document.createElement('audio');
      audioEl.controls = true;
      audioEl.preload = 'metadata';
      audioEl.src = record.url;

      item.append(metaDiv, audioEl);
      fragment.appendChild(item);
    });

    audioList.innerHTML = '';
    audioList.appendChild(fragment);
    updateCount();
  }

  // ---------- Remove ----------
  function removeRecord(id) {
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return;
    URL.revokeObjectURL(records[idx].url);
    records.splice(idx, 1);
    renderAudioList();
  }

  // ---------- Send to server ----------
  async function sendToServer(id) {
    const record = records.find(r => r.id === id);
    if (!record) return;

    const item = audioList.querySelector(`.audio-item[data-id="${id}"]`);
    const sendBtn = item ? item.querySelector('.send-btn') : null;

    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = '⏳ Sending';
    }
    statusBadge.textContent = '📤 uploading...';

    try {
      const formData = new FormData();
      formData.append('audio', record.blob, `recording-${id}.webm`);
      formData.append('timestamp', record.timestamp);

      const response = await fetch('/upload-audio', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Server responded ${response.status}`);
      }

      const data = await response.json();
      console.log('Server reply:', data);

      // Remove from UI (as requested)
      removeRecord(id);

      statusBadge.textContent = '✅ sent to server';
      setTimeout(() => (statusBadge.textContent = 'ready'), 1800);
    } catch (err) {
      console.error('Send error:', err);
      statusBadge.textContent = '❌ send failed';
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = '📤 Send';
      }
      setTimeout(() => (statusBadge.textContent = 'ready'), 2000);
    }
  }

  // ---------- Recording ----------
  async function startRecording() {
    if (isRecording) return;

    try {
      if (!activeStream) {
        activeStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
      }

      // Pick a supported mime type
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

      const options = mimeType ? { mimeType } : {};
      mediaRecorder = new MediaRecorder(activeStream, options);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, {
          type: mediaRecorder.mimeType || 'audio/webm'
        });
        const url = URL.createObjectURL(blob);
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });

        records.push({
          id: uid(),
          blob,
          url,
          timestamp: timeStr
        });
        renderAudioList();

        pttButton.classList.remove('recording');
        pttLabel.textContent = 'HOLD';
        statusBadge.textContent = 'ready';
        isRecording = false;
      };

      mediaRecorder.start();
      isRecording = true;

      pttButton.classList.add('recording');
      pttLabel.textContent = 'REC';
      statusBadge.textContent = '🔴 recording...';
    } catch (err) {
      console.error('Microphone error:', err);
      statusBadge.textContent = '⚠️ mic access denied';
      isRecording = false;
      pttButton.classList.remove('recording');
      pttLabel.textContent = 'HOLD';
      if (activeStream) {
        activeStream.getTracks().forEach(t => t.stop());
        activeStream = null;
      }
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop(); // onstop handles the rest
      pttButton.classList.remove('recording');
      pttLabel.textContent = 'HOLD';
      statusBadge.textContent = 'processing...';
      isRecording = false;
    } else if (isRecording) {
      isRecording = false;
      pttButton.classList.remove('recording');
      pttLabel.textContent = 'HOLD';
    }
  }

  // ---------- Push-to-talk events ----------
  function setupPushToTalk() {
    pttButton.addEventListener('mousedown', e => {
      e.preventDefault();
      startRecording();
    });
    pttButton.addEventListener('touchstart', e => {
      e.preventDefault();
      startRecording();
    }, { passive: false });

    pttButton.addEventListener('mouseup', e => {
      e.preventDefault();
      stopRecording();
    });
    pttButton.addEventListener('touchend', e => {
      e.preventDefault();
      stopRecording();
    }, { passive: false });

    pttButton.addEventListener('mouseleave', () => {
      if (isRecording) stopRecording();
    });

    pttButton.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ---------- Cleanup ----------
  window.addEventListener('beforeunload', () => {
    if (activeStream) activeStream.getTracks().forEach(t => t.stop());
    records.forEach(r => URL.revokeObjectURL(r.url));
  });

  // ---------- Init ----------
  function init() {
    renderAudioList();
    setupPushToTalk();
    statusBadge.textContent = 'ready';
  }

  init();
})();