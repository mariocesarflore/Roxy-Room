#include "NativePlayerWindow.h"
#include <dwmapi.h>
#include <shlobj.h>
#include <iostream>
#include <algorithm>
#include <vector>

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "gdi32.lib")

static const wchar_t* CLASS_NAME = L"RoxyRoom_NativeD3D11Player";
static const wchar_t* BAR_CLASS_NAME = L"RoxyRoom_NativePlayerBar";

#define IDT_AUTOHIDE_PLAYERBAR  9002
#define IDT_RESET_TITLE         9003

NativePlayerWindow::NativePlayerWindow() {}

NativePlayerWindow::~NativePlayerWindow() {
    Close();
}

std::vector<NativePlayerWindow::BarItemDef> NativePlayerWindow::GetBarItems() const {
    std::vector<BarItemDef> items;
    items.push_back({ 0, m_isPaused ? L"▶" : L"⏸", 34, true });
    items.push_back({ 1, m_isMuted ? L"🔇" : L"🔊", 34, true });
    items.push_back({ 3, m_isMuted ? L"0%" : (std::to_wstring(m_volume) + L"%"), 38, false });
    items.push_back({ 6, (std::to_wstring((int)(m_zoom * 100)) + L"%"), 44, true });
    items.push_back({ 8, L"📸", 34, true });
    items.push_back({ 9, L"⛶", 34, true });
    return items;
}

LRESULT CALLBACK NativePlayerWindow::ControlBarWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    NativePlayerWindow* pThis = reinterpret_cast<NativePlayerWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));

    switch (msg) {
    case WM_NCCREATE: {
        LPCREATESTRUCTW pCreate = reinterpret_cast<LPCREATESTRUCTW>(lParam);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(pCreate->lpCreateParams));
        return TRUE;
    }
    case WM_ERASEBKGND:
        return 1;

    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);

        // Double buffering to eliminate any flicker
        HDC memDC = CreateCompatibleDC(hdc);
        HBITMAP memBM = CreateCompatibleBitmap(hdc, rc.right, rc.bottom);
        HBITMAP oldBM = (HBITMAP)SelectObject(memDC, memBM);

        // Background dark pill
        HBRUSH bgBrush = CreateSolidBrush(RGB(10, 16, 32));
        HPEN borderPen = CreatePen(PS_SOLID, 1, RGB(99, 102, 241));
        HBRUSH oldBrush = (HBRUSH)SelectObject(memDC, bgBrush);
        HPEN oldPen = (HPEN)SelectObject(memDC, borderPen);

        RoundRect(memDC, rc.left, rc.top, rc.right, rc.bottom, 16, 16);

        SelectObject(memDC, oldBrush);
        SelectObject(memDC, oldPen);
        DeleteObject(bgBrush);
        DeleteObject(borderPen);

        if (pThis && pThis->m_hFont) {
            SelectObject(memDC, pThis->m_hFont);
        }
        SetBkMode(memDC, TRANSPARENT);

        auto items = pThis ? pThis->GetBarItems() : std::vector<BarItemDef>();
        int curX = 10;
        int btnH = 26;
        int btnY = (rc.bottom - btnH) / 2;

        for (int i = 0; i < (int)items.size(); ++i) {
            RECT btnRc = { curX, btnY, curX + items[i].width, btnY + btnH };
            bool isHover = (pThis && pThis->m_hoverBtnIndex == i && items[i].isAction);

            HBRUSH btnBg = nullptr;
            HPEN btnPen = nullptr;

            if (isHover) {
                btnBg = CreateSolidBrush(RGB(45, 62, 115));
                btnPen = CreatePen(PS_SOLID, 1, RGB(129, 140, 248));
                SetTextColor(memDC, RGB(255, 255, 255));
            } else if (!items[i].isAction) {
                btnBg = CreateSolidBrush(RGB(14, 20, 40));
                btnPen = CreatePen(PS_SOLID, 1, RGB(30, 42, 75));
                SetTextColor(memDC, RGB(165, 180, 252));
            } else {
                btnBg = CreateSolidBrush(RGB(20, 28, 54));
                btnPen = CreatePen(PS_SOLID, 1, RGB(45, 60, 105));
                SetTextColor(memDC, RGB(224, 231, 255));
            }

            HBRUSH ob = (HBRUSH)SelectObject(memDC, btnBg);
            HPEN op = (HPEN)SelectObject(memDC, btnPen);

            RoundRect(memDC, btnRc.left, btnRc.top, btnRc.right, btnRc.bottom, 10, 10);

            SelectObject(memDC, ob);
            SelectObject(memDC, op);
            DeleteObject(btnBg);
            DeleteObject(btnPen);

            DrawTextW(memDC, items[i].text.c_str(), -1, &btnRc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
            curX += items[i].width + 6;
        }

        BitBlt(hdc, 0, 0, rc.right, rc.bottom, memDC, 0, 0, SRCCOPY);
        SelectObject(memDC, oldBM);
        DeleteObject(memBM);
        DeleteDC(memDC);

        EndPaint(hwnd, &ps);
        return 0;
    }

    case WM_MOUSEMOVE: {
        if (!pThis) return 0;
        POINT pt = { LOWORD(lParam), HIWORD(lParam) };
        auto items = pThis->GetBarItems();
        int curX = 10;
        int btnH = 26;
        RECT rc;
        GetClientRect(hwnd, &rc);
        int btnY = (rc.bottom - btnH) / 2;

        int hoveredIndex = -1;
        for (int i = 0; i < (int)items.size(); ++i) {
            RECT btnRc = { curX, btnY, curX + items[i].width, btnY + btnH };
            if (PtInRect(&btnRc, pt) && items[i].isAction) {
                hoveredIndex = i;
                break;
            }
            curX += items[i].width + 6;
        }

        if (pThis->m_hoverBtnIndex != hoveredIndex) {
            pThis->m_hoverBtnIndex = hoveredIndex;
            InvalidateRect(hwnd, nullptr, FALSE);
        }

        TRACKMOUSEEVENT tme = { sizeof(tme), TME_LEAVE, hwnd, 0 };
        TrackMouseEvent(&tme);
        return 0;
    }

    case WM_MOUSELEAVE:
        if (pThis && pThis->m_hoverBtnIndex != -1) {
            pThis->m_hoverBtnIndex = -1;
            InvalidateRect(hwnd, nullptr, FALSE);
        }
        return 0;

    case WM_LBUTTONDOWN: {
        if (!pThis) return 0;
        POINT pt = { LOWORD(lParam), HIWORD(lParam) };
        auto items = pThis->GetBarItems();
        int curX = 10;
        int btnH = 26;
        RECT rc;
        GetClientRect(hwnd, &rc);
        int btnY = (rc.bottom - btnH) / 2;

        for (int i = 0; i < (int)items.size(); ++i) {
            RECT btnRc = { curX, btnY, curX + items[i].width, btnY + btnH };
            if (PtInRect(&btnRc, pt) && items[i].isAction) {
                switch (items[i].id) {
                case 0: // Play / Pause
                    pThis->m_isPaused = !pThis->m_isPaused;
                    break;
                case 1: // Mute
                    pThis->m_isMuted = !pThis->m_isMuted;
                    break;
                case 2: // Vol -
                    pThis->m_volume = std::max(0, pThis->m_volume - 10);
                    if (pThis->m_volume == 0) pThis->m_isMuted = true;
                    else pThis->m_isMuted = false;
                    break;
                case 4: // Vol +
                    pThis->m_volume = std::min(100, pThis->m_volume + 10);
                    pThis->m_isMuted = false;
                    break;
                case 5: // Zoom -
                    pThis->m_zoom = std::max(1.0f, pThis->m_zoom - 0.25f);
                    if (pThis->m_zoom <= 1.0f) { pThis->m_panX = 0; pThis->m_panY = 0; }
                    pThis->m_renderer.SetZoom(pThis->m_zoom);
                    pThis->m_renderer.SetPan(pThis->m_panX, pThis->m_panY);
                    pThis->m_renderer.Render();
                    break;
                case 6: // Zoom Reset (100%)
                    pThis->m_zoom = 1.0f;
                    pThis->m_panX = 0;
                    pThis->m_panY = 0;
                    pThis->m_renderer.ResetView();
                    pThis->m_renderer.Render();
                    break;
                case 7: // Zoom +
                    pThis->m_zoom = std::min(5.0f, pThis->m_zoom + 0.25f);
                    pThis->m_renderer.SetZoom(pThis->m_zoom);
                    pThis->m_renderer.Render();
                    break;
                case 8: // Snapshot (Foto)
                    pThis->SaveSnapshotToFile();
                    break;
                case 9: // Fullscreen
                    pThis->ToggleFullscreen();
                    break;
                }
                InvalidateRect(hwnd, nullptr, FALSE);
                break;
            }
            curX += items[i].width + 6;
        }
        return 0;
    }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

void NativePlayerWindow::CreateControlBar() {
    if (m_hControlBar && IsWindow(m_hControlBar)) return;

    WNDCLASSEXW bc = {};
    bc.cbSize = sizeof(bc);
    bc.style = CS_HREDRAW | CS_VREDRAW;
    bc.lpfnWndProc = ControlBarWndProc;
    bc.hInstance = m_hInstance;
    bc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    bc.lpszClassName = BAR_CLASS_NAME;
    RegisterClassExW(&bc);

    m_hFont = CreateFontW(14, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");

    int barW = 268;
    int barH = 38;

    m_hControlBar = CreateWindowExW(
        WS_EX_TOPMOST,
        BAR_CLASS_NAME,
        L"",
        WS_CHILD | WS_CLIPCHILDREN | WS_VISIBLE,
        50, 50, barW, barH,
        m_hwnd, nullptr, m_hInstance, this
    );

    UpdateControlBarPosition();
}

void NativePlayerWindow::UpdateControlBarPosition() {
    if (!m_hwnd || !m_hControlBar) return;
    RECT rc;
    GetClientRect(m_hwnd, &rc);
    int winW = rc.right - rc.left;
    int winH = rc.bottom - rc.top;

    int barW = 268;
    int barH = 38;
    int posX = std::max(10, winW - barW - 20);
    int posY = std::max(10, winH - barH - 18);

    SetWindowPos(m_hControlBar, HWND_TOP, posX, posY, barW, barH, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    InvalidateRect(m_hControlBar, nullptr, FALSE);
}

void NativePlayerWindow::UpdateVolumeUI() {
    if (m_hControlBar && IsWindow(m_hControlBar)) {
        InvalidateRect(m_hControlBar, nullptr, FALSE);
    }
}

void NativePlayerWindow::SaveSnapshotToFile() {
    std::vector<BYTE> frame;
    int w = 0, h = 0;
    {
        std::lock_guard<std::mutex> lock(m_frameMutex);
        if (m_lastFrameData.empty() || m_lastFrameWidth <= 0 || m_lastFrameHeight <= 0) return;
        frame = m_lastFrameData;
        w = m_lastFrameWidth;
        h = m_lastFrameHeight;
    }

    WCHAR desktopPath[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_DESKTOP, nullptr, 0, desktopPath))) {
        SYSTEMTIME st;
        GetLocalTime(&st);
        WCHAR fileName[MAX_PATH];
        swprintf_s(fileName, L"%s\\RoxyRoom_Captura_%04d%02d%02d_%02d%02d%02d.bmp",
            desktopPath, st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);

        BITMAPFILEHEADER bfh = {};
        BITMAPINFOHEADER bih = {};
        DWORD imageSize = (DWORD)(w * h * 4);
        bfh.bfType = 0x4D42; // "BM"
        bfh.bfOffBits = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);
        bfh.bfSize = bfh.bfOffBits + imageSize;

        bih.biSize = sizeof(BITMAPINFOHEADER);
        bih.biWidth = w;
        bih.biHeight = -h; // top-down
        bih.biPlanes = 1;
        bih.biBitCount = 32;
        bih.biCompression = BI_RGB;

        HANDLE hFile = CreateFileW(fileName, GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (hFile != INVALID_HANDLE_VALUE) {
            DWORD written = 0;
            WriteFile(hFile, &bfh, sizeof(bfh), &written, nullptr);
            WriteFile(hFile, &bih, sizeof(bih), &written, nullptr);
            WriteFile(hFile, frame.data(), imageSize, &written, nullptr);
            CloseHandle(hFile);

            SetWindowTextW(m_hwnd, L"Roxy Room - 📸 Foto salva na Área de Trabalho!");
            SetTimer(m_hwnd, IDT_RESET_TITLE, 2500, nullptr);
        }
    }
}

bool NativePlayerWindow::Create(HINSTANCE hInstance, HWND parentHwnd, const std::wstring& title) {
    if (m_hwnd && IsWindow(m_hwnd)) {
        ShowWindow(m_hwnd, SW_SHOW);
        SetForegroundWindow(m_hwnd);
        return true;
    }

    m_hInstance = hInstance;
    m_baseTitle = title.empty() ? L"Roxy Room - Player Nativo Direct3D 11" : title;

    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS;
    wc.lpfnWndProc = StaticWndProc;
    wc.hInstance = hInstance;
    wc.hIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(1));
    if (!wc.hIcon) wc.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(6, 9, 17));
    wc.lpszClassName = CLASS_NAME;

    RegisterClassExW(&wc);

    int winW = 1280;
    int winH = 720;
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int posX = (screenW - winW) / 2;
    int posY = (screenH - winH) / 2;

    m_hwnd = CreateWindowExW(
        WS_EX_APPWINDOW,
        CLASS_NAME,
        m_baseTitle.c_str(),
        WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
        posX, posY, winW, winH,
        nullptr, nullptr, hInstance, this
    );

    if (!m_hwnd) {
        return false;
    }

    // Enable dark title bar (Windows 10/11 DWM)
    BOOL darkMode = TRUE;
    DwmSetWindowAttribute(m_hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &darkMode, sizeof(darkMode));
    DwmSetWindowAttribute(m_hwnd, 19 /* DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 */, &darkMode, sizeof(darkMode));
    COLORREF captionColor = RGB(6, 9, 17);
    DwmSetWindowAttribute(m_hwnd, 35 /* DWMWA_CAPTION_COLOR */, &captionColor, sizeof(captionColor));
    COLORREF textColor = RGB(248, 250, 252);
    DwmSetWindowAttribute(m_hwnd, 36 /* DWMWA_TEXT_COLOR */, &textColor, sizeof(textColor));
    COLORREF borderColor = RGB(20, 28, 54);
    DwmSetWindowAttribute(m_hwnd, 34 /* DWMWA_BORDER_COLOR */, &borderColor, sizeof(borderColor));

    // Initialize D3D11 Renderer
    if (!m_renderer.Initialize(m_hwnd)) {
        DestroyWindow(m_hwnd);
        m_hwnd = nullptr;
        return false;
    }

    // Create custom glassmorphism control bar
    CreateControlBar();

    ShowWindow(m_hwnd, SW_SHOWNORMAL);
    UpdateWindow(m_hwnd);
    SetForegroundWindow(m_hwnd);

    SetTimer(m_hwnd, IDT_AUTOHIDE_PLAYERBAR, 3500, nullptr);
    return true;
}

void NativePlayerWindow::Close() {
    if (m_hwnd && IsWindow(m_hwnd)) {
        m_renderer.Cleanup();
        if (m_hFont) { DeleteObject(m_hFont); m_hFont = nullptr; }
        DestroyWindow(m_hwnd);
        m_hwnd = nullptr;
    }
}

void NativePlayerWindow::Show(bool show) {
    if (m_hwnd && IsWindow(m_hwnd)) {
        ShowWindow(m_hwnd, show ? SW_SHOW : SW_HIDE);
        if (show) SetForegroundWindow(m_hwnd);
    }
}

bool NativePlayerWindow::IsOpen() const {
    return m_hwnd != nullptr && IsWindow(m_hwnd);
}

void NativePlayerWindow::PushFrame(const BYTE* pData, int width, int height, int stride) {
    if (m_isPaused) return;

    if (pData && width > 0 && height > 0) {
        std::lock_guard<std::mutex> lock(m_frameMutex);
        size_t size = (size_t)width * height * 4;
        if (m_lastFrameData.size() < size) m_lastFrameData.resize(size);
        memcpy(m_lastFrameData.data(), pData, size);
        m_lastFrameWidth = width;
        m_lastFrameHeight = height;
    }

    if (IsOpen() && m_renderer.IsInitialized()) {
        m_renderer.UpdateFrame(pData, width, height, stride);
    }
}

void NativePlayerWindow::ToggleFullscreen() {
    if (!m_hwnd) return;

    if (!m_isFullscreen) {
        GetWindowRect(m_hwnd, &m_prevWindowRect);
        m_prevStyle = GetWindowLongW(m_hwnd, GWL_STYLE);

        HMONITOR hMon = MonitorFromWindow(m_hwnd, MONITOR_DEFAULTTONEAREST);
        MONITORINFO mi = { sizeof(mi) };
        GetMonitorInfoW(hMon, &mi);

        SetWindowLongW(m_hwnd, GWL_STYLE, m_prevStyle & ~(WS_CAPTION | WS_THICKFRAME));
        SetWindowPos(m_hwnd, HWND_TOP,
            mi.rcMonitor.left, mi.rcMonitor.top,
            mi.rcMonitor.right - mi.rcMonitor.left,
            mi.rcMonitor.bottom - mi.rcMonitor.top,
            SWP_NOOWNERZORDER | SWP_FRAMECHANGED);

        m_isFullscreen = true;
    } else {
        SetWindowLongW(m_hwnd, GWL_STYLE, m_prevStyle);
        SetWindowPos(m_hwnd, nullptr,
            m_prevWindowRect.left, m_prevWindowRect.top,
            m_prevWindowRect.right - m_prevWindowRect.left,
            m_prevWindowRect.bottom - m_prevWindowRect.top,
            SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);

        m_isFullscreen = false;
    }
    UpdateControlBarPosition();
}

LRESULT CALLBACK NativePlayerWindow::StaticWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    NativePlayerWindow* pThis = nullptr;
    if (msg == WM_NCCREATE) {
        LPCREATESTRUCTW pCreate = reinterpret_cast<LPCREATESTRUCTW>(lParam);
        pThis = reinterpret_cast<NativePlayerWindow*>(pCreate->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(pThis));
        pThis->m_hwnd = hwnd;
    } else {
        pThis = reinterpret_cast<NativePlayerWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    }

    if (pThis) {
        return pThis->WndProc(hwnd, msg, wParam, lParam);
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

LRESULT NativePlayerWindow::WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_SIZE:
        if (wParam != SIZE_MINIMIZED) {
            int w = LOWORD(lParam);
            int h = HIWORD(lParam);
            m_renderer.Resize(w, h);
            m_renderer.Render();
            UpdateControlBarPosition();
        }
        return 0;

    case WM_PAINT:
        {
            PAINTSTRUCT ps;
            BeginPaint(hwnd, &ps);
            m_renderer.Render();
            EndPaint(hwnd, &ps);
        }
        return 0;

    case WM_ERASEBKGND:
        return 1;

    case WM_LBUTTONDBLCLK:
        ToggleFullscreen();
        return 0;

    case WM_TIMER:
        if (wParam == IDT_AUTOHIDE_PLAYERBAR) {
            POINT pt;
            GetCursorPos(&pt);
            RECT barRc;
            if (m_hControlBar && IsWindow(m_hControlBar)) {
                GetWindowRect(m_hControlBar, &barRc);
                if (!PtInRect(&barRc, pt)) {
                    ShowWindow(m_hControlBar, SW_HIDE);
                }
            }
        } else if (wParam == IDT_RESET_TITLE) {
            KillTimer(hwnd, IDT_RESET_TITLE);
            SetWindowTextW(hwnd, m_baseTitle.c_str());
        }
        return 0;

    case WM_MOUSEMOVE:
        if (m_hControlBar) {
            ShowWindow(m_hControlBar, SW_SHOW);
            UpdateControlBarPosition();
            SetTimer(hwnd, IDT_AUTOHIDE_PLAYERBAR, 3500, nullptr);
        }
        if (m_isDragging && (wParam & MK_LBUTTON)) {
            int curX = LOWORD(lParam);
            int curY = HIWORD(lParam);
            RECT rc;
            GetClientRect(hwnd, &rc);
            int w = std::max(1, (int)(rc.right - rc.left));
            int h = std::max(1, (int)(rc.bottom - rc.top));

            float dx = (float)(curX - m_dragStart.x) / (float)w * 2.0f;
            float dy = -(float)(curY - m_dragStart.y) / (float)h * 2.0f;

            m_panX += dx;
            m_panY += dy;
            m_dragStart.x = curX;
            m_dragStart.y = curY;

            m_renderer.SetPan(m_panX, m_panY);
            m_renderer.Render();
        }
        return 0;

    case WM_LBUTTONDOWN:
        if (m_zoom > 1.0f) {
            m_isDragging = true;
            m_dragStart.x = LOWORD(lParam);
            m_dragStart.y = HIWORD(lParam);
            SetCapture(hwnd);
        }
        return 0;

    case WM_LBUTTONUP:
        if (m_isDragging) {
            m_isDragging = false;
            ReleaseCapture();
        }
        return 0;

    case WM_KEYDOWN:
        if (wParam == VK_ESCAPE) {
            if (m_isFullscreen) {
                ToggleFullscreen();
            } else {
                m_zoom = 1.0f;
                m_panX = 0.0f;
                m_panY = 0.0f;
                m_renderer.ResetView();
                m_renderer.Render();
                if (m_hControlBar) InvalidateRect(m_hControlBar, nullptr, FALSE);
            }
            return 0;
        } else if (wParam == VK_F11) {
            ToggleFullscreen();
            return 0;
        }
        break;

    case WM_MOUSEWHEEL:
        {
            short delta = GET_WHEEL_DELTA_WPARAM(wParam);
            float zoomDelta = (delta > 0) ? 1.15f : (1.0f / 1.15f);
            m_zoom = std::max(1.0f, std::min(6.0f, m_zoom * zoomDelta));
            if (m_zoom <= 1.0f) {
                m_panX = 0.0f;
                m_panY = 0.0f;
            }
            m_renderer.SetZoom(m_zoom);
            m_renderer.SetPan(m_panX, m_panY);
            m_renderer.Render();
            if (m_hControlBar) InvalidateRect(m_hControlBar, nullptr, FALSE);
        }
        return 0;

    case WM_RBUTTONUP:
        {
            HMENU hMenu = CreatePopupMenu();
            AppendMenuW(hMenu, MF_STRING, 101, m_isFullscreen ? L"Sair da Tela Cheia (F11 / Esc)" : L"Tela Cheia (F11 / Duplo Clique)");
            AppendMenuW(hMenu, MF_STRING, 102, L"Resetar Zoom (100%)");
            AppendMenuW(hMenu, MF_SEPARATOR, 0, nullptr);
            AppendMenuW(hMenu, MF_STRING, 103, L"📸 Salvar Foto na Área de Trabalho");
            AppendMenuW(hMenu, MF_SEPARATOR, 0, nullptr);
            AppendMenuW(hMenu, MF_STRING, 104, L"Fechar Player Nativo");

            POINT pt;
            GetCursorPos(&pt);
            int cmd = TrackPopupMenu(hMenu, TPM_RETURNCMD | TPM_RIGHTBUTTON, pt.x, pt.y, 0, hwnd, nullptr);
            DestroyMenu(hMenu);

            if (cmd == 101) {
                ToggleFullscreen();
            } else if (cmd == 102) {
                m_zoom = 1.0f;
                m_panX = 0.0f;
                m_panY = 0.0f;
                m_renderer.ResetView();
                m_renderer.Render();
                if (m_hControlBar) InvalidateRect(m_hControlBar, nullptr, FALSE);
            } else if (cmd == 103) {
                SaveSnapshotToFile();
            } else if (cmd == 104) {
                Close();
            }
        }
        return 0;

    case WM_CLOSE:
        Close();
        return 0;

    case WM_DESTROY:
        m_renderer.Cleanup();
        m_hwnd = nullptr;
        return 0;
    }

    return DefWindowProcW(hwnd, msg, wParam, lParam);
}
