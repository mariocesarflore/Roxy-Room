#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <string>
#include <vector>
#include <thread>
#include <fstream>

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

// Enable modern visual styles
#pragma comment(linker,"\"/manifestdependency:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\"")

#include "payload_data.h"

static HWND g_hwnd = nullptr;
static HWND g_progressBar = nullptr;
static HWND g_statusText = nullptr;
static HWND g_titleText = nullptr;
static HFONT g_fontTitle = nullptr;
static HFONT g_fontText = nullptr;

void SetStatus(const std::wstring& text, int progressPercent) {
    if (g_statusText) {
        SetWindowTextW(g_statusText, text.c_str());
    }
    if (g_progressBar) {
        SendMessageW(g_progressBar, PBM_SETPOS, (WPARAM)progressPercent, 0);
    }
}

HRESULT CreateShortcut(LPCWSTR lpszPathObj, LPCWSTR lpszPathLink, LPCWSTR lpszDesc, LPCWSTR lpszIconPath) {
    IShellLinkW* psl = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_IShellLinkW, (LPVOID*)&psl);
    if (SUCCEEDED(hr)) {
        psl->SetPath(lpszPathObj);
        psl->SetDescription(lpszDesc);
        if (lpszIconPath) psl->SetIconLocation(lpszIconPath, 0);

        WCHAR dir[MAX_PATH];
        wcsncpy_s(dir, lpszPathObj, _TRUNCATE);
        PathRemoveFileSpecW(dir);
        psl->SetWorkingDirectory(dir);

        IPersistFile* ppf = nullptr;
        hr = psl->QueryInterface(IID_IPersistFile, (LPVOID*)&ppf);
        if (SUCCEEDED(hr)) {
            hr = ppf->Save(lpszPathLink, TRUE);
            ppf->Release();
        }
        psl->Release();
    }
    return hr;
}

void DoInstall() {
    CoInitialize(nullptr);

    SetStatus(L"Preparando instalação...", 10);
    Sleep(300);

    // 1. Determine target install directory (%LOCALAPPDATA%\Programs\Roxy Room)
    WCHAR localAppData[MAX_PATH];
    if (GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH) == 0) {
        wcscpy_s(localAppData, L"C:\\ProgramData");
    }

    std::wstring installDir = std::wstring(localAppData) + L"\\Programs\\Roxy Room";
    SHCreateDirectoryExW(nullptr, installDir.c_str(), nullptr);

    // 2. Write embedded payload ZIP to temporary location
    SetStatus(L"Extraindo pacote do aplicativo...", 25);
    WCHAR tempPath[MAX_PATH];
    GetTempPathW(MAX_PATH, tempPath);
    std::wstring zipPath = std::wstring(tempPath) + L"roxy_payload.zip";

    {
        std::ofstream zipFile(zipPath, std::ios::binary);
        if (zipFile.is_open()) {
            zipFile.write((const char*)PAYLOAD_ZIP_DATA, PAYLOAD_ZIP_SIZE);
            zipFile.close();
        }
    }

    // 3. Extract ZIP to installDir using Windows built-in tar or powershell
    SetStatus(L"Instalando arquivos do Roxy Room...", 50);
    std::wstring cmd = L"/c tar -xf \"" + zipPath + L"\" -C \"" + installDir + L"\"";
    
    SHELLEXECUTEINFOW sei = {};
    sei.cbSize = sizeof(sei);
    sei.fMask = SEE_MASK_NOCLOSEPROCESS;
    sei.lpVerb = L"open";
    sei.lpFile = L"cmd.exe";
    sei.lpParameters = cmd.c_str();
    sei.nShow = SW_HIDE;

    if (ShellExecuteExW(&sei) && sei.hProcess) {
        WaitForSingleObject(sei.hProcess, 15000);
        CloseHandle(sei.hProcess);
    } else {
        // Fallback: PowerShell Expand-Archive
        std::wstring psCmd = L"-NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -Path '" + zipPath + L"' -DestinationPath '" + installDir + L"' -Force\"";
        SHELLEXECUTEINFOW sei2 = {};
        sei2.cbSize = sizeof(sei2);
        sei2.fMask = SEE_MASK_NOCLOSEPROCESS;
        sei2.lpVerb = L"open";
        sei2.lpFile = L"powershell.exe";
        sei2.lpParameters = psCmd.c_str();
        sei2.nShow = SW_HIDE;
        if (ShellExecuteExW(&sei2) && sei2.hProcess) {
            WaitForSingleObject(sei2.hProcess, 20000);
            CloseHandle(sei2.hProcess);
        }
    }

    // Clean temp zip
    DeleteFileW(zipPath.c_str());

    std::wstring exePath = installDir + L"\\RoxyRoom.exe";
    if (GetFileAttributesW(exePath.c_str()) == INVALID_FILE_ATTRIBUTES) {
        exePath = installDir + L"\\MDPDiscordTelas.exe";
    }
    std::wstring iconPath = installDir + L"\\app.ico";
    if (GetFileAttributesW(iconPath.c_str()) == INVALID_FILE_ATTRIBUTES) {
        iconPath = exePath;
    }

    // 4. Create Desktop Shortcut
    SetStatus(L"Criando atalho na Área de Trabalho...", 75);
    WCHAR desktopPath[MAX_PATH];
    if (SHGetFolderPathW(nullptr, CSIDL_DESKTOPDIRECTORY, nullptr, 0, desktopPath) == S_OK) {
        std::wstring desktopLnk = std::wstring(desktopPath) + L"\\Roxy Room.lnk";
        CreateShortcut(exePath.c_str(), desktopLnk.c_str(), L"Roxy Room", iconPath.c_str());
    }

    // 5. Create Start Menu Shortcut
    SetStatus(L"Criando atalho no Menu Iniciar...", 85);
    WCHAR startMenuPath[MAX_PATH];
    if (SHGetFolderPathW(nullptr, CSIDL_PROGRAMS, nullptr, 0, startMenuPath) == S_OK) {
        std::wstring startMenuLnk = std::wstring(startMenuPath) + L"\\Roxy Room.lnk";
        CreateShortcut(exePath.c_str(), startMenuLnk.c_str(), L"Roxy Room", iconPath.c_str());
    }

    // 6. Register Uninstaller in Windows Registry
    SetStatus(L"Configurando desinstalador...", 92);
    std::wstring uninstBat = installDir + L"\\uninstall.bat";
    {
        std::ofstream bat(uninstBat);
        if (bat.is_open()) {
            bat << "@echo off\r\n";
            bat << "taskkill /F /IM RoxyRoom.exe >nul 2>&1\r\n";
            bat << "taskkill /F /IM MDPDiscordTelas.exe >nul 2>&1\r\n";
            bat << "timeout /t 1 >nul\r\n";
            bat << "del /Q \"%USERPROFILE%\\Desktop\\Roxy Room.lnk\" >nul 2>&1\r\n";
            bat << "del /Q \"%USERPROFILE%\\Desktop\\MDP Discord Telas.lnk\" >nul 2>&1\r\n";
            bat << "del /Q \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Roxy Room.lnk\" >nul 2>&1\r\n";
            bat << "del /Q \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\MDP Discord Telas.lnk\" >nul 2>&1\r\n";
            bat << "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RoxyRoom\" /f >nul 2>&1\r\n";
            bat << "echo Roxy Room foi desinstalado com sucesso.\r\n";
            bat << "pause\r\n";
            bat.close();
        }
    }

    HKEY hKey = nullptr;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RoxyRoom",
        0, nullptr, 0, KEY_WRITE, nullptr, &hKey, nullptr) == ERROR_SUCCESS) {
        
        std::wstring dispName = L"Roxy Room";
        std::wstring dispVer = L"2.5.0";
        std::wstring pub = L"Roxy Team";
        std::wstring uninstCmd = L"\"" + uninstBat + L"\"";

        RegSetValueExW(hKey, L"DisplayName", 0, REG_SZ, (const BYTE*)dispName.c_str(), (DWORD)((dispName.length() + 1) * sizeof(WCHAR)));
        RegSetValueExW(hKey, L"DisplayVersion", 0, REG_SZ, (const BYTE*)dispVer.c_str(), (DWORD)((dispVer.length() + 1) * sizeof(WCHAR)));
        RegSetValueExW(hKey, L"Publisher", 0, REG_SZ, (const BYTE*)pub.c_str(), (DWORD)((pub.length() + 1) * sizeof(WCHAR)));
        RegSetValueExW(hKey, L"DisplayIcon", 0, REG_SZ, (const BYTE*)exePath.c_str(), (DWORD)((exePath.length() + 1) * sizeof(WCHAR)));
        RegSetValueExW(hKey, L"InstallLocation", 0, REG_SZ, (const BYTE*)installDir.c_str(), (DWORD)((installDir.length() + 1) * sizeof(WCHAR)));
        RegSetValueExW(hKey, L"UninstallString", 0, REG_SZ, (const BYTE*)uninstCmd.c_str(), (DWORD)((uninstCmd.length() + 1) * sizeof(WCHAR)));
        RegCloseKey(hKey);
    }

    // 7. Check & Install WebView2 Runtime if not present
    SetStatus(L"Verificando componentes do sistema...", 94);
    bool wv2Installed = false;
    std::wstring loaderDll = installDir + L"\\WebView2Loader.dll";
    HMODULE hLoader = LoadLibraryW(loaderDll.c_str());
    if (hLoader) {
        typedef HRESULT (STDAPICALLTYPE *PFN_GetVer)(PCWSTR, LPWSTR*);
        auto pfnGetVer = (PFN_GetVer)GetProcAddress(hLoader, "GetAvailableCoreWebView2BrowserVersionString");
        if (pfnGetVer) {
            LPWSTR ver = nullptr;
            if (SUCCEEDED(pfnGetVer(nullptr, &ver)) && ver != nullptr && wcslen(ver) > 0) {
                wv2Installed = true;
                CoTaskMemFree(ver);
            }
        }
        FreeLibrary(hLoader);
    }

    if (!wv2Installed) {
        SetStatus(L"Instalando Microsoft Edge WebView2...", 96);
        WCHAR tempPath[MAX_PATH];
        GetTempPathW(MAX_PATH, tempPath);
        std::wstring wv2Setup = std::wstring(tempPath) + L"MicrosoftEdgeWebview2Setup.exe";

        std::wstring psCmd = L"-NoProfile -ExecutionPolicy Bypass -Command \""
            L"[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; "
            L"(New-Object System.Net.WebClient).DownloadFile('https://go.microsoft.com/fwlink/p/?LinkId=2124703', '" + wv2Setup + L"'); "
            L"Start-Process -FilePath '" + wv2Setup + L"' -ArgumentList '/silent /install' -Wait"
            L"\"";

        SHELLEXECUTEINFOW seiWv2 = {};
        seiWv2.cbSize = sizeof(seiWv2);
        seiWv2.fMask = SEE_MASK_NOCLOSEPROCESS;
        seiWv2.lpVerb = L"open";
        seiWv2.lpFile = L"powershell.exe";
        seiWv2.lpParameters = psCmd.c_str();
        seiWv2.nShow = SW_HIDE;

        if (ShellExecuteExW(&seiWv2) && seiWv2.hProcess) {
            WaitForSingleObject(seiWv2.hProcess, 300000);
            CloseHandle(seiWv2.hProcess);
        }
        DeleteFileW(wv2Setup.c_str());
    }

    // 8. Finish & Launch App
    SetStatus(L"Instalação concluída! Iniciando o aplicativo...", 100);
    Sleep(800);

    ShellExecuteW(nullptr, L"open", exePath.c_str(), nullptr, installDir.c_str(), SW_SHOWNORMAL);

    Sleep(500);
    PostMessageW(g_hwnd, WM_CLOSE, 0, 0);

    CoUninitialize();
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_CREATE: {
        INITCOMMONCONTROLSEX icex = {};
        icex.dwSize = sizeof(icex);
        icex.dwICC = ICC_PROGRESS_CLASS;
        InitCommonControlsEx(&icex);

        g_fontTitle = CreateFontW(20, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
        g_fontText = CreateFontW(15, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");

        g_titleText = CreateWindowExW(0, L"STATIC", L"Instalando Roxy Room",
            WS_CHILD | WS_VISIBLE | SS_LEFT,
            75, 22, 380, 26, hwnd, nullptr, nullptr, nullptr);
        SendMessageW(g_titleText, WM_SETFONT, (WPARAM)g_fontTitle, TRUE);

        g_statusText = CreateWindowExW(0, L"STATIC", L"Iniciando instalador...",
            WS_CHILD | WS_VISIBLE | SS_LEFT,
            75, 52, 380, 20, hwnd, nullptr, nullptr, nullptr);
        SendMessageW(g_statusText, WM_SETFONT, (WPARAM)g_fontText, TRUE);

        g_progressBar = CreateWindowExW(0, PROGRESS_CLASSW, nullptr,
            WS_CHILD | WS_VISIBLE | PBS_SMOOTH,
            30, 95, 420, 22, hwnd, nullptr, nullptr, nullptr);
        SendMessageW(g_progressBar, PBM_SETRANGE, 0, MAKELPARAM(0, 100));

        // Run install in background thread
        std::thread(DoInstall).detach();
        break;
    }

    case WM_CTLCOLORSTATIC: {
        HDC hdcStatic = (HDC)wParam;
        SetTextColor(hdcStatic, RGB(240, 246, 252));
        SetBkColor(hdcStatic, RGB(22, 27, 34));
        static HBRUSH hbrBkgnd = CreateSolidBrush(RGB(22, 27, 34));
        return (INT_PTR)hbrBkgnd;
    }

    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);
        HBRUSH bgBrush = CreateSolidBrush(RGB(22, 27, 34));
        FillRect(hdc, &rc, bgBrush);
        DeleteObject(bgBrush);

        // Draw app icon in header
        HICON hIcon = (HICON)GetClassLongPtrW(hwnd, GCLP_HICON);
        if (hIcon) {
            DrawIconEx(hdc, 24, 22, hIcon, 40, 40, 0, nullptr, DI_NORMAL);
        }

        EndPaint(hwnd, &ps);
        return 0;
    }

    case WM_DESTROY:
        if (g_fontTitle) DeleteObject(g_fontTitle);
        if (g_fontText) DeleteObject(g_fontText);
        PostQuitMessage(0);
        break;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int nCmdShow) {
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"RoxyInstallerWnd";
    wc.hIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(1));
    if (!wc.hIcon) wc.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(22, 27, 34));
    RegisterClassExW(&wc);

    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int winW = 490;
    int winH = 175;
    int posX = (screenW - winW) / 2;
    int posY = (screenH - winH) / 2;

    g_hwnd = CreateWindowExW(WS_EX_TOPMOST, L"RoxyInstallerWnd", L"Roxy Room - Instalador",
        WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
        posX, posY, winW, winH,
        nullptr, nullptr, hInstance, nullptr);

    if (!g_hwnd) return 1;

    ShowWindow(g_hwnd, SW_SHOWNORMAL);
    UpdateWindow(g_hwnd);

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return (int)msg.wParam;
}
