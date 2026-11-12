import ErrorBoundary from "@components/ErrorBoundary";
import {
    ChannelStore,
    createRoot,
    GuildMemberStore,
    React,
    useEffect,
    useMemo,
    useRef,
    useState,
    UserStore,
    useStateFromStores,
    VoiceStateStore
} from "@webpack/common";

import {
    buildWebPlayerUrl,
    channelToRoomId,
    RoxyAudioMode,
    RoxyDesktopSource,
    RoxyEngine,
    RoxyRemoteStream,
    RoxySnapshot,
    sanitizeRoom
} from "./RoxyEngine";

let activeOverlayModal: {
    root: ReturnType<typeof createRoot>;
    el: HTMLDivElement;
    onKeyDown: (e: KeyboardEvent) => void;
} | null = null;

export function closeRoxyOverlayModal() {
    if (!activeOverlayModal) return;
    const { root, el, onKeyDown } = activeOverlayModal;
    activeOverlayModal = null;
    window.removeEventListener("keydown", onKeyDown, true);
    try {
        root.unmount();
    } catch {}
    try {
        el.remove();
    } catch {}
}

function openRoxyOverlayModal(render: (onClose: () => void) => React.ReactNode) {
    closeRoxyOverlayModal();

    const el = document.createElement("div");
    el.className = "roxy-vc-modal-backdrop";
    document.body.appendChild(el);

    const mountedAt = Date.now();

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeRoxyOverlayModal();
        }
    };
    window.addEventListener("keydown", onKeyDown, true);

    el.addEventListener("mousedown", e => {
        if (Date.now() - mountedAt < 180) return;
        if (e.target === el) {
            closeRoxyOverlayModal();
        }
    });

    const root = createRoot(el);
    activeOverlayModal = { root, el, onKeyDown };

    const SafeContent = ErrorBoundary.wrap(
        () => <>{render(closeRoxyOverlayModal)}</>,
        { noop: false }
    );
    root.render(<SafeContent />);
}

export interface RoxyUiDefaults {
    fps: number;
    height: number;
    bitrateMbps: number;
    audioMode: RoxyAudioMode;
    webPlayerBaseUrl: string;
}

export function useRoxySnapshot(engine: RoxyEngine): RoxySnapshot {
    const [snap, setSnap] = useState<RoxySnapshot>(() => engine.getSnapshot());
    useEffect(() => engine.subscribe(setSnap), [engine]);
    return snap;
}

async function copyTextSafe(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {}
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    } catch {
        return false;
    }
}

/* ─────────────────────────────── Ícones (Discord) ─────────────────────────────── */

const Svg = ({ size = 18, children, ...rest }: { size?: number; children: React.ReactNode; } & React.SVGProps<SVGSVGElement>) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...rest}>
        {children}
    </svg>
);

const IconVolume = () => (
    <Svg>
        <path d="M11.383 3.45a1 1 0 0 1 .617.92v15.26a1 1 0 0 1-1.6.8l-4.2-3.43H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3.2l4.2-3.43a1 1 0 0 1 .983-.12Z" />
        <path d="M15.6 8.4a1 1 0 0 1 1.414 0 5.1 5.1 0 0 1 0 7.2 1 1 0 1 1-1.414-1.414 3.1 3.1 0 0 0 0-4.372 1 1 0 0 1 0-1.414Z" />
        <path d="M18.43 5.57a1 1 0 0 1 1.414 0 9.1 9.1 0 0 1 0 12.86 1 1 0 0 1-1.414-1.414 7.1 7.1 0 0 0 0-10.032 1 1 0 0 1 0-1.414Z" />
    </Svg>
);

const IconVolumeMute = () => (
    <Svg>
        <path d="M11.383 3.45a1 1 0 0 1 .617.92v15.26a1 1 0 0 1-1.6.8l-4.2-3.43H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3.2l4.2-3.43a1 1 0 0 1 .983-.12Z" />
        <path d="M22.7 9.29a1 1 0 0 1 0 1.42L20.41 13l2.3 2.29a1 1 0 1 1-1.42 1.42L19 14.41l-2.29 2.3a1 1 0 0 1-1.42-1.42l2.3-2.29-2.3-2.29a1 1 0 0 1 1.42-1.42L19 11.59l2.29-2.3a1 1 0 0 1 1.41 0Z" />
    </Svg>
);

const IconExpand = () => (
    <Svg>
        <path d="M4 9V5a1 1 0 0 1 1-1h4a1 1 0 0 1 0 2H6v3a1 1 0 0 1-2 0Zm10-5h4a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0V6h-3a1 1 0 1 1 0-2Zm6 11v4a1 1 0 0 1-1 1h-4a1 1 0 1 1 0-2h3v-3a1 1 0 1 1 2 0ZM9 20H5a1 1 0 0 1-1-1v-4a1 1 0 1 1 2 0v3h3a1 1 0 1 1 0 2Z" />
    </Svg>
);

const IconCollapse = () => (
    <Svg>
        <path d="M9 4v4a1 1 0 0 1-1 1H4a1 1 0 0 1 0-2h3V4a1 1 0 0 1 2 0Zm6 0v3h3a1 1 0 1 1 0 2h-4a1 1 0 0 1-1-1V4a1 1 0 1 1 2 0Zm5 11a1 1 0 0 1-1 1h-3v3a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1ZM9 15v4a1 1 0 1 1-2 0v-3H4a1 1 0 1 1 0-2h4a1 1 0 0 1 1 1Z" />
    </Svg>
);

const IconScreen = ({ size = 18 }: { size?: number; }) => (
    <Svg size={size}>
        <path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5v2h2.5a1 1 0 1 1 0 2h-7a1 1 0 1 1 0-2H13v-2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    </Svg>
);

const IconApps = () => (
    <Svg>
        <path d="M5 3h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm9 0h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM5 12h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm9 0h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
    </Svg>
);

const IconCamera = ({ size = 18 }: { size?: number; }) => (
    <Svg size={size}>
        <path d="M4 6h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm11.3 3.1 3.8-2.2A1 1 0 0 1 21 7.8v8.4a1 1 0 0 1-1.9.9l-3.8-2.2V9.1Z" />
    </Svg>
);

const IconGear = ({ size = 18 }: { size?: number; }) => (
    <Svg size={size}>
        <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Zm9.4 4.3.05-.8-.05-.8 1.7-1.33a.5.5 0 0 0 .12-.63l-1.6-2.78a.5.5 0 0 0-.6-.22l-2.02.81a7.6 7.6 0 0 0-1.37-.8l-.3-2.14a.49.49 0 0 0-.49-.42h-3.2a.49.49 0 0 0-.49.42l-.3 2.14c-.49.2-.94.47-1.37.8L7.4 6.24a.5.5 0 0 0-.6.22L5.2 9.24a.49.49 0 0 0 .12.63L7.02 11.2a7.4 7.4 0 0 0 0 1.6l-1.7 1.33a.5.5 0 0 0-.12.63l1.6 2.78a.5.5 0 0 0 .6.22l2.02-.81c.43.33.88.6 1.37.8l.3 2.14c.04.24.24.42.49.42h3.2c.25 0 .45-.18.49-.42l.3-2.14c.49-.2.94-.47 1.37-.8l2.02.81a.5.5 0 0 0 .6-.22l1.6-2.78a.49.49 0 0 0-.12-.63l-1.7-1.33Z" />
    </Svg>
);

const IconCheck = () => (
    <Svg size={16}>
        <path d="M9.55 17.05a1.5 1.5 0 0 1-2.12 0l-3.4-3.4a1.5 1.5 0 1 1 2.12-2.12l2.34 2.33 6.36-6.36a1.5 1.5 0 1 1 2.12 2.12l-7.42 7.43Z" />
    </Svg>
);

const IconPiP = () => (
    <Svg>
        <path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v10h16V7H4Zm8 4h7v4h-7v-4Z" />
    </Svg>
);

const IconClose = () => (
    <Svg>
        <path d="M6.4 5a1 1 0 0 0-1.4 1.4l5.6 5.6-5.6 5.6A1 1 0 1 0 6.4 19l5.6-5.6 5.6 5.6a1 1 0 0 0 1.4-1.4L13.4 12l5.6-5.6A1 1 0 0 0 17.6 5L12 10.6 6.4 5Z" />
    </Svg>
);

const IconRefresh = () => (
    <Svg>
        <path d="M12 4a8 8 0 0 1 7.45 5.07 1 1 0 1 1-1.87.72A6 6 0 0 0 6.6 8.6L8.4 10.4H4V6l1.68 1.68A8 8 0 0 1 12 4Zm8 8.5v4.4h-4.4l1.8-1.8A6 6 0 0 1 6.42 15.2a1 1 0 0 1 1.87-.72 6 6 0 0 0 11 -.66L11.99 12.5H20Z" />
    </Svg>
);

const IconBoost = () => (
    <Svg size={20}>
        <path d="M13.6 2.4 5 13.1a.8.8 0 0 0 .62 1.3h4.23l-1.4 6.4a.8.8 0 0 0 1.42.66L18.9 10.7a.8.8 0 0 0-.62-1.3h-4.2l1.4-6.4a.8.8 0 0 0-1.88-.6Z" />
    </Svg>
);

/* ─────────────────────────────── Tile de transmissão ─────────────────────────────── */

interface StreamVideoTileProps {
    engine: RoxyEngine;
    peerId: string;
    title: string;
    avatarUrl?: string;
    stream: MediaStream;
    muted: boolean;
    volume: number;
    isLocalPreview?: boolean;
    isSpotlight: boolean;
    width: number;
    height: number;
    fps: number;
}

function StreamVideoTile({
    engine,
    peerId,
    title,
    avatarUrl,
    stream,
    muted,
    volume,
    isLocalPreview,
    isSpotlight,
    width,
    height,
    fps
}: StreamVideoTileProps) {
    const tileRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [hoverVolume, setHoverVolume] = useState(false);

    // Anexa a MediaStream uma única vez por stream (nunca em re-render)
    useEffect(() => {
        const v = videoRef.current as any;
        if (!v) return;
        if (v.srcObject !== stream) {
            v.srcObject = stream;
            if ("playoutDelayHint" in v) v.playoutDelayHint = 0;
            v.play().catch(() => {
                if (!isLocalPreview && !v.muted) {
                    v.muted = true;
                    v.play().catch(() => {});
                }
            });
        }
        return () => {
            try {
                if (v.srcObject) v.srcObject = null;
            } catch {}
        };
    }, [stream, isLocalPreview]);

    // Volume/mudo: escrita direta na propriedade, sem recriar o player
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const nextMuted = isLocalPreview ? true : muted;
        const nextVolume = isLocalPreview ? 0 : Math.max(0, Math.min(1, volume));
        if (v.muted !== nextMuted) v.muted = nextMuted;
        if (v.volume !== nextVolume) v.volume = nextVolume;
    }, [muted, volume, isLocalPreview]);

    // Economia de CPU: stream em segundo plano não decodifica vídeo
    useEffect(() => {
        const onVisibility = () => {
            const v = videoRef.current;
            if (!v || !v.srcObject) return;
            if (document.hidden) {
                if (!v.paused) v.pause();
            } else {
                v.play().catch(() => {});
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => document.removeEventListener("visibilitychange", onVisibility);
    }, []);

    useEffect(() => {
        const onFsChange = () => {
            setIsFullscreen(Boolean(tileRef.current && document.fullscreenElement === tileRef.current));
        };
        document.addEventListener("fullscreenchange", onFsChange);
        return () => document.removeEventListener("fullscreenchange", onFsChange);
    }, []);

    const qualityText = useMemo(() => {
        const res = height > 0 ? `${height}p` : width > 0 ? `${width}p` : "HD";
        return fps > 0 ? `${res} ${fps}fps` : res;
    }, [width, height, fps]);

    const toggleFullscreen = () => {
        const target = tileRef.current;
        if (!target) return;
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else {
            target.requestFullscreen?.().catch(() => {});
        }
    };

    const togglePiP = () => {
        const v = videoRef.current as any;
        if (!v) return;
        if (document.pictureInPictureElement) {
            (document as any).exitPictureInPicture?.().catch(() => {});
        } else if (v.requestPictureInPicture) {
            v.requestPictureInPicture().catch(() => {});
        }
    };

    const toggleMute = () => {
        if (!isLocalPreview) engine.setPeerMuted(peerId, !muted);
    };

    const handleVolume = (value: number) => {
        if (!isLocalPreview) engine.setPeerVolume(peerId, value);
    };

    const handleSpotlight = () => engine.setSpotlight(peerId);
    const handleClose = () => {
        if (isLocalPreview) engine.stopLocalStream();
        else engine.stopWatchingPeer(peerId);
    };

    const onTileClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest("button, input, .roxy-vc-tile-controls")) return;
        if (document.fullscreenElement === tileRef.current) return;
        handleSpotlight();
    };

    return (
        <div
            ref={tileRef}
            className={`roxy-vc-tile ${isSpotlight ? "is-spotlight" : ""} ${isFullscreen ? "is-fullscreen" : ""}`}
            onClick={onTileClick}
            onDoubleClick={toggleFullscreen}
            title={isSpotlight ? "Clique para voltar à grade" : "Clique para ampliar a tela"}
        >
            <video ref={videoRef} autoPlay playsInline muted={isLocalPreview || muted} />

            <div className="roxy-vc-tile-top">
                <span className="roxy-vc-live-pill">
                    <span className="roxy-vc-live-dot" />
                    AO VIVO
                </span>
                <span className="roxy-vc-quality-chip">{qualityText}</span>
            </div>

            <div className="roxy-vc-tile-bottom">
                <div className="roxy-vc-streamer-pill">
                    {avatarUrl ? (
                        <img src={avatarUrl} alt="" draggable={false} />
                    ) : (
                        <IconScreen size={15} />
                    )}
                    <span>{title}</span>
                </div>

                <div className="roxy-vc-tile-controls" onClick={e => e.stopPropagation()}>
                    {!isLocalPreview ? (
                        <>
                            <button
                                type="button"
                                className={`roxy-vc-icon-btn ${muted ? "is-off" : ""}`}
                                title={muted ? "Ativar som da transmissão (M)" : "Mutar transmissão (M)"}
                                onClick={toggleMute}
                                onKeyDown={e => {
                                    if (e.key === "m" || e.key === "M") toggleMute();
                                }}
                            >
                                {muted ? <IconVolumeMute /> : <IconVolume />}
                            </button>

                            <div
                                className={`roxy-vc-volume-wrap ${hoverVolume ? "is-open" : ""}`}
                                onMouseEnter={() => setHoverVolume(true)}
                                onMouseLeave={() => setHoverVolume(false)}
                            >
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.02}
                                    value={muted ? 0 : volume}
                                    className="roxy-vc-vol"
                                    title={`Volume: ${Math.round((muted ? 0 : volume) * 100)}%`}
                                    onChange={e => handleVolume(parseFloat(e.target.value))}
                                />
                                <span className="roxy-vc-vol-label">
                                    {Math.round((muted ? 0 : volume) * 100)}%
                                </span>
                            </div>
                        </>
                    ) : null}

                    <button
                        type="button"
                        className={`roxy-vc-icon-btn ${isSpotlight ? "is-on" : ""}`}
                        title={isSpotlight ? "Voltar para a grade" : "Ampliar na tela"}
                        onClick={handleSpotlight}
                    >
                        {isSpotlight ? <IconCollapse /> : <IconExpand />}
                    </button>

                    <button type="button" className="roxy-vc-icon-btn" title="Mini janela (Picture-in-Picture)" onClick={togglePiP}>
                        <IconPiP />
                    </button>

                    <button
                        type="button"
                        className="roxy-vc-icon-btn"
                        title={isFullscreen ? "Sair da tela cheia (Esc)" : "Tela cheia"}
                        onClick={toggleFullscreen}
                    >
                        {isFullscreen ? <IconCollapse /> : <IconExpand />}
                    </button>

                    <button
                        type="button"
                        className="roxy-vc-icon-btn is-danger"
                        title={isLocalPreview ? "Parar transmissão" : "Fechar visualização"}
                        onClick={handleClose}
                    >
                        <IconClose />
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ─────────────────────────────── Seletor de fonte ─────────────────────────────── */

type PickerTab = "window" | "screen" | "camera";

interface CameraDevice {
    id: string;
    label: string;
}

const QUALITY_PRESETS = {
    sd: { height: 720, fps: 30, bitrateMbps: 6 },
    hd: { height: 1080, fps: 60, bitrateMbps: 10 },
    qhd: { height: 1440, fps: 60, bitrateMbps: 18 },
    uhd: { height: 2160, fps: 60, bitrateMbps: 30 }
} as const;

type QualityPresetKey = keyof typeof QUALITY_PRESETS;

function SourcePickerModalContent({
    engine,
    defaults,
    onClose
}: {
    engine: RoxyEngine;
    defaults: RoxyUiDefaults;
    onClose: () => void;
}) {
    const snap = useRoxySnapshot(engine);
    const [tab, setTab] = useState<PickerTab>("window");
    const [sources, setSources] = useState<RoxyDesktopSource[]>([]);
    const [cameras, setCameras] = useState<CameraDevice[]>([]);
    const [selectedId, setSelectedId] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [fps, setFps] = useState<number>(defaults.fps || 60);
    const [height, setHeight] = useState<number>(defaults.height ?? 1080);
    const [bitrateMbps, setBitrateMbps] = useState<number>(defaults.bitrateMbps || 10);
    const [audioMode, setAudioMode] = useState<RoxyAudioMode>(defaults.audioMode || "exclude-discord");
    const [helperAvailable, setHelperAvailable] = useState<boolean | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [starting, setStarting] = useState(false);

    const loadSources = async () => {
        setLoading(true);
        setError(null);
        try {
            const [list, cams] = await Promise.all([
                engine.getDesktopSources().catch(() => [] as RoxyDesktopSource[]),
                engine.getCameraDevices().catch(() => [] as CameraDevice[])
            ]);
            setSources(list);
            setCameras(cams);

            const hasWindows = list.some(s => s.type === "window");
            let activeTab: PickerTab = tab;
            if (tab === "window" && !hasWindows && list.some(s => s.type === "screen")) {
                activeTab = "screen";
                setTab("screen");
            }
            const pool = activeTab === "camera"
                ? cams.map(c => c.id)
                : list.filter(s => s.type === activeTab).map(s => s.id);
            if (pool.length && !pool.includes(selectedId)) {
                setSelectedId(pool[0]);
            }
        } catch (e: any) {
            setError(e?.message || "Não foi possível listar telas e aplicativos.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSources();
        engine.checkExcludedAudioAvailable().then(setHelperAvailable).catch(() => setHelperAvailable(false));
        return () => {
            setSources([]);
            setCameras([]);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const filteredSources = useMemo(
        () => sources.filter(s => s.type === tab),
        [sources, tab]
    );

    const selectedSource = useMemo(
        () => sources.find(s => s.id === selectedId) || null,
        [sources, selectedId]
    );

    const selectedCamera = useMemo(
        () => cameras.find(c => c.id === selectedId) || null,
        [cameras, selectedId]
    );

    const handleSwitchTab = (nextTab: PickerTab) => {
        setTab(nextTab);
        const pool = nextTab === "camera"
            ? cameras.map(c => c.id)
            : sources.filter(s => s.type === nextTab).map(s => s.id);
        if (pool.length && !pool.includes(selectedId)) {
            setSelectedId(pool[0]);
        }
    };

    const handleStart = async (overrideId?: string, useDisplayMedia = false) => {
        const targetId = overrideId ?? selectedId;
        if (!useDisplayMedia && !targetId) {
            setError(tab === "camera" ? "Escolha uma câmera." : "Escolha uma janela ou tela para transmitir.");
            return;
        }
        setStarting(true);
        setError(null);
        try {
            if (tab === "camera" && !useDisplayMedia) {
                const cam = cameras.find(c => c.id === targetId);
                await engine.startLocalStream(
                    { cameraDeviceId: targetId, fps: 30, height: 720, audioMode: "none" },
                    cam?.label || "Câmera"
                );
            } else {
                const chosen = sources.find(s => s.id === targetId);
                await engine.startLocalStream(
                    {
                        sourceId: useDisplayMedia ? undefined : targetId,
                        fps,
                        height,
                        bitrateMbps,
                        audioMode,
                        useDisplayMedia
                    },
                    chosen?.name || "Sua Tela"
                );
            }
            onClose();
        } catch (e: any) {
            setError(e?.message || "Falha ao iniciar captura de tela.");
        } finally {
            setStarting(false);
        }
    };

    const setPreset = (preset: QualityPresetKey) => {
        const p = QUALITY_PRESETS[preset];
        setHeight(p.height);
        setFps(p.fps);
        setBitrateMbps(p.bitrateMbps);
    };

    const activePreset: QualityPresetKey | null =
        height === QUALITY_PRESETS.uhd.height && fps === QUALITY_PRESETS.uhd.fps
            ? "uhd"
            : height === QUALITY_PRESETS.qhd.height && fps === QUALITY_PRESETS.qhd.fps
                ? "qhd"
                : height === QUALITY_PRESETS.hd.height && fps === QUALITY_PRESETS.hd.fps
                    ? "hd"
                    : height === QUALITY_PRESETS.sd.height && fps === QUALITY_PRESETS.sd.fps
                        ? "sd"
                        : null;

    const audioShortLabel = audioMode === "exclude-discord"
        ? helperAvailable === false
            ? "Áudio do PC indisponível"
            : "Sem voz do Discord"
        : audioMode === "none"
            ? "Sem áudio"
            : "Som completo do PC";

    const qualityText = height === 0
        ? `Resolução nativa • ${fps}fps • ${bitrateMbps} Mbps`
        : `${height === 2160 ? "4K " : ""}${height}p ${fps}fps • ${bitrateMbps} Mbps`;

    const tabItems: Array<{ id: PickerTab; label: string; icon: React.ReactNode; }> = [
        { id: "window", label: "Aplicativos", icon: <IconApps /> },
        { id: "screen", label: "Tela Inteira", icon: <IconScreen /> },
        { id: "camera", label: "Dispositivos", icon: <IconCamera /> }
    ];

    const activeList = tab === "camera" ? cameras : filteredSources;
    const canStart = tab === "camera"
        ? Boolean(selectedCamera)
        : Boolean(selectedSource) || filteredSources.length === 0;

    return (
        <div className="roxy-vc-modal roxy-picker-modal">
            <div className="roxy-picker-tabs" role="tablist">
                {tabItems.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.id}
                        className={`roxy-picker-tab ${tab === item.id ? "active" : ""}`}
                        onClick={() => handleSwitchTab(item.id)}
                    >
                        {item.icon}
                        <span>{item.label}</span>
                    </button>
                ))}
            </div>

            <div className="roxy-picker-body">
                {loading ? (
                    <div className="roxy-picker-empty"><span>Carregando...</span></div>
                ) : activeList.length === 0 ? (
                    <div className="roxy-picker-empty">
                        <span>
                            {tab === "camera"
                                ? "Nenhuma câmera encontrada."
                                : tab === "window"
                                    ? "Nenhum aplicativo aberto encontrado."
                                    : "Nenhuma tela encontrada."}
                        </span>
                        {tab !== "camera" ? (
                            <button type="button" className="roxy-vc-btn" onClick={() => handleStart(undefined, true)}>
                                Usar seletor do sistema
                            </button>
                        ) : null}
                    </div>
                ) : (
                    <div className="roxy-vc-sources-grid">
                        {tab === "camera"
                            ? cameras.map(cam => {
                                const isSel = selectedId === cam.id;
                                return (
                                    <button
                                        key={cam.id}
                                        type="button"
                                        className={`roxy-vc-source-card ${isSel ? "selected" : ""}`}
                                        onClick={() => setSelectedId(cam.id)}
                                        onDoubleClick={() => {
                                            setSelectedId(cam.id);
                                            handleStart(cam.id, false);
                                        }}
                                    >
                                        <div className="roxy-vc-source-thumb-wrap is-camera">
                                            <IconCamera size={34} />
                                            <span className="roxy-vc-camera-label">{cam.label}</span>
                                            {isSel ? (
                                                <span className="roxy-vc-source-check"><IconCheck /></span>
                                            ) : null}
                                        </div>
                                        <div className="roxy-vc-source-meta">
                                            <span className="roxy-vc-source-appicon fallback"><IconCamera size={16} /></span>
                                            <span className="roxy-vc-source-name" title={cam.label}>{cam.label}</span>
                                        </div>
                                    </button>
                                );
                            })
                            : filteredSources.map(src => {
                                const isSel = selectedId === src.id;
                                return (
                                    <button
                                        key={src.id}
                                        type="button"
                                        className={`roxy-vc-source-card ${isSel ? "selected" : ""}`}
                                        onClick={() => setSelectedId(src.id)}
                                        onDoubleClick={() => {
                                            setSelectedId(src.id);
                                            handleStart(src.id, false);
                                        }}
                                    >
                                        <div className="roxy-vc-source-thumb-wrap">
                                            {src.thumbnailDataUrl ? (
                                                <img
                                                    src={src.thumbnailDataUrl}
                                                    alt={src.name}
                                                    className="roxy-vc-source-thumb"
                                                    draggable={false}
                                                    decoding="async"
                                                />
                                            ) : (
                                                <div className="roxy-vc-source-placeholder">
                                                    {src.type === "screen" ? <IconScreen size={31} /> : <IconApps />}
                                                </div>
                                            )}
                                            {isSel ? (
                                                <span className="roxy-vc-source-check"><IconCheck /></span>
                                            ) : null}
                                        </div>
                                        <div className="roxy-vc-source-meta">
                                            {src.appIconDataUrl ? (
                                                <img src={src.appIconDataUrl} alt="" className="roxy-vc-source-appicon" draggable={false} />
                                            ) : (
                                                <span className="roxy-vc-source-appicon fallback">
                                                    {src.type === "screen" ? <IconScreen size={16} /> : <IconApps />}
                                                </span>
                                            )}
                                            <span className="roxy-vc-source-name" title={src.name}>{src.name}</span>
                                        </div>
                                    </button>
                                );
                            })}
                    </div>
                )}
            </div>

            {showAdvanced ? (
                <div className="roxy-picker-advanced">
                    <label>
                        <span>FPS</span>
                        <select value={fps} onChange={e => setFps(Number(e.target.value))}>
                            <option value={144}>144 FPS</option>
                            <option value={120}>120 FPS</option>
                            <option value={60}>60 FPS</option>
                            <option value={30}>30 FPS</option>
                            <option value={15}>15 FPS</option>
                        </select>
                    </label>

                    <label>
                        <span>Resolução</span>
                        <select value={height} onChange={e => setHeight(Number(e.target.value))}>
                            <option value={2160}>4K (2160p)</option>
                            <option value={1440}>1440p (2K)</option>
                            <option value={1080}>1080p</option>
                            <option value={720}>720p</option>
                            <option value={480}>480p</option>
                            <option value={0}>Nativa (Original)</option>
                        </select>
                    </label>

                    <label>
                        <span>Bitrate</span>
                        <select value={bitrateMbps} onChange={e => setBitrateMbps(Number(e.target.value))}>
                            <option value={4}>4 Mbps</option>
                            <option value={6}>6 Mbps</option>
                            <option value={10}>10 Mbps</option>
                            <option value={15}>15 Mbps</option>
                            <option value={20}>20 Mbps</option>
                            <option value={30}>30 Mbps</option>
                            <option value={40}>40 Mbps</option>
                            <option value={50}>50 Mbps</option>
                        </select>
                    </label>

                    <label>
                        <span>Áudio</span>
                        <select value={audioMode} onChange={e => setAudioMode(e.target.value as RoxyAudioMode)}>
                            <option value="exclude-discord">PC sem voz do Discord</option>
                            <option value="none">Sem áudio</option>
                            <option value="system-all">Todo som do PC</option>
                        </select>
                    </label>

                    <div className="roxy-picker-advanced-links">
                        <button
                            type="button"
                            className="roxy-vc-btn"
                            onClick={() => openRoxyRoomModal(engine, defaults.webPlayerBaseUrl)}
                        >
                            Sala: {snap.roomId || "Configurar"}
                        </button>
                        <button type="button" className="roxy-vc-btn" onClick={() => handleStart(undefined, true)}>
                            Seletor do sistema
                        </button>
                    </div>
                </div>
            ) : null}

            {error ? <div className="roxy-picker-error">{error}</div> : null}

            <div className="roxy-picker-footer">
                <div className="roxy-picker-info">
                    <div className="roxy-picker-info-title">
                        {tab === "camera" ? "Câmera" : tab === "screen" ? "Telas" : "Jogos e aplicativos"}
                    </div>
                    <div className="roxy-picker-info-sub">
                        {tab === "camera"
                            ? "Transmita sua webcam na call"
                            : `${qualityText} • ${audioShortLabel}`}
                    </div>
                </div>

                <div className="roxy-picker-actions">
                    {tab !== "camera" ? (
                        <div className="roxy-quality-seg" role="group" aria-label="Qualidade do vídeo">
                            <button
                                type="button"
                                className={`roxy-quality-btn ${activePreset === "sd" ? "active" : ""}`}
                                onClick={() => setPreset("sd")}
                                title="720p em 30 FPS (6 Mbps) — mais leve"
                            >
                                SD
                            </button>
                            <button
                                type="button"
                                className={`roxy-quality-btn ${activePreset === "hd" ? "active" : ""}`}
                                onClick={() => setPreset("hd")}
                                title="1080p em 60 FPS (10 Mbps)"
                            >
                                HD
                            </button>
                            <button
                                type="button"
                                className={`roxy-quality-btn ${activePreset === "qhd" ? "active" : ""}`}
                                onClick={() => setPreset("qhd")}
                                title="1440p (2K) em 60 FPS (18 Mbps)"
                            >
                                1440p
                            </button>
                            <button
                                type="button"
                                className={`roxy-quality-btn ${activePreset === "uhd" ? "active" : ""}`}
                                onClick={() => setPreset("uhd")}
                                title="4K (2160p) em 60 FPS (30 Mbps)"
                            >
                                4K
                            </button>
                        </div>
                    ) : null}

                    <button
                        type="button"
                        className={`roxy-picker-circle-btn ${showAdvanced ? "active" : ""}`}
                        title="Configurações avançadas"
                        onClick={() => setShowAdvanced(v => !v)}
                    >
                        <IconGear />
                    </button>

                    <button
                        type="button"
                        className="roxy-picker-circle-btn"
                        title="Atualizar lista"
                        onClick={loadSources}
                    >
                        <IconRefresh />
                    </button>

                    <button
                        type="button"
                        className="roxy-vc-btn primary roxy-picker-go-btn"
                        disabled={starting || !canStart}
                        onClick={() => handleStart(selectedId || undefined, tab !== "camera" && filteredSources.length === 0)}
                    >
                        {starting ? "Iniciando..." : "Transmitir"}
                    </button>
                </div>
            </div>

            <div className="roxy-picker-promo">
                <span className="roxy-picker-promo-icon"><IconBoost /></span>
                <span className="roxy-picker-promo-text">
                    Transmita até <strong>4K / 144fps</strong> sem Nitro, direto pela sala P2P
                </span>
                <button
                    type="button"
                    className="roxy-picker-promo-btn"
                    onClick={() => openRoxyRoomModal(engine, defaults.webPlayerBaseUrl)}
                >
                    Ver sala
                </button>
            </div>
        </div>
    );
}

/* ─────────────────────────────── Configuração da sala ─────────────────────────────── */

function RoomConfigModalContent({
    engine,
    webPlayerBaseUrl,
    onClose
}: {
    engine: RoxyEngine;
    webPlayerBaseUrl: string;
    onClose: () => void;
}) {
    const snap = useRoxySnapshot(engine);
    const [customInput, setCustomInput] = useState(snap.roomId || "");
    const [copiedWhich, setCopiedWhich] = useState<"id" | "web" | null>(null);

    const vcRoom = channelToRoomId(snap.voiceChannelId);

    const handleCopy = async (kind: "id" | "web") => {
        const active = snap.roomId || vcRoom;
        if (!active) return;
        const text = kind === "id" ? active : buildWebPlayerUrl(webPlayerBaseUrl, active);
        await copyTextSafe(text);
        setCopiedWhich(kind);
        setTimeout(() => setCopiedWhich(null), 1800);
    };

    const handleJoinCustom = () => {
        const clean = sanitizeRoom(customInput);
        if (!clean) return;
        engine.setCustomRoom(clean);
    };

    return (
        <div className="roxy-vc-modal narrow">
            <div className="roxy-vc-modal-head">
                <h2 className="roxy-vc-modal-title">Sala Roxy P2P</h2>
                <button type="button" className="roxy-picker-circle-btn" onClick={onClose} title="Fechar">
                    <IconClose />
                </button>
            </div>

            <div className="roxy-vc-meta">
                Compatível com amigos usando o <strong>plugin Vencord</strong>, o app <strong>RoxyRoom.exe</strong> ou o{" "}
                <strong>Player Web</strong>.
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                    className="roxy-vc-input"
                    style={{ flex: 1 }}
                    value={customInput}
                    placeholder="Ex: SALA-6864 ou DC-..."
                    onChange={e => setCustomInput(e.target.value)}
                />
                <button type="button" className="roxy-vc-btn primary" onClick={handleJoinCustom}>
                    Conectar
                </button>
            </div>

            <div className="roxy-vc-actions">
                {vcRoom && snap.roomId !== vcRoom ? (
                    <button
                        type="button"
                        className="roxy-vc-btn"
                        onClick={() => {
                            engine.resetToVoiceChannelRoom();
                            setCustomInput(vcRoom);
                        }}
                    >
                        Usar canal atual ({vcRoom})
                    </button>
                ) : null}

                <button type="button" className="roxy-vc-btn" onClick={() => handleCopy("id")}>
                    {copiedWhich === "id" ? "✓ Código copiado" : "Copiar código"}
                </button>

                <button type="button" className="roxy-vc-btn success" onClick={() => handleCopy("web")}>
                    {copiedWhich === "web" ? "✓ Link copiado" : "Copiar link do navegador"}
                </button>
            </div>

            <div>
                <div className="roxy-vc-meta" style={{ marginBottom: 6 }}>
                    Conectados na sala ({snap.peers.length + (snap.connectionStatus === "connected" ? 1 : 0)}):
                </div>
                <div className="roxy-vc-peers-list">
                    <div className="roxy-vc-peer-row">
                        <div className="roxy-vc-peer-left">
                            <strong>Você</strong>
                            <span className="roxy-vc-meta">
                                {snap.isHost ? "HOST" : "P2P"} • {snap.connectionStatus}
                            </span>
                        </div>
                        {snap.isStreaming ? <span className="roxy-vc-live-tag">TRANSMITINDO</span> : null}
                    </div>

                    {snap.peers.map(p => (
                        <div key={p.peerId} className="roxy-vc-peer-row">
                            <div className="roxy-vc-peer-left">
                                {p.avatarUrl ? <img src={p.avatarUrl} alt="" draggable={false} /> : null}
                                <div>
                                    <div>{p.name}</div>
                                    <div className="roxy-vc-meta">
                                        {p.clientType === "vencord" ? "Discord Vencord" : "App Roxy externo"}
                                        {p.isHost ? " • HOST" : ""}
                                    </div>
                                </div>
                            </div>
                            {p.isStreamingRemote ? (
                                <button
                                    type="button"
                                    className="roxy-vc-btn primary"
                                    onClick={() => engine.watchPeerStream(p.peerId)}
                                >
                                    Assistir
                                </button>
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function openRoxySourcePickerModal(engine: RoxyEngine, defaults: RoxyUiDefaults) {
    openRoxyOverlayModal(onClose => (
        <SourcePickerModalContent
            engine={engine}
            defaults={defaults}
            onClose={onClose}
        />
    ));
}

export function openRoxyRoomModal(engine: RoxyEngine, webPlayerBaseUrl: string) {
    openRoxyOverlayModal(onClose => (
        <RoomConfigModalContent
            engine={engine}
            webPlayerBaseUrl={webPlayerBaseUrl}
            onClose={onClose}
        />
    ));
}

/* ─────────────────────────────── Palco da call ─────────────────────────────── */

interface CallParticipantInfo {
    userId: string;
    name: string;
    avatarUrl: string;
    muted: boolean;
    deafened: boolean;
    bgColor: string;
}

const CARD_PALETTES = [
    "#202225",
    "#24292e",
    "#23272f",
    "#2b2626",
    "#1f2928",
    "#26232e"
];

function pickCardBackground(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
    }
    return CARD_PALETTES[hash % CARD_PALETTES.length];
}

function computeGridDims(totalTiles: number): { cols: number; rows: number; } {
    if (totalTiles <= 1) return { cols: 1, rows: 1 };
    if (totalTiles === 2) return { cols: 2, rows: 1 };
    if (totalTiles <= 4) return { cols: 2, rows: 2 };
    if (totalTiles <= 6) return { cols: 3, rows: 2 };
    if (totalTiles <= 9) return { cols: 3, rows: 3 };
    return { cols: 4, rows: Math.ceil(totalTiles / 4) };
}

function ParticipantCardTile({ person, mini = false }: { person: CallParticipantInfo; mini?: boolean; }) {
    const initial = (person.name || "?").trim().charAt(0).toUpperCase();
    return (
        <div
            className={`roxy-vc-participant-card ${mini ? "is-mini" : ""}`}
            style={{ background: person.bgColor }}
        >
            {person.avatarUrl ? (
                <img src={person.avatarUrl} alt={person.name} className="roxy-vc-participant-avatar" draggable={false} />
            ) : (
                <div className="roxy-vc-participant-fallback">{initial}</div>
            )}

            <div className="roxy-vc-tile-bottom">
                <div className="roxy-vc-streamer-pill">
                    <span>{person.name}</span>
                </div>
            </div>

            {person.muted || person.deafened ? (
                <div className="roxy-vc-participant-status" title={person.deafened ? "Áudio desativado" : "Microfone mutado"}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm7-3a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.08A7 7 0 0 0 19 11Z" />
                        <path d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l18.5 18.5a.75.75 0 1 0 1.06-1.06L3.28 2.22Z" />
                    </svg>
                </div>
            ) : null}
        </div>
    );
}

export function RoxyCallStage({
    engine,
    defaults,
    localStreamerName
}: {
    engine: RoxyEngine;
    defaults: RoxyUiDefaults;
    localStreamerName?: string;
}) {
    const snap = useRoxySnapshot(engine);

    const participants = useStateFromStores<CallParticipantInfo[]>(
        [VoiceStateStore, UserStore, GuildMemberStore, ChannelStore],
        () => {
            const vcId = snap.voiceChannelId;
            if (!vcId) return [];
            const channel = ChannelStore?.getChannel?.(vcId);
            const guildId = channel?.guild_id;
            const states = (VoiceStateStore?.getVoiceStatesForChannel?.(vcId) || {}) as Record<string, any>;

            const list: CallParticipantInfo[] = [];
            for (const uid of Object.keys(states)) {
                const st = states[uid];
                const user: any = UserStore?.getUser?.(uid);
                const member: any = guildId ? GuildMemberStore?.getMember?.(guildId, uid) : null;
                const name = member?.nick || user?.globalName || user?.username || "Usuário";
                const avHash = member?.avatar || user?.avatar;
                const avatarUrl = avHash
                    ? member?.avatar && guildId
                        ? `https://cdn.discordapp.com/guilds/${guildId}/users/${uid}/avatars/${avHash}.${avHash.startsWith("a_") ? "gif" : "png"}?size=160`
                        : `https://cdn.discordapp.com/avatars/${uid}/${avHash}.${avHash.startsWith("a_") ? "gif" : "png"}?size=160`
                    : typeof user?.getAvatarURL === "function"
                        ? user.getAvatarURL(guildId, 160, false)
                        : "";

                list.push({
                    userId: uid,
                    name,
                    avatarUrl: avatarUrl || "",
                    muted: Boolean(st?.selfMute || st?.mute),
                    deafened: Boolean(st?.selfDeaf || st?.deaf),
                    bgColor: pickCardBackground(uid)
                });
            }
            return list;
        },
        [snap.voiceChannelId]
    );

    const pausedStreamers = snap.peers.filter(
        p => p.isStreamingRemote && !snap.remoteStreams.some(s => s.peerId === p.peerId)
    );
    const hasLocalTile = snap.isStreaming && !!snap.localStream;
    const streamTilesCount = snap.remoteStreams.length + (hasLocalTile ? 1 : 0) + pausedStreamers.length;

    if (streamTilesCount === 0) {
        return null;
    }

    const activeFocusId =
        snap.spotlightPeerId &&
        ((snap.spotlightPeerId === "__local__" && hasLocalTile) ||
            snap.remoteStreams.some(s => s.peerId === snap.spotlightPeerId))
            ? snap.spotlightPeerId
            : null;

    const totalTiles = streamTilesCount + participants.length;
    const { cols, rows } = computeGridDims(totalTiles);

    const localTrack = snap.localStream?.getVideoTracks?.()[0];
    const localSettings = typeof localTrack?.getSettings === "function" ? localTrack.getSettings() : {};
    const localWidth = localSettings.width || 0;
    const localHeight = localSettings.height || defaults.height || 1080;
    const localFps = Math.round(localSettings.frameRate || defaults.fps || 60);

    const renderStreamTile = (id: string, spotlight: boolean) => {
        if (id === "__local__" && hasLocalTile && snap.localStream) {
            return (
                <StreamVideoTile
                    key="__local__"
                    engine={engine}
                    peerId="__local__"
                    title={localStreamerName || "Você"}
                    stream={snap.localStream}
                    muted={true}
                    volume={0}
                    isLocalPreview={true}
                    isSpotlight={spotlight}
                    width={localWidth}
                    height={localHeight}
                    fps={localFps}
                />
            );
        }

        const rs = snap.remoteStreams.find(s => s.peerId === id);
        if (!rs) return null;
        return (
            <StreamVideoTile
                key={rs.peerId}
                engine={engine}
                peerId={rs.peerId}
                title={rs.name}
                avatarUrl={rs.avatarUrl}
                stream={rs.stream}
                muted={rs.muted}
                volume={rs.volume}
                isSpotlight={spotlight}
                width={rs.width}
                height={rs.height}
                fps={rs.fps}
            />
        );
    };

    if (activeFocusId) {
        const focusName =
            activeFocusId === "__local__"
                ? localStreamerName || "Você"
                : snap.remoteStreams.find(s => s.peerId === activeFocusId)?.name || "Transmissão";

        const otherActiveStreams: { id: string; name: string; }[] = [];
        for (const rs of snap.remoteStreams) {
            if (rs.peerId !== activeFocusId) otherActiveStreams.push({ id: rs.peerId, name: rs.name });
        }
        if (hasLocalTile && activeFocusId !== "__local__") {
            otherActiveStreams.push({ id: "__local__", name: localStreamerName || "Você" });
        }

        return (
            <div className="roxy-vc-stage-grid has-spotlight">
                {renderStreamTile(activeFocusId, true)}

                <div className="roxy-vc-spotlight-strip">
                    <div
                        className="roxy-vc-mini-stream-card is-active"
                        title="Voltar para a grade"
                        onClick={() => engine.setSpotlight(activeFocusId)}
                    >
                        <span className="roxy-vc-mini-live-dot">AO VIVO</span>
                        <IconScreen size={24} />
                        <div className="roxy-vc-tile-bottom">
                            <div className="roxy-vc-streamer-pill">
                                <span>{focusName}</span>
                            </div>
                        </div>
                    </div>

                    {otherActiveStreams.map(os => (
                        <div
                            key={`mini-${os.id}`}
                            className="roxy-vc-mini-stream-card"
                            title={`Focar tela de ${os.name}`}
                            onClick={() => engine.setSpotlight(os.id)}
                        >
                            <span className="roxy-vc-mini-live-dot">AO VIVO</span>
                            <IconScreen size={22} />
                            <div className="roxy-vc-tile-bottom">
                                <div className="roxy-vc-streamer-pill">
                                    <span>{os.name}</span>
                                </div>
                            </div>
                        </div>
                    ))}

                    {pausedStreamers.map(p => (
                        <div
                            key={`mini-paused-${p.peerId}`}
                            className="roxy-vc-mini-stream-card"
                            title={`Assistir ${p.name}`}
                            onClick={() => engine.watchPeerStream(p.peerId)}
                        >
                            <span className="roxy-vc-mini-live-dot">ASSISTIR</span>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" opacity="0.72">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                            <div className="roxy-vc-tile-bottom">
                                <div className="roxy-vc-streamer-pill">
                                    <span>{p.name}</span>
                                </div>
                            </div>
                        </div>
                    ))}

                    {participants.map(person => (
                        <ParticipantCardTile key={`vc-mini-${person.userId}`} person={person} mini={true} />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div
            className="roxy-vc-stage-grid"
            style={{
                "--roxy-cols": String(cols),
                "--roxy-rows": String(rows)
            } as React.CSSProperties}
        >
            {snap.remoteStreams.map((rs: RoxyRemoteStream) => renderStreamTile(rs.peerId, false))}
            {hasLocalTile ? renderStreamTile("__local__", false) : null}

            {pausedStreamers.map(p => (
                <div key={`paused-${p.peerId}`} className="roxy-vc-tile is-paused-card">
                    <div className="roxy-vc-paused-inner">
                        <div className="roxy-vc-paused-title">
                            {p.name} está transmitindo ({p.clientType === "vencord" ? "Discord" : "Roxy App"})
                        </div>
                        <button
                            type="button"
                            className="roxy-vc-btn primary"
                            onClick={() => engine.watchPeerStream(p.peerId)}
                        >
                            Assistir transmissão
                        </button>
                    </div>
                </div>
            ))}

            {participants.map(person => (
                <ParticipantCardTile key={`vc-${person.userId}`} person={person} />
            ))}
        </div>
    );
}

export function RoxyVoicePanelButton({
    engine,
    defaults
}: {
    engine: RoxyEngine;
    defaults: RoxyUiDefaults;
}) {
    const snap = useRoxySnapshot(engine);
    if (!snap.voiceChannelId) return null;

    return (
        <button
            type="button"
            className={`roxy-vc-panel-btn ${snap.isStreaming ? "is-live" : ""}`}
            aria-label={snap.isStreaming ? "Parar transmissão Roxy" : "Transmitir tela via Roxy P2P"}
            title={
                snap.isStreaming
                    ? "Parar transmissão Roxy P2P (Clique direito: Sala)"
                    : `Transmitir tela via Roxy P2P (${snap.roomId || "conectar"}) • Clique direito: Sala`
            }
            onClick={() => {
                if (snap.isStreaming) engine.stopLocalStream();
                else openRoxySourcePickerModal(engine, defaults);
            }}
            onContextMenu={e => {
                e.preventDefault();
                openRoxyRoomModal(engine, defaults.webPlayerBaseUrl);
            }}
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
                <path d="M8 21h8M12 17v4" />
                <path d="M16 7l5-5m0 0h-4m4 0v4" />
            </svg>
        </button>
    );
}
