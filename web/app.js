'use strict';

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const videoEl = document.getElementById('streamVideo');
const statusBadge = document.getElementById('statusBadge');
const roomTag = document.getElementById('roomTag');
const hubOverlay = document.getElementById('hubOverlay');
const roomInput = document.getElementById('roomInput');
const btnConnect = document.getElementById('btnConnect');
const audioToggleBtn = document.getElementById('audioToggleBtn');
const volumeSlider = document.getElementById('volumeSlider');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const changeRoomBtn = document.getElementById('changeRoomBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const leaveHeaderBtn = document.getElementById('leaveHeaderBtn');
const unmuteOverlay = document.getElementById('unmuteOverlay');
const viewportArea = document.getElementById('viewportArea');

// ─── Configuration ───────────────────────────────────────────────────────────
const PEER_HOST = '0.peerjs.com';
const PEER_PORT = 443;
const PEER_PATH = '/';
const PEER_SECURE = true;
const ROOM_PREFIX = 'roxy-v2-';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
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
let currentRoom = '';
let myPeerId = null;
let currentCall = null;
let currentDataConn = null;
let reconnectTimer = null;
let requestStreamInterval = null;

// ─── Safe Storage Helpers (Handles Discord iframe sandbox security restrictions) ─
function safeGetStorage(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function safeSetStorage(key, val) {
  try { localStorage.setItem(key, val); } catch (e) {}
}
function safeRemoveStorage(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}

function sanitizeRoom(raw) {
  return (raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

function getInitialRoom() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const qRoom = urlParams.get('room');
    if (qRoom) return sanitizeRoom(qRoom);

    const hash = window.location.hash.replace('#', '');
    if (hash && (hash.startsWith('SALA-') || hash.startsWith('ROXY-') || hash.startsWith('MDP-') || hash.length <= 15)) {
      return sanitizeRoom(hash);
    }
  } catch (e) {}

  return sanitizeRoom(safeGetStorage('roxy-player-last-room') || safeGetStorage('mdp-player-last-room') || '');
}

// ─── Connect to Room ──────────────────────────────────────────────────────────
function connectToRoom(room) {
  const clean = sanitizeRoom(room);
  if (!clean) {
    showHub();
    return;
  }

  currentRoom = clean;
  safeSetStorage('roxy-player-last-room', clean);
  if (roomInput) roomInput.value = clean;
  if (roomTag) {
    roomTag.textContent = 'SALA: ' + clean;
    roomTag.style.display = 'inline-flex';
  }
  if (leaveHeaderBtn) leaveHeaderBtn.style.display = 'inline-flex';
  if (leaveRoomBtn) leaveRoomBtn.style.display = 'inline-flex';
  if (statusBadge) {
    statusBadge.textContent = 'Conectando ao Servidor...';
    statusBadge.className = 'status-badge';
  }
  if (hubOverlay) hubOverlay.style.display = 'none';

  cleanupConnection();

  const opts = {
    host: PEER_HOST, port: PEER_PORT, path: PEER_PATH, secure: PEER_SECURE,
    config: { iceServers: ICE_SERVERS }
  };

  try {
    peer = new Peer(opts);
  } catch (e) {
    console.error('Peer creation error:', e);
    if (statusBadge) statusBadge.textContent = 'Erro ao inicializar';
    return;
  }

  peer.on('open', (id) => {
    myPeerId = id;
    const hostPeerId = ROOM_PREFIX + clean;
    if (statusBadge) statusBadge.textContent = 'Conectando ao Streamer...';

    // Connect to Host
    try {
      const conn = peer.connect(hostPeerId, { metadata: { name: 'Discord Activity' } });
      currentDataConn = conn;

      const handleDataOpen = () => {
        if (statusBadge && (!videoEl || !videoEl.srcObject)) {
          statusBadge.textContent = '🟢 Conectado (Aguardando Vídeo)';
          statusBadge.className = 'status-badge connected';
        }
        try {
          conn.send({ type: 'join', name: 'Discord Activity', peerId: myPeerId });
          conn.send({ type: 'requestStream', peerId: myPeerId });
        } catch (e) {}

        // Periodically ping for stream if video hasn't loaded yet
        if (requestStreamInterval) clearInterval(requestStreamInterval);
        requestStreamInterval = setInterval(() => {
          if (videoEl && videoEl.srcObject) {
            clearInterval(requestStreamInterval);
            requestStreamInterval = null;
          } else if (conn && conn.open) {
            try { conn.send({ type: 'requestStream', peerId: myPeerId }); } catch (e) {}
          }
        }, 2500);
      };

      if (conn.open) {
        handleDataOpen();
      } else {
        conn.on('open', handleDataOpen);
      }

      conn.on('data', (data) => {
        if (!data) return;
        if (data.type === 'streamStopped') {
          if (statusBadge) {
            statusBadge.textContent = 'Transmissão Pausada';
            statusBadge.className = 'status-badge';
          }
          if (videoEl) videoEl.srcObject = null;
        } else if (data.type === 'streamStarted') {
          try { conn.send({ type: 'requestStream', peerId: myPeerId }); } catch (e) {}
        }
      });

      conn.on('close', () => {
        if (statusBadge && (!videoEl || !videoEl.srcObject)) {
          statusBadge.textContent = 'Aguardando Início no App...';
          statusBadge.className = 'status-badge';
        }
      });

      conn.on('error', (err) => {
        console.warn('Data connection error:', err);
      });
    } catch (e) {
      console.error('Peer connect error:', e);
    }
  });

  peer.on('call', (call) => {
    if (currentCall && currentCall !== call) {
      try { currentCall.close(); } catch (e) {}
    }
    currentCall = call;

    call.answer(); // Answer to receive video/audio stream
    
    call.on('stream', (remoteStream) => {
      console.log('[WebRTC] Stream recebido!', remoteStream);
      if (requestStreamInterval) {
        clearInterval(requestStreamInterval);
        requestStreamInterval = null;
      }

      if (videoEl) {
        if (videoEl.srcObject !== remoteStream) {
          videoEl.srcObject = remoteStream;
        }
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('webkit-playsinline', '');
        videoEl.volume = parseFloat(volumeSlider ? volumeSlider.value : 1) || 1;
        
        // Start muted so play() is guaranteed to NEVER fail on any browser or sandbox
        videoEl.muted = true;
        videoEl.play().then(() => {
          if (statusBadge) {
            statusBadge.textContent = '🟢 Transmitindo Ao Vivo';
            statusBadge.className = 'status-badge connected';
          }
          // Try unmuting immediately; if allowed by browser gesture, sound turns on seamlessly
          videoEl.muted = false;
          const unmuteTest = videoEl.play();
          if (unmuteTest !== undefined) {
            unmuteTest.then(() => {
              if (audioToggleBtn) {
                audioToggleBtn.textContent = '🔊 Áudio Ativo';
                audioToggleBtn.classList.add('active');
              }
              if (unmuteOverlay) unmuteOverlay.style.display = 'none';
            }).catch(() => {
              videoEl.muted = true;
              videoEl.play().catch(() => {});
              if (audioToggleBtn) {
                audioToggleBtn.textContent = '🔇 Clicar p/ Áudio';
                audioToggleBtn.classList.remove('active');
              }
              if (unmuteOverlay) unmuteOverlay.style.display = 'flex';
            });
          }
        }).catch((err) => {
          console.error('[WebRTC] Erro ao reproduzir video:', err);
        });
      }
    });

    call.on('close', () => {
      if (currentCall === call) {
        currentCall = null;
        if (videoEl) videoEl.srcObject = null;
        if (unmuteOverlay) unmuteOverlay.style.display = 'none';
        if (statusBadge) {
          statusBadge.textContent = 'Transmissão Encerrada';
          statusBadge.className = 'status-badge';
        }
      }
    });

    call.on('error', (err) => {
      console.warn('Media call error:', err);
    });
  });

  peer.on('disconnected', () => {
    if (currentRoom) {
      if (statusBadge) {
        statusBadge.textContent = 'Reconectando...';
        statusBadge.className = 'status-badge';
      }
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (peer && !peer.destroyed) {
            peer.reconnect();
          }
        }, 2000);
      }
    }
  });

  peer.on('error', (err) => {
    console.warn('PeerJS error:', err);
    if (err.type === 'peer-unavailable') {
      if (statusBadge && (!videoEl || !videoEl.srcObject)) {
        statusBadge.textContent = 'Aguardando Início no App...';
      }
      if (!reconnectTimer && currentRoom) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (peer && !peer.destroyed && currentRoom) {
            const hostPeerId = ROOM_PREFIX + currentRoom;
            try {
              const conn = peer.connect(hostPeerId, { metadata: { name: 'Discord Activity' } });
              currentDataConn = conn;
              conn.on('open', () => {
                if (statusBadge && (!videoEl || !videoEl.srcObject)) {
                  statusBadge.textContent = '🟢 Conectado (Aguardando Vídeo)';
                  statusBadge.className = 'status-badge connected';
                }
                try {
                  conn.send({ type: 'join', name: 'Discord Activity', peerId: myPeerId });
                  conn.send({ type: 'requestStream', peerId: myPeerId });
                } catch (e) {}
              });
              conn.on('data', (data) => {
                if (data && data.type === 'streamStopped') {
                  if (statusBadge) {
                    statusBadge.textContent = 'Transmissão Pausada';
                    statusBadge.className = 'status-badge';
                  }
                  if (videoEl) videoEl.srcObject = null;
                }
              });
            } catch (e) {}
          }
        }, 3000);
      }
    }
  });
}

function cleanupConnection() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (requestStreamInterval) {
    clearInterval(requestStreamInterval);
    requestStreamInterval = null;
  }
  if (currentCall) {
    try { currentCall.close(); } catch (e) {}
    currentCall = null;
  }
  if (currentDataConn) {
    try { currentDataConn.close(); } catch (e) {}
    currentDataConn = null;
  }
  if (peer) {
    try { peer.destroy(); } catch (e) {}
    peer = null;
  }
}

function showHub() {
  cleanupConnection();
  currentRoom = '';
  safeRemoveStorage('roxy-player-last-room');
  safeRemoveStorage('mdp-player-last-room');
  if (videoEl) videoEl.srcObject = null;
  if (unmuteOverlay) unmuteOverlay.style.display = 'none';
  if (hubOverlay) hubOverlay.style.display = 'flex';
  if (roomTag) roomTag.style.display = 'none';
  if (leaveHeaderBtn) leaveHeaderBtn.style.display = 'none';
  if (leaveRoomBtn) leaveRoomBtn.style.display = 'none';
  if (statusBadge) {
    statusBadge.textContent = 'Aguardando Sala';
    statusBadge.className = 'status-badge';
  }
  try {
    const url = new URL(window.location);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.pathname);
  } catch (e) {}
  if (roomInput) {
    roomInput.value = '';
    roomInput.focus();
  }
}

// ─── Button Actions & Event Handlers ──────────────────────────────────────────
if (btnConnect) {
  btnConnect.addEventListener('click', () => {
    const val = roomInput ? roomInput.value.trim() : '';
    if (val) connectToRoom(val);
  });
}

if (roomInput) {
  roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = roomInput.value.trim();
      if (val) connectToRoom(val);
    }
  });
}

if (leaveRoomBtn) leaveRoomBtn.addEventListener('click', showHub);
if (leaveHeaderBtn) leaveHeaderBtn.addEventListener('click', showHub);
if (changeRoomBtn) changeRoomBtn.addEventListener('click', showHub);

function unmuteAudio() {
  if (videoEl && videoEl.srcObject) {
    videoEl.muted = false;
    videoEl.volume = parseFloat(volumeSlider ? volumeSlider.value : 1) || 1;
    videoEl.play().catch(() => {});
    if (audioToggleBtn) {
      audioToggleBtn.textContent = '🔊 Áudio Ativo';
      audioToggleBtn.classList.add('active');
    }
    if (unmuteOverlay) unmuteOverlay.style.display = 'none';
    if (statusBadge && statusBadge.textContent.includes('Toque')) {
      statusBadge.textContent = '🟢 Transmitindo Ao Vivo';
    }
  }
}

if (unmuteOverlay) unmuteOverlay.addEventListener('click', unmuteAudio);
if (viewportArea) {
  viewportArea.addEventListener('click', (e) => {
    if (videoEl && videoEl.muted && videoEl.srcObject && e.target !== leaveRoomBtn && e.target !== changeRoomBtn) {
      unmuteAudio();
    }
  });
}

if (audioToggleBtn) {
  audioToggleBtn.addEventListener('click', () => {
    if (!videoEl) return;
    videoEl.muted = !videoEl.muted;
    if (!videoEl.muted) {
      videoEl.volume = parseFloat(volumeSlider ? volumeSlider.value : 1) || 1;
      audioToggleBtn.textContent = '🔊 Áudio Ativo';
      audioToggleBtn.classList.add('active');
      if (unmuteOverlay) unmuteOverlay.style.display = 'none';
    } else {
      audioToggleBtn.textContent = '🔇 Áudio Mutado';
      audioToggleBtn.classList.remove('active');
    }
  });
}

if (volumeSlider) {
  volumeSlider.addEventListener('input', () => {
    if (!videoEl) return;
    videoEl.volume = parseFloat(volumeSlider.value);
    if (videoEl.muted && volumeSlider.value > 0) {
      videoEl.muted = false;
      if (audioToggleBtn) {
        audioToggleBtn.textContent = '🔊 Áudio Ativo';
        audioToggleBtn.classList.add('active');
      }
      if (unmuteOverlay) unmuteOverlay.style.display = 'none';
    }
  });
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
}

// Wheel zoom
let scale = 1, offsetX = 0, offsetY = 0, isDragging = false, startX = 0, startY = 0;
if (videoEl) {
  videoEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(5, Math.max(1, scale + (e.deltaY < 0 ? 0.2 : -0.2)));
    if (scale <= 1) { offsetX = 0; offsetY = 0; }
    videoEl.style.transform = `scale(${scale}) translate(${offsetX / scale}px, ${offsetY / scale}px)`;
  }, { passive: false });
}

// ─── Initialize ───────────────────────────────────────────────────────────────
const initial = getInitialRoom();
if (initial) {
  connectToRoom(initial);
} else {
  showHub();
}

