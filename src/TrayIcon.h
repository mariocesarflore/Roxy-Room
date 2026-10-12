#pragma once
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <windows.h>
#include <shellapi.h>
#include <string>
#include <functional>

#define WM_TRAYICON (WM_USER + 1)
#define ID_TRAY_SHOW    1001
#define ID_TRAY_QUIT    1002

class TrayIcon {
public:
    using MenuCallback = std::function<void(UINT id)>;

    TrayIcon();
    ~TrayIcon();

    bool Create(HWND hwnd, HINSTANCE hInst, const std::wstring& tooltip);
    void Remove();
    void SetTooltip(const std::wstring& tooltip);
    void HandleMessage(WPARAM wParam, LPARAM lParam);
    void SetCallback(MenuCallback cb) { m_callback = cb; }

private:
    NOTIFYICONDATAW m_nid{};
    HWND m_hwnd = nullptr;
    bool m_created = false;
    MenuCallback m_callback;
};
