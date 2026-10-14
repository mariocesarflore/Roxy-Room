#ifndef WEB_STREAM_SERVER_H
#define WEB_STREAM_SERVER_H

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <mutex>
#include <set>
#include <functional>

#pragma comment(lib, "Ws2_32.lib")

#include <filesystem>

class WebStreamServer {
public:
    WebStreamServer(int port = 8085);
    ~WebStreamServer();

    bool Start(const std::string& webRoot);
    void Stop();

    void BroadcastVideoFrame(const std::vector<BYTE>& frameData, int width, int height);
    void BroadcastAudioChunk(const BYTE* pData, UINT32 size, int sampleRate, int channels);

    int GetClientCount() const;
    int GetPort() const { return m_port; }

private:
    void ServerThreadFunc();
    void ClientHandlerThread(SOCKET clientSocket);
    std::string GetMimeType(const std::string& path);
    std::string ReadFileContent(const std::filesystem::path& fullPath);

    bool SendWebSocketFrame(SOCKET sock, uint8_t opcode, const BYTE* payload, size_t length);
    bool SendWebSocketFrameScatter(SOCKET sock, uint8_t opcode, const BYTE* chunkHeader, size_t chunkHeaderLen, const BYTE* payload, size_t payloadLen);

    int m_port;
    std::string m_webRoot;
    std::atomic<bool> m_isRunning{ false };
    SOCKET m_listenSocket = INVALID_SOCKET;
    std::thread m_serverThread;

    std::set<SOCKET> m_wsClients;
    std::mutex m_clientsMutex;
    std::vector<BYTE> m_broadcastBuffer;  // Pre-allocated to avoid per-frame heap allocs
};

#endif // WEB_STREAM_SERVER_H
