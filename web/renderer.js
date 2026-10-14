'use strict';

// ─── Constants & Config ───────────────────────────────────────────────────────
const PEER_HOST = '0.peerjs.com';
const PEER_PORT = 443;
const PEER_PATH = '/';
const PEER_SECURE = true;
const ROOM_PREFIX = 'roxy-v2-';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.services.mozilla.com' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

// ─── State ────────────────────────────────────────────────────────────────────
let peer = null;
let myPeerId = null;
let currentRoomId = '';
let isHost = false;
let myName = '';
let myStream = null;
let isStreaming = false;
let autoOpenStreams = true;
let modoDevAtivo = false;
let activeConnections = {};   // peerId -> { dataConn, outgoingCall, incomingCall, streamCard, name }
let contextTargetPeerId = null;
let shortcutKey = 'Alt+G';
let settings = {};
let devStatsIntervals = {};

function updateAvatar() {
  const name = document.getElementById('usernameInput')?.value.trim() || 'M';
  const avatar = document.getElementById('userAvatar');
  if (avatar) {
    avatar.textContent = name.charAt(0).toUpperCase() || 'M';
  }
}

// ─── Settings Persistence ─────────────────────────────────────────────────────
function loadSettings() {
  try {
    const raw = localStorage.getItem('roxy-settings') || localStorage.getItem('mdp-settings');
    settings = raw ? JSON.parse(raw) : {};
  } catch { settings = {}; }

  const cores = navigator.hardwareConcurrency || 4;
  const defaultFps = '60';
  const defaultBitrate = '8000000'; // 8 Mbps baseline for crystal-clear 60fps gaming

  document.getElementById('usernameInput').value = settings.username || 'Mario';
  document.getElementById('roomId').value = settings.lastRoom || 'SALA-6863';
  updateAvatar();
  document.getElementById('profilePresetSelect').value = settings.profilePreset || 'auto';
  document.getElementById('resSelect').value = settings.res || '1080';
  document.getElementById('fpsSelect').value = settings.fps || defaultFps;
  document.getElementById('bitrateSelect').value = settings.bitrate || defaultBitrate;
  document.getElementById('streamSoundToggle').checked = settings.streamSound !== false;
  document.getElementById('limitMbpsToggle').checked = settings.limitMbps !== false;
  document.getElementById('mbpsRange').value = settings.mbps || '30';
  document.getElementById('mbpsInput').value = settings.mbps || '30';
  document.getElementById('autoOpenStreamsToggle').checked = settings.autoOpen !== false;
  document.getElementById('modoDevToggle').checked = !!settings.modoDev;
  document.getElementById('audioSelect').value = settings.captureAudio || 'exclude';
  shortcutKey = settings.shortcut || 'Alt+G';
  document.getElementById('shortcutInput').value = shortcutKey;
  const badge = document.getElementById('shortcutBadge');
  if (badge) badge.textContent = shortcutKey;
  autoOpenStreams = settings.autoOpen !== false;
  modoDevAtivo = !!settings.modoDev;
}

function saveSettings() {
  try {
    settings.username = document.getElementById('usernameInput').value.trim();
    settings.lastRoom = document.getElementById('roomId').value.trim();
    settings.profilePreset = document.getElementById('profilePresetSelect').value;
    settings.res = document.getElementById('resSelect').value;
    settings.fps = document.getElementById('fpsSelect').value;
    settings.bitrate = document.getElementById('bitrateSelect').value;
    settings.streamSound = document.getElementById('streamSoundToggle').checked;
    settings.limitMbps = document.getElementById('limitMbpsToggle').checked;
    settings.mbps = document.getElementById('mbpsInput').value;
    settings.autoOpen = document.getElementById('autoOpenStreamsToggle').checked;
    settings.modoDev = document.getElementById('modoDevToggle').checked;
    settings.captureAudio = document.getElementById('audioSelect').value;
    settings.shortcut = shortcutKey;
    localStorage.setItem('roxy-settings', JSON.stringify(settings));
  } catch(e) {}
  autoOpenStreams = settings.autoOpen;
  modoDevAtivo = settings.modoDev;
  const badge = document.getElementById('shortcutBadge');
  if (badge) badge.textContent = shortcutKey;
}

// ─── Toast Notifications ──────────────────────────────────────────────────────
function showToast(msg, type = '', duration = 3500) {
  const el = document.getElementById('toastNotification');
  el.textContent = msg;
  el.className = 'toast-notification active ' + type;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast-notification'; }, duration);
}

// ─── Room & P2P Management ────────────────────────────────────────────────────
function getCleanRoom(raw) {
  return (raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

function clearUserList() {
  const list = document.getElementById('userList');
  if (list) {
    list.innerHTML = '<li class="empty-list">Ninguém na sala.</li>';
  }
  updateUserCount();
}

function joinOrCreateRoom(targetRoomId, autoStartStream = false) {
  const room = getCleanRoom(targetRoomId || document.getElementById('roomId').value);
  myName = document.getElementById('usernameInput').value.trim() || 'Usuário ' + Math.floor(Math.random() * 1000);

  if (!room) {
    showToast('⚠️ Digite ou gere um ID de sala!', 'warn');
    return;
  }

  currentRoomId = room;
  document.getElementById('roomId').value = room;
  saveSettings();

  // Close existing peer if switching rooms
  if (peer && !peer.destroyed) {
    try { peer.destroy(); } catch(e) {}
    peer = null;
  }

  activeConnections = {};
  clearUserList();
  document.querySelectorAll('.stream-card').forEach(c => { if (c._cleanup) c._cleanup(); c.remove(); });
  updatePlaceholder();

  const hostPeerId = ROOM_PREFIX + room;
  updateStatus('Conectando...', false);

  // Attempt to claim host peer ID
  const hostOpts = {
    host: PEER_HOST, port: PEER_PORT, path: PEER_PATH, secure: PEER_SECURE,
    config: { iceServers: ICE_SERVERS }
  };

  peer = new Peer(hostPeerId, hostOpts);

  peer.on('open', (id) => {
    myPeerId = id;
    isHost = true;
    updateStatus(`👑 Host da Sala: ${room}`, true);
    addUserToList(myPeerId, myName + ' (Você)', true);
    showToast(`🏠 Conectado como Host da sala ${room}!`, 'success');
    if (autoStartStream) openSourcePicker();
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // Room already has an active host! Connect as client/viewer!
      console.log(`[Host] Sala ${room} já possui um Host ativo (${hostPeerId}). Conectando como participante...`);
      updateStatus(`Conectando à sala ${room}...`, false);
      try { peer.destroy(); } catch(e) {}
      peer = null;
      connectAsClient(room, hostPeerId, autoStartStream);
    } else {
      console.warn('[Peer Error]', err);
      showToast('❌ Erro de conexão P2P: ' + (err.message || err.type), 'error');
      updateStatus('Erro na Conexão', false);
    }
  });

  setupPeerHandlers();
}
const joinRoom = joinOrCreateRoom;
window.joinRoom = joinOrCreateRoom;

function connectAsClient(room, hostPeerId, autoStartStream = false) {
  isHost = false;
  currentRoomId = room;
  document.getElementById('roomId').value = room;
  saveSettings();

  if (peer && !peer.destroyed) {
    try { peer.destroy(); } catch(e) {}
    peer = null;
  }

  activeConnections = {};
  clearUserList();
  document.querySelectorAll('.stream-card').forEach(c => { if (c._cleanup) c._cleanup(); c.remove(); });
  updatePlaceholder();

  myName = document.getElementById('usernameInput').value.trim() || 'Usuário ' + Math.floor(Math.random() * 1000);
  updateStatus(`Conectando à sala ${room}...`, false);

  const clientOpts = {
    host: PEER_HOST, port: PEER_PORT, path: PEER_PATH, secure: PEER_SECURE,
    config: { iceServers: ICE_SERVERS }
  };

  peer = new Peer(clientOpts);

  peer.on('open', (id) => {
    myPeerId = id;
    updateStatus(`🟢 Sala: ${room}`, true);
    updateOrAddUser(myPeerId, myName + ' (Você)', false);
    showToast(`✅ Conectado à sala ${room}!`, 'success');

    // Connect data channel to Host
    console.log(`[Client] Conectando data channel ao Host ${hostPeerId}...`);
    connectToPeer(hostPeerId, 'Host', true);

    if (autoStartStream) openSourcePicker();
  });

  peer.on('error', (err) => {
    console.warn('[Client Peer Error]', err);
    if (err.type === 'peer-unavailable') {
      // Self-healing: if host was not found, become host of this room automatically!
      console.log(`[Client] Host de "${room}" não encontrado. Criando sala como Host...`);
      try { peer.destroy(); } catch(e) {}
      peer = null;
      joinOrCreateRoom(room, autoStartStream);
    } else {
      showToast('❌ Erro ao conectar: ' + (err.message || err.type), 'error');
      updateStatus('Desconectado', false);
    }
  });

  setupPeerHandlers();
}

function setupPeerHandlers() {
  peer.on('connection', (conn) => {
    setupDataConnection(conn, conn.peer, conn.metadata?.name || 'Amigo');
  });

  peer.on('call', (call) => {
    handleIncomingCall(call);
  });

  peer.on('disconnected', () => {
    if (peer && !peer.destroyed) {
      console.warn('[PeerJS] Sinalização desconectada, reconectando...');
      setTimeout(() => {
        if (peer && !peer.destroyed && peer.disconnected) {
          try { peer.reconnect(); } catch(e) {}
        }
      }, 3000);
    }
  });
}

function connectToPeer(targetPeerId, defaultName, isTargetHost = false) {
  if (!peer || peer.destroyed || !targetPeerId || targetPeerId === myPeerId) return;
  if (activeConnections[targetPeerId]?.dataConn) return;

  console.log(`[Mesh] Conectando data channel a ${targetPeerId} (${defaultName})...`);
  const conn = peer.connect(targetPeerId, {
    metadata: { name: myName, peerId: myPeerId, isHost: isHost },
    reliable: true
  });
  setupDataConnection(conn, targetPeerId, defaultName, isTargetHost);
}

function setupDataConnection(conn, peerId, defaultName, isTargetHost = false) {
  const isHostId = isTargetHost || peerId.startsWith(ROOM_PREFIX);

  const handleOpen = () => {
    console.log(`[Mesh] Data channel aberto com ${peerId}`);
    if (!activeConnections[peerId]) activeConnections[peerId] = {};
    activeConnections[peerId].dataConn = conn;

    // Send hello with our actual name and role
    try {
      conn.send({
        type: 'hello',
        name: myName,
        peerId: myPeerId,
        isHost: isHost
      });
      conn.send({ type: 'requestStream', peerId: myPeerId });
    } catch(e) {}

    // If I am Host: send full room state to new peer and announce to existing peers!
    if (isHost) {
      const currentPeers = [{ peerId: myPeerId, name: myName, isHost: true }];
      Object.entries(activeConnections).forEach(([id, c]) => {
        if (id !== peerId) {
          currentPeers.push({
            peerId: id,
            name: c.name || 'Amigo',
            isHost: false
          });
        }
      });

      try {
        conn.send({
          type: 'roomState',
          hostName: myName,
          peers: currentPeers
        });
      } catch(e) {}

      // Announce to other peers
      const newPeerName = activeConnections[peerId]?.name || defaultName || 'Amigo';
      Object.entries(activeConnections).forEach(([id, c]) => {
        if (id !== peerId && c.dataConn?.open) {
          try {
            c.dataConn.send({
              type: 'peerJoined',
              peerId: peerId,
              name: newPeerName
            });
          } catch(e) {}
        }
      });
    }

    // If I am already streaming, call this peer immediately!
    if (isStreaming && myStream) {
      console.log(`[Stream] Enviando transmissão ativa para novo peer ${peerId}...`);
      callPeer(peerId, myStream);
    }
  };

  if (conn.open) {
    handleOpen();
  } else {
    conn.on('open', handleOpen);
  }

  conn.on('data', (data) => {
    handleDataMessage(peerId, data);
  });

  conn.on('close', () => {
    removePeer(peerId);
  });

  conn.on('error', (err) => {
    console.warn(`[DataConn] Erro com ${peerId}:`, err);
    removePeer(peerId);
  });
}

function handleDataMessage(fromPeerId, data) {
  if (!data || !data.type) return;

  if (activeConnections[fromPeerId]) {
    activeConnections[fromPeerId].lastSeen = Date.now();
  }

  switch (data.type) {
    case 'ping': {
      if (activeConnections[fromPeerId]?.dataConn?.open) {
        try { activeConnections[fromPeerId].dataConn.send({ type: 'pong', peerId: myPeerId }); } catch(e) {}
      }
      break;
    }

    case 'pong': {
      if (activeConnections[fromPeerId]) {
        activeConnections[fromPeerId].lastSeen = Date.now();
      }
      break;
    }

    case 'hello': {
      // Remote peer sent their REAL name and host status!
      if (!activeConnections[fromPeerId]) activeConnections[fromPeerId] = {};
      activeConnections[fromPeerId].name = data.name;
      const isRemoteHost = !!data.isHost || fromPeerId.startsWith(ROOM_PREFIX);

      updateOrAddUser(fromPeerId, data.name, isRemoteHost);
      showToast(`👋 ${data.name} entrou na sala!`);

      // If we are Host, broadcast updated name to others
      if (isHost) {
        Object.entries(activeConnections).forEach(([id, c]) => {
          if (id !== fromPeerId && c.dataConn?.open) {
            try {
              c.dataConn.send({ type: 'peerUpdated', peerId: fromPeerId, name: data.name });
            } catch(e) {}
          }
        });
      }

      // If we are currently streaming, send stream to this peer!
      if (isStreaming && myStream) {
        callPeer(fromPeerId, myStream);
      }
      break;
    }

    case 'roomState': {
      // Sent by Host: contains hostName and list of all peers in room
      if (data.hostName) {
        updateOrAddUser(fromPeerId, data.hostName, true);
        if (activeConnections[fromPeerId]) activeConnections[fromPeerId].name = data.hostName;
      }

      if (Array.isArray(data.peers)) {
        data.peers.forEach(p => {
          if (p.peerId !== myPeerId) {
            updateOrAddUser(p.peerId, p.name, !!p.isHost);
            if (!activeConnections[p.peerId]) activeConnections[p.peerId] = {};
            activeConnections[p.peerId].name = p.name;

            // Connect to other peers in room!
            // Tie-break: only connect if myPeerId is lexicographically smaller
            if (!p.isHost && myPeerId < p.peerId) {
              if (!activeConnections[p.peerId]?.dataConn) {
                connectToPeer(p.peerId, p.name, false);
              }
            }
          }
        });
      }
      break;
    }

    case 'peerJoined': {
      // Sent by Host to all existing peers when a new peer joins
      if (data.peerId !== myPeerId) {
        updateOrAddUser(data.peerId, data.name, false);
        if (!activeConnections[data.peerId]) activeConnections[data.peerId] = {};
        activeConnections[data.peerId].name = data.name;
        showToast(`👋 ${data.name} entrou na sala!`);

        // Connect to the new peer if our ID is smaller
        if (myPeerId < data.peerId) {
          if (!activeConnections[data.peerId]?.dataConn) {
            connectToPeer(data.peerId, data.name, false);
          }
        }
      }
      break;
    }

    case 'peerUpdated': {
      if (data.peerId !== myPeerId) {
        const isRemoteHost = data.peerId.startsWith(ROOM_PREFIX);
        updateOrAddUser(data.peerId, data.name, isRemoteHost);
        if (activeConnections[data.peerId]) activeConnections[data.peerId].name = data.name;
      }
      break;
    }

    case 'peerLeft': {
      if (data.peerId && data.peerId !== myPeerId) {
        removePeer(data.peerId);
      }
      break;
    }

    case 'requestStream': {
      if (isStreaming && myStream) {
        callPeer(fromPeerId, myStream);
      }
      break;
    }

    case 'streamStarted': {
      showToast(`📹 ${data.name} começou a transmitir!`, 'success');
      if (activeConnections[fromPeerId]?.dataConn?.open) {
        try {
          activeConnections[fromPeerId].dataConn.send({ type: 'requestStream', peerId: myPeerId });
        } catch(e) {}
      }
      break;
    }

    case 'streamStopped': {
      if (activeConnections[fromPeerId]?.streamCard) {
        if (activeConnections[fromPeerId].streamCard._cleanup) activeConnections[fromPeerId].streamCard._cleanup();
        activeConnections[fromPeerId].streamCard.remove();
        delete activeConnections[fromPeerId].streamCard;
        updatePlaceholder();
      }
      break;
    }
  }
}

function broadcastUserList() {
  const users = [{ peerId: myPeerId, name: myName }];
  Object.entries(activeConnections).forEach(([id, c]) => {
    users.push({ peerId: id, name: c.name || 'Amigo' });
  });
  Object.values(activeConnections).forEach(c => {
    if (c.dataConn?.open) {
      try { c.dataConn.send({ type: 'userList', users }); } catch(e) {}
    }
  });
}

function updateStatus(text, connected) {
  const badge = document.getElementById('statusBadge');
  if (badge) {
    badge.textContent = text;
    badge.classList.toggle('connected', connected);
  }

  const room = currentRoomId || document.getElementById('roomId')?.value || 'SALA-6863';

  const headerRoom = document.getElementById('headerRoomText');
  if (headerRoom) headerRoom.textContent = room;

  const headerStatusText = document.getElementById('headerStatusText');
  if (headerStatusText) {
    headerStatusText.innerHTML = connected 
      ? `<span class="status-dot-on"></span> conectada` 
      : `<span class="status-dot-off"></span> desconectada`;
  }

  const roomStatus = document.getElementById('roomStatusText');
  const roomStatusLabel = document.getElementById('roomStatusLabel');
  if (roomStatus) roomStatus.classList.toggle('online', connected);
  if (roomStatusLabel) roomStatusLabel.textContent = connected ? 'online' : 'offline';

  const stageRoom = document.getElementById('stageRoomDisplay');
  if (stageRoom) stageRoom.textContent = room;

  const stageStatus = document.getElementById('stageTransmissionStatus');
  if (stageStatus) {
    if (isStreaming) stageStatus.textContent = 'transmitindo •';
    else if (connected) stageStatus.textContent = 'conectado •';
    else stageStatus.textContent = 'aguardando transmissão •';
  }
}

function removePeer(peerId) {
  if (!peerId) return;
  console.log(`[Mesh] Removendo peer ${peerId} da sala e limpando transmissões...`);

  if (activeConnections[peerId]) {
    if (activeConnections[peerId].streamCard) {
      if (activeConnections[peerId].streamCard._cleanup) activeConnections[peerId].streamCard._cleanup();
      activeConnections[peerId].streamCard.remove();
      delete activeConnections[peerId].streamCard;
    }
    if (activeConnections[peerId].outgoingCall) {
      try { activeConnections[peerId].outgoingCall.close(); } catch(e) {}
    }
    if (activeConnections[peerId].incomingCall) {
      try { activeConnections[peerId].incomingCall.close(); } catch(e) {}
    }
    if (activeConnections[peerId].dataConn) {
      try { activeConnections[peerId].dataConn.close(); } catch(e) {}
    }
    delete activeConnections[peerId];
  }

  // Also query DOM for any orphaned stream cards for this peer
  const orphanCard = document.getElementById('stream-' + peerId);
  if (orphanCard) {
    if (orphanCard._cleanup) orphanCard._cleanup();
    orphanCard.remove();
  }

  removeUserFromList(peerId);
  updateUserCount();
  updatePlaceholder();

  // If Host, broadcast peerLeft to all remaining peers
  if (isHost) {
    Object.values(activeConnections).forEach(c => {
      if (c.dataConn?.open) {
        try { c.dataConn.send({ type: 'peerLeft', peerId }); } catch(e) {}
      }
    });
  }
}

// ─── Room Heartbeat & Stale Peer Cleanup (every 2.5s) ─────────────────────────
setInterval(() => {
  if (!peer || peer.destroyed || !currentRoomId) return;
  const now = Date.now();

  Object.entries(activeConnections).forEach(([peerId, connInfo]) => {
    // Send ping
    if (connInfo.dataConn?.open) {
      try { connInfo.dataConn.send({ type: 'ping', peerId: myPeerId }); } catch(e) {}
    }

    // Check timeout (stale after 6s of no response)
    const lastSeen = connInfo.lastSeen || now;
    if (now - lastSeen > 6000) {
      console.warn(`[Mesh] Peer ${peerId} sem resposta ha mais de 6s. Desconectando...`);
      removePeer(peerId);
    }
  });
}, 2500);

// Notify peers immediately on window close / navigation
window.addEventListener('beforeunload', () => {
  if (isStreaming && myStream) {
    stopStream();
  }
  Object.values(activeConnections).forEach(c => {
    if (c.dataConn?.open) {
      try {
        c.dataConn.send({ type: 'peerLeft', peerId: myPeerId });
        c.dataConn.send({ type: 'streamStopped', peerId: myPeerId });
      } catch(e) {}
    }
  });
  if (peer && !peer.destroyed) {
    try { peer.destroy(); } catch(e) {}
  }
});

// ─── Audio Capture (Clean Audio via C++ WASAPI) ───────────────────────────────
let _cleanAudioCtx = null;
let _cleanAudioDest = null;
let _cleanAudioProcessor = null;
let _cleanAudioWs = null;
let _selectedExcludePid = 0;    // PID of app to exclude from audio
let _audioAppsList = [];         // List from C++ EnumerateAudioApps
let _pendingSourceId = null;     // Source ID waiting for audio picker

// Fixed pre-allocated circular ring buffer: 48kHz stereo, 1.5 seconds capacity (576 KB RAM forever)
const AUDIO_RING_CAPACITY = 48000 * 2 * 1.5;
const _audioRing = new Float32Array(AUDIO_RING_CAPACITY);
let _audioWriteIdx = 0;
let _audioReadIdx = 0;
let _audioAvailable = 0;
let _audioPktCount = 0;         // diagnóstico: pacotes de áudio recebidos do C++
let _audioOutPeak = 0;          // diagnóstico: pico do que está indo para a trilha WebRTC
let _audioPrimed = false;       // só começa a tocar depois de acumular um pequeno colchão (evita estalos)
let _rsPos = 0, _rsPrevL = 0, _rsPrevR = 0; // estado do resampler defensivo (caso a taxa != AudioContext)

// Coloca UM frame estéreo no ring buffer
function _pushAudioFrame(l, r) {
  _audioRing[_audioWriteIdx] = l;
  _audioWriteIdx = (_audioWriteIdx + 1) % AUDIO_RING_CAPACITY;
  _audioRing[_audioWriteIdx] = r;
  _audioWriteIdx = (_audioWriteIdx + 1) % AUDIO_RING_CAPACITY;
  _audioAvailable = Math.min(AUDIO_RING_CAPACITY, _audioAvailable + 2);
}

function stopCleanAudio() {
  if (_cleanAudioWs) {
    try { _cleanAudioWs.close(); } catch(e) {}
    _cleanAudioWs = null;
  }
  if (_cleanAudioProcessor) {
    try {
      _cleanAudioProcessor.disconnect();
      _cleanAudioProcessor.onaudioprocess = null;
    } catch(e) {}
    _cleanAudioProcessor = null;
  }
  if (_cleanAudioCtx) {
    try { _cleanAudioCtx.close(); } catch(e) {}
    _cleanAudioCtx = null;
  }
  _cleanAudioDest = null;
  _audioWriteIdx = 0;
  _audioReadIdx = 0;
  _audioAvailable = 0;
  _audioPrimed = false;
  _audioPktCount = 0; _audioOutPeak = 0;
  _rsPos = 0; _rsPrevL = 0; _rsPrevR = 0;
}

function initCleanAudioTrack(excludePid) {
  stopCleanAudio();

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return Promise.resolve(null);

  try {
    _cleanAudioCtx = new AudioCtx({ sampleRate: 48000 });
    if (_cleanAudioCtx.state === 'suspended') {
      _cleanAudioCtx.resume().catch(() => {});
    }
    _cleanAudioDest = _cleanAudioCtx.createMediaStreamDestination();

    // Create a SINGLE reusable ScriptProcessorNode: 2048 frames buffer, 0 inputs, 2 outputs (stereo)
    // ZERO memory allocation per frame, ZERO garbage collection, ZERO graph mutation!
    _cleanAudioProcessor = _cleanAudioCtx.createScriptProcessor(2048, 0, 2);

    _cleanAudioProcessor.onaudioprocess = (e) => {
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      const frameCount = outL.length;          // 2048 frames
      const samplesNeeded = frameCount * 2;    // amostras estéreo intercaladas

      // Colchão (jitter buffer): só começa a tocar com ~64 ms acumulados.
      // Se esvaziar (underrun), volta a acumular em vez de ficar picotando bloco a bloco.
      const primeSamples = 3072 * 2;
      if (!_audioPrimed) {
        if (_audioAvailable < primeSamples) {
          outL.fill(0);
          outR.fill(0);
          return;
        }
        _audioPrimed = true;
      }

      // Limite de latência: acima de ~150 ms descarta o excedente (mantém sincronia com o vídeo)
      const maxLatencySamples = 48000 * 2 * 0.15;
      if (_audioAvailable > maxLatencySamples) {
        let excess = _audioAvailable - maxLatencySamples;
        excess -= (excess % 2); // alinha em frame estéreo
        _audioReadIdx = (_audioReadIdx + excess) % AUDIO_RING_CAPACITY;
        _audioAvailable -= excess;
      }

      // Toca o que houver; se faltar, completa com silêncio e reinicia o colchão
      const framesAvail = Math.min(frameCount, _audioAvailable >> 1);
      for (let i = 0; i < framesAvail; i++) {
        outL[i] = _audioRing[_audioReadIdx];
        _audioReadIdx = (_audioReadIdx + 1) % AUDIO_RING_CAPACITY;
        outR[i] = _audioRing[_audioReadIdx];
        _audioReadIdx = (_audioReadIdx + 1) % AUDIO_RING_CAPACITY;
      }
      for (let i = 0; i < framesAvail; i += 16) {
        const a = Math.abs(outL[i]); if (a > _audioOutPeak) _audioOutPeak = a;
      }
      _audioAvailable -= framesAvail * 2;
      if (framesAvail < frameCount) {
        for (let i = framesAvail; i < frameCount; i++) { outL[i] = 0; outR[i] = 0; }
        _audioPrimed = false;
      }
    };

    _cleanAudioProcessor.connect(_cleanAudioDest);
  } catch (e) {
    console.warn('[AudioExclusion] Falha ao criar AudioContext/ScriptProcessor:', e);
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;

    // Signal C++ to start audio capture with the specified PID excluded
    if (window.mdpBridge) {
      if (excludePid > 0) {
        window.mdpBridge.send('startStreamExclude:' + excludePid);
      } else {
        window.mdpBridge.send('startStream');
      }
    }

    const ws = new WebSocket('ws://127.0.0.1:8085');
    _cleanAudioWs = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('[AudioCapture] Conectado ao servidor nativo de áudio (porta 8085)!');
      if (_cleanAudioCtx && _cleanAudioCtx.state === 'suspended') {
        _cleanAudioCtx.resume().catch(() => {});
      }
      if (!settled) {
        settled = true;
        const track = _cleanAudioDest?.stream?.getAudioTracks()[0];
        resolve(track || null);
      }
    };

    // Reconecta sozinho se o socket de áudio cair durante a transmissão
    ws.onclose = function onAudioWsClose(ev) {
      const dead = ev.target;
      if (_cleanAudioWs !== dead || !_cleanAudioCtx) return;
      console.warn('[AudioCapture] Socket de áudio fechou, reconectando...');
      setTimeout(() => {
        if (_cleanAudioWs !== dead || !_cleanAudioCtx) return;
        const n = new WebSocket('ws://127.0.0.1:8085');
        n.binaryType = 'arraybuffer';
        n.onmessage = dead.onmessage;
        n.onclose = onAudioWsClose;
        _cleanAudioWs = n;
      }, 500);
    };

    ws.onerror = (err) => {
      console.warn('[AudioCapture] Servidor de áudio nativo não respondeu:', err);
      if (!settled) {
        settled = true;
        resolve(null);
      }
    };

    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const buf = event.data;
      if (buf.byteLength <= 8) return;

      const view = new DataView(buf);
      if (view.getUint8(0) !== 65) return; // 'A'

      _audioPktCount++;
      const srcRate = view.getUint32(2, false) || 48000;
      const channels = Math.max(1, view.getUint16(6, false) || 2);
      const frames = Math.floor((buf.byteLength - 8) / (4 * channels));
      if (frames === 0) return;

      const f = new Float32Array(buf, 8, frames * channels);
      const ctxRate = _cleanAudioCtx ? _cleanAudioCtx.sampleRate : 48000;

      if (srcRate === ctxRate && channels === 2) {
        // Caminho ultra-otimizado (SIMD bulk copy): zero loop e zero modulo por amostra
        const totalSamples = frames * 2;
        const availableSpace = AUDIO_RING_CAPACITY - _audioAvailable;
        const toWrite = Math.min(totalSamples, availableSpace);
        if (toWrite > 0) {
          const firstChunk = Math.min(toWrite, AUDIO_RING_CAPACITY - _audioWriteIdx);
          _audioRing.set(f.subarray(0, firstChunk), _audioWriteIdx);
          if (toWrite > firstChunk) {
            _audioRing.set(f.subarray(firstChunk, toWrite), 0);
          }
          _audioWriteIdx = (_audioWriteIdx + toWrite) % AUDIO_RING_CAPACITY;
          _audioAvailable += toWrite;
        }
      } else if (srcRate === ctxRate) {
        // Caminho fallback mono
        for (let i = 0; i < frames; i++) {
          const l = f[i * channels];
          _pushAudioFrame(l, channels > 1 ? f[i * channels + 1] : l);
        }
      } else {
        // Defensivo: reamostragem linear se a taxa do pacote for diferente da do AudioContext
        const step = srcRate / ctxRate;
        let p = _rsPos;
        const getL = (k) => k === 0 ? _rsPrevL : f[(k - 1) * channels];
        const getR = (k) => k === 0 ? _rsPrevR : (channels > 1 ? f[(k - 1) * channels + 1] : f[(k - 1) * channels]);
        while (p < frames) {
          const k = Math.floor(p), fr = p - k;
          _pushAudioFrame(getL(k) * (1 - fr) + getL(k + 1) * fr, getR(k) * (1 - fr) + getR(k + 1) * fr);
          p += step;
        }
        _rsPos = p - frames;
        _rsPrevL = f[(frames - 1) * channels];
        _rsPrevR = channels > 1 ? f[(frames - 1) * channels + 1] : _rsPrevL;
      }
    };

    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(_cleanAudioDest?.stream?.getAudioTracks()[0] || null);
      }
    }, 1200);
  });
}


// ─── Diagnóstico de áudio (mostra na tela onde o som se perde) ───────────────
function scheduleAudioDiag() {
  const run = async (label) => {
    if (!isStreaming) return;
    const track = myStream?.getAudioTracks?.()[0];
    let sent = [];
    for (const [pid, c] of Object.entries(activeConnections)) {
      const pc = c.outgoingCall?.peerConnection;
      if (!pc) continue;
      try {
        const aSender = pc.getSenders().find(x => x.track && x.track.kind === 'audio');
        if (!aSender) { sent.push('SEM sender de áudio'); continue; }
        const stats = await aSender.getStats();
        stats.forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'audio') sent.push(r.bytesSent + ' B'); });
      } catch (e) {}
    }
    const msg = `🔎 Áudio [${label}] ctx=${_cleanAudioCtx ? _cleanAudioCtx.state : 'null'} ` +
      `ws=${_cleanAudioWs ? _cleanAudioWs.readyState : 'null'} pacotes=${_audioPktCount} ` +
      `pico=${_audioOutPeak.toFixed(3)} trilha=${track ? track.readyState + (track.muted ? '/muted' : '') : 'NENHUMA'} ` +
      `enviado=${sent.length ? sent.join(',') : 'sem peers'}`;
    console.log(msg);
    showToast(msg, (track && _audioPktCount > 0) ? 'success' : 'error', 9000);
  };
  setTimeout(() => run('4s'), 4000);
  setTimeout(() => run('15s'), 15000);
}

// ─── Audio Apps Picker (receive list from C++) ────────────────────────────────
function handleAudioAppsMessage(data) {
  if (data.type === 'audioAppsList' && Array.isArray(data.apps)) {
    _audioAppsList = data.apps;
    renderAudioAppsList();
  }
}

// Listen for C++ messages via mdpBridge
if (window.mdpBridge) {
  window.mdpBridge.onMessage((data) => {
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch(e) {}
    }
    if (!data || typeof data !== 'object') return;

    if (data.type === 'audioAppsList') {
      handleAudioAppsMessage(data);
    } else if (data.type === 'audioStatus') {
      if (data.state === 'fallback') {
        showToast('⚠️ Não foi possível excluir o app (requer Windows 10 2004+). Transmitindo TODO o som do PC.', 'error');
      } else if (data.state === 'failed') {
        showToast('❌ Falha ao capturar o áudio do PC. Veja %TEMP%\\RoxyRoom_audio.log', 'error');
      } else {
        console.log('[AudioCapture] Status: ' + data.state);
      }
    } else if (data.type === 'hotkeyToggleStream') {
      console.log('[Hotkey] Alt+G ativado globalmente!');
      if (isStreaming) {
        stopStream();
      } else {
        const btn = document.getElementById('startBtn');
        if (btn) btn.click();
      }
    }
  });
}

function requestAudioAppsList() {
  if (window.mdpBridge) {
    window.mdpBridge.send('getAudioApps');
  }
}

function renderAudioAppsList() {
  const container = document.getElementById('audioAppsList');
  if (!container) return;

  if (_audioAppsList.length === 0) {
    container.innerHTML = '<div style="color:#8b949e;padding:20px;text-align:center">Nenhum app com áudio ativo encontrado.<br><small>Abra um app com som (Spotify, Chrome, jogo...) e clique Atualizar.</small></div>';
    return;
  }

  // Pre-select Discord automatically if available and nothing chosen yet
  if (_selectedExcludePid === 0) {
    const discordApp = _audioAppsList.find(a => (a.exe || '').toLowerCase().includes('discord'));
    if (discordApp) {
      _selectedExcludePid = discordApp.pid;
    }
  }

  let html = '';
  // "None" option — no exclusion
  html += `<div class="audio-app-none${_selectedExcludePid === 0 ? ' selected' : ''}" data-pid="0">
    <input type="radio" name="excludeApp" value="0" ${_selectedExcludePid === 0 ? 'checked' : ''}>
    <div class="audio-app-info">
      <span class="audio-app-name" style="color:#3fb950">✅ Nenhum — Capturar Todo Som</span>
      <span class="audio-app-exe">Sem exclusão, transmite todo áudio do PC</span>
    </div>
  </div>`;

  for (const app of _audioAppsList) {
    const isSelected = _selectedExcludePid === app.pid;
    html += `<div class="audio-app-item${isSelected ? ' selected' : ''}" data-pid="${app.pid}">
      <input type="radio" name="excludeApp" value="${app.pid}" ${isSelected ? 'checked' : ''}>
      <div class="audio-app-info">
        <span class="audio-app-name">${escHtml(app.name)}</span>
        <span class="audio-app-exe">${escHtml(app.exe)}</span>
      </div>
      <span class="audio-app-pid">PID ${app.pid}</span>
    </div>`;
  }

  container.innerHTML = html;

  // Add click handlers
  container.querySelectorAll('.audio-app-item, .audio-app-none').forEach(item => {
    item.addEventListener('click', () => {
      const pid = parseInt(item.dataset.pid) || 0;
      _selectedExcludePid = pid;
      // Update selection UI
      container.querySelectorAll('.audio-app-item, .audio-app-none').forEach(el => {
        el.classList.remove('selected');
        el.querySelector('input[type="radio"]').checked = false;
      });
      item.classList.add('selected');
      item.querySelector('input[type="radio"]').checked = true;
    });
  });
}

function openAudioAppsPicker(sourceId) {
  _pendingSourceId = sourceId;
  _selectedExcludePid = 0;
  document.getElementById('audioAppsModal').classList.add('active');
  requestAudioAppsList();
}

async function startStream(sourceId, excludePid) {
  const fps = parseInt(document.getElementById('fpsSelect').value) || 60;
  const targetHeight = parseInt(document.getElementById('resSelect').value) || 1080;
  const targetWidth = Math.round(targetHeight * (16 / 9));
  const audioMode = document.getElementById('audioSelect').value; // 'all', 'exclude', 'false'
  const wantAudio = audioMode !== 'false';
  const useExclusion = audioMode === 'exclude' && excludePid > 0;

  const videoConstraints = {
    frameRate: { ideal: fps, max: fps }
  };
  if (targetHeight < 1080) {
    // Apenas restringe resolução se o usuário explicitamente escolher modo econômico (720p ou 480p)
    videoConstraints.width = { ideal: targetWidth, max: targetWidth };
    videoConstraints.height = { ideal: targetHeight, max: targetHeight };
  } else {
    // 1080p / 1440p / QHD: captura na resolução nativa do jogo sem forçar downscale borrado
    videoConstraints.width = { ideal: targetWidth };
    videoConstraints.height = { ideal: targetHeight };
  }

  let stream = null;
  let cleanAudioTrack = null;

  try {
    if (sourceId === '__camera__') {
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: wantAudio
      });
    } else {
      if (wantAudio && window.mdpBridge) {
        // Use C++ WASAPI loopback for clean audio
        cleanAudioTrack = await initCleanAudioTrack(excludePid || 0);
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: false
        });

        if (cleanAudioTrack) {
          stream.addTrack(cleanAudioTrack);
          if (useExclusion) {
            console.log('[AudioCapture] Áudio com exclusão de PID ' + excludePid + ' ativado!');
            showToast('🔊 Som do PC ativado (App excluído: PID ' + excludePid + ')', 'success');
          } else {
            console.log('[AudioCapture] Áudio completo do PC ativado!');
            showToast('🔊 Som do PC ativado!', 'success');
          }
        } else {
          console.warn('[AudioCapture] Loopback falhou, transmitindo apenas vídeo');
        }
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: wantAudio
        });
      }
    }
  } catch (e) {
    stopCleanAudio();
    if (window.mdpBridge) window.mdpBridge.send('stopStream');
    if (e.name !== 'NotAllowedError') {
      showToast('❌ Falha ao capturar tela: ' + e.message, 'error');
    }
    return;
  }

  myStream = stream;
  isStreaming = true;

  // Ultra-low latency optimization: lock 60fps motion & crystal-clear audio
  try {
    const vTrack = stream.getVideoTracks()[0];
    if (vTrack && 'contentHint' in vTrack) vTrack.contentHint = 'motion';
    const aTrack = stream.getAudioTracks()[0];
    if (aTrack && 'contentHint' in aTrack) aTrack.contentHint = 'music';
  } catch(e) {}

  // Show self preview in video grid
  showMyStreamCard(stream);

  // Notify C++ backend to confirm stream is active (if not already started by initCleanAudioTrack)
  if (window.mdpBridge && !wantAudio) window.mdpBridge.send('startStream');

  // Broadcast to all connected peers in room (one call per peer)
  Object.keys(activeConnections).forEach(peerId => {
    callPeer(peerId, stream);
    if (activeConnections[peerId].dataConn?.open) {
      try { activeConnections[peerId].dataConn.send({ type: 'streamStarted', name: myName }); } catch(e) {}
    }
  });

  if (wantAudio) scheduleAudioDiag();

  // UI state
  const btn = document.getElementById('startBtn');
  btn.classList.add('stop');
  const btnText = document.getElementById('startBtnText');
  if (btnText) btnText.textContent = 'Parar Transmissão';
  else btn.querySelector('span').textContent = '⏹️ Parar Transmissão';
  const stageStatus = document.getElementById('stageTransmissionStatus');
  if (stageStatus) stageStatus.textContent = 'transmitindo •';

  if (settings.streamSound) playBeep();
  showToast('📡 Transmissão iniciada!', 'success');

  // When user stops sharing via browser/system prompt
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    if ('contentHint' in videoTrack) {
      videoTrack.contentHint = 'motion';
    }
    videoTrack.onended = () => stopStream();
  }
}

function stopStream() {
  if (!isStreaming) return;
  isStreaming = false;

  stopCleanAudio();

  if (myStream) {
    myStream.getTracks().forEach(t => t.stop());
    myStream = null;
  }

  const ownCard = document.getElementById('stream-self');
  if (ownCard) {
    if (ownCard._cleanup) ownCard._cleanup();
    ownCard.remove();
  }

  Object.entries(activeConnections).forEach(([peerId, c]) => {
    c._isCalling = false;
    if (c.outgoingCall) {
      try { c.outgoingCall.close(); } catch(e) {}
      delete c.outgoingCall;
    }
    if (c.dataConn?.open) {
      try { c.dataConn.send({ type: 'streamStopped', name: myName }); } catch(e) {}
    }
  });

  if (window.mdpBridge) window.mdpBridge.send('stopStream');

  const btn = document.getElementById('startBtn');
  btn.classList.remove('stop');
  const btnText = document.getElementById('startBtnText');
  if (btnText) btnText.textContent = 'Transmitir minha tela';
  else btn.querySelector('span').textContent = '📹 Transmitir Minha Tela';
  const stageStatus = document.getElementById('stageTransmissionStatus');
  if (stageStatus) stageStatus.textContent = (peer && !peer.destroyed && !peer.disconnected) ? 'conectado •' : 'aguardando transmissão •';

  showToast('⏹️ Transmissão encerrada.');
  updatePlaceholder();
}

function callPeer(peerId, stream) {
  if (!peer || peer.destroyed || !stream) return;
  if (!activeConnections[peerId]) activeConnections[peerId] = {};

  const connInfo = activeConnections[peerId];

  // Strictly prevent duplicate calls: if we already have an active call, do nothing!
  if (connInfo.outgoingCall) {
    const pc = connInfo.outgoingCall.peerConnection;
    if (pc && pc.connectionState !== 'closed' && pc.connectionState !== 'failed') {
      return;
    }
  }

  if (connInfo._isCalling) {
    return;
  }
  connInfo._isCalling = true;

  try {
    console.log(`[WebRTC] Chamando peer ${peerId} para transmitir tela...`);
    const call = peer.call(peerId, stream, { metadata: { name: myName } });
    if (!call) {
      connInfo._isCalling = false;
      return;
    }
    connInfo.outgoingCall = call;

    const targetHeight = parseInt(document.getElementById('resSelect').value) || 720;
    const fps = parseInt(document.getElementById('fpsSelect').value) || 60;
    const rawBitrate = parseInt(document.getElementById('bitrateSelect').value) || 3500000;
    const limitMbps = document.getElementById('limitMbpsToggle')?.checked !== false;
    const totalMaxMbps = parseInt(document.getElementById('mbpsInput')?.value) || 30;

    let targetBitrate = rawBitrate;
    if (limitMbps) {
      const peerCount = Math.max(1, Object.keys(activeConnections).length);
      targetBitrate = Math.min(rawBitrate, Math.floor((totalMaxMbps * 1000000) / peerCount));
    }

    // Prioritize hardware-accelerated video codecs (H.264 / VP8)
    try {
      if (call.peerConnection && typeof RTCRtpSender.getCapabilities === 'function') {
        const caps = RTCRtpSender.getCapabilities('video');
        if (caps && caps.codecs) {
          const h264 = caps.codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264');
          const others = caps.codecs.filter(c => c.mimeType.toLowerCase() !== 'video/h264');
          const sorted = [...h264, ...others];
          call.peerConnection.getTransceivers().forEach(tr => {
            if (tr.sender?.track?.kind === 'video' && typeof tr.setCodecPreferences === 'function') {
              tr.setCodecPreferences(sorted);
            }
          });
        }
      }
    } catch(e) {}

    let currentAdaptedBitrate = targetBitrate;
    let currentScale = 1.0;
    let abrInterval = null;

    const applyBitrate = (customBitrate = null, customScale = null) => {
      try {
        if (call.peerConnection) {
          const bRate = customBitrate !== null ? customBitrate : currentAdaptedBitrate;
          const sScale = customScale !== null ? customScale : currentScale;

          call.peerConnection.getSenders().forEach(sender => {
            if (sender.track && sender.track.kind === 'video') {
              try {
                const params = sender.getParameters();
                if (params && params.encodings && params.encodings.length > 0) {
                  params.encodings[0].maxBitrate = bRate;
                  params.encodings[0].maxFramerate = Math.min(fps, 60);
                  params.encodings[0].networkPriority = 'high';
                  // Balanced: Preserva resolução nítida e detalhes sem pixelar o jogo
                  params.degradationPreference = 'balanced';

                  let finalScale = sScale;
                  const trackSettings = sender.track.getSettings ? sender.track.getSettings() : {};
                  const trackHeight = trackSettings.height || 0;
                  if (trackHeight > targetHeight && targetHeight > 0 && targetHeight < 1080) {
                    finalScale = Math.max(sScale, trackHeight / targetHeight);
                  }
                  params.encodings[0].scaleResolutionDownBy = finalScale;

                  sender.setParameters(params).catch(() => {});
                }
              } catch(e) {}
            }
          });
        }
      } catch(e) {}
    };

    // Dynamic Adaptive Bitrate (ABR): Monitoramento inteligente em tempo real
    // - Rede estável: qualidade máxima cristalina (1080p nativo, alto bitrate).
    // - Rede oscilando/consumindo muito: reduz progressivamente o bitrate para manter a fluidez sem travar.
    // - Rede normalizada: recupera automaticamente a qualidade máxima!
    const startAbrLoop = () => {
      if (abrInterval) clearInterval(abrInterval);
      abrInterval = setInterval(async () => {
        if (!call || !call.peerConnection || call.peerConnection.connectionState === 'closed') {
          clearInterval(abrInterval);
          return;
        }
        try {
          const stats = await call.peerConnection.getStats();
          let rtt = null;
          let fractionLost = 0;

          stats.forEach(report => {
            if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
              if (typeof report.roundTripTime === 'number') rtt = report.roundTripTime;
              if (typeof report.fractionLost === 'number') fractionLost = report.fractionLost;
            } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              if (typeof report.currentRoundTripTime === 'number') rtt = report.currentRoundTripTime;
            }
          });

          // Diagnóstico de estabilidade
          const isCongested = (fractionLost > 0.035) || (rtt !== null && rtt > 0.260);
          const isHealthy = (fractionLost < 0.008) && (rtt === null || rtt < 0.150);

          let updated = false;
          if (isCongested) {
            // Rede sob pressão: reduz suavemente (-15%) com piso seguro de 2.5 Mbps
            const minFloor = 2500000;
            if (currentAdaptedBitrate > minFloor) {
              currentAdaptedBitrate = Math.max(minFloor, Math.floor(currentAdaptedBitrate * 0.85));
              updated = true;
            }
            // Congestionamento grave (> 10% perda): leve ajuste de escala para não travar
            if (fractionLost > 0.10 && currentScale < 1.33) {
              currentScale = 1.33;
              updated = true;
            }
          } else if (isHealthy) {
            // Conexão limpa: retorna para a qualidade máxima cristalina 100% nítida
            if (currentAdaptedBitrate < targetBitrate) {
              currentAdaptedBitrate = Math.min(targetBitrate, Math.floor(currentAdaptedBitrate * 1.15));
              updated = true;
            }
            if (currentScale > 1.0) {
              currentScale = 1.0;
              updated = true;
            }
          }

          if (updated) {
            applyBitrate(currentAdaptedBitrate, currentScale);
          }
        } catch (e) {}
      }, 2000);
    };

    if (call.peerConnection) {
      call.peerConnection.addEventListener('connectionstatechange', () => {
        const state = call.peerConnection?.connectionState;
        if (state === 'connected') {
          connInfo._isCalling = false;
          applyBitrate();
          startAbrLoop();
        } else if (state === 'failed' || state === 'closed') {
          connInfo._isCalling = false;
          if (abrInterval) clearInterval(abrInterval);
          if (connInfo.outgoingCall === call) {
            delete connInfo.outgoingCall;
          }
        }
      });
    }

    call.on('close', () => {
      connInfo._isCalling = false;
      if (abrInterval) clearInterval(abrInterval);
      if (connInfo.outgoingCall === call) {
        delete connInfo.outgoingCall;
      }
    });

    call.on('error', (err) => {
      connInfo._isCalling = false;
      if (abrInterval) clearInterval(abrInterval);
      console.warn(`[WebRTC] Erro na chamada com ${peerId}:`, err);
      if (connInfo.outgoingCall === call) {
        delete connInfo.outgoingCall;
      }
    });

    setTimeout(() => {
      // Only unlock _isCalling if call didn't succeed or establish
      const state = call.peerConnection?.connectionState;
      if (!state || state === 'failed' || state === 'closed') {
        connInfo._isCalling = false;
      }
    }, 5000);
  } catch (e) {
    connInfo._isCalling = false;
    console.error('[WebRTC] Falha ao chamar peer:', e);
  }
}

function handleIncomingCall(call) {
  const peerId = call.peer;
  console.log('[WebRTC] Chamada recebida de:', peerId);

  // Close previous incoming call from same peer if one was open
  if (activeConnections[peerId]?.incomingCall && activeConnections[peerId].incomingCall !== call) {
    try { activeConnections[peerId].incomingCall.close(); } catch(e) {}
  }

  // Answer call to receive remote stream
  call.answer();

  // Zero-latency presentation: bypass Chromium default 100-200ms jitter buffer
  try {
    if (call.peerConnection) {
      call.peerConnection.getReceivers().forEach(r => {
        if ('playoutDelayHint' in r) r.playoutDelayHint = 0;
        if ('jitterBufferTarget' in r) r.jitterBufferTarget = 0;
      });
      call.peerConnection.addEventListener('track', (e) => {
        if (e.receiver) {
          if ('playoutDelayHint' in e.receiver) e.receiver.playoutDelayHint = 0;
          if ('jitterBufferTarget' in e.receiver) e.receiver.jitterBufferTarget = 0;
        }
      });
    }
  } catch(e) {}

  if (!activeConnections[peerId]) activeConnections[peerId] = {};
  activeConnections[peerId].incomingCall = call;

  call.on('stream', (remoteStream) => {
    console.log('[WebRTC] Stream recebido com sucesso de:', peerId, remoteStream);
    const name = activeConnections[peerId]?.name || call.metadata?.name || 'Amigo';

    showRemoteStreamCard(peerId, name, remoteStream);
    showToast(`📺 Recebendo tela de ${name}!`, 'success');
  });

  call.on('close', () => {
    if (activeConnections[peerId]?.streamCard) {
      if (activeConnections[peerId].streamCard._cleanup) activeConnections[peerId].streamCard._cleanup();
      activeConnections[peerId].streamCard.remove();
      delete activeConnections[peerId].streamCard;
    }
    if (activeConnections[peerId]?.incomingCall === call) {
      delete activeConnections[peerId].incomingCall;
    }
    updatePlaceholder();
  });

  call.on('error', (err) => {
    console.warn(`[WebRTC Incoming Error] com ${peerId}:`, err);
    if (activeConnections[peerId]?.incomingCall === call) {
      delete activeConnections[peerId].incomingCall;
    }
  });
}

// ─── Video Grid & Zoom Controls ───────────────────────────────────────────────
function showMyStreamCard(stream) {
  let card = document.getElementById('stream-self');
  if (!card) {
    card = createStreamCard('stream-self', myName + ' (Você)', isHost);
    document.getElementById('videoGrid').prepend(card);
  }
  const video = card.querySelector('video');
  video.srcObject = stream;
  if ('playoutDelayHint' in video) video.playoutDelayHint = 0;
  video.muted = true; // Always mute self to avoid echo
  video.play().catch(() => {});
  updatePlaceholder();

  if (modoDevAtivo) startDevStats(card, video, 'stream-self');
}

function showRemoteStreamCard(peerId, name, stream) {
  let card = document.getElementById('stream-' + peerId);
  if (!card) {
    card = createStreamCard('stream-' + peerId, name, peerId.startsWith(ROOM_PREFIX));
    document.getElementById('videoGrid').appendChild(card);
    if (activeConnections[peerId]) activeConnections[peerId].streamCard = card;
  }
  const video = card.querySelector('video');
  video.srcObject = stream;
  if ('playoutDelayHint' in video) video.playoutDelayHint = 0;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.muted = false;
  video.volume = 0.85;
  if (card._updateVolumeUI) card._updateVolumeUI(0.85, false);

  const unmuteOnGesture = () => {
    video.muted = false;
    if (video.volume === 0) video.volume = 0.85;
    if (card._updateVolumeUI) card._updateVolumeUI(video.volume, false);
    window.removeEventListener('click', unmuteOnGesture);
    window.removeEventListener('keydown', unmuteOnGesture);
    card.removeEventListener('click', unmuteOnGesture);
  };

  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch(err => {
      console.warn('[Video] Play unmuted falhou, aguardando clique para ativar som:', err);
      video.muted = true;
      if (card._updateVolumeUI) card._updateVolumeUI(video.volume, true);
      video.play().then(() => {
        window.addEventListener('click', unmuteOnGesture, { once: true });
        window.addEventListener('keydown', unmuteOnGesture, { once: true });
        card.addEventListener('click', unmuteOnGesture, { once: true });
      }).catch(() => {});
    });
  }
  updatePlaceholder();

  if (modoDevAtivo) startDevStats(card, video, peerId);
}

function toggleFocusStreamCard(targetCard) {
  const grid = document.getElementById('videoGrid');
  if (!grid || !targetCard) return;

  const isCurrentlyFocused = targetCard.classList.contains('focused');

  document.querySelectorAll('.stream-card').forEach(c => {
    c.classList.remove('focused');
    const txt = c.querySelector('.focus-text');
    const ico = c.querySelector('.focus-icon');
    if (txt) txt.textContent = 'Focar';
    if (ico) ico.textContent = '⛶';
  });

  if (isCurrentlyFocused) {
    grid.classList.remove('has-focused');
    showToast('👥 Modo Grade: exibindo todas as telas');
  } else {
    grid.classList.add('has-focused');
    targetCard.classList.add('focused');
    const txt = targetCard.querySelector('.focus-text');
    const ico = targetCard.querySelector('.focus-icon');
    if (txt) txt.textContent = 'Grade';
    if (ico) ico.textContent = '🗗';
    showToast('⛶ Tela Cheia ativada (clique para voltar à grade ou aperte Esc)');
  }
}

function createStreamCard(id, name, isHostUser) {
  const isSelf = id === 'stream-self';
  const card = document.createElement('div');
  card.className = 'stream-card' + (isHostUser ? ' is-host-card' : '') + (isSelf ? ' is-self-card' : '');
  card.id = id;

  card.innerHTML = `
    <!-- Top Header Overlay -->
    <div class="stream-header">
      <div class="stream-header-left">
        <span class="stream-live-chip">
          <span class="stream-live-pulse"></span>
          <span>AO VIVO</span>
        </span>
        <span class="stream-user-tag">${isHostUser ? '👑 ' : ''}${escHtml(name)}</span>
      </div>
      <div class="stream-header-right">
        <button class="player-mini-btn btn-d3d11-card" type="button" title="Abrir no Player Nativo Direct3D 11 (GPU / 0% CPU)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span>D3D11</span>
        </button>
        <button class="player-mini-btn focus-btn" type="button" title="Alternar Tela Cheia / Grade">
          <span class="focus-icon">⛶</span> <span class="focus-text">Focar</span>
        </button>
      </div>
    </div>

    <!-- Video Stream -->
    <video autoplay playsinline webkit-playsinline></video>

    <!-- Center Play/Pause Feedback Animation -->
    <div class="player-center-feedback">
      <div class="feedback-bubble">
        <span class="feedback-icon">⏸</span>
      </div>
    </div>

    <!-- Bottom Media Player Control Bar (YouTube Style) -->
    <div class="stream-player-bar">
      <div class="player-bar-left">
        <!-- Play / Pause Button -->
        <button class="player-ctrl-btn btn-play-pause" type="button" title="Pausar / Reproduzir (Espaço)">
          <svg class="ctrl-icon-play" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <svg class="ctrl-icon-pause" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        </button>

        <!-- Sound & Volume Slider Controls -->
        <div class="player-volume-wrapper">
          <button class="player-ctrl-btn btn-mute-toggle" type="button" title="Silenciar / Ativar Som (M)">
            <svg class="ctrl-icon-vol-high" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${isSelf ? 'display:none;' : ''}"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            <svg class="ctrl-icon-vol-mute" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${isSelf ? 'display:block;' : 'display:none;'}"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          </button>
          <div class="volume-slider-box">
            <input type="range" class="stream-vol-slider" min="0" max="1" step="0.02" value="${isSelf ? '0' : '0.85'}" title="Volume da Transmissão">
            <span class="vol-percent-label">${isSelf ? '0%' : '85%'}</span>
          </div>
        </div>

        <span class="stream-live-chip-mini">
          <span class="live-dot-mini"></span>
          <span>AO VIVO</span>
        </span>
      </div>

      <div class="player-bar-right">
        <!-- Screenshot / Snapshot -->
        <button class="player-ctrl-btn btn-snapshot" type="button" title="Tirar Foto da Tela (Screenshot)">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>

        <!-- Abrir em Janela Separada / Popout -->
        <button class="player-ctrl-btn btn-popout-card" type="button" title="Abrir Transmissão em Janela Separada">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m9 10 2 2 4-4"/></svg>
        </button>

        <!-- Fullscreen / Focus -->
        <button class="player-ctrl-btn btn-fullscreen" type="button" title="Modo Foco / Tela Cheia (F)">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
      </div>
    </div>
  `;

  const video = card.querySelector('video');
  const playPauseBtn = card.querySelector('.btn-play-pause');
  const iconPlay = card.querySelector('.ctrl-icon-play');
  const iconPause = card.querySelector('.ctrl-icon-pause');
  const feedbackEl = card.querySelector('.player-center-feedback');
  const feedbackIcon = card.querySelector('.feedback-icon');

  function showFeedback(iconText) {
    if (!feedbackEl || !feedbackIcon) return;
    feedbackIcon.textContent = iconText;
    feedbackEl.classList.remove('active');
    void feedbackEl.offsetWidth; // Trigger reflow
    feedbackEl.classList.add('active');
    setTimeout(() => { feedbackEl.classList.remove('active'); }, 600);
  }

  // Play / Pause logic
  function togglePlayPause() {
    if (video.paused) {
      video.play().catch(() => {});
      if (iconPlay) iconPlay.style.display = 'none';
      if (iconPause) iconPause.style.display = 'block';
      showFeedback('▶');
      showToast('▶️ Transmissão retomada.');
    } else {
      video.pause();
      if (iconPlay) iconPlay.style.display = 'block';
      if (iconPause) iconPause.style.display = 'none';
      showFeedback('⏸');
      showToast('⏸️ Transmissão pausada.');
    }
  }

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
    });
  }

  // Volume & Mute logic
  let lastVolume = 0.85;
  const muteBtn = card.querySelector('.btn-mute-toggle');
  const volSlider = card.querySelector('.stream-vol-slider');
  const volLabel = card.querySelector('.vol-percent-label');
  const iconVolHigh = card.querySelector('.ctrl-icon-vol-high');
  const iconVolMute = card.querySelector('.ctrl-icon-vol-mute');

  function updateVolumeUI(val, isMuted) {
    if (volSlider) volSlider.value = isMuted ? 0 : val;
    if (volLabel) volLabel.textContent = isMuted ? '0%' : Math.round(val * 100) + '%';
    if (iconVolHigh && iconVolMute) {
      if (isMuted || val === 0) {
        iconVolHigh.style.display = 'none';
        iconVolMute.style.display = 'block';
      } else {
        iconVolHigh.style.display = 'block';
        iconVolMute.style.display = 'none';
      }
    }
  }

  card._updateVolumeUI = updateVolumeUI;
  if (!isSelf) {
    video.volume = 0.85;
    video.muted = false;
    updateVolumeUI(0.85, false);
  } else {
    video.volume = 0;
    video.muted = true;
    updateVolumeUI(0, true);
  }

  if (volSlider) {
    volSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      const val = parseFloat(volSlider.value);
      video.volume = val;
      video.muted = (val === 0);
      if (val > 0) lastVolume = val;
      updateVolumeUI(val, video.muted);
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.muted = !video.muted;
      if (!video.muted && video.volume === 0) {
        video.volume = lastVolume || 0.85;
      }
      updateVolumeUI(video.volume, video.muted);
      showToast(video.muted ? '🔇 Som silenciado' : '🔊 Som ativado');
    });
  }

  // Direct3D 11 Native Player button on card
  // Direct3D 11 / Janela Separada button on card
  const d3d11Btn = card.querySelector('.btn-d3d11-card');
  if (d3d11Btn) {
    d3d11Btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTransmissionPlayer(video, name);
    });
  }

  // Popout button on card
  const popoutBtn = card.querySelector('.btn-popout-card');
  if (popoutBtn) {
    popoutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTransmissionPlayer(video, name);
    });
  }

  // Snapshot / Screenshot capture
  const snapshotBtn = card.querySelector('.btn-snapshot');
  if (snapshotBtn) {
    snapshotBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (!blob) return;
          // Trigger download
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const time = new Date().toISOString().replace(/[:.]/g, '-');
          a.download = `RoxyRoom_Screenshot_${time}.png`;
          a.href = url;
          a.click();
          URL.revokeObjectURL(url);
          showToast('📸 Foto da tela capturada com sucesso!', 'success');
        }, 'image/png');
      } catch (err) {
        showToast('📸 Foto capturada!');
      }
    });
  }

  // Zoom & Pan controls
  let scale = 1, offsetX = 0, offsetY = 0, isDragging = false, startX = 0, startY = 0;
  let downX = 0, downY = 0;
  const zoomLabel = card.querySelector('.zoom-label');

  function applyTransform() {
    video.style.transform = `scale(${scale}) translate(${offsetX / scale}px, ${offsetY / scale}px)`;
    if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + '%';
  }

  const zoomInBtn = card.querySelector('.btn-zoom-in');
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      scale = Math.min(5, scale + 0.25);
      applyTransform();
    });
  }

  const zoomOutBtn = card.querySelector('.btn-zoom-out');
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      scale = Math.max(1, scale - 0.25);
      if (scale <= 1) { offsetX = 0; offsetY = 0; }
      applyTransform();
    });
  }

  const zoomResetBtn = card.querySelector('.btn-zoom-reset');
  if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      scale = 1; offsetX = 0; offsetY = 0;
      applyTransform();
      showToast('🔍 Zoom resetado para 100%');
    });
  }

  // PiP / Janela Flutuante
  const pipBtn = card.querySelector('.btn-pip');
  if (pipBtn) {
    pipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
          await video.requestPictureInPicture();
          showToast('🗗 Picture-in-Picture ativado!');
        } else {
          // Popout window fallback
          const win = window.open('', '_blank', 'width=1280,height=720');
          if (win) {
            const v = win.document.createElement('video');
            v.srcObject = video.srcObject;
            v.style.width = '100%'; v.style.height = '100%'; v.style.objectFit = 'contain';
            v.autoplay = true; v.playsInline = true;
            win.document.body.style.background = '#000';
            win.document.body.style.margin = '0';
            win.document.body.appendChild(v);
            v.play().catch(() => {});
          }
        }
      } catch (err) {
        showToast('🗗 Modo janela separado');
      }
    });
  }

  // Fullscreen / Focus button
  const fsBtn = card.querySelector('.btn-fullscreen');
  if (fsBtn) {
    fsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFocusStreamCard(card);
    });
  }

  const focusBtn = card.querySelector('.focus-btn');
  if (focusBtn) {
    focusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFocusStreamCard(card);
    });
  }

  // Mouse wheel zoom & pan
  card.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(5, Math.max(1, scale + (e.deltaY < 0 ? 0.2 : -0.2)));
    if (scale <= 1) { offsetX = 0; offsetY = 0; }
    applyTransform();
  }, { passive: false });

  card.addEventListener('mousedown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    if (scale <= 1 || e.button !== 0) return;
    isDragging = true;
    startX = e.clientX - offsetX;
    startY = e.clientY - offsetY;
  });

  // Click on video area (not buttons) toggles play/pause or focus
  card.addEventListener('click', (e) => {
    if (e.target.closest('.stream-player-bar') || e.target.closest('.stream-header') || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
      return;
    }
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (dist > 6) return; // Ignore drag operations

    toggleFocusStreamCard(card);
  });

  // Drag handlers
  const onMouseMove = (e) => {
    if (!isDragging) return;
    offsetX = e.clientX - startX;
    offsetY = e.clientY - startY;
    applyTransform();
  };

  const onMouseUp = () => { isDragging = false; };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // Auto-hide control bar on inactivity
  let hideControlsTimer = null;
  const playerBar = card.querySelector('.stream-player-bar');
  const headerOverlay = card.querySelector('.stream-header');

  const onCardMouseMove = () => {
    card.classList.add('user-active');
    clearTimeout(hideControlsTimer);
    hideControlsTimer = setTimeout(() => {
      card.classList.remove('user-active');
    }, 2800);
  };

  const onCardMouseLeave = () => {
    clearTimeout(hideControlsTimer);
    card.classList.remove('user-active');
  };

  card.addEventListener('mousemove', onCardMouseMove);
  card.addEventListener('mouseleave', onCardMouseLeave);

  // Right-click context menu
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    contextTargetPeerId = id;
    const menu = document.getElementById('videoContextMenu');
    menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 150) + 'px';
    menu.classList.add('active');
    menu._resetZoom = () => { scale = 1; offsetX = 0; offsetY = 0; applyTransform(); };
    menu._video = video;
    menu._name = name;
  });

  // Cleanup handler
  card._cleanup = () => {
    if (card.classList.contains('focused')) {
      document.getElementById('videoGrid').classList.remove('has-focused');
    }
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    card.removeEventListener('mousemove', onCardMouseMove);
    card.removeEventListener('mouseleave', onCardMouseLeave);
    clearTimeout(hideControlsTimer);

    const peerId = id.replace('stream-', '');
    if (devStatsIntervals[peerId]) {
      clearInterval(devStatsIntervals[peerId]);
      delete devStatsIntervals[peerId];
    }
    if (video.srcObject) {
      video.srcObject = null;
    }
  };

  return card;
}

function startDevStats(card, video, peerId) {
  if (devStatsIntervals[peerId]) clearInterval(devStatsIntervals[peerId]);
  let lastTime = performance.now();
  let frameCount = 0;
  let lastBytes = 0;
  let lastStatTime = performance.now();

  let statsEl = card.querySelector('.stream-dev-stats');
  if (!statsEl) {
    statsEl = document.createElement('div');
    statsEl.className = 'stream-dev-stats';
    card.appendChild(statsEl);
  }

  devStatsIntervals[peerId] = setInterval(async () => {
    const now = performance.now();
    const elapsed = (now - lastTime) / 1000;
    const fps = Math.round(frameCount / (elapsed || 1));
    frameCount = 0;
    lastTime = now;

    let bitrateStr = '';
    let droppedStr = '';
    const pc = activeConnections[peerId]?.incomingCall?.peerConnection || activeConnections[peerId]?.outgoingCall?.peerConnection;
    if (pc && pc.getStats) {
      try {
        const stats = await pc.getStats();
        stats.forEach(report => {
          if ((report.type === 'inbound-rtp' || report.type === 'outbound-rtp') && report.kind === 'video') {
            const timeDiff = (now - lastStatTime) / 1000;
            const bytes = report.bytesReceived || report.bytesSent || 0;
            if (bytes && lastBytes > 0 && timeDiff > 0) {
              const kbps = Math.round(((bytes - lastBytes) * 8) / (timeDiff * 1000));
              bitrateStr = ` | ${kbps} kbps`;
            }
            lastBytes = bytes;
            if (report.framesDropped !== undefined) {
              droppedStr = ` | Drop: ${report.framesDropped}`;
            }
          }
        });
        lastStatTime = now;
      } catch(e) {}
    }

    statsEl.textContent = `${fps} FPS | ${video.videoWidth || 0}x${video.videoHeight || 0}${bitrateStr}${droppedStr}`;
  }, 1000);

  function countFrame() {
    if (!modoDevAtivo) return;
    frameCount++;
    if (video.srcObject) requestAnimationFrame(countFrame);
  }
  requestAnimationFrame(countFrame);
}

// ─── Source Picker ────────────────────────────────────────────────────────────
async function openSourcePicker() {
  document.getElementById('sourcePickerModal').classList.add('active');
  await loadSources('screens');
}

function startOrPickExclusion(sourceId) {
  const audioMode = document.getElementById('audioSelect').value;
  if (audioMode === 'exclude' && window.mdpBridge) {
    // Open the audio apps picker modal to let user choose which app to exclude
    openAudioAppsPicker(sourceId);
  } else {
    startStream(sourceId, 0);
  }
}

async function loadSources(tab) {
  const grid = document.getElementById('sourceGrid');
  grid.innerHTML = '<div style="color:#8b949e;padding:20px">Carregando opções...</div>';

  if (tab === 'cameras') {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === 'videoinput');
      grid.innerHTML = '';
      if (!cameras.length) {
        grid.innerHTML = '<div style="color:#8b949e;padding:20px">Nenhuma câmera detectada.</div>';
        return;
      }
      cameras.forEach(cam => {
        const card = createSourceCard(cam.deviceId, cam.label || 'Câmera', '📷');
        card.addEventListener('click', () => {
          document.getElementById('sourcePickerModal').classList.remove('active');
          startOrPickExclusion('__camera__');
        });
        grid.appendChild(card);
      });
    } catch (e) {
      grid.innerHTML = '<div style="color:#f85149;padding:20px">Erro ao acessar câmeras.</div>';
    }
    return;
  }

  grid.innerHTML = '';
  const item = createSourceCard('screen_all', tab === 'screens' ? 'Compartilhar Tela Inteira' : 'Compartilhar Janela de Aplicativo', tab === 'screens' ? '🖥️' : '🪟');
  item.addEventListener('click', () => {
    document.getElementById('sourcePickerModal').classList.remove('active');
    startOrPickExclusion(null);
  });
  grid.appendChild(item);
}

function createSourceCard(id, name, emoji) {
  const card = document.createElement('div');
  card.className = 'source-card';
  card.innerHTML = `<div class="source-icon-placeholder">${emoji}</div><div class="source-title">${escHtml(name)}</div>`;
  return card;
}

// ─── User List ────────────────────────────────────────────────────────────────
function updateOrAddUser(peerId, name, isHostUser) {
  const list = document.getElementById('userList');
  if (!list) return;
  const empty = list.querySelector('.empty-list');
  if (empty) empty.remove();

  const isSelf = peerId === myPeerId || name.includes('(Você)');
  const cleanName = name.replace(/\s*\(Você\)\s*/g, '').trim() || 'Usuário';
  const initial = cleanName.charAt(0).toUpperCase() || 'U';

  if (isSelf) {
    // Only the local user can be self
    list.querySelectorAll('.user-item-self').forEach(el => el.remove());
  }

  let li = document.getElementById('user-' + peerId);
  if (!li) {
    li = document.createElement('li');
    li.id = 'user-' + peerId;
    list.appendChild(li);
  }

  li.className = 'user-item' + (isHostUser ? ' is-host-user' : '') + (isSelf ? ' user-item-self' : '');
  li.innerHTML = `
    <div class="user-live-dot"></div>
    <div class="user-avatar-badge ${isHostUser ? 'host-avatar' : 'client-avatar'}">${initial}</div>
    <div class="user-info-col">
      <div class="user-name-line">
        <span class="user-name-text">${escHtml(cleanName)}</span>
        ${isSelf ? '<span class="user-you-tag">· você</span>' : ''}
      </div>
      <span class="user-role-sub">${isHostUser ? 'anfitrião da sala' : 'presente agora'}</span>
    </div>
    ${isHostUser ? '<span class="host-pill-badge">HOST</span>' : ''}
  `;
  updateUserCount();

  // Also update stream card header if present
  const cardId = isSelf ? 'stream-self' : 'stream-' + peerId;
  const card = document.getElementById(cardId);
  if (card) {
    const tag = card.querySelector('.stream-user-tag');
    if (tag) {
      tag.textContent = (isHostUser ? '👑 ' : '') + cleanName + (isSelf ? ' (Você)' : '');
    }
  }
}
const addUserToList = updateOrAddUser;

function removeUserFromList(peerId) {
  const el = document.getElementById('user-' + peerId);
  if (el) el.remove();
  if (document.getElementById('userList').children.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-list';
    li.textContent = 'Ninguém na sala.';
    document.getElementById('userList').appendChild(li);
  }
  updateUserCount();
}

function updateUserCount() {
  const count = document.querySelectorAll('#userList .user-item').length;
  document.getElementById('userCount').textContent = count;
}

function updatePlaceholder() {
  const cards = document.querySelectorAll('.stream-card');
  document.getElementById('emptyPlaceholder').style.display = cards.length ? 'none' : 'flex';
  if (!cards.length) {
    document.getElementById('videoGrid').classList.remove('has-focused');
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const focused = document.querySelector('.stream-card.focused');
    if (focused) {
      toggleFocusStreamCard(focused);
    }
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let _beepCtx = null;
function playBeep() {
  try {
    if (!_beepCtx || _beepCtx.state === 'closed') _beepCtx = new AudioContext();
    const osc = _beepCtx.createOscillator();
    const gain = _beepCtx.createGain();
    osc.connect(gain);
    gain.connect(_beepCtx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, _beepCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _beepCtx.currentTime + 0.25);
    osc.start();
    osc.stop(_beepCtx.currentTime + 0.25);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch {}
}

function generateRoomId() {
  return 'SALA-' + Math.floor(1000 + Math.random() * 9000);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
document.getElementById('createRoomBtn').addEventListener('click', () => {
  const newRoom = generateRoomId();
  document.getElementById('roomId').value = newRoom;
  showToast(`🎲 Novo ID gerado: ${newRoom}`);
});

document.getElementById('copyRoomBtn').addEventListener('click', () => {
  const room = document.getElementById('roomId').value.trim();
  if (!room) {
    showToast('⚠️ Digite ou gere um ID de sala primeiro!', 'warn');
    return;
  }
  navigator.clipboard.writeText(room).then(() => {
    showToast(`📋 ID "${room}" copiado! Envie para seus amigos.`, 'success');
  }).catch(() => {
    showToast(`ID da Sala: ${room}`, 'success');
  });
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
  const room = getCleanRoom(document.getElementById('roomId').value);
  if (!room) {
    showToast('⚠️ Digite o ID da sala para entrar!', 'warn');
    return;
  }

  // If already connected to this room, inform user
  if (peer && !peer.destroyed && !peer.disconnected && currentRoomId === room) {
    showToast(`✅ Você já está conectado na sala ${room}!`, 'success');
    return;
  }

  showToast(`🔄 Conectando à sala ${room}...`);
  joinOrCreateRoom(room, false);
});

document.getElementById('startBtn').addEventListener('click', () => {
  if (isStreaming) {
    stopStream();
    return;
  }

  const room = document.getElementById('roomId').value.trim();
  if (!room) {
    showToast('⚠️ Digite ou gere um ID de sala!', 'warn');
    return;
  }

  if (!peer || peer.destroyed || currentRoomId !== getCleanRoom(room)) {
    joinOrCreateRoom(room, true);
  } else {
    openSourcePicker();
  }
});

document.getElementById('pixBtn').addEventListener('click', () => {
  if (window.mdpBridge) window.mdpBridge.send('openUrl:https://pixmeachave.com');
  else window.open('https://pixmeachave.com', '_blank');
});

document.getElementById('discordBtn').addEventListener('click', () => {
  if (window.mdpBridge) window.mdpBridge.send('openUrl:https://discord.gg/MDPDiscord');
  else window.open('https://discord.gg/MDPDiscord', '_blank');
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.add('active');
});

document.getElementById('profilePresetSelect').addEventListener('change', (e) => {
  const val = e.target.value;
  if (val === 'weak') {
    document.getElementById('resSelect').value = '720';
    document.getElementById('fpsSelect').value = '30';
    document.getElementById('bitrateSelect').value = '2000000';
    showToast('🐢 Conexão Fraca: 720p / 30 FPS / 2.0 Mbps');
  } else if (val === 'balanced') {
    document.getElementById('resSelect').value = '1080';
    document.getElementById('fpsSelect').value = '60';
    document.getElementById('bitrateSelect').value = '6000000';
    showToast('⚖️ Perfil Equilibrado: 1080p / 60 FPS / 6.0 Mbps');
  } else if (val === 'high') {
    document.getElementById('resSelect').value = '1080';
    document.getElementById('fpsSelect').value = '60';
    document.getElementById('bitrateSelect').value = '10000000';
    showToast('🚀 Gamer Ultra: 1080p / 60 FPS / 10 Mbps');
  } else {
    document.getElementById('resSelect').value = '1080';
    document.getElementById('fpsSelect').value = '60';
    document.getElementById('bitrateSelect').value = '8000000';
    showToast('✨ Dinâmico Inteligente: 1080p / 60 FPS / 8.0 Mbps');
  }
});

document.getElementById('closeModalBtn').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.remove('active');
});

document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  saveSettings();
  document.getElementById('settingsModal').classList.remove('active');
  showToast('✅ Configurações salvas!', 'success');
});

document.getElementById('closeSourcePickerBtn').addEventListener('click', () => {
  document.getElementById('sourcePickerModal').classList.remove('active');
});

// Audio Apps Picker modal
document.getElementById('closeAudioAppsBtn').addEventListener('click', () => {
  document.getElementById('audioAppsModal').classList.remove('active');
  _pendingSourceId = null;
});

document.getElementById('refreshAudioAppsBtn').addEventListener('click', () => {
  document.getElementById('audioAppsList').innerHTML = '<div style="color:#8b949e;padding:20px;text-align:center">Atualizando...</div>';
  requestAudioAppsList();
});

document.getElementById('confirmAudioExcludeBtn').addEventListener('click', () => {
  document.getElementById('audioAppsModal').classList.remove('active');
  const sourceId = _pendingSourceId;
  _pendingSourceId = null;
  startStream(sourceId, _selectedExcludePid);
});

document.getElementById('modalFirewallBtn').addEventListener('click', () => {
  if (window.mdpBridge) window.mdpBridge.send('openFirewall');
  showToast('🛡️ Solicitando permissão de firewall do Windows...', '', 2500);
});

document.getElementById('hideToTrayBtn').addEventListener('click', () => {
  if (window.mdpBridge) window.mdpBridge.send('hideToTray');
  showToast('📥 Aplicativo minimizado para a bandeja (perto do relógio).');
});

document.getElementById('quitAppBtn').addEventListener('click', () => {
  if (window.mdpBridge) window.mdpBridge.send('quit');
  else window.close();
});

// Source tabs
document.querySelectorAll('.source-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.source-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadSources(btn.dataset.tab);
  });
});

// Mbps slider
document.getElementById('mbpsRange').addEventListener('input', (e) => {
  document.getElementById('mbpsInput').value = e.target.value;
});
document.getElementById('mbpsInput').addEventListener('input', (e) => {
  document.getElementById('mbpsRange').value = e.target.value;
});

// ─── Dedicated YouTube-Style Transmission Player ─────────────────────────
function openTransmissionPlayer(targetVideo, streamTitle) {
  let video = targetVideo;
  if (!video) {
    const menu = document.getElementById('videoContextMenu');
    if (menu && menu._video) video = menu._video;
    else video = document.querySelector('.stream-card video');
  }

  if (!video || !video.srcObject) {
    showToast('⚠️ Nenhuma transmissão ativa no momento para abrir.', 'error');
    return;
  }

  const stream = video.srcObject;
  const name = streamTitle || (currentRoom ? 'Roxy Room • ' + currentRoom : 'Transmissão Ao Vivo');

  const win = window.open('', '_blank', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no');
  if (!win) {
    showToast('⚠️ Pop-up bloqueado. Permita janelas pop-up para abrir o player.', 'error');
    return;
  }

  win.document.title = 'Roxy Room • ' + name;
  win.document.body.style.margin = '0';
  win.document.body.style.background = '#000';
  win.document.body.style.overflow = 'hidden';
  win.document.body.style.fontFamily = "'Plus Jakarta Sans', -apple-system, sans-serif";

  win.document.body.innerHTML = `
    <div id="ytContainer" style="position:relative; width:100vw; height:100vh; background:#000; display:flex; align-items:center; justify-content:center; overflow:hidden; user-select:none;">
      <video id="ytVideo" autoplay playsinline webkit-playsinline style="width:100%; height:100%; object-fit:contain; background:#000;"></video>

      <!-- Center Play/Pause Ripple -->
      <div id="ytFeedback" style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) scale(0.6); width:68px; height:68px; border-radius:50%; background:rgba(0,0,0,0.7); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; color:#fff; font-size:1.8rem; pointer-events:none; opacity:0; transition:transform 0.22s cubic-bezier(0.16,1,0.3,1), opacity 0.22s; z-index:20;">
        <span id="ytFeedbackIcon">⏸</span>
      </div>

      <!-- Top Overlay Header -->
      <div id="ytTopBar" style="position:absolute; top:0; left:0; right:0; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; background:linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 70%, transparent 100%); z-index:10; transition:opacity 0.25s, transform 0.25s;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="display:inline-flex; align-items:center; gap:6px; background:#ef4444; color:#fff; font-size:0.68rem; font-weight:800; padding:3px 8px; border-radius:4px; letter-spacing:0.5px;">
            <span style="width:6px; height:6px; border-radius:50%; background:#fff;"></span>
            AO VIVO
          </span>
          <span style="color:#f8fafc; font-size:0.92rem; font-weight:700;">${escHtml(name)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="background:rgba(99,102,241,0.2); border:1px solid rgba(129,140,248,0.4); color:#c4b5fd; font-size:0.75rem; font-weight:700; padding:3px 10px; border-radius:6px;">Direct3D 11 GPU • 60 FPS</span>
        </div>
      </div>

      <!-- Bottom YouTube-Style Player Control Bar -->
      <div id="ytBottomBar" style="position:absolute; bottom:0; left:0; right:0; padding:8px 20px 14px 20px; background:linear-gradient(0deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.45) 65%, transparent 100%); z-index:10; display:flex; align-items:center; justify-content:space-between; transition:opacity 0.25s, transform 0.25s;">
        <!-- Left Corner: Play/Pause, Sound/Volume -->
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="ytPlayPauseBtn" style="background:transparent; border:none; color:#f1f5f9; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; outline:none; transition:background 0.2s, transform 0.15s;" title="Reproduzir / Pausar (Espaço)">
            <svg id="ytIconPlay" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <svg id="ytIconPause" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </button>

          <div id="ytVolWrapper" style="display:flex; align-items:center; gap:2px; position:relative;">
            <button id="ytMuteBtn" style="background:transparent; border:none; color:#f1f5f9; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; outline:none; transition:background 0.2s;" title="Silenciar / Ativar Som (M)">
              <svg id="ytIconVolHigh" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              <svg id="ytIconVolMute" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
            </button>
            <div id="ytVolBox" style="width:0; overflow:hidden; display:flex; align-items:center; transition:width 0.25s cubic-bezier(0.16,1,0.3,1), margin 0.2s;">
              <input type="range" id="ytVolSlider" min="0" max="1" step="0.02" value="0.85" style="width:56px; height:3px; accent-color:#ffffff; cursor:pointer;">
              <span id="ytVolLabel" style="color:#cbd5e1; font-size:0.72rem; font-weight:700; margin-left:6px; min-width:28px;">85%</span>
            </div>
          </div>
        </div>

        <!-- Right Corner: Screenshot, Zoom Reset, Fullscreen -->
        <div style="display:flex; align-items:center; gap:8px;">
          <button id="ytSnapshotBtn" style="background:transparent; border:none; color:#cbd5e1; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background 0.2s, transform 0.15s;" title="Tirar Foto (Screenshot)">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>

          <button id="ytResetZoomBtn" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; padding:4px 8px; border-radius:12px; font-size:0.72rem; font-weight:700; cursor:pointer; transition:all 0.2s;" title="Resetar Zoom">
            100%
          </button>

          <button id="ytFullscreenBtn" style="background:transparent; border:none; color:#cbd5e1; width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background 0.2s;" title="Tela Cheia (F)">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;

  const popVideo = win.document.getElementById('ytVideo');
  popVideo.srcObject = stream;
  popVideo.volume = 0.85;
  popVideo.muted = false;
  popVideo.play().catch(() => {});

  const origMuted = video.muted;
  video.muted = true;
  win.addEventListener('beforeunload', () => {
    video.muted = origMuted;
  });

  const styleEl = win.document.createElement('style');
  styleEl.textContent = `
    button:hover { background: rgba(255,255,255,0.18) !important; color:#fff !important; transform: scale(1.08); }
    button:active { transform: scale(0.95); }
    #ytVolWrapper:hover #ytVolBox, #ytVolBox:focus-within { width: 95px !important; margin-left: 6px !important; }
    .idle-hide { cursor: none !important; }
    .idle-hide #ytTopBar, .idle-hide #ytBottomBar { opacity: 0 !important; pointer-events: none !important; }
    .idle-hide #ytTopBar { transform: translateY(-10px) !important; }
    .idle-hide #ytBottomBar { transform: translateY(10px) !important; }
  `;
  win.document.head.appendChild(styleEl);

  const container = win.document.getElementById('ytContainer');
  const playPauseBtn = win.document.getElementById('ytPlayPauseBtn');
  const iconPlay = win.document.getElementById('ytIconPlay');
  const iconPause = win.document.getElementById('ytIconPause');
  const muteBtn = win.document.getElementById('ytMuteBtn');
  const iconVolHigh = win.document.getElementById('ytIconVolHigh');
  const iconVolMute = win.document.getElementById('ytIconVolMute');
  const volSlider = win.document.getElementById('ytVolSlider');
  const volLabel = win.document.getElementById('ytVolLabel');
  const feedback = win.document.getElementById('ytFeedback');
  const feedbackIcon = win.document.getElementById('ytFeedbackIcon');
  const fsBtn = win.document.getElementById('ytFullscreenBtn');
  const snapshotBtn = win.document.getElementById('ytSnapshotBtn');
  const resetZoomBtn = win.document.getElementById('ytResetZoomBtn');

  function showPopFeedback(icon) {
    if (!feedback || !feedbackIcon) return;
    feedbackIcon.textContent = icon;
    feedback.style.opacity = '1';
    feedback.style.transform = 'translate(-50%,-50%) scale(1.15)';
    setTimeout(() => {
      feedback.style.opacity = '0';
      feedback.style.transform = 'translate(-50%,-50%) scale(0.6)';
    }, 500);
  }

  function togglePlay() {
    if (popVideo.paused) {
      popVideo.play().catch(() => {});
      iconPlay.style.display = 'none';
      iconPause.style.display = 'block';
      showPopFeedback('▶');
    } else {
      popVideo.pause();
      iconPlay.style.display = 'block';
      iconPause.style.display = 'none';
      showPopFeedback('⏸');
    }
  }

  playPauseBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
  popVideo.addEventListener('click', togglePlay);

  let lastVol = 0.85;
  function updateVol(val, isMute) {
    volSlider.value = isMute ? 0 : val;
    volLabel.textContent = isMute ? '0%' : Math.round(val * 100) + '%';
    if (isMute || val === 0) {
      iconVolHigh.style.display = 'none';
      iconVolMute.style.display = 'block';
    } else {
      iconVolHigh.style.display = 'block';
      iconVolMute.style.display = 'none';
    }
  }

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    popVideo.muted = !popVideo.muted;
    if (!popVideo.muted && popVideo.volume === 0) popVideo.volume = lastVol || 0.85;
    updateVol(popVideo.volume, popVideo.muted);
  });

  volSlider.addEventListener('input', (e) => {
    e.stopPropagation();
    const v = parseFloat(volSlider.value);
    popVideo.volume = v;
    popVideo.muted = (v === 0);
    if (v > 0) lastVol = v;
    updateVol(v, popVideo.muted);
  });

  snapshotBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      const c = win.document.createElement('canvas');
      c.width = popVideo.videoWidth || 1280;
      c.height = popVideo.videoHeight || 720;
      const ctx = c.getContext('2d');
      ctx.drawImage(popVideo, 0, 0, c.width, c.height);
      const a = win.document.createElement('a');
      a.download = 'RoxyRoom_Captura_' + Date.now() + '.png';
      a.href = c.toDataURL('image/png');
      a.click();
      showPopFeedback('📸');
    } catch(err) {}
  });

  function toggleFs() {
    if (!win.document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      win.document.exitFullscreen().catch(() => {});
    }
  }
  fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
  popVideo.addEventListener('dblclick', (e) => { e.stopPropagation(); toggleFs(); });

  let zoomLevel = 1.0;
  resetZoomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (zoomLevel >= 2.0) zoomLevel = 1.0;
    else zoomLevel += 0.5;
    popVideo.style.transform = zoomLevel > 1.0 ? 'scale(' + zoomLevel + ')' : 'none';
    resetZoomBtn.textContent = Math.round(zoomLevel * 100) + '%';
  });

  let idleTimer = null;
  function resetIdle() {
    container.classList.remove('idle-hide');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      container.classList.add('idle-hide');
    }, 2500);
  }
  container.addEventListener('mousemove', resetIdle);
  resetIdle();

  win.addEventListener('keydown', (e) => {
    resetIdle();
    if (e.code === 'Space' || e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFs();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      popVideo.muted = !popVideo.muted;
      updateVol(popVideo.volume, popVideo.muted);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      popVideo.volume = Math.min(1, popVideo.volume + 0.05);
      popVideo.muted = false;
      lastVol = popVideo.volume;
      updateVol(popVideo.volume, false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      popVideo.volume = Math.max(0, popVideo.volume - 0.05);
      if (popVideo.volume === 0) popVideo.muted = true;
      updateVol(popVideo.volume, popVideo.muted);
    }
  });

  showToast('🚀 Transmissão aberta no Player com sucesso!', 'success');
}

// Global button to open active transmission in player
document.getElementById('openNativePlayerBtn')?.addEventListener('click', () => {
  const activeVideo = document.querySelector('.stream-card video');
  if (activeVideo) {
    openTransmissionPlayer(activeVideo, 'Transmissão Ao Vivo');
  } else {
    showToast('⚠️ Nenhuma transmissão ativa no momento.', 'error');
  }
});

// Context Menu: Abrir no Player Nativo Direct3D 11
document.getElementById('nativePlayerContextBtn')?.addEventListener('click', () => {
  const menu = document.getElementById('videoContextMenu');
  openTransmissionPlayer(menu?._video, menu?._name || 'Transmissão Ao Vivo');
  if (menu) menu.classList.remove('active');
});

// Context Menu: Abrir em Janela Separada
document.getElementById('popoutContextBtn')?.addEventListener('click', () => {
  const menu = document.getElementById('videoContextMenu');
  openTransmissionPlayer(menu?._video, menu?._name || 'Transmissão Ao Vivo');
  if (menu) menu.classList.remove('active');
});

document.getElementById('resetZoomContextBtn').addEventListener('click', () => {
  const menu = document.getElementById('videoContextMenu');
  if (menu._resetZoom) menu._resetZoom();
  menu.classList.remove('active');
});

document.getElementById('closeContextBtn').addEventListener('click', () => {
  const menu = document.getElementById('videoContextMenu');
  if (contextTargetPeerId === 'stream-self') {
    stopStream();
  } else if (contextTargetPeerId) {
    const peerId = contextTargetPeerId.replace('stream-', '');
    const card = document.getElementById(contextTargetPeerId);
    if (card) card.remove();
    if (activeConnections[peerId]?.incomingCall) {
      try { activeConnections[peerId].incomingCall.close(); } catch(e) {}
      delete activeConnections[peerId].incomingCall;
    }
  }
  menu.classList.remove('active');
  updatePlaceholder();
});

document.addEventListener('click', (e) => {
  const menu = document.getElementById('videoContextMenu');
  if (!menu.contains(e.target)) menu.classList.remove('active');
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});

// Hotkeys
document.addEventListener('keydown', (e) => {
  if (e.altKey && (e.key === 'g' || e.key === 'G')) {
    if (isStreaming) stopStream();
    else document.getElementById('startBtn').click();
  }
});

// Dynamic inputs and Roxy Room controls
document.getElementById('usernameInput')?.addEventListener('input', () => {
  updateAvatar();
  saveSettings();
});

document.getElementById('roomId')?.addEventListener('input', () => {
  const room = document.getElementById('roomId').value.trim();
  const headerRoom = document.getElementById('headerRoomText');
  if (headerRoom) headerRoom.textContent = room || 'SALA-6863';
  const stageRoom = document.getElementById('stageRoomDisplay');
  if (stageRoom) stageRoom.textContent = room || 'SALA-6863';
});

document.getElementById('igniteStageBtn')?.addEventListener('click', () => {
  document.getElementById('startBtn')?.click();
});

document.getElementById('stageConfigBtn')?.addEventListener('click', () => {
  document.getElementById('settingsBtn')?.click();
});

document.getElementById('stageFullscreenBtn')?.addEventListener('click', () => {
  const focused = document.querySelector('.stream-card.focused');
  if (focused) {
    toggleFocusStreamCard(focused);
  } else {
    const firstCard = document.querySelector('.stream-card');
    if (firstCard) {
      toggleFocusStreamCard(firstCard);
    } else {
      const stageBox = document.querySelector('.stage-card-container');
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else if (stageBox && stageBox.requestFullscreen) {
        stageBox.requestFullscreen().catch(() => {});
      }
    }
  }
});

// ─── Initial Startup ──────────────────────────────────────────────────────────
loadSettings();
updatePlaceholder();

// Automatically host/register the current room on startup
const startupRoom = document.getElementById('roomId').value.trim() || generateRoomId();
document.getElementById('roomId').value = startupRoom;
joinOrCreateRoom(startupRoom, false);

// ─── Automated GitHub Auto-Updater System ──────────────────────────────────
const CURRENT_VERSION = '1.1.2';
const GITHUB_REPO = 'mariocesarflore/Roxy-Room';

function parseSemver(v) {
  return (v || '').replace(/^[vV]/, '').split('.').map(n => parseInt(n, 10) || 0);
}

function isNewerVersion(remote, local) {
  const r = parseSemver(remote);
  const l = parseSemver(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function checkForUpdates(silent = true) {
  try {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/version.json?t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
      if (!silent) showToast('ℹ️ Não foi possível consultar o servidor de atualizações do GitHub.', 'error');
      return;
    }
    const data = await res.json();
    if (data && data.version && isNewerVersion(data.version, CURRENT_VERSION)) {
      showUpdateNotification(data);
    } else {
      if (!silent) {
        showToast(`✅ O Roxy Room já está na versão mais recente (v${CURRENT_VERSION})!`, 'success');
      }
    }
  } catch (err) {
    if (!silent) showToast('ℹ️ Erro ao verificar atualizações: ' + (err.message || 'Falha de conexão'), 'error');
  }
}

function showUpdateNotification(data) {
  if (document.getElementById('updateNotificationBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'updateNotificationBanner';
  banner.style.cssText = `
    position: fixed;
    top: 20px;
    right: 24px;
    z-index: 99999;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 27, 75, 0.98));
    border: 1.5px solid rgba(129, 140, 248, 0.5);
    border-radius: 14px;
    padding: 16px 20px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.85), 0 0 25px rgba(99, 102, 241, 0.35);
    color: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 380px;
    animation: slideInBanner 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  banner.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:1.2rem;">🚀</span>
        <strong style="font-size:0.95rem; color:#c4b5fd;">Nova Versão Disponível!</strong>
      </div>
      <span style="font-size:0.75rem; background:rgba(99,102,241,0.25); border:1px solid rgba(129,140,248,0.4); color:#a5b4fc; padding:2px 8px; border-radius:10px; font-weight:800;">v${escHtml(data.version)}</span>
    </div>
    <p style="font-size:0.8rem; color:#94a3b8; margin:0; line-height:1.45;">${escHtml(data.changelog || 'Novas melhorias e correções disponíveis no Roxy Room.')}</p>
    <div style="display:flex; gap:8px; margin-top:4px;">
      <button id="btnConfirmAutoUpdate" style="flex:1; background:linear-gradient(135deg, #6366f1, #8b5cf6); border:none; color:#fff; font-size:0.82rem; font-weight:700; padding:8px 14px; border-radius:8px; cursor:pointer; box-shadow:0 2px 10px rgba(99,102,241,0.4); transition:all 0.2s;">
        Atualizar Automaticamente
      </button>
      <button id="btnDismissUpdate" style="background:rgba(255,255,255,0.08); border:none; color:#cbd5e1; font-size:0.82rem; font-weight:600; padding:8px 12px; border-radius:8px; cursor:pointer;">
        Depois
      </button>
    </div>
  `;

  document.body.appendChild(banner);

  banner.querySelector('#btnConfirmAutoUpdate').addEventListener('click', () => {
    banner.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; padding:6px 0;">
        <span style="font-size:1.3rem;">⏳</span>
        <div>
          <strong style="font-size:0.9rem; color:#c4b5fd;">Baixando e atualizando o Roxy Room...</strong>
          <p style="font-size:0.75rem; color:#94a3b8; margin:3px 0 0 0;">O app reiniciará automaticamente na nova versão.</p>
        </div>
      </div>
    `;
    if (window.mdpBridge) {
      window.mdpBridge.send('startUpdate:' + (data.downloadUrl || ''));
    } else {
      showToast('ℹ️ Atualização nativa disponível no executável Windows.');
      setTimeout(() => banner.remove(), 4000);
    }
  });

  banner.querySelector('#btnDismissUpdate').addEventListener('click', () => {
    banner.remove();
  });
}

// Update Bridge notifications from C++
if (window.mdpBridge) {
  window.mdpBridge.onMessage((raw) => {
    try {
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (data.type === 'updateProgress') {
        showToast('📥 Baixando arquivos da nova versão...', 'info');
      } else if (data.type === 'updateReady') {
        showToast('✨ Atualização pronta! Reiniciando o Roxy Room...', 'success');
      } else if (data.type === 'updateFailed') {
        showToast('❌ Falha ao baixar a atualização. Tente novamente mais tarde.', 'error');
        const b = document.getElementById('updateNotificationBanner');
        if (b) b.remove();
      }
    } catch(e) {}
  });
}

// Hook up "Verificar Atualizações" in settings modal
document.getElementById('checkUpdateBtn')?.addEventListener('click', () => {
  showToast('🔍 Verificando se há atualizações no GitHub...', 'info');
  checkForUpdates(false);
});

const versionBadge = document.getElementById('updateVersionBadge');
if (versionBadge) versionBadge.textContent = 'v' + CURRENT_VERSION;

// Check updates automatically 3.5s after startup
setTimeout(() => {
  checkForUpdates(true);
}, 3500);

// And check every 45 minutes
setInterval(() => {
  checkForUpdates(true);
}, 45 * 60 * 1000);

