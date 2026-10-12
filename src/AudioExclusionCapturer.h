#ifndef AUDIO_EXCLUSION_CAPTURER_H
#define AUDIO_EXCLUSION_CAPTURER_H

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <winsock2.h>
#include <windows.h>
#include <sdkddkver.h>

#ifndef NTDDI_WIN10_FE
#define NTDDI_WIN10_FE 0x0A00000B
#endif

#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <tlhelp32.h>
#include <vector>
#include <string>
#include <functional>
#include <thread>
#include <atomic>
#include <mutex>

// Info about a running audio session (app producing sound)
struct AudioAppInfo {
    DWORD pid;
    std::wstring displayName;   // Friendly name (e.g., "Discord", "Spotify")
    std::wstring exeName;       // Process exe name (e.g., "Discord.exe")
};

class AudioExclusionCapturer {
public:
    using AudioCallback = std::function<void(const BYTE* pData, UINT32 numFrames, const WAVEFORMATEX* pwfx)>;
    // Status reportado para a UI: L"exclude" (exclusao ativa), L"all" (todo o som),
    // L"fallback" (exclusao indisponivel -> captura total), L"failed" (sem audio)
    // ATENCAO: chamado a partir da thread de captura.
    using StatusCallback = std::function<void(const std::wstring& state)>;

    AudioExclusionCapturer();
    ~AudioExclusionCapturer();

    // Find root process of an exe by name (e.g. L"Discord.exe")
    static DWORD FindProcessId(const std::wstring& processName);

    // Given any PID (even a child/worker process), find the top-most root process in the same exe tree
    static DWORD GetRootProcessId(DWORD pid);

    // Enumerate all apps currently producing audio
    static std::vector<AudioAppInfo> EnumerateAudioApps();

    // Start capture: if excludePid > 0, excludes that process tree. If 0, captures all audio.
    bool StartCapture(DWORD excludePid, AudioCallback callback);

    void StopCapture();

    void SetStatusCallback(StatusCallback cb) { m_statusCallback = std::move(cb); }

    bool IsCapturing() const { return m_isCapturing; }
    WAVEFORMATEX GetFormat() const { return m_waveFormat; }

private:
    enum class SessionResult { Stopped, Failed, DeviceLost };

    void CaptureThreadFunc(DWORD excludePid);
    SessionResult RunSession(DWORD excludePid);
    void ReportStatus(const std::wstring& state);

    std::atomic<bool> m_isCapturing{ false };
    HANDLE m_hStopEvent = nullptr;
    std::thread m_captureThread;
    AudioCallback m_audioCallback;
    StatusCallback m_statusCallback;
    WAVEFORMATEX m_waveFormat{};
    std::mutex m_mutex;
};

#endif // AUDIO_EXCLUSION_CAPTURER_H
