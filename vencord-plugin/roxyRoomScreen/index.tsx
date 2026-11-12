import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { makeRange, OptionType, PluginNative } from "@utils/types";
import {
    ChannelStore,
    createRoot,
    Menu,
    PresenceStore,
    React,
    SelectedChannelStore,
    UserProfileStore,
    UserStore
} from "@webpack/common";

import {
    closeRoxyOverlayModal,
    openRoxyRoomModal,
    openRoxySourcePickerModal,
    RoxyCallStage,
    RoxyUiDefaults,
    RoxyVoicePanelButton
} from "./RoxyCallUI";
import { RoxyAudioMode, RoxyEngine, RoxyUserProfile } from "./RoxyEngine";
import managedStyle from "./styles.css?managed";

const Native = (typeof VencordNative !== "undefined"
    ? VencordNative.pluginHelpers?.RoxyRoomScreen
    : undefined) as PluginNative<typeof import("./native")> | undefined;

export const settings = definePluginSettings({
    autoConnectInVoice: {
        type: OptionType.BOOLEAN,
        description: "Conectar automaticamente à sala Roxy P2P (DC-<canal>) ao entrar em uma call de voz",
        default: true
    },
    autoWatchStreams: {
        type: OptionType.BOOLEAN,
        description: "Abrir automaticamente transmissões compartilhadas na sala dentro da call",
        default: true
    },
    defaultHeight: {
        type: OptionType.SELECT,
        description: "Resolução padrão ao iniciar transmissão Roxy",
        options: [
            { label: "Nativa (Original)", value: 0 },
            { label: "4K Ultra HD (2160p)", value: 2160 },
            { label: "1440p QHD (2K)", value: 1440 },
            { label: "1080p Full HD", value: 1080, default: true },
            { label: "720p HD", value: 720 }
        ]
    },
    defaultFps: {
        type: OptionType.SELECT,
        description: "Taxa de quadros (FPS) padrão",
        options: [
            { label: "144 FPS", value: 144 },
            { label: "120 FPS", value: 120 },
            { label: "60 FPS (Suave)", value: 60, default: true },
            { label: "30 FPS (Econômico)", value: 30 }
        ]
    },
    bitrateMbps: {
        type: OptionType.SLIDER,
        description: "Bitrate alvo de transmissão P2P (Mbps)",
        markers: makeRange(2, 50, 4),
        default: 10,
        stickToMarkers: false
    },
    audioMode: {
        type: OptionType.SELECT,
        description: "Modo de áudio ao transmitir a tela",
        options: [
            { label: "Som do PC sem voz do Discord (Sem Eco)", value: "exclude-discord", default: true },
            { label: "Sem áudio (Apenas vídeo)", value: "none" },
            { label: "Todo som do PC (Pode dar eco na call)", value: "system-all" }
        ]
    },
    soundEffects: {
        type: OptionType.BOOLEAN,
        description: "Reproduzir sons ao abrir/fechar transmissão e ao entrar/sair de uma tela",
        default: true
    },
    webPlayerBaseUrl: {
        type: OptionType.STRING,
        description: "URL do Player Web para compartilhar com amigos sem Vencord",
        default: "https://mariocesarflore.github.io/Roxy-Room/player.html"
    }
});

interface MountedNode {
    el: HTMLElement;
    root: ReturnType<typeof createRoot>;
}

const engine = new RoxyEngine();
let rafId: number | null = null;
let safetyInterval: ReturnType<typeof setInterval> | null = null;
let engineUnsub: (() => void) | null = null;
let delayedSyncTimer: ReturnType<typeof setTimeout> | null = null;

let stageMount: MountedNode | null = null;
let panelMount: MountedNode | null = null;

function getUiDefaults(): RoxyUiDefaults {
    return {
        fps: Number(settings.store.defaultFps) || 60,
        height: Number(settings.store.defaultHeight ?? 1080),
        bitrateMbps: Number(settings.store.bitrateMbps) || 10,
        audioMode: (settings.store.audioMode as RoxyAudioMode) || "exclude-discord",
        webPlayerBaseUrl: settings.store.webPlayerBaseUrl || "https://mariocesarflore.github.io/Roxy-Room/player.html"
    };
}

const voiceJoinedAtMap = new Map<string, number>();

function buildLocalDiscordProfile(): RoxyUserProfile {
    const user: any = UserStore?.getCurrentUser?.();
    if (!user) {
        return { client: "vencord", displayName: "Amigo Discord", status: "online" };
    }

    const avatarHash = user.avatar;
    const avatarUrl = avatarHash
        ? `https://cdn.discordapp.com/avatars/${user.id}/${avatarHash}.${avatarHash.startsWith("a_") ? "gif" : "png"}?size=256`
        : "";

    const userProfile = UserProfileStore?.getUserProfile?.(user.id);
    const bannerHash = user.banner || userProfile?.banner;
    const bannerUrl = bannerHash
        ? `https://cdn.discordapp.com/banners/${user.id}/${bannerHash}.${bannerHash.startsWith("a_") ? "gif" : "png"}?size=600`
        : "";

    const accent = userProfile?.accentColor ?? user.accentColor ?? null;
    const bannerColor = typeof accent === "number"
        ? `#${accent.toString(16).padStart(6, "0")}`
        : "";

    const vcId = SelectedChannelStore?.getVoiceChannelId?.() || null;
    const vc = vcId ? ChannelStore?.getChannel?.(vcId) : null;
    if (vcId && !voiceJoinedAtMap.has(vcId)) {
        voiceJoinedAtMap.set(vcId, Date.now());
    }

    const status = PresenceStore?.getStatus?.(user.id) || "online";
    const activities: any[] = PresenceStore?.getActivities?.(user.id) || [];
    const customAct = activities.find(a => a?.type === 4);
    const customStatus = customAct?.state ? String(customAct.state) : "";

    return {
        client: "vencord",
        id: user.id,
        discordId: user.id,
        username: user.username,
        discriminator: user.discriminator || "0",
        displayName: user.globalName || user.username,
        avatarUrl,
        bannerUrl,
        bannerColor,
        customStatus,
        status,
        accentColor: accent,
        voice: vc
            ? {
                  inCall: true,
                  name: vc.name || "Chamada de voz no Discord",
                  startedAt: voiceJoinedAtMap.get(vcId!) || Date.now()
              }
            : null,
        voiceChannel: vc ? { id: vc.id, name: vc.name || "Canal de Voz" } : null
    };
}

function syncVoiceAndProfile() {
    engine.setPreferences({
        bitrateMbps: Number(settings.store.bitrateMbps) || 10,
        autoWatchStreams: Boolean(settings.store.autoWatchStreams),
        soundEffects: Boolean(settings.store.soundEffects)
    });

    engine.setLocalProfile(buildLocalDiscordProfile());

    const vcId = SelectedChannelStore?.getVoiceChannelId?.() || null;
    const vc = vcId ? ChannelStore?.getChannel?.(vcId) : null;
    engine.setVoiceChannel(vcId, vc?.name || null, Boolean(settings.store.autoConnectInVoice));
}

function unmountNode(mount: MountedNode | null): null {
    if (!mount) return null;
    try {
        mount.root.unmount();
    } catch {}
    try {
        mount.el.remove();
    } catch {}
    return null;
}

function getLocalStreamerName(): string {
    const user: any = UserStore?.getCurrentUser?.();
    return user?.globalName || user?.username || "Você";
}

const WrappedStage = ErrorBoundary.wrap(() => (
    <RoxyCallStage engine={engine} defaults={getUiDefaults()} localStreamerName={getLocalStreamerName()} />
), { noop: true });

const WrappedPanelBtn = ErrorBoundary.wrap(() => (
    <RoxyVoicePanelButton engine={engine} defaults={getUiDefaults()} />
), { noop: true });

function clearSidebarLiveBadges() {
    document.querySelectorAll(".roxy-sidebar-live-badge").forEach(el => el.remove());
}

function ensureStageMounted() {
    const snap = engine.getSnapshot();
    const pausedStreamers = snap.peers.filter(
        p => p.isStreamingRemote && !snap.remoteStreams.some(s => s.peerId === p.peerId)
    );
    const localTileCount = snap.isStreaming && snap.localStream ? 1 : 0;
    const roxyTileCount = snap.remoteStreams.length + localTileCount + pausedStreamers.length;

    if (roxyTileCount === 0) {
        if (stageMount) {
            stageMount = unmountNode(stageMount);
        }
        return;
    }

    const callContainer = document.querySelector<HTMLElement>('[class*="callContainer_"]');
    if (!callContainer) {
        if (stageMount && !stageMount.el.isConnected) {
            stageMount = unmountNode(stageMount);
        }
        return;
    }

    if (stageMount && stageMount.el.isConnected && stageMount.el.parentElement === callContainer) {
        return;
    }

    stageMount = unmountNode(stageMount);
    if (getComputedStyle(callContainer).position === "static") {
        callContainer.style.position = "relative";
    }

    const el = document.createElement("div");
    el.className = "roxy-vc-stage-overlay";
    callContainer.appendChild(el);

    const root = createRoot(el);
    root.render(<WrappedStage />);
    stageMount = { el, root };
}

let lastBadgeSignature = "";

function syncSidebarLiveBadges(force = false) {
    const vcId = SelectedChannelStore?.getVoiceChannelId?.();
    if (!vcId) {
        clearSidebarLiveBadges();
        lastBadgeSignature = "";
        return;
    }

    const snap = engine.getSnapshot();
    const activeStreamers: Array<{ id?: string; names: string[] }> = [];

    if (snap.isStreaming) {
        const me: any = UserStore?.getCurrentUser?.();
        const names = [me?.globalName, me?.username].filter(Boolean).map((s: string) => s.toLowerCase());
        activeStreamers.push({ id: me?.id, names });
    }

    snap.peers.forEach(p => {
        const isLive = p.isStreamingRemote || snap.remoteStreams.some(s => s.peerId === p.peerId);
        if (!isLive) return;
        const names = [p.name, p.profile?.displayName, p.profile?.username]
            .filter(Boolean)
            .map(s => String(s).toLowerCase());
        activeStreamers.push({ id: p.profile?.discordId || p.profile?.id, names });
    });

    // Assinatura: quem está ao vivo (e o canal). Se nada mudou, não varremos o sidebar inteiro.
    // Antes, o ciclo de segurança de 1,8 s fazia dezenas de querySelector com [src*=...] por linha.
    const signature = `${vcId}|${activeStreamers.map(s => s.id || s.names[0] || "").join(",")}`;
    if (!force && signature === lastBadgeSignature) {
        // Se o Discord re-renderizou a lista de voz, os badges somem sem a assinatura mudar:
        // nesse caso (e só nele) vale refazer a varredura.
        if (activeStreamers.length === 0 || document.querySelector(".roxy-sidebar-live-badge")) return;
    }
    lastBadgeSignature = signature;

    if (activeStreamers.length === 0) {
        clearSidebarLiveBadges();
        return;
    }

    const rows = Array.from(document.querySelectorAll<HTMLElement>('[class*="voiceUser_"]'));

    rows.forEach(row => {
        const matched = activeStreamers.some(s => {
            if (s.id) {
                // Varredura direta das imagens da linha (sem seletor de atributo, bem mais rápido)
                const imgs = row.getElementsByTagName("img");
                for (let i = 0; i < imgs.length; i++) {
                    const src = imgs[i].getAttribute("src") || "";
                    if (src.includes(`/avatars/${s.id}/`) || src.includes(`/users/${s.id}/avatars/`)) return true;
                }
                const styled = row.querySelectorAll<HTMLElement>("[style]");
                for (let i = 0; i < styled.length; i++) {
                    const style = styled[i].getAttribute("style") || "";
                    if (style.includes(s.id)) return true;
                }
            }
            const nameEl = row.querySelector<HTMLElement>('[class*="username_"]');
            const txt = nameEl?.textContent?.trim().toLowerCase() || "";
            return txt.length > 0 && s.names.some(n => txt === n || txt.startsWith(n));
        });

        const existingBadge = row.querySelector<HTMLElement>(".roxy-sidebar-live-badge");
        if (matched) {
            if (!existingBadge) {
                const badge = document.createElement("span");
                badge.className = "roxy-sidebar-live-badge";
                badge.textContent = "AO VIVO";
                const iconsEl = row.querySelector<HTMLElement>('[class*="icons_"]')
                    || row.querySelector<HTMLElement>('[class*="content_"]')
                    || row;
                iconsEl.appendChild(badge);
            }
        } else if (existingBadge) {
            existingBadge.remove();
        }
    });
}

function ensurePanelButtonMounted() {
    const vcId = SelectedChannelStore?.getVoiceChannelId?.();
    const panelsContainer = document.querySelector<HTMLElement>('section[class*="panels_"]');
    const actionButtons = panelsContainer?.querySelector<HTMLElement>('[class*="actionButtons_"]');

    if (!vcId || !actionButtons) {
        if (panelMount && (!panelMount.el.isConnected || !vcId)) {
            panelMount = unmountNode(panelMount);
        }
        return;
    }

    if (panelMount && panelMount.el.isConnected && panelMount.el.parentElement === actionButtons) {
        return;
    }

    panelMount = unmountNode(panelMount);
    const el = document.createElement("div");
    el.className = "roxy-vc-panel-mount";
    actionButtons.appendChild(el);

    const root = createRoot(el);
    root.render(<WrappedPanelBtn />);
    panelMount = { el, root };
}

function syncMounts() {
    ensureStageMounted();
    ensurePanelButtonMounted();
    syncSidebarLiveBadges();
}

function scheduleSyncMounts(withDelayedCheck = false) {
    if (rafId === null) {
        rafId = requestAnimationFrame(() => {
            rafId = null;
            syncMounts();
        });
    }
    if (withDelayedCheck) {
        if (delayedSyncTimer) clearTimeout(delayedSyncTimer);
        delayedSyncTimer = setTimeout(() => {
            delayedSyncTimer = null;
            syncMounts();
            setTimeout(syncMounts, 450);
        }, 160);
    }
}

export default definePlugin({
    name: "RoxyRoomScreen",
    description: "Transmite e assiste telas em P2P WebRTC (Roxy Room) direto na call do Discord, compatível com RoxyRoom.exe e Player Web.",
    tags: ["Voice", "Media", "Utility"],
    authors: [{ name: "Mario Cesar", id: 965311813627547828n }],
    settings,
    managedStyle,

    flux: {
        VOICE_CHANNEL_SELECT() {
            syncVoiceAndProfile();
            scheduleSyncMounts(true);
        },
        VOICE_STATE_UPDATES(event: any) {
            const vcId = SelectedChannelStore?.getVoiceChannelId?.();
            if (!vcId) return;
            const states = Array.isArray(event?.voiceStates) ? event.voiceStates : [];
            if (states.some((s: any) => s?.channelId === vcId || s?.oldChannelId === vcId)) {
                scheduleSyncMounts(true);
            }
        },
        CHANNEL_SELECT() {
            scheduleSyncMounts(true);
        },
        CURRENT_USER_UPDATE() {
            syncVoiceAndProfile();
        }
    },

    toolboxActions() {
        const snap = engine.getSnapshot();
        return (
            <>
                <Menu.MenuItem
                    id="roxy-vc-share"
                    label={snap.isStreaming ? "Parar Transmissão Roxy" : "Transmitir Tela (Roxy P2P)"}
                    action={() => {
                        if (engine.getSnapshot().isStreaming) engine.stopLocalStream();
                        else setTimeout(() => openRoxySourcePickerModal(engine, getUiDefaults()), 10);
                    }}
                />
                <Menu.MenuItem
                    id="roxy-vc-room"
                    label="Configurar Sala / Link Web Roxy"
                    action={() => setTimeout(() => openRoxyRoomModal(engine, getUiDefaults().webPlayerBaseUrl), 10)}
                />
            </>
        );
    },

    start() {
        engine.setExcludedAudioBridge(Native ?? null);
        syncVoiceAndProfile();
        syncMounts();

        let lastSig = "";
        engineUnsub = engine.subscribe(snap => {
            const pausedCount = snap.peers.filter(
                p => p.isStreamingRemote && !snap.remoteStreams.some(s => s.peerId === p.peerId)
            ).length;
            const sig = `${snap.isStreaming ? 1 : 0}:${snap.remoteStreams.length}:${pausedCount}:${snap.spotlightPeerId || ""}`;
            if (sig !== lastSig) {
                lastSig = sig;
                scheduleSyncMounts(true);
            }
        });

        safetyInterval = setInterval(() => {
            const vcId = SelectedChannelStore?.getVoiceChannelId?.();
            if (!vcId && !panelMount && !stageMount) return;
            syncMounts();
        }, 3000);
    },

    stop() {
        if (engineUnsub) {
            engineUnsub();
            engineUnsub = null;
        }
        if (delayedSyncTimer) {
            clearTimeout(delayedSyncTimer);
            delayedSyncTimer = null;
        }
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (safetyInterval) {
            clearInterval(safetyInterval);
            safetyInterval = null;
        }
        closeRoxyOverlayModal();
        clearSidebarLiveBadges();
        stageMount = unmountNode(stageMount);
        panelMount = unmountNode(panelMount);
        engine.destroy();
        engine.setExcludedAudioBridge(null);
    }
});
