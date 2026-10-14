#include "WebStreamServer.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <filesystem>
#include <wincrypt.h>
#include <algorithm>

#pragma comment(lib, "Advapi32.lib")
#pragma comment(lib, "Crypt32.lib")

static std::string ComputeWebSocketAccept(const std::string& clientKey) {
    std::string magic = clientKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    HCRYPTPROV hProv = 0;
    HCRYPTHASH hHash = 0;
    std::string result = "";

    if (CryptAcquireContextW(&hProv, NULL, NULL, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT)) {
        if (CryptCreateHash(hProv, CALG_SHA1, 0, 0, &hHash)) {
            if (CryptHashData(hHash, (BYTE*)magic.c_str(), (DWORD)magic.length(), 0)) {
                BYTE hash[20];
                DWORD hashLen = 20;
                if (CryptGetHashParam(hHash, HP_HASHVAL, hash, &hashLen, 0)) {
                    DWORD b64Len = 0;
                    CryptBinaryToStringA(hash, hashLen, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, NULL, &b64Len);
                    if (b64Len > 0) {
                        std::vector<char> b64Buf(b64Len);
                        CryptBinaryToStringA(hash, hashLen, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, b64Buf.data(), &b64Len);
                        result = std::string(b64Buf.data());
                    }
                }
            }
            CryptDestroyHash(hHash);
        }
        CryptReleaseContext(hProv, 0);
    }
    return result;
}

WebStreamServer::WebStreamServer(int port) : m_port(port) {}

WebStreamServer::~WebStreamServer() {
    Stop();
}

bool WebStreamServer::Start(const std::string& webRoot) {
    m_webRoot = webRoot;
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        return false;
    }

    int basePort = m_port;
    bool bound = false;

    for (int attempt = 0; attempt < 10; ++attempt) {
        int testPort = basePort + attempt;
        m_listenSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (m_listenSocket == INVALID_SOCKET) {
            continue;
        }

        int opt = 1;
        setsockopt(m_listenSocket, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

        sockaddr_in service;
        service.sin_family = AF_INET;
        service.sin_addr.s_addr = INADDR_ANY;
        service.sin_port = htons((u_short)testPort);

        if (bind(m_listenSocket, (SOCKADDR*)&service, sizeof(service)) != SOCKET_ERROR) {
            if (listen(m_listenSocket, SOMAXCONN) != SOCKET_ERROR) {
                m_port = testPort;
                bound = true;
                break;
            }
        }
        closesocket(m_listenSocket);
        m_listenSocket = INVALID_SOCKET;
    }

    if (!bound) {
        WSACleanup();
        return false;
    }

    m_isRunning = true;
    m_serverThread = std::thread(&WebStreamServer::ServerThreadFunc, this);
    std::cout << "[WebStreamServer] Servidor iniciado na porta " << m_port << std::endl;
    return true;
}

void WebStreamServer::Stop() {
    m_isRunning = false;
    if (m_listenSocket != INVALID_SOCKET) {
        closesocket(m_listenSocket);
        m_listenSocket = INVALID_SOCKET;
    }
    if (m_serverThread.joinable()) {
        m_serverThread.join();
    }
    {
        std::lock_guard<std::mutex> lock(m_clientsMutex);
        for (SOCKET s : m_wsClients) {
            shutdown(s, SD_BOTH);
            closesocket(s);
        }
        m_wsClients.clear();
    }
    WSACleanup();
}

void WebStreamServer::ServerThreadFunc() {
    while (m_isRunning) {
        SOCKET clientSocket = accept(m_listenSocket, NULL, NULL);
        if (clientSocket != INVALID_SOCKET) {
            std::thread(&WebStreamServer::ClientHandlerThread, this, clientSocket).detach();
        }
    }
}

std::string WebStreamServer::GetMimeType(const std::string& path) {
    auto endsWith = [](const std::string& s, const std::string& suffix) {
        return s.size() >= suffix.size() && s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
    };
    if (endsWith(path, ".html")) return "text/html; charset=utf-8";
    if (endsWith(path, ".css")) return "text/css";
    if (endsWith(path, ".js")) return "application/javascript";
    if (endsWith(path, ".png")) return "image/png";
    if (endsWith(path, ".ico")) return "image/x-icon";
    if (endsWith(path, ".json")) return "application/json";
    if (endsWith(path, ".svg")) return "image/svg+xml";
    if (endsWith(path, ".woff2")) return "font/woff2";
    return "text/plain";
}

std::string WebStreamServer::ReadFileContent(const std::filesystem::path& fullPath) {
    try {
        if (!std::filesystem::exists(fullPath) || std::filesystem::is_directory(fullPath)) {
            return "";
        }
        std::ifstream file(fullPath, std::ios::binary);
        if (!file.is_open()) return "";
        std::stringstream buffer;
        buffer << file.rdbuf();
        return buffer.str();
    } catch (...) {
        return "";
    }
}

void WebStreamServer::ClientHandlerThread(SOCKET clientSocket) {
    char recvBuf[4096];
    int bytesRecv = recv(clientSocket, recvBuf, sizeof(recvBuf) - 1, 0);
    if (bytesRecv <= 0) {
        closesocket(clientSocket);
        return;
    }

    recvBuf[bytesRecv] = '\0';
    std::string request(recvBuf);

    // Check if WebSocket Upgrade request
    if (request.find("Upgrade: websocket") != std::string::npos || request.find("upgrade: websocket") != std::string::npos) {
        size_t keyPos = request.find("Sec-WebSocket-Key: ");
        if (keyPos == std::string::npos) keyPos = request.find("sec-websocket-key: ");

        if (keyPos != std::string::npos) {
            size_t keyStart = keyPos + 19;
            size_t keyEnd = request.find("\r\n", keyStart);
            if (keyEnd == std::string::npos) {
                closesocket(clientSocket);
                return;
            }
            std::string clientKey = request.substr(keyStart, keyEnd - keyStart);
            std::string acceptKey = ComputeWebSocketAccept(clientKey);

            std::stringstream response;
            response << "HTTP/1.1 101 Switching Protocols\r\n"
                << "Upgrade: websocket\r\n"
                << "Connection: Upgrade\r\n"
                << "Sec-WebSocket-Accept: " << acceptKey << "\r\n\r\n";

            std::string respStr = response.str();
            send(clientSocket, respStr.c_str(), (int)respStr.length(), 0);

            // Disable Nagle's algorithm for low-latency real-time streaming
            int nodelay = 1;
            setsockopt(clientSocket, IPPROTO_TCP, TCP_NODELAY, (const char*)&nodelay, sizeof(nodelay));

            // Set socket send timeout (250ms) to prevent slow network from freezing stream threads
            DWORD sndTimeout = 250;
            setsockopt(clientSocket, SOL_SOCKET, SO_SNDTIMEO, (const char*)&sndTimeout, sizeof(sndTimeout));
            DWORD rcvTimeout = 1000;
            setsockopt(clientSocket, SOL_SOCKET, SO_RCVTIMEO, (const char*)&rcvTimeout, sizeof(rcvTimeout));

            {
                std::lock_guard<std::mutex> lock(m_clientsMutex);
                m_wsClients.insert(clientSocket);
            }
            std::cout << "[WebStreamServer] Novo cliente WebSocket conectado! Total: " << GetClientCount() << std::endl;

            // Monitor client socket
            char wsBuf[256];
            while (m_isRunning) {
                int n = recv(clientSocket, wsBuf, sizeof(wsBuf), 0);
                if (n < 0 && WSAGetLastError() == WSAETIMEDOUT) {
                    // Timeout de leitura (SO_RCVTIMEO) NAO e desconexao: o cliente de audio/video
                    // so recebe dados e nunca envia nada. Antes isso derrubava o cliente apos 1s.
                    continue;
                }
                if (n <= 0) break;
                if (n >= 2 && (wsBuf[0] & 0x0F) == 0x08) {
                    // Close frame
                    char closeFrame[2] = { (char)0x88, 0x00 };
                    send(clientSocket, closeFrame, 2, 0);
                    break;
                }
                if (n >= 2 && (wsBuf[0] & 0x0F) == 0x09) {
                    // Pong response
                    wsBuf[0] = (wsBuf[0] & 0xF0) | 0x0A;
                    send(clientSocket, wsBuf, n, 0);
                }
            }

            {
                std::lock_guard<std::mutex> lock(m_clientsMutex);
                m_wsClients.erase(clientSocket);
            }
            shutdown(clientSocket, SD_BOTH);
            closesocket(clientSocket);
            std::cout << "[WebStreamServer] Cliente WebSocket desconectado. Restantes: " << GetClientCount() << std::endl;
            return;
        }
    }

    // Standard HTTP static file server
    std::stringstream reqStream(request);
    std::string method, url;
    reqStream >> method >> url;

    size_t qPos = url.find('?');
    std::string cleanUrl = (qPos != std::string::npos) ? url.substr(0, qPos) : url;
    if (cleanUrl == "/" || cleanUrl.empty()) cleanUrl = "/index.html";

    std::string sub = (cleanUrl[0] == '/') ? cleanUrl.substr(1) : cleanUrl;
    std::filesystem::path rootPath = std::filesystem::u8path(m_webRoot);
    std::filesystem::path fullPath = rootPath / std::filesystem::u8path(sub);

    std::string body = ReadFileContent(fullPath);

    if (body.empty() && (cleanUrl == "/index.html" || cleanUrl == "index.html")) {
        body = R"(<!DOCTYPE html><html><head><title>Roxy Room</title></head>
<body><h2>Roxy Room C++</h2><p>Servidor ativo!</p></body></html>)";
    }

    std::stringstream response;
    if (!body.empty()) {
        response << "HTTP/1.1 200 OK\r\n"
            << "Content-Type: " << GetMimeType(url) << "\r\n"
            << "Content-Length: " << body.length() << "\r\n"
            << "Access-Control-Allow-Origin: *\r\n"
            << "Connection: close\r\n\r\n"
            << body;
    }
    else {
        std::string errStr = "404 Not Found";
        response << "HTTP/1.1 404 Not Found\r\n"
            << "Content-Type: text/plain\r\n"
            << "Content-Length: " << errStr.length() << "\r\n"
            << "Connection: close\r\n\r\n"
            << errStr;
    }

    std::string respStr = response.str();
    send(clientSocket, respStr.c_str(), (int)respStr.length(), 0);
    shutdown(clientSocket, SD_SEND);
    closesocket(clientSocket);
}

bool WebStreamServer::SendWebSocketFrameScatter(SOCKET sock, uint8_t opcode, const BYTE* chunkHeader, size_t chunkHeaderLen, const BYTE* payload, size_t payloadLen) {
    size_t totalPayloadLen = chunkHeaderLen + payloadLen;
    BYTE wsHeader[10];
    int wsHeaderLen = 0;
    wsHeader[0] = 0x80 | opcode;

    if (totalPayloadLen <= 125) {
        wsHeader[1] = (uint8_t)totalPayloadLen;
        wsHeaderLen = 2;
    }
    else if (totalPayloadLen <= 65535) {
        wsHeader[1] = 126;
        wsHeader[2] = (totalPayloadLen >> 8) & 0xFF;
        wsHeader[3] = totalPayloadLen & 0xFF;
        wsHeaderLen = 4;
    }
    else {
        wsHeader[1] = 127;
        for (int i = 0; i < 8; ++i) {
            wsHeader[2 + i] = (totalPayloadLen >> ((7 - i) * 8)) & 0xFF;
        }
        wsHeaderLen = 10;
    }

    WSABUF bufs[3];
    DWORD bufCount = 0;

    bufs[bufCount].len = (ULONG)wsHeaderLen;
    bufs[bufCount].buf = reinterpret_cast<char*>(wsHeader);
    bufCount++;

    if (chunkHeader && chunkHeaderLen > 0) {
        bufs[bufCount].len = (ULONG)chunkHeaderLen;
        bufs[bufCount].buf = reinterpret_cast<char*>(const_cast<BYTE*>(chunkHeader));
        bufCount++;
    }

    if (payload && payloadLen > 0) {
        bufs[bufCount].len = (ULONG)payloadLen;
        bufs[bufCount].buf = reinterpret_cast<char*>(const_cast<BYTE*>(payload));
        bufCount++;
    }

    DWORD bytesSent = 0;
    int res = WSASend(sock, bufs, bufCount, &bytesSent, 0, nullptr, nullptr);
    return (res == 0);
}

bool WebStreamServer::SendWebSocketFrame(SOCKET sock, uint8_t opcode, const BYTE* payload, size_t length) {
    return SendWebSocketFrameScatter(sock, opcode, nullptr, 0, payload, length);
}

void WebStreamServer::BroadcastVideoFrame(const std::vector<BYTE>& frameData, int width, int height) {
    if (frameData.empty()) return;

    std::vector<SOCKET> clientSnapshot;
    {
        std::lock_guard<std::mutex> lock(m_clientsMutex);
        if (m_wsClients.empty()) return;
        clientSnapshot.assign(m_wsClients.begin(), m_wsClients.end());
    }

    // Header: Type 'V' (1 byte) + Width (2 bytes) + Height (2 bytes)
    BYTE header[5];
    header[0] = 'V';
    header[1] = (width >> 8) & 0xFF;
    header[2] = width & 0xFF;
    header[3] = (height >> 8) & 0xFF;
    header[4] = height & 0xFF;

    std::vector<SOCKET> disconnected;
    for (SOCKET s : clientSnapshot) {
        if (!SendWebSocketFrameScatter(s, 0x2, header, sizeof(header), frameData.data(), frameData.size())) {
            disconnected.push_back(s);
        }
    }

    if (!disconnected.empty()) {
        std::lock_guard<std::mutex> lock(m_clientsMutex);
        for (SOCKET s : disconnected) {
            m_wsClients.erase(s);
            shutdown(s, SD_BOTH);
            closesocket(s);
        }
    }
}

void WebStreamServer::BroadcastAudioChunk(const BYTE* pData, UINT32 size, int sampleRate, int channels) {
    if (!pData || size == 0) return;

    std::vector<SOCKET> clientSnapshot;
    {
        std::lock_guard<std::mutex> lock(m_clientsMutex);
        if (m_wsClients.empty()) return;
        clientSnapshot.assign(m_wsClients.begin(), m_wsClients.end());
    }

    // Header: Type 'A' (1 byte) + Pad (1 byte) + SampleRate (4 bytes) + Channels (2 bytes) = 8 bytes
    BYTE audioHeader[8];
    audioHeader[0] = 'A';
    audioHeader[1] = 0;
    audioHeader[2] = (sampleRate >> 24) & 0xFF;
    audioHeader[3] = (sampleRate >> 16) & 0xFF;
    audioHeader[4] = (sampleRate >> 8) & 0xFF;
    audioHeader[5] = sampleRate & 0xFF;
    audioHeader[6] = (channels >> 8) & 0xFF;
    audioHeader[7] = channels & 0xFF;

    std::vector<SOCKET> disconnected;
    for (SOCKET s : clientSnapshot) {
        if (!SendWebSocketFrameScatter(s, 0x2, audioHeader, sizeof(audioHeader), pData, size)) {
            disconnected.push_back(s);
        }
    }

    if (!disconnected.empty()) {
        std::lock_guard<std::mutex> lock(m_clientsMutex);
        for (SOCKET s : disconnected) {
            m_wsClients.erase(s);
            shutdown(s, SD_BOTH);
            closesocket(s);
        }
    }
}

int WebStreamServer::GetClientCount() const {
    std::lock_guard<std::mutex> lock(const_cast<std::mutex&>(m_clientsMutex));
    return (int)m_wsClients.size();
}
