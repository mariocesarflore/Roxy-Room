#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <windows.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <shlobj.h>
#include <dwmapi.h>
#pragma comment(lib, "dwmapi.lib")
#include <wrl.h>
#include <wrl/client.h>
#include "WebView2.h"
#include "WebView2EnvironmentOptions.h"
#include <string>
#include <sstream>
#include <thread>
#include <memory>
#include <iostream>
#include <vector>
#include <tlhelp32.h>
#include <atomic>
#include <fstream>

#include "TrayIcon.h"
#include "HotkeyManager.h"
#include "AudioExclusionCapturer.h"
#include "DXGICapturer.h"
#include "WebStreamServer.h"
#include "NativePlayerWindow.h"

using namespace Microsoft::WRL;

// Global state
static HWND g_hwnd = nullptr;
static ComPtr<ICoreWebView2> g_webview;
static ComPtr<ICoreWebView2Controller> g_controller;
static TrayIcon g_tray;
static HotkeyManager g_hotkeys;
static std::unique_ptr<AudioExclusionCapturer> g_audio;
static std::unique_ptr<DXGICapturer> g_video;
static std::unique_ptr<WebStreamServer> g_server;
static std::unique_ptr<NativePlayerWindow> g_nativePlayer;
static std::atomic<bool> g_isStreaming{ false };
static std::mutex g_streamMutex;
static bool g_isClosing = false;
static HINSTANCE g_hInst = nullptr;
static DWORD g_webviewBrowserPid = 0;
static std::thread g_suppressorThread;
static std::atomic<bool> g_stopSuppressor{ false };

void StartScreenShareBarSuppressor() {
    g_suppressorThread = std::thread([]() {
        while (!g_stopSuppressor.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            if (g_stopSuppressor.load()) break;

            EnumWindows([](HWND hwnd, LPARAM) -> BOOL {
                if (!hwnd || !IsWindow(hwnd)) return TRUE;
                // STRICT SAFETY: Never touch main window, any of its children, or native player window
                if (hwnd == g_hwnd || IsChild(g_hwnd, hwnd)) return TRUE;
                if (g_nativePlayer) {
                    HWND nHwnd = g_nativePlayer->GetHWND();
                    if (nHwnd && (hwnd == nHwnd || IsChild(nHwnd, hwnd))) return TRUE;
                }

                // Check class name
                WCHAR className[128] = {};
                GetClassNameW(hwnd, className, 127);
                if (wcscmp(className, L"Chrome_WidgetWin_1") != 0 && wcscmp(className, L"Chrome_WidgetWin_0") != 0) {
                    return TRUE;
                }

                // Small height floating bar check
                RECT rc;
                GetWindowRect(hwnd, &rc);
                int width = rc.right - rc.left;
                int height = rc.bottom - rc.top;
                if (height <= 0 || height > 140 || width <= 0 || width > 800) {
                    return TRUE;
                }

                // Check window text or child text
                WCHAR title[256] = {};
                GetWindowTextW(hwnd, title, 255);
                std::wstring sTitle = title;
                bool isShareBar = false;

                if (sTitle.find(L"compartilhando sua tela") != std::wstring::npos ||
                    sTitle.find(L"sharing your screen") != std::wstring::npos ||
                    sTitle.find(L"Parar compartilhamento") != std::wstring::npos) {
                    isShareBar = true;
                } else {
                    EnumChildWindows(hwnd, [](HWND child, LPARAM lParam) -> BOOL {
                        WCHAR cText[256] = {};
                        GetWindowTextW(child, cText, 255);
                        std::wstring sc = cText;
                        if (sc.find(L"Parar compartilhamento") != std::wstring::npos ||
                            sc.find(L"Stop sharing") != std::wstring::npos ||
                            sc.find(L"compartilhando sua tela") != std::wstring::npos) {
                            *reinterpret_cast<bool*>(lParam) = true;
                            return FALSE;
                        }
                        return TRUE;
                    }, reinterpret_cast<LPARAM>(&isShareBar));
                }

                if (isShareBar) {
                    ShowWindow(hwnd, SW_HIDE);
                    SetWindowPos(hwnd, nullptr, -10000, -10000, 0, 0, SWP_NOACTIVATE | SWP_NOZORDER | SWP_HIDEWINDOW);
                }

                return TRUE;
            }, 0);
        }
    });
}

#define ID_HOTKEY_STREAM 2001
#define WM_TRAYICON (WM_USER + 1)
#define WM_AUDIO_STATUS (WM_APP + 2)   // status do audio vindo da thread de captura -> thread da UI

// Helper: resolve web folder path
std::wstring GetWebPath() {
    WCHAR exePath[MAX_PATH];
    GetModuleFileNameW(nullptr, exePath, MAX_PATH);
    PathRemoveFileSpecW(exePath);
    std::wstring exeDir(exePath);

    std::wstring webPath = exeDir + L"\\web";
    if (GetFileAttributesW(webPath.c_str()) == INVALID_FILE_ATTRIBUTES) {
        WCHAR parentDir[MAX_PATH];
        wcsncpy_s(parentDir, exeDir.c_str(), _TRUNCATE);
        PathRemoveFileSpecW(parentDir);
        std::wstring candidate = std::wstring(parentDir) + L"\\web";
        if (GetFileAttributesW(candidate.c_str()) != INVALID_FILE_ATTRIBUTES) {
            webPath = candidate;
        } else {
            WCHAR cwd[MAX_PATH];
            GetCurrentDirectoryW(MAX_PATH, cwd);
            std::wstring cwdCandidate = std::wstring(cwd) + L"\\web";
            if (GetFileAttributesW(cwdCandidate.c_str()) != INVALID_FILE_ATTRIBUTES) {
                webPath = cwdCandidate;
            }
        }
    }
    return webPath;
}

// Post a message to the WebView JS
void SendToWebView(const std::wstring& json) {
    if (g_webview) {
        g_webview->PostWebMessageAsJson(json.c_str());
    }
}

// Send list of audio apps to the JS UI
void EnumerateAndSendAudioApps() {
    auto apps = AudioExclusionCapturer::EnumerateAudioApps();
    
    std::wostringstream ss;
    ss << L"{\"type\":\"audioAppsList\",\"apps\":[";
    for (size_t i = 0; i < apps.size(); i++) {
        if (i > 0) ss << L",";
        std::wstring safeName = apps[i].displayName;
        std::wstring safeExe = apps[i].exeName;
        for (auto& c : safeName) { if (c == L'"') c = L'\''; if (c == L'\\') c = L'/'; }
        for (auto& c : safeExe) { if (c == L'"') c = L'\''; if (c == L'\\') c = L'/'; }
        ss << L"{\"pid\":" << apps[i].pid 
           << L",\"name\":\"" << safeName 
           << L"\",\"exe\":\"" << safeExe << L"\"}";
    }
    ss << L"]}";
    SendToWebView(ss.str());
}

void StartStreaming(DWORD excludePid = 0) {
    std::lock_guard<std::mutex> lock(g_streamMutex);
    if (g_isStreaming) return;
    g_isStreaming = true;

    try {
        g_audio = std::make_unique<AudioExclusionCapturer>();
        // WebView2 so pode ser usado na thread da UI -> repassa via PostMessage
        g_audio->SetStatusCallback([](const std::wstring& state) {
            if (!g_hwnd) return;
            auto* heapState = new std::wstring(state);
            if (!PostMessageW(g_hwnd, WM_AUDIO_STATUS, 0, (LPARAM)heapState)) delete heapState;
        });
        g_audio->StartCapture(excludePid, [](const BYTE* pData, UINT32 numFrames, const WAVEFORMATEX* pwfx) {
            if (g_server && pData && pwfx) {
                UINT32 size = numFrames * pwfx->nBlockAlign;
                g_server->BroadcastAudioChunk(pData, size, pwfx->nSamplesPerSec, pwfx->nChannels);
            }
        });
    } catch (...) {
        std::wcerr << L"[AudioCapture] Excecao ao iniciar captura de audio." << std::endl;
    }

    // Notify UI
    std::wostringstream ss;
    ss << L"{\"type\":\"streamStarted\",\"excludePid\":" << excludePid << L"}";
    SendToWebView(ss.str());
}

void StopStreaming() {
    std::lock_guard<std::mutex> lock(g_streamMutex);
    if (!g_isStreaming) return;
    g_isStreaming = false;
    if (g_audio) { g_audio->StopCapture(); g_audio.reset(); }
    if (g_video) { g_video->StopCapture(); g_video.reset(); }
    SendToWebView(L"{\"type\":\"streamStopped\"}");
}

void OpenNativePlayer() {
    if (!g_nativePlayer) {
        g_nativePlayer = std::make_unique<NativePlayerWindow>();
    }
    g_nativePlayer->Create(g_hInst, g_hwnd, L"Roxy Room - Player Nativo Direct3D 11");
}

void KillProcessTree(DWORD rootPid) {
    if (rootPid == 0 || rootPid == GetCurrentProcessId()) return;

    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnap != INVALID_HANDLE_VALUE) {
        PROCESSENTRY32W pe;
        pe.dwSize = sizeof(pe);
        if (Process32FirstW(hSnap, &pe)) {
            do {
                if (pe.th32ParentProcessID == rootPid && pe.th32ProcessID != rootPid) {
                    KillProcessTree(pe.th32ProcessID);
                }
            } while (Process32NextW(hSnap, &pe));
        }
        CloseHandle(hSnap);
    }

    HANDLE hProc = OpenProcess(PROCESS_TERMINATE, FALSE, rootPid);
    if (hProc) {
        TerminateProcess(hProc, 0);
        CloseHandle(hProc);
    }
}

void ForceKillWebViewProcesses() {
    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnap == INVALID_HANDLE_VALUE) return;
    PROCESSENTRY32W pe;
    pe.dwSize = sizeof(pe);
    DWORD myPid = GetCurrentProcessId();

    if (Process32FirstW(hSnap, &pe)) {
        do {
            if (_wcsicmp(pe.szExeFile, L"msedgewebview2.exe") == 0) {
                if (pe.th32ParentProcessID == myPid || (g_webviewBrowserPid != 0 && pe.th32ParentProcessID == g_webviewBrowserPid)) {
                    HANDLE hProc = OpenProcess(PROCESS_TERMINATE, FALSE, pe.th32ProcessID);
                    if (hProc) {
                        TerminateProcess(hProc, 0);
                        CloseHandle(hProc);
                    }
                }
            }
        } while (Process32NextW(hSnap, &pe));
    }
    CloseHandle(hSnap);
}

void CleanExit() {
    static std::atomic<bool> alreadyExiting{ false };
    if (alreadyExiting.exchange(true)) return;
    g_isClosing = true;
    g_stopSuppressor = true;

    // 1. Hide windows immediately
    if (g_hwnd) ShowWindow(g_hwnd, SW_HIDE);
    if (g_nativePlayer) {
        g_nativePlayer->Close();
        g_nativePlayer.reset();
    }
    g_tray.Remove();

    // 2. Stop streams and web server
    StopStreaming();
    if (g_server) {
        g_server->Stop();
        g_server.reset();
    }

    // 3. Close WebView2 controller
    if (g_controller) {
        g_controller->Close();
        g_controller = nullptr;
    }
    g_webview = nullptr;

    // 4. Terminate WebView2 browser processes
    if (g_webviewBrowserPid != 0) {
        KillProcessTree(g_webviewBrowserPid);
    }
    ForceKillWebViewProcesses();

    // 5. Hard exit process to ensure zero hung threads or sockets
    TerminateProcess(GetCurrentProcess(), 0);
}

// Window procedure
LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_SIZE:
        if (g_controller && wParam != SIZE_MINIMIZED) {
            RECT bounds;
            GetClientRect(hwnd, &bounds);
            g_controller->put_Bounds(bounds);
        }
        break;

    case WM_HOTKEY:
        if (wParam == ID_HOTKEY_STREAM) {
            g_hotkeys.HandleMessage(wParam);
        }
        break;

    case WM_TRAYICON:
        g_tray.HandleMessage(wParam, lParam);
        break;

    case WM_AUDIO_STATUS: {
        std::unique_ptr<std::wstring> state(reinterpret_cast<std::wstring*>(lParam));
        if (state) {
            SendToWebView(L"{\"type\":\"audioStatus\",\"state\":\"" + *state + L"\"}");
        }
        return 0;
    }

    case WM_CLOSE:
        CleanExit();
        return 0;

    case WM_DESTROY:
        CleanExit();
        return 0;

    default:
        return DefWindowProcW(hwnd, msg, wParam, lParam);
    }
    return 0;
}

// Helper: Perform automated application update from GitHub release
void PerformAppUpdate(const std::wstring& downloadUrl) {
    WCHAR tempPath[MAX_PATH];
    GetTempPathW(MAX_PATH, tempPath);
    std::wstring updateDir = std::wstring(tempPath) + L"RoxyRoom_Update";
    CreateDirectoryW(updateDir.c_str(), nullptr);

    std::wstring zipPath = updateDir + L"\\RoxyRoom-Update.zip";
    std::wstring batPath = updateDir + L"\\apply_update.bat";

    // Delete any previous update file
    DeleteFileW(zipPath.c_str());

    // 1. Notify UI: downloading
    SendToWebView(L"{\"type\":\"updateProgress\",\"status\":\"downloading\"}");

    // 2. Download via PowerShell
    std::wstring psCmd = L"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \""
        L"[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; "
        L"$client = New-Object System.Net.WebClient; "
        L"$client.Headers.Add('User-Agent', 'RoxyRoom-Updater'); "
        L"$client.DownloadFile('" + downloadUrl + L"', '" + zipPath + L"')\"";

    STARTUPINFOW si = { sizeof(si) };
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi = {};

    std::vector<wchar_t> cmdBuf(psCmd.begin(), psCmd.end());
    cmdBuf.push_back(0);

    if (CreateProcessW(nullptr, cmdBuf.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        WaitForSingleObject(pi.hProcess, 120000); // Wait up to 120s
        DWORD exitCode = 1;
        GetExitCodeProcess(pi.hProcess, &exitCode);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);

        if (exitCode != 0 || GetFileAttributesW(zipPath.c_str()) == INVALID_FILE_ATTRIBUTES) {
            SendToWebView(L"{\"type\":\"updateFailed\",\"error\":\"download_error\"}");
            return;
        }
    } else {
        SendToWebView(L"{\"type\":\"updateFailed\",\"error\":\"process_error\"}");
        return;
    }

    // 3. Resolve app directory
    WCHAR exePath[MAX_PATH];
    GetModuleFileNameW(nullptr, exePath, MAX_PATH);
    std::wstring fullExe(exePath);
    PathRemoveFileSpecW(exePath);
    std::wstring appDir(exePath);

    // 4. Create batch updater script
    std::wofstream batFile(batPath);
    if (batFile.is_open()) {
        batFile << L"@echo off\r\n";
        batFile << L"echo Atualizando o Roxy Room para a versao mais recente...\r\n";
        batFile << L"timeout /t 1 /nobreak >nul\r\n";
        batFile << L"tar -xf \"" << zipPath << L"\" -C \"" << appDir << L"\"\r\n";
        batFile << L"start \"\" \"" << fullExe << L"\"\r\n";
        batFile << L"timeout /t 2 /nobreak >nul\r\n";
        batFile << L"del /q \"" << zipPath << L"\"\r\n";
        batFile << L"del /q \"%~f0\"\r\n";
        batFile.close();
    }

    // 5. Notify UI update is ready and restarting
    SendToWebView(L"{\"type\":\"updateReady\"}");
    Sleep(1500);

    // 6. Launch updater detached and exit
    ShellExecuteW(nullptr, L"open", batPath.c_str(), nullptr, nullptr, SW_HIDE);
    CleanExit();
}

// WebView2 message handler - JS -> C++
void OnWebMessageReceived(ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) {
    LPWSTR rawMsg = nullptr;
    args->TryGetWebMessageAsString(&rawMsg);
    if (!rawMsg) return;
    std::wstring msg(rawMsg);
    CoTaskMemFree(rawMsg);

    if (msg == L"startStream") {
        StartStreaming(0);
    } else if (msg.rfind(L"startStreamExclude:", 0) == 0) {
        DWORD pid = (DWORD)_wtol(msg.substr(19).c_str());
        StartStreaming(pid);
    } else if (msg == L"getAudioApps") {
        EnumerateAndSendAudioApps();
    } else if (msg == L"stopStream") {
        StopStreaming();
    } else if (msg == L"openNativePlayer") {
        OpenNativePlayer();
    } else if (msg == L"quit") {
        CleanExit();
    } else if (msg == L"hideToTray" || msg == L"minimize") {
        ShowWindow(g_hwnd, SW_HIDE);
    } else if (msg == L"openFirewall") {
        WCHAR exePath[MAX_PATH];
        GetModuleFileNameW(nullptr, exePath, MAX_PATH);
        ShellExecuteW(nullptr, L"runas", L"netsh", 
            (L"advfirewall firewall add rule name=\"Roxy-Room-UDP\" dir=in action=allow program=\"" + std::wstring(exePath) + L"\" protocol=udp enable=yes").c_str(),
            nullptr, SW_HIDE);
    } else if (msg.rfind(L"setHotkey:", 0) == 0) {
        g_hotkeys.Unregister(g_hwnd, ID_HOTKEY_STREAM);
        g_hotkeys.Register(g_hwnd, ID_HOTKEY_STREAM, MOD_ALT | MOD_NOREPEAT, 'G', []() {
            SendToWebView(L"{\"type\":\"hotkeyToggleStream\"}");
        });
    } else if (msg.rfind(L"openUrl:", 0) == 0) {
        std::wstring url = msg.substr(8);
        ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    } else if (msg.rfind(L"startUpdate:", 0) == 0) {
        std::wstring downloadUrl = msg.substr(12);
        std::thread([downloadUrl]() {
            PerformAppUpdate(downloadUrl);
        }).detach();
    }
}

bool CheckWebView2Installed() {
    LPWSTR versionInfo = nullptr;
    HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(nullptr, &versionInfo);
    if (SUCCEEDED(hr) && versionInfo != nullptr && wcslen(versionInfo) > 0) {
        CoTaskMemFree(versionInfo);
        return true;
    }
    return false;
}

bool PromptAndInstallWebView2(HWND hwndParent) {
    int res = MessageBoxW(hwndParent,
        L"O componente 'Microsoft Edge WebView2 Runtime' não foi encontrado no seu computador.\n\n"
        L"Ele é necessário para a interface do Roxy Room.\n\n"
        L"Deseja baixar e instalar o WebView2 automaticamente agora?",
        L"Roxy Room - WebView2 Necessário",
        MB_YESNO | MB_ICONQUESTION);

    if (res != IDYES) {
        int manual = MessageBoxW(hwndParent,
            L"Sem o WebView2 Runtime, o aplicativo não pode inicializar a interface.\n\n"
            L"Deseja abrir a página oficial da Microsoft para baixar manualmente?",
            L"Roxy Room",
            MB_YESNO | MB_ICONINFORMATION);
        if (manual == IDYES) {
            ShellExecuteW(nullptr, L"open", L"https://go.microsoft.com/fwlink/p/?LinkId=2124703", nullptr, nullptr, SW_SHOWNORMAL);
        }
        return false;
    }

    WCHAR tempPath[MAX_PATH];
    GetTempPathW(MAX_PATH, tempPath);
    std::wstring installerPath = std::wstring(tempPath) + L"MicrosoftEdgeWebview2Setup.exe";

    std::wstring psCmd =
        L"-NoProfile -ExecutionPolicy Bypass -Command \""
        L"[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; "
        L"(New-Object System.Net.WebClient).DownloadFile('https://go.microsoft.com/fwlink/p/?LinkId=2124703', '" + installerPath + L"'); "
        L"Start-Process -FilePath '" + installerPath + L"' -ArgumentList '/install' -Wait"
        L"\"";

    SHELLEXECUTEINFOW sei = {};
    sei.cbSize = sizeof(sei);
    sei.fMask = SEE_MASK_NOCLOSEPROCESS;
    sei.lpVerb = L"open";
    sei.lpFile = L"powershell.exe";
    sei.lpParameters = psCmd.c_str();
    sei.nShow = SW_SHOWNORMAL;

    if (ShellExecuteExW(&sei) && sei.hProcess) {
        WaitForSingleObject(sei.hProcess, 300000);
        CloseHandle(sei.hProcess);
        DeleteFileW(installerPath.c_str());
    }

    if (CheckWebView2Installed()) {
        MessageBoxW(hwndParent,
            L"Microsoft Edge WebView2 Runtime instalado com sucesso!\nO aplicativo será iniciado agora.",
            L"Roxy Room",
            MB_OK | MB_ICONINFORMATION);
        return true;
    } else {
        MessageBoxW(hwndParent,
            L"Não foi possível concluir a instalação automática do WebView2.\n\n"
            L"A página oficial da Microsoft será aberta para download.",
            L"Roxy Room - Erro",
            MB_OK | MB_ICONEXCLAMATION);
        ShellExecuteW(nullptr, L"open", L"https://go.microsoft.com/fwlink/p/?LinkId=2124703", nullptr, nullptr, SW_SHOWNORMAL);
        return false;
    }
}

// Initialize WebView2 and load the app
void InitWebView2(HWND hwnd) {
    if (!CheckWebView2Installed()) {
        if (!PromptAndInstallWebView2(hwnd)) {
            DestroyWindow(hwnd);
            return;
        }
    }

    WCHAR localAppData[MAX_PATH];
    std::wstring dataPath;
    if (GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH) > 0) {
        dataPath = std::wstring(localAppData) + L"\\RoxyRoom\\webview_data";
    } else {
        WCHAR exeDir[MAX_PATH];
        GetModuleFileNameW(nullptr, exeDir, MAX_PATH);
        PathRemoveFileSpecW(exeDir);
        dataPath = std::wstring(exeDir) + L"\\webview_data";
    }

    SHCreateDirectoryExW(nullptr, dataPath.c_str(), nullptr);

    std::wstring webPath = GetWebPath();

    auto options = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
    options->put_AdditionalBrowserArguments(
        L"--autoplay-policy=no-user-gesture-required "
        L"--enable-features=WebRtcHardwareVideoEncoding,WebRtcHardwareVideoDecoding "
        L"--disable-features=CalculateNativeWinOcclusion"
    );

    HRESULT hrInit = CreateCoreWebView2EnvironmentWithOptions(nullptr, dataPath.c_str(), options.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [hwnd, webPath](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                if (FAILED(result) || !env) {
                    if (result == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)) {
                        if (PromptAndInstallWebView2(hwnd)) {
                            InitWebView2(hwnd);
                            return S_OK;
                        }
                    } else {
                        WCHAR errMsg[256];
                        swprintf_s(errMsg, L"Falha ao inicializar WebView2 (HRESULT 0x%08X).", result);
                        MessageBoxW(hwnd, errMsg, L"Roxy Room - Erro", MB_ICONERROR | MB_OK);
                    }
                    DestroyWindow(hwnd);
                    return result;
                }

                env->CreateCoreWebView2Controller(hwnd,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [hwnd, webPath](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(result) || !controller) {
                                MessageBoxW(hwnd, L"Falha ao criar o controlador do WebView2.", L"Erro", MB_ICONERROR | MB_OK);
                                return result;
                            }

                            g_controller = controller;
                            controller->get_CoreWebView2(&g_webview);

                            if (!g_webview) return E_FAIL;

                            UINT32 bPid = 0;
                            if (SUCCEEDED(g_webview->get_BrowserProcessId(&bPid))) {
                                g_webviewBrowserPid = (DWORD)bPid;
                            }

                            // Settings
                            ComPtr<ICoreWebView2Settings> settings;
                            g_webview->get_Settings(&settings);
                            if (settings) {
                                settings->put_IsStatusBarEnabled(FALSE);
                                settings->put_AreDefaultContextMenusEnabled(FALSE);
                                settings->put_IsZoomControlEnabled(FALSE);
                                settings->put_AreDevToolsEnabled(FALSE);
                            }

                            // Size bounds
                            RECT bounds;
                            GetClientRect(hwnd, &bounds);
                            controller->put_Bounds(bounds);
                            controller->put_IsVisible(TRUE);

                            // Permissions
                            g_webview->add_PermissionRequested(
                                Callback<ICoreWebView2PermissionRequestedEventHandler>(
                                    [](ICoreWebView2* sender, ICoreWebView2PermissionRequestedEventArgs* args) -> HRESULT {
                                        args->put_State(COREWEBVIEW2_PERMISSION_STATE_ALLOW);
                                        return S_OK;
                                    }).Get(), nullptr);

                            // Message handler (JS -> C++)
                            g_webview->add_WebMessageReceived(
                                Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                    [](ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                        OnWebMessageReceived(sender, args);
                                        return S_OK;
                                    }).Get(), nullptr);

                            // Inject C++ bridge object into JS (support both roxyBridge and mdpBridge alias)
                            g_webview->AddScriptToExecuteOnDocumentCreated(
                                L"window.roxyBridge = window.mdpBridge = {"
                                L"  send: (msg) => window.chrome.webview.postMessage(msg),"
                                L"  onMessage: (cb) => window.chrome.webview.addEventListener('message', e => cb(e.data))"
                                L"};",
                                nullptr);

                            // Virtual host mapping
                            ComPtr<ICoreWebView2_3> webview3;
                            if (SUCCEEDED(g_webview.As(&webview3))) {
                                webview3->SetVirtualHostNameToFolderMapping(
                                    L"app.roxyroom",
                                    webPath.c_str(),
                                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW
                                );
                                g_webview->Navigate(L"https://app.roxyroom/index.html");
                            } else {
                                std::wstring indexPath = L"file:///" + webPath + L"/index.html";
                                for (auto& c : indexPath) if (c == L'\\') c = L'/';
                                g_webview->Navigate(indexPath.c_str());
                            }

                            return S_OK;
                        }).Get());
                return S_OK;
            }).Get());

    if (FAILED(hrInit)) {
        if (hrInit == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)) {
            if (PromptAndInstallWebView2(hwnd)) {
                InitWebView2(hwnd);
                return;
            }
        } else {
            WCHAR errMsg[256];
            swprintf_s(errMsg, L"CreateCoreWebView2EnvironmentWithOptions retornou erro 0x%08X", hrInit);
            MessageBoxW(hwnd, errMsg, L"Roxy Room - Erro", MB_ICONERROR | MB_OK);
        }
        DestroyWindow(hwnd);
    }
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int nCmdShow) {
    g_hInst = hInstance;

    // Single instance lock
    HANDLE hMutex = CreateMutexW(nullptr, TRUE, L"RoxyRoomAppLock");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existing = FindWindowW(L"RoxyRoom", nullptr);
        if (existing && IsWindow(existing)) {
            ShowWindow(existing, SW_SHOW);
            ShowWindow(existing, SW_RESTORE);
            SetForegroundWindow(existing);
            BringWindowToTop(existing);
            CloseHandle(hMutex);
            return 0;
        }
    }

    // Windows Job Object to auto-kill all child processes on exit
    HANDLE hJob = CreateJobObjectW(nullptr, nullptr);
    if (hJob) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli = { 0 };
        jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));
        AssignProcessToJobObject(hJob, GetCurrentProcess());
    }

    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

    // Start WebSocket streaming server
    std::wstring webPath = GetWebPath();
    int size_needed = WideCharToMultiByte(CP_UTF8, 0, webPath.c_str(), (int)webPath.length(), NULL, 0, NULL, NULL);
    std::string webPathStr(size_needed, 0);
    WideCharToMultiByte(CP_UTF8, 0, webPath.c_str(), (int)webPath.length(), &webPathStr[0], size_needed, NULL, NULL);

    g_server = std::make_unique<WebStreamServer>(8085);
    g_server->Start(webPathStr);

    // Register window class
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"RoxyRoom";
    wc.hIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(1));
    if (!wc.hIcon) wc.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(6, 9, 17));
    RegisterClassExW(&wc);

    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int winW = 1280;
    int winH = 750;
    int posX = (screenW - winW) / 2;
    int posY = (screenH - winH) / 2;
    if (posX < 0) posX = CW_USEDEFAULT;
    if (posY < 0) posY = CW_USEDEFAULT;

    // Create main window
    g_hwnd = CreateWindowExW(0, L"RoxyRoom", L"Roxy Room",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        posX, posY, winW, winH,
        nullptr, nullptr, hInstance, nullptr);

    if (!g_hwnd) {
        MessageBoxW(nullptr, L"Falha ao criar janela principal.", L"Erro", MB_ICONERROR);
        return 1;
    }

    // Enable dark title bar (Windows 10 / 11)
    BOOL darkMode = TRUE;
    DwmSetWindowAttribute(g_hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &darkMode, sizeof(darkMode));
    DwmSetWindowAttribute(g_hwnd, 19 /* DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 */, &darkMode, sizeof(darkMode));
    COLORREF captionColor = RGB(6, 9, 17);
    DwmSetWindowAttribute(g_hwnd, 35 /* DWMWA_CAPTION_COLOR */, &captionColor, sizeof(captionColor));
    COLORREF textColor = RGB(248, 250, 252);
    DwmSetWindowAttribute(g_hwnd, 36 /* DWMWA_TEXT_COLOR */, &textColor, sizeof(textColor));
    COLORREF borderColor = RGB(20, 28, 54);
    DwmSetWindowAttribute(g_hwnd, 34 /* DWMWA_BORDER_COLOR */, &borderColor, sizeof(borderColor));

    // Tray icon
    g_tray.Create(g_hwnd, hInstance, L"Roxy Room");
    g_tray.SetCallback([](UINT id) {
        if (id == ID_TRAY_SHOW) {
            ShowWindow(g_hwnd, SW_SHOW);
            ShowWindow(g_hwnd, SW_RESTORE);
            SetForegroundWindow(g_hwnd);
        } else if (id == ID_TRAY_QUIT) {
            CleanExit();
        }
    });

    // Global hotkey Alt+G = toggle stream via UI message
    g_hotkeys.Register(g_hwnd, ID_HOTKEY_STREAM, MOD_ALT | MOD_NOREPEAT, 'G', []() {
        SendToWebView(L"{\"type\":\"hotkeyToggleStream\"}");
    });

    // Initialize WebView2
    InitWebView2(g_hwnd);

    // Start background suppressor for screen sharing notification bar
    StartScreenShareBarSuppressor();

    ShowWindow(g_hwnd, SW_SHOWNORMAL);
    UpdateWindow(g_hwnd);
    SetForegroundWindow(g_hwnd);
    BringWindowToTop(g_hwnd);

    // Message loop
    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    CleanExit();
    return 0;
}
