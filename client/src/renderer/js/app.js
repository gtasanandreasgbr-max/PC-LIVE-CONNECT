document.addEventListener('DOMContentLoaded', async () => {
  let settings = await window.pcLiveAPI.getSettings();
  let selectedSourceId = null;
  let roomCode = null;
  let sessionToken = null;
  let timerInterval = null;
  let startTimeMs = 0;
  let virtualCamLoop = null;
  let isVirtualCamRunning = false;

  const navBtns = document.querySelectorAll('.nav-btn');
  const views = document.querySelectorAll('.view');
  const localPreview = document.getElementById('localPreview');
  const remoteVideo = document.getElementById('remoteVideo');

  function showToast(msg, isError = false) {
    const container = document.getElementById('toastContainer');
    const div = document.createElement('div');
    div.className = `toast ${isError ? 'error' : ''}`;
    div.textContent = msg;
    container.appendChild(div);
    setTimeout(() => div.remove(), 4500);
  }

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      navBtns.forEach((b) => b.classList.remove('active'));
      views.forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    });
  });

  document.getElementById('cfgSignalingUrl').value = settings.signalingUrl;
  document.getElementById('wsUrlLabel').textContent = settings.signalingUrl;
  document.getElementById('cfgAutoReconnect').checked = settings.autoReconnect === 'true';
  document.getElementById('cfgAutoQuality').checked = settings.autoAdjustQuality === 'true';
  document.getElementById('txFps').value = settings.fps;
  document.getElementById('txCodec').value = settings.codec;
  document.getElementById('txBitrate').value = settings.bitrateKbps;

  await window.mediaCapture.populateAudioDevices(
    document.getElementById('micSelect'),
    document.getElementById('cfgAudioOutput')
  );
  await refreshHistoryTable();

  window.signalingClient.connect(settings.signalingUrl);

  window.signalingClient.on('status', ({ connected, url }) => {
    const dot = document.getElementById('wsStatusDot');
    const txt = document.getElementById('wsStatusText');
    document.getElementById('wsUrlLabel').textContent = url;
    dot.className = `dot ${connected ? 'online' : 'offline'}`;
    txt.textContent = connected ? 'Servidor Online' : 'Reconectando...';
  });

  window.signalingClient.on('error', ({ message }) => {
    showToast(message, true);
    window.pcLiveAPI.notify('PC Live Connect - Aviso', message);
  });

  document.getElementById('btnCreateRoom').addEventListener('click', () => {
    window.signalingClient.send({ type: 'create-room' });
  });

  window.signalingClient.on('room-created', ({ code, sessionToken: token, iceServers }) => {
    roomCode = code;
    sessionToken = token;
    window.webrtcManager.iceServers = iceServers;
    window.signalingClient.sessionState = { role: 'host', code, sessionToken: token };

    document.getElementById('roomCodeDisplay').textContent = code;
    document.getElementById('btnCopyCode').disabled = false;
    updateStartButtonState();
    showToast(`Sessão criada: ${code}`);
  });

  document.getElementById('btnCopyCode').addEventListener('click', () => {
    navigator.clipboard.writeText(roomCode);
    showToast('Código copiado para a área de transferência!');
  });

  document.getElementById('btnSelectSources').addEventListener('click', async () => {
    const res = await window.pcLiveAPI.getCaptureSources();
    if (!res.authorized) {
      return showToast('Permissão de captura negada pelo usuário.', true);
    }

    const grid = document.getElementById('sourcesGrid');
    grid.innerHTML = '';

    res.sources.forEach((src) => {
      const card = document.createElement('div');
      card.className = 'source-item';
      card.innerHTML = `<img src="${src.thumbnail}" /><span>${src.type === 'screen' ? '🖥️' : '🪟'} ${src.name}</span>`;
      card.addEventListener('click', async () => {
        document.querySelectorAll('.source-item').forEach((el) => el.classList.remove('selected'));
        card.classList.add('selected');
        selectedSourceId = src.id;

        const stream = await window.mediaCapture.startCapture({
          sourceId: selectedSourceId,
          fps: document.getElementById('txFps').value,
          captureSystemAudio: document.getElementById('chkSystemAudio').checked,
          captureMic: document.getElementById('chkMicAudio').checked,
          micDeviceId: document.getElementById('micSelect').value,
        });

        localPreview.srcObject = stream;
        document.getElementById('txPlaceholder').style.display = 'none';
        updateStartButtonState();
      });
      grid.appendChild(card);
    });
  });

  document.getElementById('chkMicAudio').addEventListener('change', (e) => {
    document.getElementById('micSelect').disabled = !e.target.checked;
    window.mediaCapture.toggleMicMute(!e.target.checked);
  });

  function updateStartButtonState() {
    document.getElementById('btnStartTx').disabled = !(roomCode && selectedSourceId);
  }

  document.getElementById('btnStartTx').addEventListener('click', () => {
    window.webrtcManager.preferredCodec = document.getElementById('txCodec').value;
    window.webrtcManager.targetBitrateKbps = Number(document.getElementById('txBitrate').value);
    window.webrtcManager.currentBitrateKbps = window.webrtcManager.targetBitrateKbps;
    window.webrtcManager.autoAdjust = document.getElementById('cfgAutoQuality').checked;

    window.webrtcManager.initPeerConnection({
      role: 'host',
      iceServers: window.webrtcManager.iceServers,
      localStream: window.mediaCapture.combinedStream,
      onStateChange: (state) => {
        if (state === 'connected') {
          startChronometer();
          window.pcLiveAPI.notify('PC Live Connect', 'PC Receptor conectado! Transmissão ao vivo.');
          showToast('PC Receptor conectado com sucesso!');
        } else if (state === 'disconnected') {
          showToast('Conexão instável. Tentando reconectar...', true);
        }
      },
    });

    document.getElementById('btnStartTx').hidden = true;
    document.getElementById('btnStopTx').hidden = false;
    showToast('Aguardando PC Receptor inserir o código...');
  });

  window.signalingClient.on('receiver-joined', async () => {
    if (window.webrtcManager.pc) {
      await window.webrtcManager.createAndSendOffer(false);
    }
  });

  document.getElementById('btnStopTx').addEventListener('click', async () => {
    const duration = stopChronometer();
    const avgBitrate = window.telemetryMonitor.getAverageBitrate();
    if (roomCode) {
      await window.pcLiveAPI.logSession({ role: 'Transmissor', roomCode, durationSec: duration, avgBitrateKbps: avgBitrate });
      await refreshHistoryTable();
    }
    window.webrtcManager.close();
    window.mediaCapture.stopCapture();
    window.signalingClient.send({ type: 'leave-room' });
    window.signalingClient.sessionState = null;

    localPreview.srcObject = null;
    document.getElementById('txPlaceholder').style.display = 'flex';
    document.getElementById('btnStartTx').hidden = false;
    document.getElementById('btnStopTx').hidden = true;
    showToast('Transmissão encerrada.');
  });

  document.getElementById('btnJoinRoom').addEventListener('click', () => {
    const code = document.getElementById('inputJoinCode').value.trim().toUpperCase();
    if (code.length < 8) return showToast('Digite um código válido (ex: XXXX-XXXX).', true);
    window.signalingClient.send({ type: 'join-room', code });
  });

  window.signalingClient.on('room-joined', ({ code, iceServers }) => {
    roomCode = code;
    window.signalingClient.sessionState = { role: 'receiver', code };

    window.webrtcManager.initPeerConnection({
      role: 'receiver',
      iceServers,
      onRemoteStream: async (stream) => {
        remoteVideo.srcObject = stream;
        document.getElementById('rxPlaceholder').style.display = 'none';

        const audioOut = document.getElementById('cfgAudioOutput').value;
        if (audioOut && audioOut !== 'default' && remoteVideo.setSinkId) {
          await remoteVideo.setSinkId(audioOut).catch(() => {});
        }
      },
      onStateChange: (state) => {
        if (state === 'connected') {
          window.pcLiveAPI.notify('PC Live Connect', 'Recebendo transmissão de vídeo e áudio!');
          showToast('Conectado ao PC Transmissor!');
        }
      },
    });

    document.getElementById('btnJoinRoom').hidden = true;
    document.getElementById('btnLeaveRoom').hidden = false;
  });

  window.signalingClient.on('signal', async ({ data }) => {
    await window.webrtcManager.handleSignal(data);
  });

  window.signalingClient.on('peer-disconnected', ({ role }) => {
    showToast(`O ${role === 'host' ? 'PC Transmissor' : 'PC Receptor'} desconectou.`, true);
  });

  document.getElementById('btnLeaveRoom').addEventListener('click', () => {
    window.webrtcManager.close();
    window.signalingClient.send({ type: 'leave-room' });
    window.signalingClient.sessionState = null;
    remoteVideo.srcObject = null;
    document.getElementById('rxPlaceholder').style.display = 'flex';
    document.getElementById('btnJoinRoom').hidden = false;
    document.getElementById('btnLeaveRoom').hidden = true;
    stopVirtualCamStream();
  });

  document.getElementById('rxVolume').addEventListener('input', (e) => {
    remoteVideo.volume = Number(e.target.value);
    document.getElementById('rxVolumeLabel').textContent = `${Math.round(e.target.value * 100)}%`;
  });

  document.getElementById('btnFullscreen').addEventListener('click', () => {
    const wrapper = document.getElementById('rxVideoWrapper');
    if (!document.fullscreenElement) wrapper.requestFullscreen();
    else document.exitFullscreen();
  });

  document.getElementById('btnObsVirtualCam').addEventListener('click', async () => {
    const btn = document.getElementById('btnObsVirtualCam');
    if (!isVirtualCamRunning) {
      const device = document.getElementById('cfgVirtualCamDevice').value;
      const res = await window.pcLiveAPI.startVirtualCam(device, 60);
      if (res.success) {
        isVirtualCamRunning = true;
        btn.textContent = '⏹ Parar Câmera Virtual OBS';
        btn.classList.replace('btn-emerald', 'btn-danger');
        startVirtualCamFramePump();
        showToast(`Câmera Virtual ativa (${device}). Selecione no OBS Studio!`);
      }
    } else {
      stopVirtualCamStream();
    }
  });

  function startVirtualCamFramePump() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');

    virtualCamLoop = setInterval(() => {
      if (!isVirtualCamRunning || remoteVideo.readyState < 2) return;
      ctx.drawImage(remoteVideo, 0, 0, 1280, 720);
      canvas.toBlob(async (blob) => {
        if (blob) {
          const buf = await blob.arrayBuffer();
          window.pcLiveAPI.pushVirtualCamFrame(buf);
        }
      }, 'image/jpeg', 0.92);
    }, 1000 / 60);
  }

  function stopVirtualCamStream() {
    isVirtualCamRunning = false;
    clearInterval(virtualCamLoop);
    window.pcLiveAPI.stopVirtualCam();
    const btn = document.getElementById('btnObsVirtualCam');
    btn.textContent = '🎥 Ativar Câmera Virtual OBS';
    btn.classList.replace('btn-danger', 'btn-emerald');
  }

  let cleanWinOpen = false;
  document.getElementById('btnObsCleanWindow').addEventListener('click', async () => {
    cleanWinOpen = !cleanWinOpen;
    await window.pcLiveAPI.toggleCleanWindow(cleanWinOpen);
    showToast(cleanWinOpen ? 'Janela Limpa OBS (1280x720) aberta.' : 'Janela Limpa OBS fechada.');
  });

  document.getElementById('btnSaveSettings').addEventListener('click', async () => {
    const newUrl = document.getElementById('cfgSignalingUrl').value.trim();
    await window.pcLiveAPI.saveSetting('signalingUrl', newUrl);
    await window.pcLiveAPI.saveSetting('autoReconnect', document.getElementById('cfgAutoReconnect').checked);
    await window.pcLiveAPI.saveSetting('autoAdjustQuality', document.getElementById('cfgAutoQuality').checked);
    await window.pcLiveAPI.saveSetting('fps', document.getElementById('txFps').value);
    await window.pcLiveAPI.saveSetting('codec', document.getElementById('txCodec').value);
    await window.pcLiveAPI.saveSetting('bitrateKbps', document.getElementById('txBitrate').value);

    window.signalingClient.connect(newUrl);
    showToast('Configurações salvas no banco local!');
  });

  function startChronometer() {
    startTimeMs = Date.now();
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - startTimeMs) / 1000);
      const h = String(Math.floor(sec / 3600)).padStart(2, '0');
      const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      document.getElementById('txTimer').textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  function stopChronometer() {
    clearInterval(timerInterval);
    const sec = startTimeMs ? Math.floor((Date.now() - startTimeMs) / 1000) : 0;
    startTimeMs = 0;
    document.getElementById('txTimer').textContent = '00:00:00';
    return sec;
  }

  async function refreshHistoryTable() {
    const rows = await window.pcLiveAPI.getHistory();
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td>${r.role}</td>
        <td><code>${r.room_code}</code></td>
        <td>${r.duration_sec}s</td>
        <td>${r.avg_bitrate_kbps} kbps</td>
      </tr>`
      )
      .join('');
  }
});
