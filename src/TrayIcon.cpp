#include "TrayIcon.h"

TrayIcon::TrayIcon() {}

TrayIcon::~TrayIcon() {
    Remove();
}

bool TrayIcon::Create(HWND hwnd, HINSTANCE hInst, const std::wstring& tooltip) {
    m_hwnd = hwnd;
    ZeroMemory(&m_nid, sizeof(m_nid));
    m_nid.cbSize = sizeof(NOTIFYICONDATAW);
    m_nid.hWnd = hwnd;
    m_nid.uID = 1;
    m_nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    m_nid.uCallbackMessage = WM_TRAYICON;

    // Load icon from executable resources or use a default shell icon
    m_nid.hIcon = LoadIconW(hInst, MAKEINTRESOURCEW(1));
    if (!m_nid.hIcon) {
        m_nid.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    }

    wcsncpy_s(m_nid.szTip, tooltip.c_str(), _TRUNCATE);

    m_created = Shell_NotifyIconW(NIM_ADD, &m_nid) == TRUE;
    return m_created;
}

void TrayIcon::Remove() {
    if (m_created) {
        Shell_NotifyIconW(NIM_DELETE, &m_nid);
        m_created = false;
    }
}

void TrayIcon::SetTooltip(const std::wstring& tooltip) {
    wcsncpy_s(m_nid.szTip, tooltip.c_str(), _TRUNCATE);
    if (m_created) {
        m_nid.uFlags = NIF_TIP;
        Shell_NotifyIconW(NIM_MODIFY, &m_nid);
    }
}

void TrayIcon::HandleMessage(WPARAM wParam, LPARAM lParam) {
    if ((UINT)wParam != 1) return;

    switch ((UINT)lParam) {
    case WM_LBUTTONUP:
    case WM_LBUTTONDBLCLK:
        if (m_callback) m_callback(ID_TRAY_SHOW);
        break;
    case WM_RBUTTONUP: {
        POINT pt;
        GetCursorPos(&pt);
        HMENU hMenu = CreatePopupMenu();
        AppendMenuW(hMenu, MF_STRING, ID_TRAY_SHOW, L"🖥️ Mostrar Roxy Room");
        AppendMenuW(hMenu, MF_SEPARATOR, 0, nullptr);
        AppendMenuW(hMenu, MF_STRING, ID_TRAY_QUIT, L"❌ Sair");
        SetForegroundWindow(m_hwnd);
        UINT cmd = TrackPopupMenu(hMenu, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON,
            pt.x, pt.y, 0, m_hwnd, nullptr);
        DestroyMenu(hMenu);
        if (cmd && m_callback) m_callback(cmd);
        break;
    }
    }
}
