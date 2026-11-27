(function () {
  // ---------- DOM ----------
  const pttButton      = document.getElementById('pttButton');
  const pttLabel       = document.getElementById('pttLabel');
  const statusBadge    = document.getElementById('statusBadge');
  const audioList      = document.getElementById('audioList');
  const countBadge     = document.getElementById('countBadge');

  const settingsToggle = document.getElementById('settingsToggle');
  const settingsBody   = document.getElementById('settingsBody');
  const settingsPanel  = settingsToggle ? settingsToggle.closest('.settings-panel') : null;
  const langSelect     = document.getElementById('langSelect');
  const modelSelect    = document.getElementById('modelSelect');

  // ---------- State ----------
  let mediaRecorder = null;
  let audioChunks   = [];
  let isRecording   = false;
  let records       = [];
  let activeStream  = null;

  const uid = () => Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  // ---------- Settings persistence ----------
  function loadSettings() {
    const savedLang  = localStorage.getItem('ptt.lang')  || 'ja';
    const savedModel = localStorage.getItem('ptt.model') || 'base';
    if (langSelect)  langSelect.value  = savedLang;
    if (modelSelect) modelSelect.value = savedModel;
  }

  function saveSettings() {
    if (langSelect)  localStorage.setItem('ptt.lang',  langSelect.value);
    if (modelSelect) localStorage.setItem('ptt.model', modelSelect.value);
    statusBadge.textContent = '⚙️ settings saved';
    setTimeout(() => (statusBadge.textContent = 'ready'), 1200);
  }

  function getSettings() {
    return {
      language: langSelect  ? langSelect.value  : 'ja',
      model:    modelSelect ? modelSelect.value : 'base',
    };
  }

  // ---------- Count ----------
  function updateCount() {
    countBadge.textContent = records.length;
  }

  // ---------- Render ----------
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

      const metaDiv = document.createElement('div');
      metaDiv.className = 'meta';

      const ts = document.createElement('span');
      ts.className = 'timestamp';
      ts.textContent = record.timestamp;

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'actions';

      const sendBtn = document.createElement('button');
      sendBtn.className = 'send-btn';
      sendBtn.innerHTML = '📤 Send';
      sendBtn.addEventListener('click', e => {
        e.stopPropagation();
        sendToServer(record.id);
      });

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

  // ---------- Send via SSE ----------
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
      const settings = getSettings();
      const formData = new FormData();
      formData.append('audio', record.blob, `recording-${id}.webm`);
      formData.append('timestamp', record.timestamp);
      formData.append('language', settings.language);
      formData.append('model',    settings.model);
      console.log('[send] settings:', settings);

      const response = await fetch('/transcribe', {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'text/event-stream' },
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalTranscript = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const lines = raw.split('\n');
          let event = 'message';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;

          let data;
          try { data = JSON.parse(dataStr); } catch { continue; }

          if (event === 'stage') {
            statusBadge.textContent = `⏳ ${data.message}`;
            console.log('[stage]', data);
          } else if (event === 'transcript') {
            finalTranscript = data.text || '';
            console.log('[transcript]', finalTranscript);
            statusBadge.textContent = finalTranscript
              ? `📝 ${finalTranscript.slice(0, 40)}${finalTranscript.length > 40 ? '…' : ''}`
              : '📝 (no speech detected)';
          } else if (event === 'done') {
            removeRecord(id);
            if (finalTranscript) showTranscriptCard(finalTranscript);
            statusBadge.textContent = '✅ done';
            setTimeout(() => (statusBadge.textContent = 'ready'), 2000);
          } else if (event === 'error') {
            throw new Error(data.message || 'server error');
          }
        }
      }
    } catch (err) {
      console.error('Send error:', err);
      statusBadge.textContent = `❌ ${err.message || 'send failed'}`;
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = '📤 Send';
      }
      setTimeout(() => (statusBadge.textContent = 'ready'), 3000);
    }
  }

  // ---------- Transcript card ----------
  function showTranscriptCard(text) {
    let card = document.getElementById('transcriptCard');
    if (!card) {
      card = document.createElement('div');
      card.id = 'transcriptCard';
      card.style.cssText = `
        margin-top: 1rem;
        padding: 1rem 1.2rem;
        background: #eef7ff;
        border-radius: 1.2rem;
        border: 1px solid #cfe2f3;
        color: #1e2b3c;
        font-size: 1rem;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      `;
      document.querySelector('.recordings-section').appendChild(card);
    }
    card.textContent = text;
  }

  // ---------- Recording ----------
  async function startRecording() {
    if (isRecording) return;

    try {
      if (!activeStream) {
        activeStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }

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
          type: mediaRecorder.mimeType || 'audio/webm',
        });
        const url = URL.createObjectURL(blob);
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });

        records.push({ id: uid(), blob, url, timestamp: timeStr });
        renderAudioList();

        pttButton.classList.remove('recording');
        pttLabel.textContent = 'HOLD';
        statusBadge.textContent = 'ready';
        isRecording = false;
      };

      mediaRecorder.start(100);
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
      mediaRecorder.stop();
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
    if (!pttButton) {
      console.error('pttButton not found in DOM');
      return;
    }

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

  // ---------- Settings UI ----------
  function setupSettings() {
    if (langSelect)  langSelect.addEventListener('change', saveSettings);
    if (modelSelect) modelSelect.addEventListener('change', saveSettings);

    if (settingsToggle && settingsPanel) {
      settingsToggle.addEventListener('click', e => {
        e.stopPropagation();
        settingsPanel.classList.toggle('collapsed');
      });
      const header = settingsPanel.querySelector('.settings-header');
      if (header) {
        header.addEventListener('click', () => settingsPanel.classList.toggle('collapsed'));
      }
    }
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
    loadSettings();
    setupSettings();
    statusBadge.textContent = 'ready';
  }

  init();
})();