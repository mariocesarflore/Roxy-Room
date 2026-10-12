#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <windows.h>
#include <functional>
#include <map>

#define WM_HOTKEY_FIRED (WM_USER + 2)

class HotkeyManager {
public:
    using HotkeyCallback = std::function<void()>;

    HotkeyManager();
    ~HotkeyManager();

    bool Register(HWND hwnd, int id, UINT modifiers, UINT vk, HotkeyCallback cb);
    void Unregister(HWND hwnd, int id);
    void UnregisterAll(HWND hwnd);
    void HandleMessage(WPARAM id);

private:
    std::map<int, HotkeyCallback> m_callbacks;
};
