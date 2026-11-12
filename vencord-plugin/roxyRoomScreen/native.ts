import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { desktopCapturer, IpcMainInvokeEvent } from "electron";
import { existsSync } from "fs";
import { join } from "path";

export interface NativeDesktopSource {
    id: string;
    name: string;
    thumbnailDataUrl: string;
    appIconDataUrl?: string;
    type: "screen" | "window";
}

export interface ExcludedAudioStartResult {
    ok: boolean;
    port?: number;
    excludedPid?: number;
    helperPath?: string;
    status?: string;
    error?: string;
}

const IGNORED_WINDOW_PATTERNS: RegExp[] = [
    /^nvidia geforce overlay/i,
    /^nvidia overlay/i,
    /^nvidia container/i,
    /rainmeter\\skins\\/i,
    /^(program manager|windows input experience|microsoft text input application|msctfime ui|default ime|action center|notification center|search|start|cortana|task switching|lockapp)$/i,
    /^(rtss|rivatuner statistics server|msi afterburner.*overlay)$/i
];

function isIgnoredCaptureWindow(src: Electron.DesktopCapturerSource): boolean {
    const id = String(src?.id || "");
    const name = String(src?.name || "").trim();
    if (!id || !name) return true;
    if (id.startsWith("screen:")) return false;

    if (IGNORED_WINDOW_PATTERNS.some(rx => rx.test(name))) {
        return true;
    }

    // Filter background Windows system paths / invisible hosts
    if (/^[A-Z]:\\.*\\(Rainmeter|WallpaperEngine|TranslucentTB)\\/i.test(name)) {
        return true;
    }

    if (src.thumbnail && src.thumbnail.isEmpty()) {
        return true;
    }

    const size = src.thumbnail?.getSize?.();
    if (size && (size.width <= 1 || size.height <= 1)) {
        return true;
    }

    return false;
}

export async function getDesktopCaptureSources(_: IpcMainInvokeEvent): Promise<NativeDesktopSource[]> {
    const rawSources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 288, height: 162 },
        fetchWindowIcons: true
    });

    const filtered = rawSources.filter(src => !isIgnoredCaptureWindow(src));

    // Keep actual games/apps first and push Discord windows to the end of Aplicativos
    filtered.sort((a, b) => {
        const aScreen = String(a.id).startsWith("screen:") ? 0 : 1;
        const bScreen = String(b.id).startsWith("screen:") ? 0 : 1;
        if (aScreen !== bScreen) return aScreen - bScreen;

        const aDiscord = /discord/i.test(a.name) ? 1 : 0;
        const bDiscord = /discord/i.test(b.name) ? 1 : 0;
        return aDiscord - bDiscord;
    });

    return filtered.map(src => {
        const thumb = src.thumbnail && !src.thumbnail.isEmpty() ? src.thumbnail.toDataURL() : "";
        const icon = src.appIcon && !src.appIcon.isEmpty() ? src.appIcon.toDataURL() : undefined;
        const id = String(src.id);
        return {
            id,
            name: String(src.name),
            thumbnailDataUrl: thumb,
            appIconDataUrl: icon,
            type: id.startsWith("screen:") ? "screen" : "window"
        };
    });
}

let activeHelper: ChildProcessWithoutNullStreams | null = null;
let activeHelperState = "idle";
let exitHookRegistered = false;

function findHelperExecutable(): string | null {
    const candidates = [
        process.env.ROXY_AUDIO_HELPER_PATH || "",
        join(__dirname, "RoxyAudioHelper.exe"),
        join(process.env.LOCALAPPDATA || "", "RoxyRoom", "RoxyAudioHelper.exe"),
        join(process.env.APPDATA || "", "Vencord", "RoxyAudioHelper.exe"),
        join(process.env.APPDATA || "", "Vencord", "dist", "RoxyAudioHelper.exe"),
        join(process.env.USERPROFILE || "", "Documents", "Programaçao", "faculdade", "Tela Discord", "bin", "RoxyAudioHelper.exe")
    ];

    for (const p of candidates) {
        if (p && existsSync(p)) return p;
    }
    return null;
}

function killHelperInternal() {
    if (!activeHelper) return;
    const proc = activeHelper;
    activeHelper = null;
    activeHelperState = "idle";
    try {
        proc.stdin?.write("q\n");
        proc.stdin?.end();
    } catch {}
    setTimeout(() => {
        try {
            if (!proc.killed) proc.kill();
        } catch {}
    }, 250);
}

export async function checkExcludedAudioSupport(_: IpcMainInvokeEvent): Promise<{ available: boolean; helperPath: string | null }> {
    const helperPath = findHelperExecutable();
    return {
        available: Boolean(helperPath),
        helperPath
    };
}

export async function startExcludedAudio(
    _: IpcMainInvokeEvent,
    requestedPort = 8095
): Promise<ExcludedAudioStartResult> {
    if (process.platform !== "win32") {
        return { ok: false, error: "Exclusão WASAPI por processo está disponível apenas no Windows." };
    }

    const helperPath = findHelperExecutable();
    if (!helperPath) {
        return {
            ok: false,
            error: "RoxyAudioHelper.exe não encontrado. Execute tools\\build.bat ou instalar-vencord.ps1."
        };
    }

    killHelperInternal();

    if (!exitHookRegistered) {
        exitHookRegistered = true;
        process.once("exit", killHelperInternal);
    }

    const discordPid = process.pid;

    return new Promise(resolve => {
        let settled = false;
        let buffer = "";

        const finish = (res: ExcludedAudioStartResult) => {
            if (settled) return;
            settled = true;
            resolve(res);
        };

        const proc = spawn(
            helperPath,
            [
                "--port",
                String(requestedPort || 8095),
                "--exclude-pid",
                String(discordPid),
                "--parent-pid",
                String(discordPid)
            ],
            {
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"]
            }
        );

        activeHelper = proc;
        activeHelperState = "starting";

        const timeout = setTimeout(() => {
            finish({ ok: false, error: "Tempo limite ao iniciar helper de áudio sem eco." });
        }, 3000);

        proc.stdout.on("data", (chunk: Buffer) => {
            buffer += chunk.toString("utf8");
            let idx = buffer.indexOf("\n");
            while (idx >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);

                if (line.startsWith("READY ")) {
                    const parts = line.split(/\s+/);
                    const port = parseInt(parts[1] || "0", 10);
                    const excludedPid = parseInt(parts[2] || "0", 10);
                    clearTimeout(timeout);
                    activeHelperState = "ready";
                    finish({
                        ok: port > 0,
                        port,
                        excludedPid,
                        helperPath,
                        status: activeHelperState
                    });
                } else if (line.startsWith("STATUS ")) {
                    activeHelperState = line.slice(7).trim();
                } else if (line.startsWith("ERROR ")) {
                    clearTimeout(timeout);
                    finish({ ok: false, error: line.slice(6).trim() });
                }

                idx = buffer.indexOf("\n");
            }
        });

        proc.on("error", err => {
            clearTimeout(timeout);
            if (activeHelper === proc) activeHelper = null;
            finish({ ok: false, error: err?.message || "Falha ao executar RoxyAudioHelper.exe." });
        });

        proc.on("exit", code => {
            clearTimeout(timeout);
            if (activeHelper === proc) activeHelper = null;
            if (!settled) {
                finish({ ok: false, error: `RoxyAudioHelper encerrou antes de iniciar (código ${code ?? -1}).` });
            }
        });
    });
}

export async function stopExcludedAudio(_: IpcMainInvokeEvent): Promise<{ ok: boolean }> {
    killHelperInternal();
    return { ok: true };
}
