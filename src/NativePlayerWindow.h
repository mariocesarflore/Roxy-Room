#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <string>
#include <memory>
#include <functional>
#include "D3D11Renderer.h"

class NativePlayerWindow {
public:
    NativePlayerWindow();
    ~NativePlayerWindow();

    // Create and show native Direct3D 11 player window
    bool Create(HINSTANCE hInstance, HWND parentHwnd = nullptr, const std::wstring& title = L"Roxy Room - Player Nativo D3D11");

    // Close window and release resources
    void Close();

    // Show/Hide
    void Show(bool show = true);

    // Push new video frame to render
    void PushFrame(const BYTE* pData, int width, int height, int stride = 0);

    // Check if open
    bool IsOpen() const;

    HWND GetHWND() const { return m_hwnd; }

    // Toggle Fullscreen
    void ToggleFullscreen();

    // Snapshot
    void SaveSnapshotToFile();

private:
    static LRESULT CALLBACK StaticWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);
    static LRESULT CALLBACK ControlBarWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);
    LRESULT WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);

    struct BarItemDef {
        int id;
        std::wstring text;
        int width;
        bool isAction;
    };
    std::vector<BarItemDef> GetBarItems() const;

    void CreateControlBar();
    void UpdateControlBarPosition();
    void UpdateVolumeUI();

    HWND m_hwnd = nullptr;
    HINSTANCE m_hInstance = nullptr;
    D3D11Renderer m_renderer;

    HWND m_hControlBar = nullptr;
    HFONT m_hFont = nullptr;
    int m_hoverBtnIndex = -1;
    int m_pressedBtnIndex = -1;

    bool m_isFullscreen = false;
    bool m_isPaused = false;
    bool m_isMuted = false;
    int m_volume = 85;
    std::wstring m_baseTitle = L"Roxy Room - Player Nativo Direct3D 11";
    RECT m_prevWindowRect = {};
    DWORD m_prevStyle = 0;

    // Last frame for snapshot
    std::vector<BYTE> m_lastFrameData;
    int m_lastFrameWidth = 0;
    int m_lastFrameHeight = 0;
    std::mutex m_frameMutex;

    // Zoom & Pan state
    bool m_isDragging = false;
    POINT m_dragStart = {};
    float m_panX = 0.0f;
    float m_panY = 0.0f;
    float m_zoom = 1.0f;
};
