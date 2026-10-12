#include "HotkeyManager.h"
#include <iostream>

HotkeyManager::HotkeyManager() {}

HotkeyManager::~HotkeyManager() {}

bool HotkeyManager::Register(HWND hwnd, int id, UINT modifiers, UINT vk, HotkeyCallback cb) {
    Unregister(hwnd, id);
    if (RegisterHotKey(hwnd, id, modifiers, vk)) {
        m_callbacks[id] = cb;
        std::wcout << L"[HotkeyManager] Atalho registrado com sucesso! ID: " << id << std::endl;
        return true;
    } else {
        DWORD err = GetLastError();
        std::wcerr << L"[HotkeyManager] Falha ao registrar atalho global (Erro: " << err << L"). ID: " << id << std::endl;
        // Store callback anyway so local key handling or re-attempts can fire it
        m_callbacks[id] = cb;
        return false;
    }
}

void HotkeyManager::Unregister(HWND hwnd, int id) {
    UnregisterHotKey(hwnd, id);
    m_callbacks.erase(id);
}

void HotkeyManager::UnregisterAll(HWND hwnd) {
    for (auto& [id, _] : m_callbacks) {
        UnregisterHotKey(hwnd, id);
    }
    m_callbacks.clear();
}

void HotkeyManager::HandleMessage(WPARAM id) {
    auto it = m_callbacks.find((int)id);
    if (it != m_callbacks.end() && it->second) {
        it->second();
    }
}
