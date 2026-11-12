#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include "AudioExclusionCapturer.h"
#include "WebStreamServer.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <atomic>
#include <chrono>

static DWORD FindDiscordRootPid() {
    const wchar_t* candidates[] = {
        L"Discord.exe",
        L"DiscordPTB.exe",
        L"DiscordCanary.exe",
        L"Vesktop.exe"
    };
    for (const wchar_t* name : candidates) {
        DWORD pid = AudioExclusionCapturer::FindProcessId(name);
        if (pid > 0) {
            return AudioExclusionCapturer::GetRootProcessId(pid);
        }
    }
    return 0;
}

int main(int argc, char* argv[]) {
    int requestedPort = 8095;
    DWORD excludePid = 0;
    DWORD parentPid = 0;

    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
            requestedPort = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--exclude-pid") == 0 && i + 1 < argc) {
            excludePid = (DWORD)strtoul(argv[++i], nullptr, 10);
        } else if (strcmp(argv[i], "--parent-pid") == 0 && i + 1 < argc) {
            parentPid = (DWORD)strtoul(argv[++i], nullptr, 10);
        }
    }

    HRESULT hrCom = CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    if (excludePid > 0) {
        excludePid = AudioExclusionCapturer::GetRootProcessId(excludePid);
    } else {
        excludePid = FindDiscordRootPid();
    }

    if (excludePid == 0) {
        printf("ERROR NO_DISCORD_PID\n");
        fflush(stdout);
        if (SUCCEEDED(hrCom)) CoUninitialize();
        return 2;
    }

    WebStreamServer server(requestedPort);
    if (!server.Start(".")) {
        printf("ERROR SERVER_START_FAILED\n");
        fflush(stdout);
        if (SUCCEEDED(hrCom)) CoUninitialize();
        return 3;
    }

    AudioExclusionCapturer capturer;
    capturer.SetStatusCallback([](const std::wstring& state) {
        printf("STATUS %ls\n", state.c_str());
        fflush(stdout);
    });

    auto audioCallback = [&server](const BYTE* pData, UINT32 numFrames, const WAVEFORMATEX* pwfx) {
        if (pData && pwfx && numFrames > 0) {
            UINT32 size = numFrames * pwfx->nBlockAlign;
            server.BroadcastAudioChunk(pData, size, pwfx->nSamplesPerSec, pwfx->nChannels);
        }
    };

    capturer.StartCapture(excludePid, audioCallback);

    printf("READY %d %lu\n", server.GetPort(), (unsigned long)excludePid);
    fflush(stdout);

    std::atomic<bool> shouldExit{ false };
    HANDLE hStopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

    std::thread stdinWatcher([&]() {
        int ch = 0;
        while ((ch = getchar()) != EOF) {
            if (ch == 'q' || ch == 'Q') break;
        }
        shouldExit = true;
        if (hStopEvent) SetEvent(hStopEvent);
    });
    stdinWatcher.detach();

    // Guardiao do PID do Discord: se o Discord reiniciar (ou uma nova instancia principal
    // aparecer), o PID raiz muda. Sem isso a exclusao continuaria apontando para um processo
    // morto e a voz da call voltaria a vazar na transmissao (eco).
    std::thread pidWatcher([&]() {
        DWORD current = excludePid;
        while (!shouldExit.load()) {
            for (int i = 0; i < 25 && !shouldExit.load(); ++i) {
                std::this_thread::sleep_for(std::chrono::milliseconds(200));
            }
            if (shouldExit.load()) break;

            DWORD resolved = FindDiscordRootPid();
            if (resolved == 0 || resolved == current) continue;

            printf("STATUS reconnecting\n");
            fflush(stdout);

            capturer.StopCapture();
            if (shouldExit.load()) break;
            capturer.StartCapture(resolved, audioCallback);
            current = resolved;

            printf("READY %d %lu\n", server.GetPort(), (unsigned long)resolved);
            fflush(stdout);
        }
    });

    HANDLE hParent = nullptr;
    if (parentPid > 0) {
        hParent = OpenProcess(SYNCHRONIZE, FALSE, parentPid);
    }

    if (hParent && hStopEvent) {
        HANDLE waits[2] = { hStopEvent, hParent };
        WaitForMultipleObjects(2, waits, FALSE, INFINITE);
    } else if (hStopEvent) {
        WaitForSingleObject(hStopEvent, INFINITE);
    }

    if (pidWatcher.joinable()) {
        pidWatcher.join();
    }
    capturer.StopCapture();
    server.Stop();
    if (hParent) CloseHandle(hParent);
    if (hStopEvent) CloseHandle(hStopEvent);
    if (SUCCEEDED(hrCom)) CoUninitialize();
    return 0;
}
