import PeerCtor from "./vendorPeerJs";

export const PEER_HOST = "0.peerjs.com";
export const PEER_PORT = 443;
export const PEER_PATH = "/";
export const PEER_SECURE = true;
export const ROOM_PREFIX = "roxy-v2-";

export const ICE_SERVERS: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
    { urls: "stun:stun.services.mozilla.com" },
    {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
    },
    {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject"
    },
    {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject"
    }
];

export interface RoxyUserProfile {
    client?: "vencord" | "roxy-app";
    id?: string;
    discordId?: string;
    username?: string;
    discriminator?: string;
    displayName?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    bannerColor?: string;
    customStatus?: string;
    status?: string;
    accentColor?: number | null;
    guildCount?: number;
    voice?: {
        inCall: boolean;
        name: string;
        startedAt: number;
    } | null;
    voiceChannel?: {
        id?: string;
        name?: string;
    } | null;
}

export interface RoxyPeerInfo {
    peerId: string;
    name: string;
    avatarUrl: string;
    status: string;
    isHost: boolean;
    isStreamingRemote: boolean;
    watchingPaused: boolean;
    profile: RoxyUserProfile | null;
    clientType: "vencord" | "roxy";
}

export interface RoxyRemoteStream {
    peerId: string;
    name: string;
    avatarUrl: string;
    stream: MediaStream;
    muted: boolean;
    volume: number;
    width: number;
    height: number;
    fps: number;
}

export type RoxyAudioMode = "exclude-discord" | "none" | "system-all";

export interface ExcludedAudioStartResult {
    ok: boolean;
    port?: number;
    excludedPid?: number;
    error?: string;
}

export interface ExcludedAudioBridge {
    getDesktopCaptureSources?: () => Promise<RoxyDesktopSource[]>;
    startExcludedAudio(requestedPort?: number): Promise<ExcludedAudioStartResult>;
    stopExcludedAudio(): Promise<{ ok: boolean }>;
    checkExcludedAudioSupport?: () => Promise<{ available: boolean; helperPath?: string | null }>;
}

export interface RoxyCaptureOptions {
    sourceId?: string;
    width?: number;
    height?: number;
    fps?: number;
    audioMode?: RoxyAudioMode;
    bitrateMbps?: number;
    useDisplayMedia?: boolean;
    /** Quando definido, captura a câmera (aba "Dispositivos") em vez da tela. */
    cameraDeviceId?: string;
}

export interface RoxyDesktopSource {
    id: string;
    name: string;
    thumbnailDataUrl: string;
    appIconDataUrl?: string;
    type: "screen" | "window";
}

export type RoxyConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface RoxySnapshot {
    roomId: string;
    voiceChannelId: string | null;
    voiceChannelName: string | null;
    customRoomId: string;
    connectionStatus: RoxyConnectionStatus;
    isHost: boolean;
    myPeerId: string | null;
    isStreaming: boolean;
    localStream: MediaStream | null;
    localCaptureLabel: string;
    audioMode: RoxyAudioMode;
    excludedPid: number | null;
    audioNotice: string | null;
    peers: RoxyPeerInfo[];
    remoteStreams: RoxyRemoteStream[];
    spotlightPeerId: string | null;
    stageCollapsed: boolean;
    lastError: string | null;
}

interface InternalPeerConn {
    peerId: string;
    name: string;
    avatarUrl: string;
    status: string;
    isHost: boolean;
    isStreamingRemote: boolean;
    watchingPaused: boolean;
    profile: RoxyUserProfile | null;
    dataConn?: any;
    incomingCall?: any;
    outgoingCall?: any;
    remoteStream?: MediaStream;
    muted: boolean;
    volume: number;
    isCalling?: boolean;
    isViewerWatching?: boolean;
    suppressNextOpenSoundUntil?: number;
}

export function sanitizeRoom(raw?: string | null): string {
    return String(raw || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "");
}

export function channelToRoomId(channelId?: string | null): string {
    if (!channelId) return "";
    return sanitizeRoom(`DC-${channelId}`);
}

export function buildWebPlayerUrl(baseUrl: string, roomId: string): string {
    const clean = sanitizeRoom(roomId);
    const cleanBase = (baseUrl || "https://mariocesarflore.github.io/Roxy-Room/player.html").trim();
    const sep = cleanBase.includes("?") ? "&" : "?";
    return `${cleanBase}${sep}room=${encodeURIComponent(clean)}`;
}

function sanitizeAvatarUrl(raw?: string | null): string {
    const url = String(raw || "").trim();
    if (/^https?:\/\//i.test(url)) return url;
    return "";
}

function sanitizeStatus(raw?: string | null): string {
    const s = String(raw || "online").trim().toLowerCase();
    if (s === "idle" || s === "dnd" || s === "offline" || s === "online") return s;
    return "online";
}

function getPreferredLocalConstraints(
    opts: RoxyCaptureOptions,
    relaxed = false
): MediaStreamConstraints {
    const fps = opts.fps && opts.fps > 0 ? opts.fps : 60;
    const height = opts.height ?? 1080;
    const width = height > 0 ? Math.round(height * 2.4) : 0;

    const mandatoryVideo: Record<string, any> = {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: opts.sourceId
    };
    if (!relaxed) {
        mandatoryVideo.maxFrameRate = fps;
        if (height > 0 && width > 0) {
            mandatoryVideo.maxWidth = width;
            mandatoryVideo.maxHeight = height;
        }
    }

    const wantRawDesktopAudio = !relaxed && opts.audioMode === "system-all";
    return {
        audio: wantRawDesktopAudio
            ? ({
                  mandatory: {
                      chromeMediaSource: "desktop",
                      chromeMediaSourceId: opts.sourceId
                  }
              } as any)
            : false,
        video: { mandatory: mandatoryVideo } as any
    };
}

function extractVideoStats(stream?: MediaStream | null): { width: number; height: number; fps: number } {
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return { width: 0, height: 0, fps: 0 };
    const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
    return {
        width: settings.width || 0,
        height: settings.height || 0,
        fps: Math.round(settings.frameRate || 0)
    };
}

export class RoxyEngine {
    private peer: any = null;
    private roomId = "";
    private voiceChannelId: string | null = null;
    private voiceChannelName: string | null = null;
    private customRoomId = "";
    private connectionStatus: RoxyConnectionStatus = "disconnected";
    private isHost = false;
    private myPeerId: string | null = null;
    private hostPeerId = "";

    private localProfile: RoxyUserProfile = {
        client: "vencord",
        displayName: "Discord User",
        status: "online"
    };

    private localStream: MediaStream | null = null;
    private localCaptureLabel = "";
    private isStreaming = false;
    private streamStartedAt = 0;
    private bitrateMbps = 10;
    private targetFps = 60;
    private targetHeight = 1080;
    private autoWatchStreams = true;
    private soundEffects = true;
    private audioMode: RoxyAudioMode = "exclude-discord";
    private excludedPid: number | null = null;
    private audioNotice: string | null = null;

    private excludedAudioBridge: ExcludedAudioBridge | null = null;
    private cleanAudioCtx: AudioContext | null = null;
    private cleanAudioDest: MediaStreamAudioDestinationNode | null = null;
    private cleanAudioProc: ScriptProcessorNode | null = null;
    private cleanAudioWs: WebSocket | null = null;

    private connections = new Map<string, InternalPeerConn>();
    private spotlightPeerId: string | null = null;
    private stageCollapsed = false;
    private lastError: string | null = null;

    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private requestPollTimer: ReturnType<typeof setInterval> | null = null;
    private destroyed = false;

    private listeners = new Set<(snap: RoxySnapshot) => void>();
    private emitScheduled = false;

    subscribe(listener: (snap: RoxySnapshot) => void): () => void {
        this.listeners.add(listener);
        listener(this.getSnapshot());
        return () => {
            this.listeners.delete(listener);
        };
    }

    // Emissão coalescida: rajadas de mensagens P2P (hello, roomState, peerJoined...) geravam
    // uma reconstrução completa do grid React por mensagem. Agora vira no máximo 1 por frame.
    private emit() {
        if (this.emitScheduled) return;
        this.emitScheduled = true;
        const flush = () => {
            this.emitScheduled = false;
            if (this.destroyed) return;
            const snap = this.getSnapshot();
            this.listeners.forEach(fn => {
                try {
                    fn(snap);
                } catch (e) {
                    console.error("[RoxyRoom] Listener error:", e);
                }
            });
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
        else setTimeout(flush, 0);
    }

    getSnapshot(): RoxySnapshot {
        const peers: RoxyPeerInfo[] = [];
        const remoteStreams: RoxyRemoteStream[] = [];

        this.connections.forEach(c => {
            peers.push({
                peerId: c.peerId,
                name: c.name || "Amigo",
                avatarUrl: c.avatarUrl || "",
                status: c.status || "online",
                isHost: c.isHost,
                isStreamingRemote: c.isStreamingRemote,
                watchingPaused: c.watchingPaused,
                profile: c.profile,
                clientType: c.profile?.client === "vencord" ? "vencord" : "roxy"
            });

            if (c.remoteStream && (c.remoteStream.active || c.remoteStream.getVideoTracks().length > 0)) {
                const { width, height, fps } = extractVideoStats(c.remoteStream);
                remoteStreams.push({
                    peerId: c.peerId,
                    name: c.name || "Amigo",
                    avatarUrl: c.avatarUrl || "",
                    stream: c.remoteStream,
                    muted: c.muted,
                    volume: c.volume,
                    width,
                    height,
                    fps
                });
            }
        });

        return {
            roomId: this.roomId,
            voiceChannelId: this.voiceChannelId,
            voiceChannelName: this.voiceChannelName,
            customRoomId: this.customRoomId,
            connectionStatus: this.connectionStatus,
            isHost: this.isHost,
            myPeerId: this.myPeerId,
            isStreaming: this.isStreaming,
            localStream: this.localStream,
            localCaptureLabel: this.localCaptureLabel,
            audioMode: this.audioMode,
            excludedPid: this.excludedPid,
            audioNotice: this.audioNotice,
            peers,
            remoteStreams,
            spotlightPeerId: this.spotlightPeerId,
            stageCollapsed: this.stageCollapsed,
            lastError: this.lastError
        };
    }

    setExcludedAudioBridge(bridge: ExcludedAudioBridge | null) {
        this.excludedAudioBridge = bridge;
    }

    async checkExcludedAudioAvailable(): Promise<boolean> {
        if (!this.excludedAudioBridge?.checkExcludedAudioSupport) return false;
        try {
            const res = await this.excludedAudioBridge.checkExcludedAudioSupport();
            return Boolean(res?.available);
        } catch {
            return false;
        }
    }

    setPreferences(prefs: { bitrateMbps?: number; autoWatchStreams?: boolean; soundEffects?: boolean }) {
        if (typeof prefs.bitrateMbps === "number" && prefs.bitrateMbps > 0) {
            this.bitrateMbps = prefs.bitrateMbps;
            this.applyBitrateToActiveSenders();
        }
        if (typeof prefs.autoWatchStreams === "boolean") {
            this.autoWatchStreams = prefs.autoWatchStreams;
        }
        if (typeof prefs.soundEffects === "boolean") {
            this.soundEffects = prefs.soundEffects;
        }
    }

    setLocalProfile(profile: RoxyUserProfile) {
        // Assinatura barata: o perfil carrega banner base64 e era serializado 2x por chamada.
        const next = { ...profile, client: "vencord" as const };
        const prev = this.localProfile;
        if (
            prev.displayName === next.displayName &&
            prev.avatarUrl === next.avatarUrl &&
            prev.bannerUrl === next.bannerUrl &&
            prev.bannerColor === next.bannerColor &&
            prev.customStatus === next.customStatus &&
            prev.status === next.status &&
            prev.accentColor === next.accentColor &&
            prev.username === next.username &&
            prev.discriminator === next.discriminator &&
            prev.voice?.inCall === next.voice?.inCall &&
            prev.voice?.name === next.voice?.name &&
            prev.voiceChannel?.id === next.voiceChannel?.id
        ) {
            return;
        }
        this.localProfile = next;

        if (this.connectionStatus === "connected" && this.myPeerId) {
            this.broadcastData({
                type: "peerUpdated",
                peerId: this.myPeerId,
                name: this.getLocalDisplayName(),
                avatarUrl: this.localProfile.avatarUrl || "",
                status: sanitizeStatus(this.localProfile.status),
                profile: this.localProfile
            });
        }
    }

    setVoiceChannel(channelId: string | null, channelName: string | null, autoConnect: boolean) {
        const changed = this.voiceChannelId !== channelId || this.voiceChannelName !== channelName;
        this.voiceChannelId = channelId;
        this.voiceChannelName = channelName;

        if (!channelId) {
            this.customRoomId = "";
            if (this.isStreaming) {
                this.stopLocalStream();
            }
            this.disconnect();
            this.emit();
            return;
        }

        const targetRoom = sanitizeRoom(this.customRoomId) || channelToRoomId(channelId);
        if (autoConnect && targetRoom && targetRoom !== this.roomId) {
            this.connectToRoom(targetRoom);
        } else if (changed) {
            this.emit();
        }
    }

    setCustomRoom(roomId: string) {
        const clean = sanitizeRoom(roomId);
        this.customRoomId = clean;
        const target = clean || channelToRoomId(this.voiceChannelId);
        if (target) {
            this.connectToRoom(target);
        } else {
            this.emit();
        }
    }

    resetToVoiceChannelRoom() {
        this.customRoomId = "";
        const target = channelToRoomId(this.voiceChannelId);
        if (target) {
            this.connectToRoom(target);
        } else {
            this.disconnect();
        }
    }

    setStageCollapsed(collapsed: boolean) {
        this.stageCollapsed = collapsed;
        this.emit();
    }

    setSpotlight(peerId: string | null) {
        this.spotlightPeerId = this.spotlightPeerId === peerId ? null : peerId;
        this.emit();
    }

    togglePeerMuted(peerId: string) {
        const c = this.connections.get(peerId);
        if (!c) return;
        c.muted = !c.muted;
        this.emit();
    }

    setPeerMuted(peerId: string, muted: boolean) {
        const c = this.connections.get(peerId);
        if (!c || c.muted === muted) return;
        c.muted = muted;
        this.emit();
    }

    setPeerVolume(peerId: string, volume: number) {
        const c = this.connections.get(peerId);
        if (!c) return;
        c.volume = Math.max(0, Math.min(1, volume));
        if (c.volume > 0 && c.muted) c.muted = false;
        this.emit();
    }

    connectToRoom(rawRoomId: string, forceRandomPeer = false) {
        const cleanRoom = sanitizeRoom(rawRoomId);
        if (!cleanRoom) return;

        if (
            !forceRandomPeer &&
            this.peer &&
            !this.peer.destroyed &&
            !this.peer.disconnected &&
            this.roomId === cleanRoom &&
            (this.connectionStatus === "connected" || this.connectionStatus === "connecting")
        ) {
            return;
        }

        this.cleanupPeer();
        this.destroyed = false;
        this.roomId = cleanRoom;
        this.hostPeerId = ROOM_PREFIX + cleanRoom;
        this.connectionStatus = "connecting";
        this.lastError = null;
        this.isHost = !forceRandomPeer;
        this.emit();

        const peerOpts = {
            host: PEER_HOST,
            port: PEER_PORT,
            path: PEER_PATH,
            secure: PEER_SECURE,
            debug: 0,
            config: {
                iceServers: ICE_SERVERS,
                iceCandidatePoolSize: 0
            }
        };

        try {
            const instance = forceRandomPeer
                ? new PeerCtor(peerOpts)
                : new PeerCtor(this.hostPeerId, peerOpts);
            this.peer = instance;
            this.bindPeerEvents(instance, cleanRoom);
        } catch (err: any) {
            this.connectionStatus = "error";
            this.lastError = err?.message || "Falha ao inicializar PeerJS";
            this.emit();
        }
    }

    disconnect() {
        this.cleanupPeer();
        this.roomId = "";
        this.hostPeerId = "";
        this.connectionStatus = "disconnected";
        this.isHost = false;
        this.myPeerId = null;
        this.lastError = null;
        this.emit();
    }

    destroy() {
        this.destroyed = true;
        this.stopLocalStream();
        this.disconnect();
        this.listeners.clear();
        if (this.chimeCtx) {
            try { this.chimeCtx.close().catch(() => {}); } catch {}
            this.chimeCtx = null;
        }
    }

    async getDesktopSources(): Promise<RoxyDesktopSource[]> {
        if (this.excludedAudioBridge?.getDesktopCaptureSources) {
            try {
                const nativeSources = await this.excludedAudioBridge.getDesktopCaptureSources();
                if (Array.isArray(nativeSources) && nativeSources.length > 0) {
                    return nativeSources;
                }
            } catch {}
        }

        const dc = (window as any).DiscordNative?.desktopCapture;
        if (dc?.getDesktopCaptureSources) {
            const rawSources: any[] = await dc.getDesktopCaptureSources({
                types: ["screen", "window"],
                thumbnailSize: { width: 480, height: 270 },
                fetchWindowIcons: true
            });

            return (rawSources || []).map(src => {
                const thumb = typeof src.thumbnail?.toDataURL === "function"
                    ? src.thumbnail.toDataURL()
                    : typeof src.thumbnail === "string"
                        ? src.thumbnail
                        : "";
                const icon = typeof src.appIcon?.toDataURL === "function"
                    ? src.appIcon.toDataURL()
                    : undefined;

                return {
                    id: String(src.id),
                    name: String(src.name || "Tela"),
                    thumbnailDataUrl: thumb,
                    appIconDataUrl: icon,
                    type: String(src.id || "").startsWith("screen:") ? "screen" : "window"
                };
            });
        }

        return [];
    }

    /** Câmeras disponíveis (aba "Dispositivos" do seletor). */
    async getCameraDevices(): Promise<Array<{ id: string; label: string }>> {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices
                .filter(d => d.kind === "videoinput" && d.deviceId)
                .map((d, i) => ({ id: d.deviceId, label: d.label || `Câmera ${i + 1}` }));
        } catch {
            return [];
        }
    }

    async startLocalStream(opts: RoxyCaptureOptions, label?: string): Promise<MediaStream> {
        let stream: MediaStream | null = null;
        const fps = opts.fps && opts.fps > 0 ? opts.fps : 60;
        const height = opts.height ?? 1080;
        const isCamera = Boolean(opts.cameraDeviceId);
        const mode: RoxyAudioMode = isCamera ? "none" : opts.audioMode || "exclude-discord";

        this.stopCleanAudio();
        this.audioMode = mode;
        this.excludedPid = null;
        this.audioNotice = null;
        this.lastError = null;

        if (isCamera) {
            // Câmera: vídeo puro. O áudio da call continua sendo o microfone do Discord.
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    deviceId: { exact: opts.cameraDeviceId },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: Math.min(fps, 30), max: fps }
                },
                audio: false
            });
        } else if (!opts.useDisplayMedia && opts.sourceId) {
            try {
                stream = await navigator.mediaDevices.getUserMedia(
                    getPreferredLocalConstraints({ ...opts, audioMode: mode }, false)
                );
            } catch {
                stream = await navigator.mediaDevices.getUserMedia(
                    getPreferredLocalConstraints({ ...opts, audioMode: "none" }, true)
                );
            }
        } else {
            const video: MediaTrackConstraints = {
                frameRate: { ideal: fps, max: fps }
            };
            if (height > 0) {
                video.width = { ideal: Math.round(height * (16 / 9)) };
                video.height = { ideal: height };
            }
            stream = await navigator.mediaDevices.getDisplayMedia({
                video,
                audio: mode === "system-all"
            });
        }

        if (mode === "exclude-discord") {
            const audioTrack = await this.initExcludedAudioTrack();
            if (audioTrack) {
                stream.getAudioTracks().forEach(t => {
                    stream!.removeTrack(t);
                    try { t.stop(); } catch {}
                });
                stream.addTrack(audioTrack);
            }
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
        }

        this.localStream = stream;
        this.localCaptureLabel = label
            || (isCamera ? "Câmera" : opts.sourceId?.startsWith("screen:") ? "Tela inteira" : "Janela");
        this.isStreaming = true;
        this.targetFps = fps;
        this.targetHeight = height;
        if (typeof opts.bitrateMbps === "number" && opts.bitrateMbps > 0) {
            this.bitrateMbps = opts.bitrateMbps;
        }

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            if ("contentHint" in videoTrack) {
                videoTrack.contentHint = fps >= 50 ? "motion" : "detail";
            }
            videoTrack.addEventListener("ended", () => {
                if (this.localStream === stream) {
                    this.stopLocalStream();
                }
            });
        }

        const targetRoom = sanitizeRoom(this.customRoomId) || channelToRoomId(this.voiceChannelId);
        if (this.connectionStatus !== "connected" && targetRoom) {
            this.connectToRoom(targetRoom);
        }

        this.streamStartedAt = Date.now();
        this.connections.forEach(c => { c.isViewerWatching = false; });
        this.playChime("streamStart");
        this.broadcastData({
            type: "streamStarted",
            name: this.getLocalDisplayName()
        });

        this.connections.forEach(c => {
            this.callPeer(c.peerId, stream!, true);
        });

        this.emit();
        return stream;
    }

    stopLocalStream() {
        const wasStreaming = this.isStreaming;
        this.stopCleanAudio();
        this.excludedPid = null;
        this.audioNotice = null;

        if (this.localStream) {
            this.localStream.getTracks().forEach(t => {
                try {
                    t.stop();
                } catch {}
            });
            this.localStream = null;
        }
        this.isStreaming = false;
        this.localCaptureLabel = "";

        this.connections.forEach(c => {
            c.isCalling = false;
            c.isViewerWatching = false;
            if (c.outgoingCall) {
                try {
                    c.outgoingCall.close();
                } catch {}
                c.outgoingCall = undefined;
            }
        });

        if (wasStreaming) {
            this.playChime("streamStop");
            this.broadcastData({
                type: "streamStopped",
                name: this.getLocalDisplayName()
            });
        }
        this.emit();
    }

    private stopCleanAudio() {
        if (this.cleanAudioWs) {
            const ws = this.cleanAudioWs;
            this.cleanAudioWs = null;
            try { ws.close(); } catch {}
        }
        if (this.cleanAudioProc) {
            try {
                this.cleanAudioProc.onaudioprocess = null;
                this.cleanAudioProc.disconnect();
            } catch {}
            this.cleanAudioProc = null;
        }
        if (this.cleanAudioDest) {
            try { this.cleanAudioDest.disconnect(); } catch {}
            this.cleanAudioDest = null;
        }
        if (this.cleanAudioCtx) {
            try { this.cleanAudioCtx.close().catch(() => {}); } catch {}
            this.cleanAudioCtx = null;
        }
        if (this.excludedAudioBridge) {
            this.excludedAudioBridge.stopExcludedAudio().catch(() => {});
        }
    }

    private async initExcludedAudioTrack(): Promise<MediaStreamTrack | null> {
        if (!this.excludedAudioBridge) {
            this.audioNotice = "Sem ponte nativa (enviando sem áudio para evitar eco).";
            return null;
        }

        const startRes: ExcludedAudioStartResult = await this.excludedAudioBridge
            .startExcludedAudio(8095)
            .catch((err): ExcludedAudioStartResult => ({
                ok: false,
                error: err?.message || "Falha ao iniciar RoxyAudioHelper"
            }));

        if (!startRes.ok || !startRes.port) {
            this.audioNotice = startRes.error || "Helper de áudio não encontrado (enviando sem áudio).";
            return null;
        }

        this.excludedPid = startRes.excludedPid || null;
        this.audioNotice = "Áudio sem voz do Discord ativo";

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) {
            this.audioNotice = "WebAudio indisponível (enviando sem áudio).";
            return null;
        }

        const ctx = new AudioCtx({ sampleRate: 48000 });
        if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }
        const dest = ctx.createMediaStreamDestination();
        const proc = ctx.createScriptProcessor(2048, 0, 2);

        const ringCapacity = 48000 * 2;
        const ring = new Float32Array(ringCapacity);
        let writeIdx = 0;
        let readIdx = 0;
        let available = 0;
        let primed = false;
        let rsPos = 0;
        let rsPrevL = 0;
        let rsPrevR = 0;

        const pushFrame = (l: number, r: number) => {
            if (available + 2 > ringCapacity) return;
            ring[writeIdx] = l;
            writeIdx = (writeIdx + 1) % ringCapacity;
            ring[writeIdx] = r;
            writeIdx = (writeIdx + 1) % ringCapacity;
            available += 2;
        };

        proc.onaudioprocess = ev => {
            const outL = ev.outputBuffer.getChannelData(0);
            const outR = ev.outputBuffer.getChannelData(1);
            const frameCount = outL.length;

            const primeSamples = 3072 * 2;
            if (!primed) {
                if (available < primeSamples) {
                    outL.fill(0);
                    outR.fill(0);
                    return;
                }
                primed = true;
            }

            const maxLatencySamples = 48000 * 2 * 0.15;
            if (available > maxLatencySamples) {
                let excess = available - maxLatencySamples;
                excess -= excess % 2;
                readIdx = (readIdx + excess) % ringCapacity;
                available -= excess;
            }

            const framesAvail = Math.min(frameCount, available >> 1);
            const samplesToRead = framesAvail * 2;
            let rIdx = readIdx;
            if (rIdx + samplesToRead <= ringCapacity) {
                for (let i = 0; i < framesAvail; i++) {
                    outL[i] = ring[rIdx++];
                    outR[i] = ring[rIdx++];
                }
                readIdx = rIdx === ringCapacity ? 0 : rIdx;
            } else {
                for (let i = 0; i < framesAvail; i++) {
                    outL[i] = ring[rIdx];
                    rIdx = (rIdx + 1) % ringCapacity;
                    outR[i] = ring[rIdx];
                    rIdx = (rIdx + 1) % ringCapacity;
                }
                readIdx = rIdx;
            }
            available -= samplesToRead;
            if (framesAvail < frameCount) {
                for (let i = framesAvail; i < frameCount; i++) {
                    outL[i] = 0;
                    outR[i] = 0;
                }
                primed = false;
            }
        };

        proc.connect(dest);
        this.cleanAudioCtx = ctx;
        this.cleanAudioDest = dest;
        this.cleanAudioProc = proc;

        return new Promise(resolve => {
            let settled = false;
            const ws = new WebSocket(`ws://127.0.0.1:${startRes.port}`);
            this.cleanAudioWs = ws;
            ws.binaryType = "arraybuffer";

            ws.onopen = () => {
                if (this.cleanAudioCtx?.state === "suspended") {
                    this.cleanAudioCtx.resume().catch(() => {});
                }
                if (!settled) {
                    settled = true;
                    resolve(dest.stream.getAudioTracks()[0] || null);
                }
            };

            ws.onmessage = event => {
                if (!(event.data instanceof ArrayBuffer)) return;
                const buf = event.data;
                if (buf.byteLength <= 8) return;
                const view = new DataView(buf);
                if (view.getUint8(0) !== 65) return;

                const srcRate = view.getUint32(2, false) || 48000;
                const channels = Math.max(1, view.getUint16(6, false) || 2);
                const frames = Math.floor((buf.byteLength - 8) / (4 * channels));
                if (frames === 0) return;

                const f = new Float32Array(buf, 8, frames * channels);
                const ctxRate = ctx.sampleRate || 48000;

                if (srcRate === ctxRate && channels === 2) {
                    const totalSamples = frames * 2;
                    const toWrite = Math.min(totalSamples, ringCapacity - available);
                    if (toWrite > 0) {
                        const firstChunk = Math.min(toWrite, ringCapacity - writeIdx);
                        ring.set(f.subarray(0, firstChunk), writeIdx);
                        if (toWrite > firstChunk) {
                            ring.set(f.subarray(firstChunk, toWrite), 0);
                        }
                        writeIdx = (writeIdx + toWrite) % ringCapacity;
                        available += toWrite;
                    }
                } else if (srcRate === ctxRate) {
                    for (let i = 0; i < frames; i++) {
                        const l = f[i * channels];
                        pushFrame(l, channels > 1 ? f[i * channels + 1] : l);
                    }
                } else {
                    const step = srcRate / ctxRate;
                    let p = rsPos;
                    const getL = (k: number) => (k === 0 ? rsPrevL : f[(k - 1) * channels]);
                    const getR = (k: number) =>
                        k === 0 ? rsPrevR : channels > 1 ? f[(k - 1) * channels + 1] : f[(k - 1) * channels];
                    while (p < frames) {
                        const k = Math.floor(p);
                        const fr = p - k;
                        pushFrame(
                            getL(k) * (1 - fr) + getL(k + 1) * fr,
                            getR(k) * (1 - fr) + getR(k + 1) * fr
                        );
                        p += step;
                    }
                    rsPos = p - frames;
                    rsPrevL = f[(frames - 1) * channels];
                    rsPrevR = channels > 1 ? f[(frames - 1) * channels + 1] : rsPrevL;
                }
            };

            ws.onerror = () => {
                if (!settled) {
                    settled = true;
                    this.audioNotice = "Falha ao conectar áudio local (enviando sem áudio).";
                    resolve(null);
                }
            };

            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve(dest.stream.getAudioTracks()[0] || null);
                }
            }, 1500);
        });
    }

    watchPeerStream(peerId: string) {
        const c = this.connections.get(peerId);
        if (!c) return;
        const alreadyActive = Boolean(c.remoteStream && !c.watchingPaused);
        c.watchingPaused = false;
        this.stageCollapsed = false;
        if (!alreadyActive) {
            c.suppressNextOpenSoundUntil = Date.now() + 4000;
            this.playChime("viewerJoin");
        }
        if (c.dataConn?.open) {
            try {
                c.dataConn.send({ type: "requestStream", peerId: this.myPeerId });
            } catch {}
        }
        this.emit();
    }

    stopWatchingPeer(peerId: string) {
        const c = this.connections.get(peerId);
        if (!c) return;
        const wasWatching = Boolean(c.remoteStream || !c.watchingPaused);
        c.watchingPaused = true;
        c.remoteStream = undefined;
        if (c.incomingCall) {
            try {
                c.incomingCall.close();
            } catch {}
            c.incomingCall = undefined;
        }
        if (c.dataConn?.open) {
            try {
                c.dataConn.send({ type: "stopWatching", peerId: this.myPeerId });
            } catch {}
        }
        if (this.spotlightPeerId === peerId) {
            this.spotlightPeerId = null;
        }
        if (wasWatching) {
            this.playChime("viewerLeave");
        }
        this.emit();
    }

    private getLocalDisplayName(): string {
        return this.localProfile.displayName || this.localProfile.username || "Amigo Discord";
    }

    private cleanupPeer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.requestPollTimer) {
            clearInterval(this.requestPollTimer);
            this.requestPollTimer = null;
        }

        this.connections.forEach(c => {
            try { c.dataConn?.close(); } catch {}
            try { c.incomingCall?.close(); } catch {}
            try { c.outgoingCall?.close(); } catch {}
        });
        this.connections.clear();
        this.spotlightPeerId = null;

        if (this.peer) {
            try {
                this.peer.destroy();
            } catch {}
            this.peer = null;
        }
    }

    private runMeshMaintenance() {
        if (!this.peer || this.peer.destroyed || this.connectionStatus !== "connected") return;

        // 1. Envia ping para peers conectados
        this.connections.forEach(c => {
            if (c.dataConn?.open) {
                try {
                    c.dataConn.send({ type: "ping", peerId: this.myPeerId });
                } catch {}
            }
        });

        // 2. Se estou transmitindo, garante que todos os peers com dataConn aberto recebam chamada de vídeo
        if (this.isStreaming && this.localStream) {
            this.connections.forEach((c, id) => {
                if (c.dataConn?.open) {
                    const hasActiveCall = c.outgoingCall && !c.outgoingCall.destroyed && c.outgoingCall.open;
                    if (!hasActiveCall && !c.isCalling) {
                        this.callPeer(id, this.localStream!, false);
                    }
                }
            });
        }

        // 3. Se um peer remoto está transmitindo e eu não tenho o vídeo ativo, pede a stream de volta
        this.connections.forEach(c => {
            if (c.isStreamingRemote && !c.watchingPaused && this.autoWatchStreams && c.dataConn?.open) {
                const hasLiveTrack = c.remoteStream?.getVideoTracks?.().some(t => t.readyState === "live");
                if (!hasLiveTrack) {
                    try {
                        c.dataConn.send({ type: "requestStream", peerId: this.myPeerId });
                    } catch {}
                }
            }
        });

        // 4. Se sou cliente e perdi contato com o anfitrião, tenta reconectar
        if (!this.isHost && this.hostPeerId && this.hostPeerId !== this.myPeerId) {
            const hostConn = this.connections.get(this.hostPeerId);
            if (!hostConn || !hostConn.dataConn || !hostConn.dataConn.open) {
                this.connectToPeer(this.hostPeerId, "Anfitrião", true);
            }
        }
    }

    private bindPeerEvents(peerInstance: any, room: string) {
        peerInstance.on("open", (id: string) => {
            if (this.peer !== peerInstance || this.destroyed) return;
            this.myPeerId = id;
            this.connectionStatus = "connected";
            this.lastError = null;

            if (!this.isHost) {
                this.connectToPeer(this.hostPeerId, "Anfitrião", true);
            }

            if (this.requestPollTimer) {
                clearInterval(this.requestPollTimer);
            }
            this.requestPollTimer = setInterval(() => {
                this.runMeshMaintenance();
            }, 2500);

            this.emit();
        });

        peerInstance.on("connection", (conn: any) => {
            if (this.peer !== peerInstance) return;
            this.setupDataConnection(conn);
        });

        peerInstance.on("call", (call: any) => {
            if (this.peer !== peerInstance) return;
            const fromPeer = call.peer;
            const existing = this.ensurePeerEntry(fromPeer, call.metadata?.name || "Amigo", fromPeer.startsWith(ROOM_PREFIX));

            if (existing.incomingCall && existing.incomingCall !== call) {
                try {
                    existing.incomingCall.close();
                } catch {}
            }
            existing.incomingCall = call;

            call.answer();
            this.configureLowLatencyReceiver(call);

            call.on("stream", (remoteStream: MediaStream) => {
                if (existing.watchingPaused) return;
                const hadStream = Boolean(existing.remoteStream);
                existing.isStreamingRemote = true;
                existing.remoteStream = remoteStream;
                this.stageCollapsed = false;
                if (!hadStream && Date.now() > (existing.suppressNextOpenSoundUntil || 0)) {
                    this.playChime("viewerJoin");
                }
                this.emit();
            });

            call.on("close", () => {
                if (existing.incomingCall === call) {
                    existing.incomingCall = undefined;
                    existing.remoteStream = undefined;
                    if (this.spotlightPeerId === fromPeer) this.spotlightPeerId = null;
                    this.emit();
                }
            });

            call.on("error", () => {
                if (existing.incomingCall === call) {
                    existing.incomingCall = undefined;
                    existing.remoteStream = undefined;
                    this.emit();
                }
            });
        });

        peerInstance.on("disconnected", () => {
            if (this.peer !== peerInstance || this.destroyed) return;
            try {
                peerInstance.reconnect();
            } catch {}
        });

        peerInstance.on("error", (err: any) => {
            if (this.peer !== peerInstance || this.destroyed) return;

            if (err?.type === "unavailable-id" && this.isHost) {
                this.connectToRoom(room, true);
                return;
            }

            if (err?.type === "peer-unavailable" && !this.isHost) {
                this.scheduleRejoin(room, 2500);
                return;
            }

            this.lastError = err?.message || err?.type || "Erro P2P";
            if (err?.type === "network" || err?.type === "server-error") {
                this.connectionStatus = "error";
                this.scheduleRejoin(room, 4000);
            }
            this.emit();
        });
    }

    private scheduleRejoin(room: string, delayMs: number) {
        if (this.reconnectTimer || this.destroyed) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.destroyed && this.roomId === room) {
                this.connectToRoom(room, false);
            }
        }, delayMs);
    }

    private ensurePeerEntry(peerId: string, name: string, isHost: boolean): InternalPeerConn {
        let entry = this.connections.get(peerId);
        if (!entry) {
            entry = {
                peerId,
                name: name || "Amigo",
                avatarUrl: "",
                status: "online",
                isHost,
                isStreamingRemote: false,
                watchingPaused: false,
                profile: null,
                muted: false,
                volume: 1
            };
            this.connections.set(peerId, entry);
        }
        return entry;
    }

    private connectToPeer(remotePeerId: string, fallbackName: string, isRemoteHost: boolean) {
        if (!this.peer || this.peer.destroyed || !remotePeerId || remotePeerId === this.myPeerId) return;
        const existing = this.connections.get(remotePeerId);
        if (existing?.dataConn?.open) return;

        try {
            const conn = this.peer.connect(remotePeerId, { reliable: true });
            const entry = this.ensurePeerEntry(remotePeerId, fallbackName, isRemoteHost);
            entry.dataConn = conn;
            this.setupDataConnection(conn);
        } catch {}
    }

    private setupDataConnection(conn: any) {
        const remoteId = conn.peer;
        const isRemoteHost = remoteId.startsWith(ROOM_PREFIX);
        const entry = this.ensurePeerEntry(remoteId, "Amigo", isRemoteHost);
        entry.dataConn = conn;

        const onOpen = () => {
            try {
                conn.send({
                    type: "hello",
                    name: this.getLocalDisplayName(),
                    avatarUrl: this.localProfile.avatarUrl || "",
                    status: sanitizeStatus(this.localProfile.status),
                    peerId: this.myPeerId,
                    isHost: this.isHost,
                    isStreaming: this.isStreaming,
                    profile: this.localProfile
                });
                // Solicita stream imediatamente ao abrir canal (igual ao app standalone)
                conn.send({ type: "requestStream", peerId: this.myPeerId });
            } catch {}

            // Se eu já estiver transmitindo, liga para o novo peer na mesma hora
            if (this.isStreaming && this.localStream) {
                this.callPeer(remoteId, this.localStream, false);
            }

            if (this.isHost) {
                const peersPayload: any[] = [];
                this.connections.forEach((c, id) => {
                    if (id !== remoteId) {
                        peersPayload.push({
                            peerId: id,
                            name: c.name,
                            avatarUrl: c.avatarUrl,
                            status: c.status,
                            isHost: c.isHost,
                            isStreaming: c.isStreamingRemote,
                            profile: c.profile
                        });
                    }
                });
                try {
                    conn.send({
                        type: "roomState",
                        hostName: this.getLocalDisplayName(),
                        hostAvatarUrl: this.localProfile.avatarUrl || "",
                        hostStatus: sanitizeStatus(this.localProfile.status),
                        hostStreaming: this.isStreaming,
                        hostProfile: this.localProfile,
                        peers: peersPayload
                    });
                } catch {}
            }
        };

        if (conn.open) onOpen();
        else conn.on("open", onOpen);

        conn.on("data", (msg: any) => {
            this.handleDataMessage(remoteId, msg);
        });

        conn.on("close", () => {
            const wasHost = remoteId === this.hostPeerId;
            this.removePeer(remoteId);
            if (wasHost && !this.isHost && this.roomId && !this.destroyed) {
                this.scheduleRejoin(this.roomId, 1600);
            }
        });
    }

    private handleDataMessage(fromPeerId: string, data: any) {
        if (!data || typeof data !== "object") return;
        const isRemoteHost = fromPeerId.startsWith(ROOM_PREFIX);

        switch (data.type) {
            case "ping": {
                const c = this.connections.get(fromPeerId);
                if (c?.dataConn?.open) {
                    try {
                        c.dataConn.send({ type: "pong", peerId: this.myPeerId });
                    } catch {}
                }
                break;
            }

            case "pong": {
                break;
            }

            case "hello": {
                const isNew = !this.connections.has(fromPeerId);
                const entry = this.ensurePeerEntry(fromPeerId, data.name || "Amigo", isRemoteHost);
                entry.name = data.name || entry.name;
                entry.status = sanitizeStatus(data.status);
                const av = sanitizeAvatarUrl(data.avatarUrl);
                if (av) entry.avatarUrl = av;
                if (data.profile) entry.profile = data.profile;
                if (typeof data.isStreaming === "boolean") {
                    entry.isStreamingRemote = data.isStreaming;
                }

                if (this.isHost) {
                    const peerSummary = {
                        peerId: fromPeerId,
                        name: entry.name,
                        avatarUrl: entry.avatarUrl,
                        status: entry.status,
                        isStreaming: entry.isStreamingRemote,
                        profile: entry.profile
                    };
                    if (isNew) {
                        this.broadcastData({ type: "peerJoined", ...peerSummary }, fromPeerId);
                    } else {
                        this.broadcastData({ type: "peerUpdated", ...peerSummary }, fromPeerId);
                    }
                }

                if (entry.isStreamingRemote && this.autoWatchStreams && !entry.watchingPaused && entry.dataConn?.open) {
                    try {
                        entry.dataConn.send({ type: "requestStream", peerId: this.myPeerId });
                    } catch {}
                }

                if (this.isStreaming && this.localStream) {
                    this.callPeer(fromPeerId, this.localStream, false);
                }
                this.emit();
                break;
            }

            case "roomState": {
                if (data.hostName) {
                    const hostEntry = this.ensurePeerEntry(fromPeerId, data.hostName, true);
                    hostEntry.name = data.hostName;
                    hostEntry.status = sanitizeStatus(data.hostStatus);
                    const av = sanitizeAvatarUrl(data.hostAvatarUrl);
                    if (av) hostEntry.avatarUrl = av;
                    if (data.hostProfile) hostEntry.profile = data.hostProfile;
                    if (typeof data.hostStreaming === "boolean") {
                        hostEntry.isStreamingRemote = data.hostStreaming;
                    }
                    if (hostEntry.isStreamingRemote && this.autoWatchStreams && !hostEntry.watchingPaused) {
                        try {
                            hostEntry.dataConn?.send({ type: "requestStream", peerId: this.myPeerId });
                        } catch {}
                    }
                }

                if (Array.isArray(data.peers)) {
                    data.peers.forEach((p: any) => {
                        if (!p?.peerId || p.peerId === this.myPeerId) return;
                        const peerEntry = this.ensurePeerEntry(p.peerId, p.name || "Amigo", !!p.isHost);
                        peerEntry.name = p.name || peerEntry.name;
                        peerEntry.status = sanitizeStatus(p.status);
                        const av = sanitizeAvatarUrl(p.avatarUrl);
                        if (av) peerEntry.avatarUrl = av;
                        if (p.profile) peerEntry.profile = p.profile;
                        if (typeof p.isStreaming === "boolean") {
                            peerEntry.isStreamingRemote = p.isStreaming;
                        }
                        if (!p.isHost && this.myPeerId && this.myPeerId < p.peerId && !peerEntry.dataConn) {
                            this.connectToPeer(p.peerId, peerEntry.name, false);
                        }
                    });
                }
                this.emit();
                break;
            }

            case "peerJoined": {
                if (!data.peerId || data.peerId === this.myPeerId) return;
                const entry = this.ensurePeerEntry(data.peerId, data.name || "Amigo", !!data.peerId.startsWith(ROOM_PREFIX));
                entry.name = data.name || entry.name;
                entry.status = sanitizeStatus(data.status);
                const av = sanitizeAvatarUrl(data.avatarUrl);
                if (av) entry.avatarUrl = av;
                if (data.profile) entry.profile = data.profile;
                if (typeof data.isStreaming === "boolean") {
                    entry.isStreamingRemote = data.isStreaming;
                }
                if (this.myPeerId && this.myPeerId < data.peerId && !entry.dataConn) {
                    this.connectToPeer(data.peerId, entry.name, false);
                }
                this.emit();
                break;
            }

            case "peerUpdated": {
                if (!data.peerId || data.peerId === this.myPeerId) return;
                const entry = this.ensurePeerEntry(data.peerId, data.name || "Amigo", data.peerId.startsWith(ROOM_PREFIX));
                if (data.name) entry.name = data.name;
                if (data.status) entry.status = sanitizeStatus(data.status);
                const av = sanitizeAvatarUrl(data.avatarUrl);
                if (av) entry.avatarUrl = av;
                if (data.profile) entry.profile = data.profile;
                this.emit();
                break;
            }

            case "peerLeft": {
                if (data.peerId && data.peerId !== this.myPeerId) {
                    this.removePeer(data.peerId);
                }
                break;
            }

            case "requestStream": {
                if (this.isStreaming && this.localStream) {
                    const c = this.connections.get(fromPeerId);
                    const wasWatching = Boolean(c?.isViewerWatching);
                    if (c) c.isViewerWatching = true;
                    this.callPeer(fromPeerId, this.localStream, true);
                    if (!wasWatching && Date.now() - this.streamStartedAt > 1200) {
                        this.playChime("viewerJoin");
                    }
                }
                break;
            }

            case "stopWatching": {
                const c = this.connections.get(fromPeerId);
                if (c) {
                    const wasWatching = Boolean(c.isViewerWatching);
                    c.isViewerWatching = false;
                    c.isCalling = false;
                    if (c.outgoingCall) {
                        try {
                            c.outgoingCall.close();
                        } catch {}
                        c.outgoingCall = undefined;
                    }
                    if (wasWatching && this.isStreaming) {
                        this.playChime("viewerLeave");
                    }
                }
                break;
            }

            case "streamStarted": {
                const prev = this.connections.get(fromPeerId);
                const wasAlreadyLive = Boolean(prev?.isStreamingRemote);
                const entry = this.ensurePeerEntry(fromPeerId, data.name || "Amigo", isRemoteHost);
                entry.isStreamingRemote = true;
                entry.watchingPaused = false;
                if (!wasAlreadyLive) {
                    entry.suppressNextOpenSoundUntil = Date.now() + 3000;
                    this.playChime("streamStart");
                }
                if (this.autoWatchStreams && entry.dataConn?.open) {
                    try {
                        entry.dataConn.send({ type: "requestStream", peerId: this.myPeerId });
                    } catch {}
                }
                this.emit();
                break;
            }

            case "streamStopped": {
                const entry = this.connections.get(fromPeerId);
                if (entry) {
                    const wasLive = Boolean(entry.isStreamingRemote || entry.remoteStream);
                    entry.isStreamingRemote = false;
                    entry.watchingPaused = false;
                    entry.remoteStream = undefined;
                    if (entry.incomingCall) {
                        try {
                            entry.incomingCall.close();
                        } catch {}
                        entry.incomingCall = undefined;
                    }
                    if (this.spotlightPeerId === fromPeerId) {
                        this.spotlightPeerId = null;
                    }
                    if (wasLive) this.playChime("streamStop");
                }
                this.emit();
                break;
            }
        }
    }

    private removePeer(peerId: string) {
        const entry = this.connections.get(peerId);
        if (!entry) return;
        const wasWatchingMyStream = this.isStreaming && Boolean(entry.isViewerWatching);
        const wasStreamingToMe = Boolean(entry.remoteStream);
        try { entry.dataConn?.close(); } catch {}
        try { entry.incomingCall?.close(); } catch {}
        try { entry.outgoingCall?.close(); } catch {}
        this.connections.delete(peerId);

        if (wasWatchingMyStream) {
            this.playChime("viewerLeave");
        } else if (wasStreamingToMe) {
            this.playChime("streamStop");
        }

        if (this.spotlightPeerId === peerId) {
            this.spotlightPeerId = null;
        }
        if (this.isHost) {
            this.broadcastData({ type: "peerLeft", peerId }, peerId);
        }
        this.emit();
    }

    private broadcastData(payload: any, excludePeerId?: string) {
        this.connections.forEach((c, id) => {
            if (excludePeerId && id === excludePeerId) return;
            if (c.dataConn?.open) {
                try {
                    c.dataConn.send(payload);
                } catch {}
            }
        });
    }

    private callPeer(remotePeerId: string, stream: MediaStream, force: boolean) {
        if (!this.peer || this.peer.destroyed || !stream) return;
        const entry = this.ensurePeerEntry(remotePeerId, "Amigo", remotePeerId.startsWith(ROOM_PREFIX));

        if (!force && entry.outgoingCall?.open) return;
        if (entry.isCalling) return;

        if (entry.outgoingCall) {
            try {
                entry.outgoingCall.close();
            } catch {}
            entry.outgoingCall = undefined;
        }

        entry.isCalling = true;
        try {
            const call = this.peer.call(remotePeerId, stream, {
                metadata: { name: this.getLocalDisplayName() }
            });
            entry.outgoingCall = call;

            if (call.peerConnection) {
                try {
                    if (typeof RTCRtpSender.getCapabilities === "function") {
                        const caps = RTCRtpSender.getCapabilities("video");
                        if (caps && caps.codecs) {
                            const h264Hw = caps.codecs.filter(c =>
                                c.mimeType.toLowerCase() === "video/h264" &&
                                c.sdpFmtpLine && c.sdpFmtpLine.includes("packetization-mode=1")
                            );
                            const h264Rest = caps.codecs.filter(c =>
                                c.mimeType.toLowerCase() === "video/h264" &&
                                (!c.sdpFmtpLine || !c.sdpFmtpLine.includes("packetization-mode=1"))
                            );
                            const vp8 = caps.codecs.filter(c => c.mimeType.toLowerCase() === "video/vp8");
                            const others = caps.codecs.filter(c =>
                                c.mimeType.toLowerCase() !== "video/h264" && c.mimeType.toLowerCase() !== "video/vp8"
                            );
                            const sorted = [...h264Hw, ...vp8, ...h264Rest, ...others];
                            call.peerConnection.getTransceivers().forEach((tr: any) => {
                                if (tr.sender?.track?.kind === "video" && typeof tr.setCodecPreferences === "function") {
                                    tr.setCodecPreferences(sorted);
                                }
                            });
                        }
                    }
                } catch {}
                this.tuneSenderConnection(call.peerConnection);
            }

            call.on("error", () => {
                entry.isCalling = false;
                if (entry.outgoingCall === call) entry.outgoingCall = undefined;
            });

            call.on("close", () => {
                entry.isCalling = false;
                if (entry.outgoingCall === call) entry.outgoingCall = undefined;
            });

            setTimeout(() => {
                if (entry.isCalling) entry.isCalling = false;
            }, 3000);
        } catch {
            entry.isCalling = false;
        }
    }

    private tuneSenderConnection(pc: RTCPeerConnection) {
        const apply = () => {
            const bps = Math.max(1_000_000, this.bitrateMbps * 1_000_000);
            pc.getSenders().forEach(sender => {
                if (sender.track?.kind !== "video") return;
                try {
                    const params = sender.getParameters();
                    if (!params.encodings || !params.encodings.length) {
                        params.encodings = [{}];
                    }
                    params.encodings[0].maxBitrate = bps;
                    params.encodings[0].maxFramerate = Math.max(15, this.targetFps || 60);
                    params.encodings[0].scaleResolutionDownBy = 1;
                    params.encodings[0].networkPriority = "high";
                    params.degradationPreference =
                        this.targetHeight === 0 || this.targetHeight >= 1440
                            ? "maintain-resolution"
                            : "maintain-framerate";
                    sender.setParameters(params).catch(() => {});
                } catch {}
            });
        };

        apply();
        if (pc.connectionState !== "connected") {
            const onConnChange = () => {
                if (pc.connectionState === "connected") {
                    apply();
                    pc.removeEventListener("connectionstatechange", onConnChange);
                } else if (pc.connectionState === "closed" || pc.connectionState === "failed") {
                    pc.removeEventListener("connectionstatechange", onConnChange);
                }
            };
            pc.addEventListener("connectionstatechange", onConnChange);
        }
    }

    private applyBitrateToActiveSenders() {
        this.connections.forEach(c => {
            const pc: RTCPeerConnection | undefined = c.outgoingCall?.peerConnection;
            if (pc) this.tuneSenderConnection(pc);
        });
    }

    private configureLowLatencyReceiver(call: any) {
        const applyReceiverHints = (receiver: RTCRtpReceiver | null | undefined) => {
            if (!receiver) return;
            const r = receiver as any;
            try {
                if ("playoutDelayHint" in r) r.playoutDelayHint = 0;
                if ("jitterBufferTarget" in r) r.jitterBufferTarget = 0;
            } catch {}
        };

        try {
            const pc: RTCPeerConnection | undefined = call.peerConnection;
            if (!pc) return;
            pc.getReceivers().forEach(applyReceiverHints);
            pc.addEventListener("track", e => applyReceiverHints(e.receiver));
        } catch {}
    }

    // Um único AudioContext reaproveitado: criar e destruir um contexto por "chime"
    // alocava uma thread de áudio e buffer de saída a cada abertura/fechamento de stream.
    private chimeCtx: AudioContext | null = null;

    private playChime(type: "streamStart" | "streamStop" | "viewerJoin" | "viewerLeave") {
        if (!this.soundEffects) return;
        try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioCtx) return;
            if (!this.chimeCtx || this.chimeCtx.state === "closed") {
                this.chimeCtx = new AudioCtx();
            }
            const ctx = this.chimeCtx;
            if (ctx.state === "suspended") ctx.resume().catch(() => {});

            const presets: Record<typeof type, { freqs: number[]; step: number; tail: number; gain: number }> = {
                streamStart: { freqs: [523.25, 659.25, 783.99], step: 0.065, tail: 0.22, gain: 0.045 },
                streamStop:  { freqs: [587.33, 440.00],         step: 0.075, tail: 0.24, gain: 0.045 },
                viewerJoin:  { freqs: [698.46, 987.77],         step: 0.055, tail: 0.18, gain: 0.036 },
                viewerLeave: { freqs: [783.99, 523.25],         step: 0.055, tail: 0.18, gain: 0.036 }
            };
            const cfg = presets[type];
            const now = ctx.currentTime;

            cfg.freqs.forEach((freq, idx) => {
                const startAt = now + idx * cfg.step;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "sine";
                osc.frequency.setValueAtTime(freq, startAt);
                gain.gain.setValueAtTime(0.0001, startAt);
                gain.gain.exponentialRampToValueAtTime(cfg.gain, startAt + 0.018);
                gain.gain.exponentialRampToValueAtTime(0.0001, startAt + cfg.tail);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(startAt);
                osc.stop(startAt + cfg.tail + 0.02);
                osc.onended = () => {
                    try { osc.disconnect(); gain.disconnect(); } catch {}
                };
            });
        } catch {}
    }
}
