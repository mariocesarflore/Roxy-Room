#include "DiscordManager.h"
#include <winhttp.h>
#include <tlhelp32.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <sstream>
#include <iomanip>
#include <vector>
#include <set>
#include <chrono>
#include <cctype>

#pragma comment(lib, "winhttp.lib")

DiscordManager::DiscordManager() {}

DiscordManager::~DiscordManager() {
    Shutdown();
}

void DiscordManager::SetMessageCallback(MessageCallback cb) {
    std::lock_guard<std::mutex> lock(m_cbMutex);
    m_callback = std::move(cb);
}

void DiscordManager::Emit(const std::string& utf8Json) {
    if (m_shuttingDown.load()) return;
    MessageCallback cbCopy;
    {
        std::lock_guard<std::mutex> lock(m_cbMutex);
        cbCopy = m_callback;
    }
    if (cbCopy) {
        cbCopy(utf8Json);
    }
}

void DiscordManager::Shutdown() {
    m_shuttingDown = true;
    DisconnectIpc();
}

std::string DiscordManager::WideToUtf8(const std::wstring& ws) {
    if (ws.empty()) return "";
    int len = WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), (int)ws.size(), nullptr, 0, nullptr, nullptr);
    if (len <= 0) return "";
    std::string out(len, '\0');
    WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), (int)ws.size(), &out[0], len, nullptr, nullptr);
    return out;
}

std::wstring DiscordManager::Utf8ToWide(const std::string& s) {
    if (s.empty()) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
    if (len <= 0) return L"";
    std::wstring out(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &out[0], len);
    return out;
}

std::string DiscordManager::JsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20) {
                char buf[8];
                snprintf(buf, sizeof(buf), "\\u%04x", c);
                out += buf;
            } else {
                out += (char)c;
            }
        }
    }
    return out;
}

std::string DiscordManager::UrlEncode(const std::string& s) {
    std::ostringstream oss;
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            oss << c;
        } else {
            oss << '%' << std::uppercase << std::hex << std::setw(2) << std::setfill('0') << (int)c;
        }
    }
    return oss.str();
}

std::string DiscordManager::ExtractJsonString(const std::string& json, const std::string& key) {
    std::string pattern = "\"" + key + "\"";
    size_t pos = json.find(pattern);
    if (pos == std::string::npos) return "";
    pos = json.find(':', pos + pattern.size());
    if (pos == std::string::npos) return "";
    pos++;
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t' || json[pos] == '\r' || json[pos] == '\n')) pos++;
    if (pos >= json.size() || json[pos] != '"') return "";
    pos++;
    std::string val;
    while (pos < json.size()) {
        char c = json[pos++];
        if (c == '\\' && pos < json.size()) {
            char next = json[pos++];
            switch (next) {
            case '"': val += '"'; break;
            case '\\': val += '\\'; break;
            case '/': val += '/'; break;
            case 'n': val += '\n'; break;
            case 'r': val += '\r'; break;
            case 't': val += '\t'; break;
            default: val += next; break;
            }
        } else if (c == '"') {
            break;
        } else {
            val += c;
        }
    }
    return val;
}

int DiscordManager::ExtractJsonInt(const std::string& json, const std::string& key, int fallback) {
    return (int)ExtractJsonInt64(json, key, fallback);
}

long long DiscordManager::ExtractJsonInt64(const std::string& json, const std::string& key, long long fallback) {
    std::string pattern = "\"" + key + "\"";
    size_t pos = json.find(pattern);
    if (pos == std::string::npos) return fallback;
    pos = json.find(':', pos + pattern.size());
    if (pos == std::string::npos) return fallback;
    pos++;
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    if (pos >= json.size()) return fallback;
    try {
        return std::stoll(json.substr(pos));
    } catch (...) {
        return fallback;
    }
}

// ─── WinHTTP Client ───────────────────────────────────────────────────────────

bool DiscordManager::HttpRequest(
    const std::wstring& host,
    const std::wstring& path,
    const std::wstring& method,
    const std::string& body,
    const std::wstring& contentType,
    const std::string& bearerToken,
    int& outStatus,
    std::string& outBody
) {
    outStatus = 0;
    outBody.clear();

    HINTERNET hSession = WinHttpOpen(L"RoxyRoom/1.1 (DiscordIntegration)",
        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return false;

    WinHttpSetTimeouts(hSession, 8000, 8000, 10000, 15000);

    HINTERNET hConnect = WinHttpConnect(hSession, host.c_str(), INTERNET_DEFAULT_HTTPS_PORT, 0);
    if (!hConnect) {
        WinHttpCloseHandle(hSession);
        return false;
    }

    HINTERNET hRequest = WinHttpOpenRequest(hConnect, method.c_str(), path.c_str(),
        nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
    if (!hRequest) {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    std::wstring headers;
    if (!contentType.empty()) {
        headers += L"Content-Type: " + contentType + L"\r\n";
    }
    if (!bearerToken.empty()) {
        headers += L"Authorization: Bearer " + Utf8ToWide(bearerToken) + L"\r\n";
    }
    headers += L"Accept: application/json\r\n";

    BOOL ok = WinHttpSendRequest(
        hRequest,
        headers.c_str(),
        (DWORD)headers.size(),
        body.empty() ? WINHTTP_NO_REQUEST_DATA : (LPVOID)body.data(),
        (DWORD)body.size(),
        (DWORD)body.size(),
        0
    );

    if (ok) {
        ok = WinHttpReceiveResponse(hRequest, nullptr);
    }

    if (ok) {
        DWORD statusCode = 0;
        DWORD statusSize = sizeof(statusCode);
        if (WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &statusSize, WINHTTP_NO_HEADER_INDEX)) {
            outStatus = (int)statusCode;
        }

        DWORD dwSize = 0;
        do {
            dwSize = 0;
            if (!WinHttpQueryDataAvailable(hRequest, &dwSize) || dwSize == 0) break;
            std::vector<char> buf(dwSize);
            DWORD dwDownloaded = 0;
            if (WinHttpReadData(hRequest, buf.data(), dwSize, &dwDownloaded) && dwDownloaded > 0) {
                outBody.append(buf.data(), dwDownloaded);
            } else {
                break;
            }
        } while (dwSize > 0);
    }

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return ok == TRUE;
}

static bool IsValidJsonEnvelope(const std::string& s) {
    for (char c : s) {
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') continue;
        return c == '{' || c == '[';
    }
    return false;
}

void DiscordManager::ExchangeOAuthCode(const std::string& jsonParams) {
    std::string clientId = ExtractJsonString(jsonParams, "clientId");
    std::string code = ExtractJsonString(jsonParams, "code");
    std::string redirectUri = ExtractJsonString(jsonParams, "redirectUri");
    std::string codeVerifier = ExtractJsonString(jsonParams, "codeVerifier");
    std::string clientSecret = ExtractJsonString(jsonParams, "clientSecret");

    std::thread([this, clientId, code, redirectUri, codeVerifier, clientSecret]() {
        std::ostringstream form;
        form << "client_id=" << UrlEncode(clientId)
             << "&grant_type=authorization_code"
             << "&code=" << UrlEncode(code)
             << "&redirect_uri=" << UrlEncode(redirectUri);
        if (!codeVerifier.empty()) {
            form << "&code_verifier=" << UrlEncode(codeVerifier);
        }
        if (!clientSecret.empty()) {
            form << "&client_secret=" << UrlEncode(clientSecret);
        }

        int status = 0;
        std::string respBody;
        bool ok = HttpRequest(
            L"discord.com",
            L"/api/oauth2/token",
            L"POST",
            form.str(),
            L"application/x-www-form-urlencoded",
            "",
            status,
            respBody
        );

        std::ostringstream out;
        out << "{\"type\":\"discordOAuthToken\",\"ok\":" << (ok && status >= 200 && status < 300 ? "true" : "false")
            << ",\"status\":" << status
            << ",\"data\":" << (IsValidJsonEnvelope(respBody) ? respBody : ("\"" + JsonEscape(respBody) + "\""))
            << "}";
        Emit(out.str());
    }).detach();
}

void DiscordManager::FetchProfile(const std::string& accessToken) {
    if (accessToken.empty()) return;
    std::thread([this, accessToken]() {
        int userStatus = 0, guildsStatus = 0, connStatus = 0;
        std::string userBody, guildsBody, connBody;

        HttpRequest(L"discord.com", L"/api/v10/users/@me", L"GET", "", L"", accessToken, userStatus, userBody);

        if (userStatus == 200) {
            HttpRequest(L"discord.com", L"/api/v10/users/@me/guilds?with_counts=true", L"GET", "", L"", accessToken, guildsStatus, guildsBody);
            if (guildsStatus != 200) {
                HttpRequest(L"discord.com", L"/api/v10/users/@me/guilds", L"GET", "", L"", accessToken, guildsStatus, guildsBody);
            }
            HttpRequest(L"discord.com", L"/api/v10/users/@me/connections", L"GET", "", L"", accessToken, connStatus, connBody);
        }

        std::ostringstream out;
        out << "{\"type\":\"discordApiProfile\""
            << ",\"userStatus\":" << userStatus
            << ",\"guildsStatus\":" << guildsStatus
            << ",\"connectionsStatus\":" << connStatus
            << ",\"user\":" << (IsValidJsonEnvelope(userBody) ? userBody : "null")
            << ",\"guilds\":" << ((guildsStatus == 200 && IsValidJsonEnvelope(guildsBody)) ? guildsBody : "null")
            << ",\"connections\":" << ((connStatus == 200 && IsValidJsonEnvelope(connBody)) ? connBody : "null")
            << "}";
        Emit(out.str());
    }).detach();
}

// ─── Local Windows Discord & Spotify Status ───────────────────────────────────

struct SpotifyFindCtx {
    std::vector<DWORD> pids;
    std::wstring title;
};

static std::vector<DWORD> FindProcessIdsByExe(const wchar_t* exeName) {
    std::vector<DWORD> pids;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return pids;
    PROCESSENTRY32W pe;
    pe.dwSize = sizeof(pe);
    if (Process32FirstW(snap, &pe)) {
        do {
            if (_wcsicmp(pe.szExeFile, exeName) == 0) {
                pids.push_back(pe.th32ProcessID);
            }
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
    return pids;
}

struct DiscordVoiceProbeResult {
    bool inCall = false;
    long long startedAtMs = 0;
};

static ULONGLONG FileTimeToU64(const FILETIME& ft) {
    ULARGE_INTEGER u;
    u.LowPart = ft.dwLowDateTime;
    u.HighPart = ft.dwHighDateTime;
    return u.QuadPart;
}

static DiscordVoiceProbeResult ProbeDiscordLocalVoiceCall(const std::vector<DWORD>& discordPids) {
    DiscordVoiceProbeResult res;
    if (discordPids.empty()) return res;

    std::set<DWORD> pidSet(discordPids.begin(), discordPids.end());
    std::set<std::wstring> encodedExePaths;
    ULONGLONG earliestProcStart = 0;

    for (DWORD pid : discordPids) {
        HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!hProc) continue;

        WCHAR imgPath[MAX_PATH * 2] = {};
        DWORD sz = MAX_PATH * 2;
        if (QueryFullProcessImageNameW(hProc, 0, imgPath, &sz) && sz > 0) {
            std::wstring encoded(imgPath, sz);
            for (wchar_t& ch : encoded) {
                if (ch == L'\\') ch = L'#';
            }
            encodedExePaths.insert(encoded);
        }

        FILETIME ftCreate = {}, ftExit = {}, ftKernel = {}, ftUser = {};
        if (GetProcessTimes(hProc, &ftCreate, &ftExit, &ftKernel, &ftUser)) {
            ULONGLONG t = FileTimeToU64(ftCreate);
            if (t > 0 && (earliestProcStart == 0 || t < earliestProcStart)) {
                earliestProcStart = t;
            }
        }
        CloseHandle(hProc);
    }

    // 1. Official Windows Microphone ConsentStore for the currently running Discord executable
    for (const auto& encoded : encodedExePaths) {
        std::wstring subKey = L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged\\" + encoded;
        HKEY hKey = nullptr;
        if (RegOpenKeyExW(HKEY_CURRENT_USER, subKey.c_str(), 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
            ULONGLONG startFt = 0, stopFt = 0;
            DWORD type = 0, cb = sizeof(ULONGLONG);
            bool hasStart = (RegQueryValueExW(hKey, L"LastUsedTimeStart", nullptr, &type, reinterpret_cast<LPBYTE>(&startFt), &cb) == ERROR_SUCCESS && type == REG_QWORD);
            cb = sizeof(ULONGLONG);
            bool hasStop = (RegQueryValueExW(hKey, L"LastUsedTimeStop", nullptr, &type, reinterpret_cast<LPBYTE>(&stopFt), &cb) == ERROR_SUCCESS && type == REG_QWORD);
            RegCloseKey(hKey);

            if (hasStart && hasStop && stopFt == 0 && startFt > 0) {
                if (earliestProcStart == 0 || startFt + 50000000ULL >= earliestProcStart) {
                    res.inCall = true;
                    if (startFt > 116444736000000000ULL) {
                        long long ms = (long long)((startFt - 116444736000000000ULL) / 10000ULL);
                        if (res.startedAtMs == 0 || ms < res.startedAtMs) {
                            res.startedAtMs = ms;
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback: WASAPI active eCapture session belonging to any running Discord PID
    if (!res.inCall) {
        HRESULT hrInit = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        bool didInit = SUCCEEDED(hrInit);
        if (hrInit == RPC_E_CHANGED_MODE || didInit) {
            IMMDeviceEnumerator* pEnum = nullptr;
            if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&pEnum))) && pEnum) {
                IMMDeviceCollection* pCol = nullptr;
                if (SUCCEEDED(pEnum->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &pCol)) && pCol) {
                    UINT devCount = 0;
                    pCol->GetCount(&devCount);
                    for (UINT d = 0; d < devCount && !res.inCall; d++) {
                        IMMDevice* pDev = nullptr;
                        if (FAILED(pCol->Item(d, &pDev)) || !pDev) continue;
                        IAudioSessionManager2* pMgr = nullptr;
                        if (SUCCEEDED(pDev->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&pMgr))) && pMgr) {
                            IAudioSessionEnumerator* pSesEnum = nullptr;
                            if (SUCCEEDED(pMgr->GetSessionEnumerator(&pSesEnum)) && pSesEnum) {
                                int cnt = 0;
                                pSesEnum->GetCount(&cnt);
                                for (int i = 0; i < cnt && !res.inCall; i++) {
                                    IAudioSessionControl* pCtrl = nullptr;
                                    if (FAILED(pSesEnum->GetSession(i, &pCtrl)) || !pCtrl) continue;
                                    IAudioSessionControl2* pCtrl2 = nullptr;
                                    if (SUCCEEDED(pCtrl->QueryInterface(__uuidof(IAudioSessionControl2), reinterpret_cast<void**>(&pCtrl2))) && pCtrl2) {
                                        DWORD spid = 0;
                                        AudioSessionState st = AudioSessionStateInactive;
                                        pCtrl2->GetProcessId(&spid);
                                        pCtrl2->GetState(&st);
                                        if (st == AudioSessionStateActive && pidSet.count(spid)) {
                                            res.inCall = true;
                                        }
                                        pCtrl2->Release();
                                    }
                                    pCtrl->Release();
                                }
                                pSesEnum->Release();
                            }
                            pMgr->Release();
                        }
                        pDev->Release();
                    }
                    pCol->Release();
                }
                pEnum->Release();
            }
            if (didInit) CoUninitialize();
        }
    }

    return res;
}

void DiscordManager::PollLocalStatus() {
    std::thread([this]() {
        std::vector<DWORD> discordPids = FindProcessIdsByExe(L"Discord.exe");
        auto canaryPids = FindProcessIdsByExe(L"DiscordCanary.exe");
        auto ptbPids = FindProcessIdsByExe(L"DiscordPTB.exe");
        discordPids.insert(discordPids.end(), canaryPids.begin(), canaryPids.end());
        discordPids.insert(discordPids.end(), ptbPids.begin(), ptbPids.end());
        bool discordRunning = !discordPids.empty();
        DiscordVoiceProbeResult voiceProbe = ProbeDiscordLocalVoiceCall(discordPids);

        SpotifyFindCtx ctx;
        ctx.pids = FindProcessIdsByExe(L"Spotify.exe");
        bool spotifyRunning = !ctx.pids.empty();
        bool spotifyPlaying = false;
        std::string spotifyTitle;
        std::string spotifyArtist;
        std::string spotifyTrack;

        if (spotifyRunning) {
            EnumWindows([](HWND hwnd, LPARAM lParam) -> BOOL {
                if (!IsWindowVisible(hwnd)) return TRUE;
                auto* c = reinterpret_cast<SpotifyFindCtx*>(lParam);
                DWORD pid = 0;
                GetWindowThreadProcessId(hwnd, &pid);
                bool match = false;
                for (DWORD p : c->pids) {
                    if (p == pid) { match = true; break; }
                }
                if (!match) return TRUE;
                WCHAR buf[512] = {};
                int len = GetWindowTextW(hwnd, buf, 511);
                if (len > 0) {
                    std::wstring t(buf);
                    // Main Spotify window always has text and no owner or standard title
                    if (t != L"GDI+ Window (Spotify.exe)" && t != L"Default IME" && t != L"MSCTFIME UI") {
                        c->title = t;
                        if (t.find(L" - ") != std::wstring::npos) {
                            return FALSE;
                        }
                    }
                }
                return TRUE;
            }, reinterpret_cast<LPARAM>(&ctx));

            spotifyTitle = WideToUtf8(ctx.title);
            if (!spotifyTitle.empty() &&
                spotifyTitle != "Spotify" &&
                spotifyTitle != "Spotify Free" &&
                spotifyTitle != "Spotify Premium") {
                size_t sep = spotifyTitle.find(" - ");
                if (sep != std::string::npos) {
                    spotifyArtist = spotifyTitle.substr(0, sep);
                    spotifyTrack = spotifyTitle.substr(sep + 3);
                    spotifyPlaying = !spotifyTrack.empty();
                }
            }
        }

        std::ostringstream out;
        out << "{\"type\":\"discordLocalStatus\""
            << ",\"discordRunning\":" << (discordRunning ? "true" : "false")
            << ",\"ipcConnected\":" << (m_ipcRunning.load() && m_pipe != INVALID_HANDLE_VALUE ? "true" : "false")
            << ",\"voice\":{\"inCall\":" << (voiceProbe.inCall ? "true" : "false")
            << ",\"startedAt\":" << voiceProbe.startedAtMs << "}"
            << ",\"spotify\":{"
            << "\"running\":" << (spotifyRunning ? "true" : "false")
            << ",\"playing\":" << (spotifyPlaying ? "true" : "false")
            << ",\"title\":\"" << JsonEscape(spotifyTitle) << "\""
            << ",\"artist\":\"" << JsonEscape(spotifyArtist) << "\""
            << ",\"track\":\"" << JsonEscape(spotifyTrack) << "\""
            << "}}";
        Emit(out.str());
    }).detach();
}

// ─── Discord Local IPC (\\.\pipe\discord-ipc-0..9) ────────────────────────────

bool DiscordManager::SendIpcFrame(uint32_t opcode, const std::string& payload) {
    std::lock_guard<std::mutex> lock(m_pipeWriteMutex);
    if (m_pipe == INVALID_HANDLE_VALUE) return false;

    uint32_t header[2] = { opcode, (uint32_t)payload.size() };
    DWORD written = 0;
    if (!WriteFile(m_pipe, header, sizeof(header), &written, nullptr) || written != sizeof(header)) {
        return false;
    }
    if (!payload.empty()) {
        size_t offset = 0;
        while (offset < payload.size()) {
            DWORD chunk = 0;
            if (!WriteFile(m_pipe, payload.data() + offset, (DWORD)(payload.size() - offset), &chunk, nullptr) || chunk == 0) {
                return false;
            }
            offset += chunk;
        }
    }
    return true;
}

bool DiscordManager::ReadIpcFrame(uint32_t& outOpcode, std::string& outPayload, DWORD timeoutMs) {
    outOpcode = 0;
    outPayload.clear();

    DWORD waited = 0;
    while (m_ipcRunning.load() && !m_shuttingDown.load()) {
        HANDLE h = m_pipe;
        if (h == INVALID_HANDLE_VALUE) return false;

        DWORD avail = 0;
        if (!PeekNamedPipe(h, nullptr, 0, nullptr, &avail, nullptr)) {
            return false;
        }
        if (avail >= 8) break;
        if (waited >= timeoutMs) return false;
        Sleep(40);
        waited += 40;
    }
    if (!m_ipcRunning.load() || m_shuttingDown.load() || m_pipe == INVALID_HANDLE_VALUE) return false;

    uint32_t header[2] = { 0, 0 };
    DWORD readBytes = 0;
    if (!ReadFile(m_pipe, header, sizeof(header), &readBytes, nullptr) || readBytes != sizeof(header)) {
        return false;
    }
    outOpcode = header[0];
    uint32_t len = header[1];
    if (len > 4 * 1024 * 1024) return false;

    outPayload.resize(len);
    size_t offset = 0;
    while (offset < len) {
        DWORD chunk = 0;
        if (!ReadFile(m_pipe, &outPayload[offset], (DWORD)(len - offset), &chunk, nullptr) || chunk == 0) {
            return false;
        }
        offset += chunk;
    }
    return true;
}

void DiscordManager::DisconnectIpc() {
    m_ipcRunning = false;
    {
        std::lock_guard<std::mutex> lock(m_pipeWriteMutex);
        if (m_pipe != INVALID_HANDLE_VALUE) {
            CloseHandle(m_pipe);
            m_pipe = INVALID_HANDLE_VALUE;
        }
    }
    if (m_ipcThread.joinable()) {
        m_ipcThread.join();
    }
}

void DiscordManager::ConnectIpc(const std::string& clientId) {
    if (clientId.empty()) return;
    RegisterProtocolHandler(clientId);
    if (m_ipcRunning.load() && m_ipcClientId == clientId && m_pipe != INVALID_HANDLE_VALUE) {
        return;
    }
    DisconnectIpc();
    m_ipcClientId = clientId;
    m_ipcRunning = true;
    m_ipcThread = std::thread(&DiscordManager::IpcWorkerLoop, this, clientId);
}

void DiscordManager::IpcWorkerLoop(std::string clientId) {
    HANDLE pipe = INVALID_HANDLE_VALUE;
    for (int i = 0; i < 10 && m_ipcRunning.load() && !m_shuttingDown.load(); ++i) {
        std::wstring pipeName = L"\\\\.\\pipe\\discord-ipc-" + std::to_wstring(i);
        pipe = CreateFileW(pipeName.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
        if (pipe != INVALID_HANDLE_VALUE) break;
    }

    if (pipe == INVALID_HANDLE_VALUE) {
        m_ipcRunning = false;
        Emit("{\"type\":\"discordIpcStatus\",\"connected\":false,\"reason\":\"pipe_not_found\"}");
        return;
    }

    {
        std::lock_guard<std::mutex> lock(m_pipeWriteMutex);
        m_pipe = pipe;
    }

    // Opcode 0: Handshake
    std::string handshake = "{\"v\":1,\"client_id\":\"" + JsonEscape(clientId) + "\"}";
    if (!SendIpcFrame(0, handshake)) {
        std::lock_guard<std::mutex> lock(m_pipeWriteMutex);
        if (m_pipe != INVALID_HANDLE_VALUE) { CloseHandle(m_pipe); m_pipe = INVALID_HANDLE_VALUE; }
        m_ipcRunning = false;
        Emit("{\"type\":\"discordIpcStatus\",\"connected\":false,\"reason\":\"handshake_failed\"}");
        return;
    }

    Emit("{\"type\":\"discordIpcStatus\",\"connected\":true}");

    while (m_ipcRunning.load() && !m_shuttingDown.load()) {
        uint32_t opcode = 0;
        std::string payload;
        if (!ReadIpcFrame(opcode, payload, 500)) {
            if (m_pipe == INVALID_HANDLE_VALUE || !m_ipcRunning.load()) break;
            DWORD avail = 0;
            if (!PeekNamedPipe(m_pipe, nullptr, 0, nullptr, &avail, nullptr)) {
                break; // Pipe closed by Discord
            }
            continue;
        }

        if (opcode == 2) {
            break; // CLOSE
        } else if (opcode == 3) {
            SendIpcFrame(4, payload); // PING -> PONG
        } else if (opcode == 1 && !payload.empty() && IsValidJsonEnvelope(payload)) {
            Emit("{\"type\":\"discordIpcFrame\",\"frame\":" + payload + "}");
            if (payload.find("\"evt\":\"READY\"") != std::string::npos) {
                SubscribeActivityEvents();
            }
        }
    }

    {
        std::lock_guard<std::mutex> lock(m_pipeWriteMutex);
        if (m_pipe != INVALID_HANDLE_VALUE) {
            CloseHandle(m_pipe);
            m_pipe = INVALID_HANDLE_VALUE;
        }
    }
    m_ipcRunning = false;
    if (!m_shuttingDown.load()) {
        Emit("{\"type\":\"discordIpcStatus\",\"connected\":false,\"reason\":\"disconnected\"}");
    }
}

void DiscordManager::SetActivity(const std::string& jsonArgs) {
    if (!m_ipcRunning.load() || m_pipe == INVALID_HANDLE_VALUE) return;

    if (jsonArgs.find("\"clear\":true") != std::string::npos) {
        std::ostringstream ss;
        uint64_t nonce = m_nonceCounter++;
        ss << "{\"cmd\":\"SET_ACTIVITY\",\"args\":{\"pid\":" << GetCurrentProcessId() << "},\"nonce\":\"" << nonce << "\"}";
        std::string frame = ss.str();
        std::thread([this, frame]() {
            SendIpcFrame(1, frame);
        }).detach();
        return;
    }

    std::string state = ExtractJsonString(jsonArgs, "state");
    std::string details = ExtractJsonString(jsonArgs, "details");
    std::string partyId = ExtractJsonString(jsonArgs, "partyId");
    std::string joinSecret = ExtractJsonString(jsonArgs, "joinSecret");
    std::string buttonLabel = ExtractJsonString(jsonArgs, "buttonLabel");
    std::string buttonUrl = ExtractJsonString(jsonArgs, "buttonUrl");
    std::string largeImageKey = ExtractJsonString(jsonArgs, "largeImageKey");
    std::string largeImageText = ExtractJsonString(jsonArgs, "largeImageText");
    int partySize = ExtractJsonInt(jsonArgs, "partySize", 1);
    int partyMax = ExtractJsonInt(jsonArgs, "partyMax", 100);
    long long startTs = ExtractJsonInt64(jsonArgs, "startTimestamp", 0);
    bool hasButton = !buttonLabel.empty() && !buttonUrl.empty();

    std::ostringstream ss;
    uint64_t nonce = m_nonceCounter++;
    DWORD pid = GetCurrentProcessId();

    ss << "{\"cmd\":\"SET_ACTIVITY\",\"args\":{\"pid\":" << pid << ",\"activity\":{";
    bool needComma = false;
    if (!details.empty()) {
        ss << "\"details\":\"" << JsonEscape(details) << "\"";
        needComma = true;
    }
    if (!state.empty()) {
        if (needComma) ss << ",";
        ss << "\"state\":\"" << JsonEscape(state) << "\"";
        needComma = true;
    }
    if (startTs > 0) {
        if (needComma) ss << ",";
        ss << "\"timestamps\":{\"start\":" << startTs << "}";
        needComma = true;
    }
    if (!largeImageKey.empty()) {
        if (needComma) ss << ",";
        ss << "\"assets\":{\"large_image\":\"" << JsonEscape(largeImageKey) << "\"";
        if (!largeImageText.empty()) {
            ss << ",\"large_text\":\"" << JsonEscape(largeImageText) << "\"";
        }
        ss << "}";
        needComma = true;
    }
    if (!partyId.empty() && partySize > 0 && partyMax >= partySize) {
        if (needComma) ss << ",";
        ss << "\"party\":{\"id\":\"" << JsonEscape(partyId) << "\",\"size\":[" << partySize << "," << partyMax << "]}";
        needComma = true;
    }
    if (hasButton) {
        // Discord RPC prohibits sending 'secrets' together with 'buttons'
        if (needComma) ss << ",";
        ss << "\"buttons\":[{\"label\":\"" << JsonEscape(buttonLabel) << "\",\"url\":\"" << JsonEscape(buttonUrl) << "\"}]";
        needComma = true;
    } else if (!joinSecret.empty()) {
        if (needComma) ss << ",";
        ss << "\"secrets\":{\"join\":\"" << JsonEscape(joinSecret) << "\"}";
        needComma = true;
    }
    if (needComma) ss << ",";
    ss << "\"instance\":" << ((!hasButton && !joinSecret.empty()) ? "true" : "false") << "}},\"nonce\":\"" << nonce << "\"}";

    std::string frame = ss.str();
    std::thread([this, frame]() {
        SendIpcFrame(1, frame);
    }).detach();
}

void DiscordManager::AuthorizeRpc(const std::string& clientId, const std::string& scopesJsonArray) {
    if (!m_ipcRunning.load() || m_pipe == INVALID_HANDLE_VALUE || clientId.empty()) return;
    uint64_t nonce = m_nonceCounter++;
    std::string scopes = IsValidJsonEnvelope(scopesJsonArray) ? scopesJsonArray : "[\"rpc\",\"rpc.voice.read\"]";
    std::ostringstream ss;
    ss << "{\"cmd\":\"AUTHORIZE\",\"args\":{\"client_id\":\"" << JsonEscape(clientId)
       << "\",\"scopes\":" << scopes << "},\"nonce\":\"auth-" << nonce << "\"}";
    std::string frame = ss.str();
    std::thread([this, frame]() {
        SendIpcFrame(1, frame);
    }).detach();
}

void DiscordManager::AuthenticateRpc(const std::string& accessToken) {
    if (!m_ipcRunning.load() || m_pipe == INVALID_HANDLE_VALUE || accessToken.empty()) return;
    uint64_t nonce = m_nonceCounter++;
    std::ostringstream ss;
    ss << "{\"cmd\":\"AUTHENTICATE\",\"args\":{\"access_token\":\"" << JsonEscape(accessToken)
       << "\"},\"nonce\":\"authen-" << nonce << "\"}";
    std::string frame = ss.str();
    std::thread([this, frame]() {
        SendIpcFrame(1, frame);
    }).detach();
}

void DiscordManager::GetSelectedVoiceChannel() {
    if (!m_ipcRunning.load() || m_pipe == INVALID_HANDLE_VALUE) return;
    uint64_t nonce = m_nonceCounter++;
    std::ostringstream ss;
    ss << "{\"cmd\":\"GET_SELECTED_VOICE_CHANNEL\",\"args\":{},\"nonce\":\"voice-" << nonce << "\"}";
    std::string frame = ss.str();
    std::thread([this, frame]() {
        SendIpcFrame(1, frame);
    }).detach();
}

void DiscordManager::SubscribeVoiceEvents() {
    if (!m_ipcRunning.load() || m_pipe == INVALID_HANDLE_VALUE) return;
    std::thread([this]() {
        const char* events[] = {
            "VOICE_CHANNEL_SELECT",
            "VOICE_STATE_CREATE",
            "VOICE_STATE_UPDATE",
            "VOICE_STATE_DELETE",
            "NOTIFICATION_CREATE"
        };
        for (const char* evt : events) {
            uint64_t nonce = m_nonceCounter++;
            std::ostringstream ss;
            ss << "{\"cmd\":\"SUBSCRIBE\",\"evt\":\"" << evt << "\",\"args\":{},\"nonce\":\"sub-" << nonce << "\"}";
            SendIpcFrame(1, ss.str());
        }
    }).detach();
}

void DiscordManager::SubscribeActivityEvents() {
    if (!m_ipcRunning.load() || m_pipe == INVALID_HANDLE_VALUE) return;
    std::thread([this]() {
        const char* events[] = {
            "ACTIVITY_JOIN",
            "ACTIVITY_SPECTATE",
            "ACTIVITY_JOIN_REQUEST"
        };
        for (const char* evt : events) {
            uint64_t nonce = m_nonceCounter++;
            std::ostringstream ss;
            ss << "{\"cmd\":\"SUBSCRIBE\",\"evt\":\"" << evt << "\",\"args\":{},\"nonce\":\"act-" << nonce << "\"}";
            SendIpcFrame(1, ss.str());
        }
    }).detach();
}

void DiscordManager::SendActivityJoinInvite(const std::string& userId) {
    if (!m_ipcRunning.load() || m_pipe == INVALID_HANDLE_VALUE || userId.empty()) return;
    uint64_t nonce = m_nonceCounter++;
    std::ostringstream ss;
    ss << "{\"cmd\":\"SEND_ACTIVITY_JOIN_INVITE\",\"args\":{\"user_id\":\"" << JsonEscape(userId)
       << "\"},\"nonce\":\"inv-" << nonce << "\"}";
    std::string frame = ss.str();
    std::thread([this, frame]() {
        SendIpcFrame(1, frame);
    }).detach();
}

static void RegisterSingleUriScheme(const std::wstring& scheme, const std::wstring& description, const std::wstring& exePath) {
    if (scheme.empty() || exePath.empty()) return;

    std::wstring baseKey = L"Software\\Classes\\" + scheme;
    HKEY hKey = nullptr;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, baseKey.c_str(), 0, nullptr, REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hKey, nullptr) == ERROR_SUCCESS) {
        RegSetValueExW(hKey, nullptr, 0, REG_SZ, (const BYTE*)description.c_str(), (DWORD)((description.size() + 1) * sizeof(wchar_t)));
        const wchar_t empty[] = L"";
        RegSetValueExW(hKey, L"URL Protocol", 0, REG_SZ, (const BYTE*)empty, sizeof(empty));
        RegCloseKey(hKey);
    }

    std::wstring iconKey = baseKey + L"\\DefaultIcon";
    if (RegCreateKeyExW(HKEY_CURRENT_USER, iconKey.c_str(), 0, nullptr, REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hKey, nullptr) == ERROR_SUCCESS) {
        std::wstring iconVal = L"\"" + exePath + L"\",0";
        RegSetValueExW(hKey, nullptr, 0, REG_SZ, (const BYTE*)iconVal.c_str(), (DWORD)((iconVal.size() + 1) * sizeof(wchar_t)));
        RegCloseKey(hKey);
    }

    std::wstring cmdKey = baseKey + L"\\shell\\open\\command";
    if (RegCreateKeyExW(HKEY_CURRENT_USER, cmdKey.c_str(), 0, nullptr, REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hKey, nullptr) == ERROR_SUCCESS) {
        std::wstring cmdVal = L"\"" + exePath + L"\" \"%1\"";
        RegSetValueExW(hKey, nullptr, 0, REG_SZ, (const BYTE*)cmdVal.c_str(), (DWORD)((cmdVal.size() + 1) * sizeof(wchar_t)));
        RegCloseKey(hKey);
    }
}

void DiscordManager::RegisterProtocolHandler(const std::string& clientId) {
    wchar_t exePath[MAX_PATH] = {};
    if (GetModuleFileNameW(nullptr, exePath, MAX_PATH) == 0) return;

    RegisterSingleUriScheme(L"roxyroom", L"URL:Roxy Room Protocol", exePath);
    if (!clientId.empty()) {
        std::wstring wClientId;
        for (unsigned char c : clientId) {
            if (std::isdigit(c)) wClientId.push_back((wchar_t)c);
        }
        if (!wClientId.empty()) {
            RegisterSingleUriScheme(L"discord-" + wClientId, L"URL:Run Roxy Room via Discord", exePath);
        }
    }
}
