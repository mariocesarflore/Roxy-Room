#ifndef DXGI_CAPTURER_H
#define DXGI_CAPTURER_H

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <vector>
#include <thread>
#include <atomic>
#include <functional>
#include <mutex>

class DXGICapturer {
public:
    using FrameCallback = std::function<void(const std::vector<BYTE>& bgraBuffer, int width, int height)>;

    DXGICapturer();
    ~DXGICapturer();

    bool Initialize(int outputIndex = 0);
    bool StartCapture(FrameCallback callback, int targetFps = 60);
    void StopCapture();

    int GetWidth() const { return m_width; }
    int GetHeight() const { return m_height; }
    bool IsCapturing() const { return m_isCapturing; }

private:
    void CaptureThreadFunc(int targetFps);
    void ReleaseD3D();

    ID3D11Device* m_pDevice = nullptr;
    ID3D11DeviceContext* m_pContext = nullptr;
    IDXGIOutputDuplication* m_pDeskDupl = nullptr;

    int m_width = 0;
    int m_height = 0;
    std::atomic<bool> m_isCapturing{ false };
    HANDLE m_hStopEvent = nullptr;
    std::thread m_captureThread;
    FrameCallback m_frameCallback;
    std::mutex m_mutex;
};

#endif // DXGI_CAPTURER_H
