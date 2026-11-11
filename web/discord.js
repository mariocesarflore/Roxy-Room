'use strict';

(function () {
  const STORAGE_KEY = 'roxy-discord-state-v1';

  // Configuração interna do App Roxy Room no Discord Developer Portal.
  // O usuário final não precisa preencher nada na interface: apenas o desenvolvedor
  // define aqui o Application ID do app (e cadastra http://127.0.0.1:8085/discord/callback em Redirects).
  const DISCORD_APP_CONFIG = {
    clientId: '1569943132269707315', // Application ID oficial do Roxy Room
    oauthMode: 'token', // 'token' (Implicit) ou 'pkce'
    requestVoiceRpc: false,
    joinBaseUrl: 'https://mariocesarflore.github.io/Roxy-Room/join.html',
  };

  const state = {
    clientId: DISCORD_APP_CONFIG.clientId,
    clientSecret: '',
    oauthMode: DISCORD_APP_CONFIG.oauthMode,
    requestVoiceRpc: DISCORD_APP_CONFIG.requestVoiceRpc,
    accessToken: '',
    tokenExpiresAt: 0,
    customStatus: 'Transmitindo uma nova aventura em Roxy Room',
    serverPort: 8085,
    pkceVerifier: '',
    oauthState: '',

    // Fetched / live data
    apiUser: null,
    ipcUser: null,
    guilds: null,
    connections: null,
    voiceChannel: null,
    voiceError: null,
    ipcConnected: false,
    discordRunning: false,
    spotifyLocal: { running: false, playing: false, title: '', artist: '', track: '' },

    // Roxy Room live state
    roomId: 'SALA-6863',
    roomConnected: false,
    isHost: false,
    isStreaming: false,
    streamStartedAt: 0,
    roomUserCount: 0,
  };

  let activityTimerInterval = null;
  let localPollInterval = null;

  // ─── Persistence ────────────────────────────────────────────────────────────
  function loadSavedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.accessToken) state.accessToken = String(parsed.accessToken);
      if (parsed.tokenExpiresAt) state.tokenExpiresAt = Number(parsed.tokenExpiresAt) || 0;
      if (parsed.customStatus) state.customStatus = String(parsed.customStatus);
      if (parsed.apiUser) state.apiUser = parsed.apiUser;
      if (parsed.guilds) state.guilds = parsed.guilds;
      if (parsed.connections) state.connections = parsed.connections;
    } catch (e) {}
    // Garante que a configuração do app sempre venha do código
    state.clientId = (DISCORD_APP_CONFIG.clientId || '').trim();
    state.oauthMode = DISCORD_APP_CONFIG.oauthMode || 'token';
    state.requestVoiceRpc = !!DISCORD_APP_CONFIG.requestVoiceRpc;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        accessToken: state.accessToken,
        tokenExpiresAt: state.tokenExpiresAt,
        customStatus: state.customStatus,
        apiUser: state.apiUser,
        guilds: state.guilds,
        connections: state.connections,
      }));
    } catch (e) {}
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function bridgeSend(msg) {
    if (window.mdpBridge) {
      window.mdpBridge.send(msg);
      return true;
    }
    return false;
  }

  function getRedirectUri() {
    return `http://127.0.0.1:${state.serverPort || 8085}/discord/callback`;
  }

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function formatNumberBR(n) {
    if (typeof n !== 'number' || isNaN(n)) return '';
    return n.toLocaleString('pt-BR');
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function getAvatarUrl(user) {
    if (!user || !user.id) return '';
    if (user.avatar) {
      const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
      return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
    }
    const idx = user.discriminator && user.discriminator !== '0'
      ? Number(user.discriminator) % 5
      : Number((BigInt(user.id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  }

  function getBannerUrl(user) {
    if (!user || !user.id || !user.banner) return '';
    const ext = user.banner.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.${ext}?size=600`;
  }

  function getGuildIconUrl(guild) {
    if (!guild || !guild.id || !guild.icon) return '';
    const ext = guild.icon.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}?size=128`;
  }

  function getInitials(name) {
    const clean = String(name || 'U').trim();
    if (!clean) return 'U';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return clean.slice(0, 2).toUpperCase();
  }

  function getActiveUser() {
    return state.apiUser || state.ipcUser || null;
  }

  function getLocalDisplayName() {
    const u = getActiveUser();
    if (u) return u.global_name || u.username || 'Usuário';
    const input = document.getElementById('usernameInput');
    return (input && input.value.trim()) || 'Usuário';
  }

  function getEffectiveOnlineStatus() {
    if (state.apiUser || state.ipcConnected || state.discordRunning || state.roomConnected) {
      return { key: 'online', label: 'online' };
    }
    return { key: 'online', label: 'online' };
  }

  // ─── PKCE Crypto Helpers ────────────────────────────────────────────────────
  function randomBase64Url(byteLen = 32) {
    const arr = new Uint8Array(byteLen);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function sha256Base64Url(plain) {
    const data = new TextEncoder().encode(plain);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hash);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ─── UI Rendering ───────────────────────────────────────────────────────────
  function renderProfileSidebar() {
    const user = getActiveUser();
    const displayName = getLocalDisplayName();
    const avatarUrl = getAvatarUrl(user);
    const status = getEffectiveOnlineStatus();

    const avatarEl = document.getElementById('userAvatar');
    if (avatarEl) {
      if (avatarUrl) {
        avatarEl.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`;
      } else {
        avatarEl.textContent = displayName.charAt(0).toUpperCase() || 'U';
      }
    }

    const nameEl = document.getElementById('profileDisplayName');
    if (nameEl) {
      nameEl.textContent = displayName;
      if (user) nameEl.dataset.discordLocked = '1';
      else delete nameEl.dataset.discordLocked;
    }

    const subEl = document.getElementById('profileSubLabel');
    if (subEl) {
      if (state.apiUser) {
        subEl.textContent = '@' + state.apiUser.username;
      } else if (state.ipcUser) {
        subEl.textContent = 'Discord IPC • @' + state.ipcUser.username;
      } else if (state.discordRunning) {
        subEl.textContent = 'Discord • clique p/ vincular';
      } else {
        subEl.textContent = 'Discord';
      }
    }

    const hiddenInput = document.getElementById('usernameInput');
    if (hiddenInput && user && hiddenInput.value !== displayName) {
      hiddenInput.value = displayName;
      if (typeof saveSettings === 'function') saveSettings();
    }

    const dotEl = document.getElementById('profileAvatarDot');
    if (dotEl) dotEl.className = 'profile-avatar-status ' + status.key;

    const pillEl = document.getElementById('profileOnlinePill');
    if (pillEl) pillEl.className = 'profile-online-pill ' + status.key;

    const pillTextEl = document.getElementById('profileOnlineText');
    if (pillTextEl) pillTextEl.textContent = status.label;

    if (typeof window.refreshSelfRoomIdentity === 'function') {
      window.refreshSelfRoomIdentity();
    }
  }

  function renderModal() {
    const user = getActiveUser();
    const displayName = getLocalDisplayName();
    const avatarUrl = getAvatarUrl(user);
    const bannerUrl = getBannerUrl(user);
    const status = getEffectiveOnlineStatus();

    // 1. Banner
    const bannerEl = document.getElementById('dpBanner');
    if (bannerEl) {
      if (bannerUrl) {
        bannerEl.style.backgroundImage = `linear-gradient(180deg, rgba(10,15,31,0.12) 0%, rgba(10,15,31,0.72) 100%), url('${bannerUrl}')`;
      } else if (user && (user.banner_color || user.accent_color)) {
        const hex = user.banner_color || ('#' + Number(user.accent_color).toString(16).padStart(6, '0'));
        bannerEl.style.backgroundImage = `radial-gradient(circle at 70% 25%, ${hex}aa 0%, transparent 60%), linear-gradient(125deg, #111834 0%, ${hex}66 55%, #10162c 100%)`;
      } else {
        bannerEl.style.backgroundImage = '';
      }
    }

    // 2. Modal Avatar
    const dpAvatar = document.getElementById('dpAvatar');
    if (dpAvatar) {
      if (avatarUrl) {
        dpAvatar.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`;
      } else {
        dpAvatar.textContent = displayName.charAt(0).toUpperCase() || 'U';
      }
    }

    const dpDot = document.getElementById('dpAvatarStatusDot');
    if (dpDot) dpDot.className = 'dp-avatar-status ' + status.key;

    const dpStatusPill = document.getElementById('dpStatusPill');
    if (dpStatusPill) dpStatusPill.className = 'dp-status-pill ' + status.key;
    const dpStatusText = document.getElementById('dpStatusText');
    if (dpStatusText) dpStatusText.textContent = status.label;

    // 3. Name & Username Tag
    const dpName = document.getElementById('dpDisplayName');
    if (dpName) dpName.textContent = displayName;

    const dpTag = document.getElementById('dpUsernameTag');
    if (dpTag) {
      if (user) {
        const tagPart = (user.discriminator && user.discriminator !== '0')
          ? `${user.username}#${user.discriminator}`
          : `ID ${user.id}`;
        dpTag.textContent = `@${user.username} • ${tagPart}`;
      } else {
        dpTag.textContent = `@${displayName.toLowerCase().replace(/\s+/g, '.')} • Conecte sua conta Discord`;
      }
    }

    const dpEyebrow = document.getElementById('dpEyebrow');
    if (dpEyebrow) {
      if (state.apiUser && state.ipcConnected) dpEyebrow.textContent = 'DISCORD • OAUTH2 + IPC ATIVO';
      else if (state.apiUser) dpEyebrow.textContent = 'DISCORD • OAUTH2 CONECTADO';
      else if (state.ipcConnected) dpEyebrow.textContent = 'DISCORD • PRESENÇA RICH (IPC)';
      else dpEyebrow.textContent = 'DISCORD • PRESENÇA RICH';
    }

    // 4. Custom Status Phrase
    const customTextEl = document.getElementById('dpCustomStatusText');
    if (customTextEl) customTextEl.textContent = state.customStatus;

    // 5. Atividade Atual
    renderCurrentActivity();

    // 6. Ouvindo Agora (Spotify)
    renderSpotifyCard();

    // 7. Servidores
    renderGuildsCard();

    // 8. Canal de Voz
    renderVoiceCard();

    // 9. Footer & Config Inputs
    renderFooterAndConfig();
  }

  function renderCurrentActivity() {
    const titleEl = document.getElementById('dpActivityTitle');
    const subEl = document.getElementById('dpActivitySub');
    const btnLabel = document.getElementById('dpViewStreamLabel');

    if (titleEl) titleEl.textContent = 'Roxy Room';

    if (subEl) {
      if (state.isStreaming && state.streamStartedAt > 0) {
        const elapsed = formatDuration(Date.now() - state.streamStartedAt);
        subEl.textContent = `Transmitindo tela • ${elapsed}`;
      } else if (state.roomConnected) {
        subEl.textContent = `Na sala ${state.roomId} • em espera`;
      } else {
        subEl.textContent = `Em espera • ${state.roomId || 'SALA-6863'}`;
      }
    }

    if (btnLabel) {
      btnLabel.textContent = state.isStreaming ? 'Ver transmissão' : 'Transmitir agora';
    }
  }

  function renderSpotifyCard() {
    const titleEl = document.getElementById('dpSpotifyTitle');
    const subEl = document.getElementById('dpSpotifySub');
    const actionLabel = document.getElementById('dpSpotifyActionLabel');
    const actionIcon = document.getElementById('dpSpotifyActionIcon');

    const spotifyConn = Array.isArray(state.connections)
      ? state.connections.find((c) => c.type === 'spotify')
      : null;

    if (state.spotifyLocal && state.spotifyLocal.playing) {
      const trackText = state.spotifyLocal.track || state.spotifyLocal.title;
      const artist = state.spotifyLocal.artist || 'Spotify Desktop';
      const subText = spotifyConn ? `${artist} • @${spotifyConn.name}` : artist;
      if (titleEl) { titleEl.textContent = trackText; titleEl.title = trackText; }
      if (subEl) { subEl.textContent = subText; subEl.title = subText; }
      if (actionLabel) actionLabel.textContent = 'Abrir no Spotify';
      if (actionIcon) actionIcon.textContent = '↗';
    } else if (spotifyConn) {
      const titleText = `Spotify • ${spotifyConn.name}`;
      const subText = state.spotifyLocal.running ? 'Pausado no momento' : 'Conta vinculada no Discord';
      if (titleEl) { titleEl.textContent = titleText; titleEl.title = titleText; }
      if (subEl) { subEl.textContent = subText; subEl.title = subText; }
      if (actionLabel) actionLabel.textContent = 'Atualizar Spotify';
      if (actionIcon) actionIcon.textContent = '↻';
    } else {
      if (titleEl) { titleEl.textContent = 'Spotify'; titleEl.title = 'Spotify'; }
      if (subEl) { subEl.textContent = 'Nenhuma atividade conectada'; subEl.title = ''; }
      if (actionLabel) actionLabel.textContent = 'Conectar Spotify';
      if (actionIcon) actionIcon.textContent = '+';
    }
  }

  function renderGuildsCard() {
    const listEl = document.getElementById('dpGuildsList');
    const countEl = document.getElementById('dpGuildsCount');
    if (!listEl) return;

    if (!Array.isArray(state.guilds) || state.guilds.length === 0) {
      if (countEl) countEl.style.display = 'none';
      if (state.apiUser) {
        listEl.innerHTML = `<div class="dp-servers-empty">Nenhum servidor retornado pela API do Discord.</div>`;
      } else {
        listEl.innerHTML = `<div class="dp-servers-empty">Conecte sua conta Discord via OAuth2 para carregar seus servidores reais com ícones e contagem de membros.</div>`;
      }
      return;
    }

    if (countEl) {
      countEl.textContent = state.guilds.length;
      countEl.style.display = 'inline-block';
    }

    const sorted = [...state.guilds].sort((a, b) => {
      if (!!b.owner !== !!a.owner) return b.owner ? 1 : -1;
      return (b.approximate_member_count || 0) - (a.approximate_member_count || 0);
    });

    listEl.innerHTML = sorted.map((g) => {
      const iconUrl = getGuildIconUrl(g);
      const iconHtml = iconUrl
        ? `<img src="${escapeHtml(iconUrl)}" alt="${escapeHtml(g.name)}">`
        : escapeHtml(getInitials(g.name));

      const parts = [];
      if (typeof g.approximate_member_count === 'number') {
        parts.push(`${formatNumberBR(g.approximate_member_count)} membros`);
      }
      if (typeof g.approximate_presence_count === 'number') {
        parts.push(`${formatNumberBR(g.approximate_presence_count)} online`);
      }
      if (parts.length === 0) {
        parts.push(g.owner ? 'Dono do servidor' : 'Membro conectado');
      }

      return `
        <div class="dp-server-item">
          <div class="dp-server-icon">${iconHtml}</div>
          <div class="dp-server-meta">
            <div class="dp-server-name">${escapeHtml(g.name)}</div>
            <div class="dp-server-sub">${escapeHtml(parts.join(' • '))}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderVoiceCard() {
    const boxEl = document.getElementById('dpVoiceBox');
    const dotEl = document.getElementById('dpVoiceDot');
    const eqEl = document.getElementById('dpVoiceEq');
    const nameEl = document.getElementById('dpVoiceChannelName');
    const subEl = document.getElementById('dpVoiceChannelSub');
    const tagsEl = document.getElementById('dpVoiceTags');

    const user = getActiveUser();
    const displayName = getLocalDisplayName();

    if (state.voiceChannel && state.voiceChannel.name) {
      if (boxEl) boxEl.className = 'dp-voice-box';
      if (dotEl) dotEl.className = 'dp-voice-dot';
      if (eqEl) eqEl.className = 'dp-voice-eq';
      if (nameEl) { nameEl.textContent = state.voiceChannel.name; nameEl.title = state.voiceChannel.name; }
      const participants = Array.isArray(state.voiceChannel.voice_states)
        ? state.voiceChannel.voice_states.length
        : 1;
      const limit = state.voiceChannel.user_limit > 0 ? state.voiceChannel.user_limit : 0;
      const countText = limit > 0 ? `${participants}/${limit}` : `${participants}`;
      const subText = `${displayName} • ${countText} conectados no Discord`;
      if (subEl) { subEl.textContent = subText; subEl.title = subText; }
    } else {
      if (boxEl) boxEl.className = 'dp-voice-box idle';
      if (dotEl) dotEl.className = 'dp-voice-dot idle';
      if (eqEl) eqEl.className = 'dp-voice-eq idle';
      if (nameEl) {
        nameEl.textContent = 'Nenhum canal de voz';
        nameEl.title = 'Canal de voz do Discord';
      }
      if (subEl) {
        let subText = 'Entre em uma call no Discord';
        if (state.apiUser && !state.requestVoiceRpc) {
          subText = 'Canal de voz requer escopo RPC aprovado no app';
        } else if (state.voiceError) {
          subText = 'RPC de Voz aguarda permissão do app Discord';
        } else if (!state.discordRunning) {
          subText = 'Discord desktop não detectado';
        }
        subEl.textContent = subText;
        subEl.title = subText;
      }
    }

    if (tagsEl) {
      const tags = [];
      tags.push(state.isStreaming ? 'Streamer Ao Vivo' : 'Streamer');
      tags.push(state.isHost ? 'Host' : 'Participante');
      if (user && user.premium_type > 0) tags.push('Discord Nitro');
      else tags.push('Roxy Club');
      tagsEl.innerHTML = tags.map((t) => `<span class="dp-tag">${escapeHtml(t)}</span>`).join('');
    }
  }

  function renderFooterAndConfig() {
    const connectBtn = document.getElementById('dpConnectBtn');
    const refreshBtn = document.getElementById('dpRefreshBtn');
    const disconnectBtn = document.getElementById('dpDisconnectBtn');
    const footerTitle = document.getElementById('dpFooterTitle');
    const footerSub = document.getElementById('dpFooterSub');

    const isAuthed = !!state.accessToken && !!state.apiUser;
    if (connectBtn) {
      connectBtn.style.display = isAuthed ? 'none' : 'inline-block';
    }
    if (refreshBtn) {
      refreshBtn.style.display = isAuthed ? 'inline-block' : 'none';
    }
    if (disconnectBtn) {
      disconnectBtn.style.display = isAuthed ? 'inline-block' : 'none';
    }

    if (footerTitle && footerSub) {
      if (isAuthed) {
        footerTitle.textContent = state.ipcConnected
          ? 'OAuth2 + Discord Desktop IPC Conectados'
          : 'Discord OAuth2 Conectado';
        footerSub.textContent = state.voiceChannel
          ? `Dados ao vivo sincronizados (@${state.apiUser.username}) incluindo canal de voz.`
          : `Avatar, banner, servidores e conexões sincronizados com @${state.apiUser.username}.`;
      } else {
        footerTitle.textContent = 'Integração com OAuth2 + Gateway Presence';
        footerSub.textContent = 'Avatar, banner, status, atividade, servidores e voz dependem das permissões autorizadas pelo usuário.';
      }
    }
  }

  function renderAll() {
    renderProfileSidebar();
    renderModal();
  }

  // ─── Discord OAuth2 & API Actions ───────────────────────────────────────────
  async function startDiscordOAuth() {
    const clientId = (DISCORD_APP_CONFIG.clientId || state.clientId || '').trim();
    if (!clientId || !/^\d{15,22}$/.test(clientId)) {
      if (typeof showToast === 'function') {
        showToast('⚠️ Configure o Application ID do Roxy Room em web/discord.js (DISCORD_APP_CONFIG.clientId).', 'warn', 5000);
      }
      return;
    }
    state.clientId = clientId;

    // Also connect local IPC immediately
    bridgeSend('discord:connectIpc:' + clientId);

    const scopes = ['identify', 'guilds', 'connections'];
    if (state.requestVoiceRpc) {
      scopes.push('rpc', 'rpc.voice.read');
    }

    state.oauthState = randomBase64Url(16);
    const redirectUri = getRedirectUri();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state: state.oauthState,
      prompt: 'consent',
    });

    if (state.oauthMode === 'token') {
      params.set('response_type', 'token');
    } else if (state.oauthMode === 'pkce') {
      state.pkceVerifier = randomBase64Url(48);
      const challenge = await sha256Base64Url(state.pkceVerifier);
      params.set('response_type', 'code');
      params.set('code_challenge', challenge);
      params.set('code_challenge_method', 'S256');
    } else {
      params.set('response_type', 'code');
    }

    const authUrl = `https://discord.com/oauth2/authorize?${params.toString().replace(/\+/g, '%20')}`;
    if (!bridgeSend('openUrl:' + authUrl)) {
      window.open(authUrl, '_blank');
    }
    if (typeof showToast === 'function') {
      showToast('🌐 Autorize o Roxy Room no navegador para puxar seu perfil Discord...', '', 4500);
    }
  }

  function fetchDiscordApiProfile() {
    if (!state.accessToken) return;
    if (window.mdpBridge) {
      bridgeSend('discord:fetchProfile:' + state.accessToken);
    } else {
      // Browser fallback
      const hdr = { Authorization: `Bearer ${state.accessToken}` };
      Promise.all([
        fetch('https://discord.com/api/v10/users/@me', { headers: hdr }).then((r) => r.ok ? r.json() : null),
        fetch('https://discord.com/api/v10/users/@me/guilds?with_counts=true', { headers: hdr }).then((r) => r.ok ? r.json() : null),
        fetch('https://discord.com/api/v10/users/@me/connections', { headers: hdr }).then((r) => r.ok ? r.json() : null),
      ]).then(([user, guilds, connections]) => {
        if (user) {
          state.apiUser = user;
          if (Array.isArray(guilds)) state.guilds = guilds;
          if (Array.isArray(connections)) state.connections = connections;
          saveState();
          renderAll();
        }
      }).catch(() => {});
    }
  }

  function pushRichPresence() {
    if (!state.ipcConnected) return;
    const activeRoom = (state.roomId || 'SALA-6863').trim();
    const payload = {
      details: state.isStreaming
        ? `Transmitindo na sala ${activeRoom}`
        : `Na sala ${activeRoom} • Em espera`,
      state: state.customStatus || 'Roxy Room P2P',
      startTimestamp: state.isStreaming && state.streamStartedAt
        ? Math.floor(state.streamStartedAt / 1000)
        : 0,
      partyId: 'ROXY-' + activeRoom,
      partySize: Math.max(1, state.roomUserCount || 1),
      partyMax: 100,
      buttonLabel: 'Entrar na transmissão',
      buttonUrl: `${DISCORD_APP_CONFIG.joinBaseUrl}?sala=${encodeURIComponent(activeRoom)}`,
      largeImageKey: 'https://cdn.discordapp.com/app-assets/1569943132269707315/1569947625594163261.png',
      largeImageText: `Roxy Room • ${activeRoom}`,
    };
    bridgeSend('discord:setActivity:' + JSON.stringify(payload));
  }

  function handleDiscordInviteJoin(rawSecret) {
    let secret = String(rawSecret || '').trim();
    if (!secret) return;
    if (secret.includes('secret=')) {
      const m = secret.match(/secret=([^&#\s]+)/i);
      if (m && m[1]) secret = decodeURIComponent(m[1]);
    }
    secret = secret.replace(/^roxyroom:\/\/join\//i, '').replace(/^discord-\d+:\/\/(join\/)?/i, '');
    secret = secret.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
    if (!secret) return;

    closeModal();
    document.getElementById('settingsModal')?.classList.remove('active');

    if (state.roomConnected && state.roomId && state.roomId.toUpperCase() === secret) {
      if (typeof showToast === 'function') {
        showToast(`✅ Você já está conectado na sala ${secret}!`, 'success');
      }
      return;
    }

    const roomInput = document.getElementById('roomId');
    if (roomInput) roomInput.value = secret;
    if (typeof window.joinRoom === 'function') {
      if (typeof showToast === 'function') {
        showToast(`🎮 Entrando na sala ${secret} pelo convite do Discord...`, 'success', 4500);
      }
      window.joinRoom(secret, false);
    }
  }

  function disconnectDiscord() {
    state.accessToken = '';
    state.tokenExpiresAt = 0;
    state.apiUser = null;
    state.ipcUser = null;
    state.guilds = null;
    state.connections = null;
    state.voiceChannel = null;
    state.ipcConnected = false;
    saveState();
    bridgeSend('discord:disconnect');
    renderAll();
    if (typeof showToast === 'function') {
      showToast('🔌 Conta Discord desconectada.');
    }
  }

  // ─── C++ Bridge Message Handling ────────────────────────────────────────────
  function handleBridgeMessage(raw) {
    let data = raw;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return; }
    }
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'discordServerPort': {
        if (data.port) {
          state.serverPort = Number(data.port) || 8085;
          renderFooterAndConfig();
        }
        break;
      }

      case 'discordOAuthCallback': {
        const p = data.payload || {};
        if (p.error) {
          if (typeof showToast === 'function') {
            showToast('❌ Discord OAuth: ' + (p.error_description || p.error), 'error');
          }
          return;
        }
        if (p.state && state.oauthState && p.state !== state.oauthState) {
          return;
        }
        if (p.access_token) {
          state.accessToken = p.access_token;
          const expSec = Number(p.expires_in) || 604800;
          state.tokenExpiresAt = Date.now() + expSec * 1000;
          saveState();
          fetchDiscordApiProfile();
          if (state.ipcConnected && state.requestVoiceRpc) {
            bridgeSend('discord:authenticateRpc:' + state.accessToken);
          }
          if (typeof showToast === 'function') {
            showToast('✅ Discord autorizado! Carregando perfil, banner e servidores...', 'success');
          }
        } else if (p.code) {
          bridgeSend('discord:exchangeCode:' + JSON.stringify({
            clientId: state.clientId,
            code: p.code,
            redirectUri: getRedirectUri(),
            codeVerifier: state.oauthMode === 'pkce' ? state.pkceVerifier : '',
            clientSecret: state.oauthMode === 'code' ? state.clientSecret : '',
          }));
        }
        break;
      }

      case 'discordOAuthToken': {
        const tok = data.data;
        if (data.ok && tok && tok.access_token) {
          state.accessToken = tok.access_token;
          const expSec = Number(tok.expires_in) || 604800;
          state.tokenExpiresAt = Date.now() + expSec * 1000;
          saveState();
          fetchDiscordApiProfile();
          if (state.ipcConnected && state.requestVoiceRpc) {
            bridgeSend('discord:authenticateRpc:' + state.accessToken);
          }
          if (typeof showToast === 'function') {
            showToast('✅ Token Discord obtido! Carregando perfil...', 'success');
          }
        } else {
          const msg = (tok && (tok.error_description || tok.error)) || `Erro HTTP ${data.status}`;
          if (typeof showToast === 'function') {
            showToast('❌ Falha ao trocar código OAuth2: ' + msg, 'error', 5000);
          }
        }
        break;
      }

      case 'discordApiProfile': {
        if (data.userStatus === 200 && data.user) {
          state.apiUser = data.user;
          if (Array.isArray(data.guilds)) state.guilds = data.guilds;
          if (Array.isArray(data.connections)) state.connections = data.connections;
          saveState();
          renderAll();
          if (typeof showToast === 'function') {
            showToast(`✨ Perfil Discord sincronizado (${data.user.global_name || data.user.username})!`, 'success');
          }
        } else if (data.userStatus === 401) {
          state.accessToken = '';
          saveState();
          renderAll();
          if (typeof showToast === 'function') {
            showToast('⚠️ Sessão Discord expirou. Clique em Conectar novamente.', 'warn');
          }
        }
        break;
      }

      case 'discordIpcStatus': {
        state.ipcConnected = !!data.connected;
        if (state.ipcConnected) {
          pushRichPresence();
          if (state.accessToken && state.requestVoiceRpc) {
            bridgeSend('discord:authenticateRpc:' + state.accessToken);
          }
        }
        renderAll();
        break;
      }

      case 'discordIpcFrame': {
        const frame = data.frame;
        if (!frame) break;
        if (frame.evt === 'READY' && frame.data && frame.data.user) {
          state.ipcUser = frame.data.user;
          state.ipcConnected = true;
          bridgeSend('discord:subscribeActivity');
          pushRichPresence();
          if (state.accessToken && state.requestVoiceRpc) {
            bridgeSend('discord:authenticateRpc:' + state.accessToken);
          }
          renderAll();
        } else if (frame.evt === 'ACTIVITY_JOIN' && frame.data && frame.data.secret) {
          handleDiscordInviteJoin(frame.data.secret);
        } else if (frame.evt === 'ACTIVITY_SPECTATE' && frame.data && frame.data.secret) {
          handleDiscordInviteJoin(frame.data.secret);
        } else if (frame.evt === 'ACTIVITY_JOIN_REQUEST' && frame.data && frame.data.user) {
          const reqUser = frame.data.user.global_name || frame.data.user.username || 'Alguém';
          if (typeof showToast === 'function') {
            showToast(`🎮 ${reqUser} pediu para entrar na sua sala! Aceite pelo Discord para liberar.`, 'info', 5000);
          }
        } else if (frame.cmd === 'AUTHENTICATE' && frame.evt !== 'ERROR') {
          bridgeSend('discord:getVoiceChannel');
          bridgeSend('discord:subscribeVoice');
        } else if (frame.cmd === 'GET_SELECTED_VOICE_CHANNEL' && frame.evt !== 'ERROR') {
          state.voiceChannel = frame.data || null;
          renderVoiceCard();
        } else if (frame.evt === 'VOICE_CHANNEL_SELECT') {
          if (frame.data && frame.data.channel_id) {
            bridgeSend('discord:getVoiceChannel');
          } else {
            state.voiceChannel = null;
            renderVoiceCard();
          }
        } else if (frame.evt === 'VOICE_STATE_CREATE' || frame.evt === 'VOICE_STATE_UPDATE' || frame.evt === 'VOICE_STATE_DELETE') {
          bridgeSend('discord:getVoiceChannel');
        } else if (frame.evt === 'ERROR' && frame.data) {
          state.voiceError = frame.data.message || String(frame.data.code || '');
        }
        break;
      }

      case 'discordActivityJoin': {
        if (data.secret) {
          handleDiscordInviteJoin(data.secret);
        }
        break;
      }

      case 'discordLocalStatus': {
        state.discordRunning = !!data.discordRunning;
        if (data.spotify) state.spotifyLocal = data.spotify;
        renderProfileSidebar();
        renderSpotifyCard();
        renderVoiceCard();
        break;
      }
    }
  }

  // ─── DOM Events ─────────────────────────────────────────────────────────────
  function openModal() {
    const modal = document.getElementById('discordProfileModal');
    if (!modal) return;
    bridgeSend('discord:pollLocal');
    if (state.accessToken) fetchDiscordApiProfile();
    if (state.ipcConnected && state.requestVoiceRpc) {
      bridgeSend('discord:getVoiceChannel');
    }
    try {
      renderAll();
    } catch (e) {
      console.error('Erro ao renderizar modal Discord:', e);
    }
    modal.classList.add('active');
  }

  function closeModal() {
    document.getElementById('discordProfileModal')?.classList.remove('active');
  }

  function initEvents() {
    const trigger = document.getElementById('profileCardTrigger');
    if (trigger) {
      trigger.addEventListener('click', openModal);
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openModal();
        }
      });
    }

    document.getElementById('closeDiscordModalBtn')?.addEventListener('click', closeModal);

    // Edit custom status phrase
    const editStatusBtn = document.getElementById('dpEditStatusBtn');
    const statusText = document.getElementById('dpCustomStatusText');
    const statusInput = document.getElementById('dpCustomStatusInput');
    if (editStatusBtn && statusText && statusInput) {
      const startEditingStatus = () => {
        statusInput.value = state.customStatus;
        statusText.style.display = 'none';
        statusInput.style.display = 'block';
        statusInput.focus();
        statusInput.select();
      };
      const commitStatus = () => {
        const val = statusInput.value.trim();
        if (val) state.customStatus = val;
        statusInput.style.display = 'none';
        statusText.style.display = 'block';
        statusText.textContent = state.customStatus;
        saveState();
        pushRichPresence();
      };
      editStatusBtn.addEventListener('click', () => {
        if (statusInput.style.display === 'none') startEditingStatus();
        else commitStatus();
      });
      statusText.addEventListener('dblclick', startEditingStatus);
      statusInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commitStatus();
        else if (e.key === 'Escape') {
          statusInput.style.display = 'none';
          statusText.style.display = 'block';
        }
      });
      statusInput.addEventListener('blur', commitStatus);
    }

    // Ver transmissão / Transmitir agora
    document.getElementById('dpViewStreamBtn')?.addEventListener('click', () => {
      closeModal();
      if (state.isStreaming) {
        const firstCard = document.querySelector('.stream-card');
        if (firstCard && typeof toggleFocusStreamCard === 'function' && !firstCard.classList.contains('focused')) {
          toggleFocusStreamCard(firstCard);
        }
      } else {
        document.getElementById('startBtn')?.click();
      }
    });

    // Spotify action
    document.getElementById('dpSpotifyActionBtn')?.addEventListener('click', () => {
      if (state.spotifyLocal && state.spotifyLocal.playing) {
        if (!bridgeSend('openUrl:spotify:')) {
          window.open('https://open.spotify.com', '_blank');
        }
      } else if (state.accessToken) {
        bridgeSend('discord:pollLocal');
        fetchDiscordApiProfile();
        if (typeof showToast === 'function') showToast('🎵 Verificando Spotify conectado...');
      } else {
        startDiscordOAuth();
      }
    });

    // Footer action buttons
    document.getElementById('dpConnectBtn')?.addEventListener('click', startDiscordOAuth);

    document.getElementById('dpRefreshBtn')?.addEventListener('click', () => {
      bridgeSend('discord:pollLocal');
      fetchDiscordApiProfile();
      if (state.ipcConnected && state.requestVoiceRpc) {
        bridgeSend('discord:getVoiceChannel');
      }
      if (typeof showToast === 'function') showToast('🔄 Atualizando dados do Discord...');
    });

    document.getElementById('dpDisconnectBtn')?.addEventListener('click', disconnectDiscord);
  }

  // ─── Public Hooks for renderer.js ───────────────────────────────────────────
  window.roxyDiscord = {
    onRoomStateChanged({ roomId, connected, isHost, userCount }) {
      let activityChanged = false;
      const nextRoom = roomId !== undefined ? (roomId || 'SALA-6863') : state.roomId;
      if (roomId !== undefined && state.roomId !== nextRoom) {
        state.roomId = nextRoom;
        activityChanged = true;
      }
      if (connected !== undefined && state.roomConnected !== !!connected) {
        state.roomConnected = !!connected;
        activityChanged = true;
      }
      if (isHost !== undefined && state.isHost !== !!isHost) {
        state.isHost = !!isHost;
        activityChanged = true;
      }
      if (userCount !== undefined) state.roomUserCount = Number(userCount) || 0;
      pushRichPresence();
      if (activityChanged) renderModal();
    },
    onStreamStateChanged({ streaming }) {
      state.isStreaming = !!streaming;
      state.streamStartedAt = state.isStreaming ? Date.now() : 0;
      pushRichPresence();
      renderCurrentActivity();
      renderVoiceCard();
    },
    openModal,
    getProfileIdentity() {
      const u = getActiveUser();
      return {
        name: getLocalDisplayName(),
        avatarUrl: u ? getAvatarUrl(u) : '',
      };
    },
  };

  // ─── Boot ───────────────────────────────────────────────────────────────────
  loadSavedState();
  initEvents();

  if (window.mdpBridge) {
    window.mdpBridge.onMessage(handleBridgeMessage);
    bridgeSend('discord:getServerPort');
    bridgeSend('discord:pollLocal');
    if (state.clientId) {
      bridgeSend('discord:connectIpc:' + state.clientId);
    }
    setTimeout(() => {
      bridgeSend('discord:getPendingInvite');
    }, 250);
  }

  if (state.accessToken) {
    if (state.tokenExpiresAt && Date.now() > state.tokenExpiresAt) {
      state.accessToken = '';
      saveState();
    } else {
      fetchDiscordApiProfile();
    }
  }

  // Live timer tick for streaming elapsed time
  activityTimerInterval = setInterval(() => {
    if (state.isStreaming) {
      renderCurrentActivity();
    }
  }, 1000);

  // Poll local Discord / Spotify status periodically
  localPollInterval = setInterval(() => {
    bridgeSend('discord:pollLocal');
  }, 5000);

  renderAll();
})();
