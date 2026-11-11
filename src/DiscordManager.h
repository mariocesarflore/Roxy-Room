#ifndef DISCORD_MANAGER_H
#define DISCORD_MANAGER_H

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <string>
#include <functional>
#include <thread>
#include <atomic>
#include <mutex>
#include <vector>

class DiscordManager {
public:
    using MessageCallback = std::function<void(const std::string& utf8Json)>;

    DiscordManager();
    ~DiscordManager();

    void SetMessageCallback(MessageCallback cb);
    void Shutdown();

    // Local IPC (\\.\pipe\discord-ipc-0..9)
    void ConnectIpc(const std::string& clientId);
    void DisconnectIpc();
    void SetActivity(const std::string& jsonArgs);
    void AuthorizeRpc(const std::string& clientId, const std::string& scopesJsonArray);
    void AuthenticateRpc(const std::string& accessToken);
    void GetSelectedVoiceChannel();
    void SubscribeVoiceEvents();
    void SubscribeActivityEvents();
    void SendActivityJoinInvite(const std::string& userId);

    // Registers discord-<clientId>:// and roxyroom:// URI handlers in HKCU\Software\Classes
    static void RegisterProtocolHandler(const std::string& clientId);

    // Discord HTTPS API (via WinHTTP - bypasses WebView CORS)
    void ExchangeOAuthCode(const std::string& jsonParams);
    void FetchProfile(const std::string& accessToken);

    // Local Windows Discord & Spotify status check
    void PollLocalStatus();

private:
    void Emit(const std::string& utf8Json);
    void IpcWorkerLoop(std::string clientId);
    bool SendIpcFrame(uint32_t opcode, const std::string& payload);
    bool ReadIpcFrame(uint32_t& outOpcode, std::string& outPayload, DWORD timeoutMs);

    static bool HttpRequest(
        const std::wstring& host,
        const std::wstring& path,
        const std::wstring& method,
        const std::string& body,
        const std::wstring& contentType,
        const std::string& bearerToken,
        int& outStatus,
        std::string& outBody
    );

    static std::string ExtractJsonString(const std::string& json, const std::string& key);
    static int ExtractJsonInt(const std::string& json, const std::string& key, int fallback = 0);
    static long long ExtractJsonInt64(const std::string& json, const std::string& key, long long fallback = 0);
    static std::string JsonEscape(const std::string& s);
    static std::string UrlEncode(const std::string& s);
    static std::string WideToUtf8(const std::wstring& ws);
    static std::wstring Utf8ToWide(const std::string& s);

    MessageCallback m_callback;
    std::mutex m_cbMutex;

    std::atomic<bool> m_shuttingDown{ false };

    // IPC pipe state
    HANDLE m_pipe = INVALID_HANDLE_VALUE;
    std::mutex m_pipeWriteMutex;
    std::thread m_ipcThread;
    std::atomic<bool> m_ipcRunning{ false };
    std::string m_ipcClientId;
    std::atomic<uint64_t> m_nonceCounter{ 1 };
};

#endif // DISCORD_MANAGER_H
