#include "DXGICapturer.h"
#include <iostream>
#include <chrono>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")

DXGICapturer::DXGICapturer() {
    m_hStopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
}

DXGICapturer::~DXGICapturer() {
    StopCapture();
    ReleaseD3D();
    if (m_hStopEvent) {
        CloseHandle(m_hStopEvent);
        m_hStopEvent = nullptr;
    }
}

void DXGICapturer::ReleaseD3D() {
    if (m_pDeskDupl) { m_pDeskDupl->Release(); m_pDeskDupl = nullptr; }
    if (m_pContext) { m_pContext->Release(); m_pContext = nullptr; }
    if (m_pDevice) { m_pDevice->Release(); m_pDevice = nullptr; }
}

bool DXGICapturer::Initialize(int outputIndex) {
    ReleaseD3D();

    m_width = GetSystemMetrics(SM_CXSCREEN);
    m_height = GetSystemMetrics(SM_CYSCREEN);

    HRESULT hr = S_OK;

    D3D_FEATURE_LEVEL featureLevels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0
    };
    D3D_FEATURE_LEVEL featureLevel;

    hr = D3D11CreateDevice(
        nullptr,
        D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        0,
        featureLevels,
        ARRAYSIZE(featureLevels),
        D3D11_SDK_VERSION,
        &m_pDevice,
        &featureLevel,
        &m_pContext
    );

    if (SUCCEEDED(hr) && m_pDevice) {
        IDXGIDevice* pDxgiDevice = nullptr;
        if (SUCCEEDED(m_pDevice->QueryInterface(__uuidof(IDXGIDevice), (void**)&pDxgiDevice))) {
            IDXGIAdapter* pDxgiAdapter = nullptr;
            if (SUCCEEDED(pDxgiDevice->GetParent(__uuidof(IDXGIAdapter), (void**)&pDxgiAdapter))) {
                IDXGIOutput* pDxgiOutput = nullptr;
                if (SUCCEEDED(pDxgiAdapter->EnumOutputs(outputIndex, &pDxgiOutput))) {
                    IDXGIOutput1* pDxgiOutput1 = nullptr;
                    if (SUCCEEDED(pDxgiOutput->QueryInterface(__uuidof(IDXGIOutput1), (void**)&pDxgiOutput1))) {
                        hr = pDxgiOutput1->DuplicateOutput(m_pDevice, &m_pDeskDupl);
                        pDxgiOutput1->Release();
                    }
                    pDxgiOutput->Release();
                }
                pDxgiAdapter->Release();
            }
            pDxgiDevice->Release();
        }
    }

    if (m_pDeskDupl) {
        std::cout << "[DXGICapturer] DXGI Desktop Duplication ativo! Resolução: " << m_width << "x" << m_height << std::endl;
    } else {
        std::cout << "[DXGICapturer] DXGI indisponível. Ativando modo de captura GDI BitBlt de alta velocidade (" 
                  << m_width << "x" << m_height << ")..." << std::endl;
    }

    return true;
}

bool DXGICapturer::StartCapture(FrameCallback callback, int targetFps) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_isCapturing) return true;

    if (m_hStopEvent) ResetEvent(m_hStopEvent);
    Initialize();

    m_frameCallback = callback;
    m_isCapturing = true;
    m_captureThread = std::thread(&DXGICapturer::CaptureThreadFunc, this, targetFps);
    return true;
}

void DXGICapturer::StopCapture() {
    m_isCapturing = false;
    if (m_hStopEvent) {
        SetEvent(m_hStopEvent);
    }
    if (m_captureThread.joinable()) {
        m_captureThread.join();
    }
}

void DXGICapturer::CaptureThreadFunc(int targetFps) {
    int targetFrameTimeMs = 1000 / std::max(1, targetFps);
    std::vector<BYTE> frameBuffer(m_width * m_height * 4);

    if (m_pDeskDupl && m_pDevice && m_pContext) {
        DXGI_OUTDUPL_FRAME_INFO frameInfo;
        IDXGIResource* pDesktopResource = nullptr;

        ID3D11Texture2D* pStagingTexture = nullptr;
        D3D11_TEXTURE2D_DESC stagingDesc = {};
        stagingDesc.Width = m_width;
        stagingDesc.Height = m_height;
        stagingDesc.MipLevels = 1;
        stagingDesc.ArraySize = 1;
        stagingDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        stagingDesc.SampleDesc.Count = 1;
        stagingDesc.Usage = D3D11_USAGE_STAGING;
        stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;

        if (SUCCEEDED(m_pDevice->CreateTexture2D(&stagingDesc, nullptr, &pStagingTexture))) {
            while (m_isCapturing) {
                auto frameStartTime = std::chrono::steady_clock::now();

                HRESULT hr = m_pDeskDupl->AcquireNextFrame(targetFrameTimeMs, &frameInfo, &pDesktopResource);
                if (SUCCEEDED(hr)) {
                    ID3D11Texture2D* pAcquiredTexture = nullptr;
                    if (SUCCEEDED(pDesktopResource->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&pAcquiredTexture))) {
                        m_pContext->CopyResource(pStagingTexture, pAcquiredTexture);
                        pAcquiredTexture->Release();

                        D3D11_MAPPED_SUBRESOURCE mappedResource;
                        if (SUCCEEDED(m_pContext->Map(pStagingTexture, 0, D3D11_MAP_READ, 0, &mappedResource))) {
                            const BYTE* pSrc = (const BYTE*)mappedResource.pData;
                            BYTE* pDst = frameBuffer.data();
                            UINT rowPitch = mappedResource.RowPitch;
                            UINT lineSize = m_width * 4;

                            if (rowPitch == lineSize) {
                                memcpy(pDst, pSrc, lineSize * m_height);
                            } else {
                                for (int y = 0; y < m_height; ++y) {
                                    memcpy(pDst + y * lineSize, pSrc + y * rowPitch, lineSize);
                                }
                            }
                            m_pContext->Unmap(pStagingTexture, 0);

                            if (m_frameCallback) m_frameCallback(frameBuffer, m_width, m_height);
                        }
                    }
                    pDesktopResource->Release();
                    m_pDeskDupl->ReleaseFrame();
                } else if (hr == DXGI_ERROR_ACCESS_LOST || hr == DXGI_ERROR_INVALID_CALL) {
                    // Display mode changed or secure desktop (UAC) - safely re-init duplication
                    if (m_pDeskDupl) { m_pDeskDupl->Release(); m_pDeskDupl = nullptr; }
                    Sleep(50);
                    Initialize();
                    if (!m_pDeskDupl) break; // Fall through to GDI fallback
                }

                auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - frameStartTime).count();
                if (elapsedMs < targetFrameTimeMs && m_isCapturing) {
                    DWORD sleepTime = (DWORD)(targetFrameTimeMs - elapsedMs);
                    if (m_hStopEvent) {
                        if (WaitForSingleObject(m_hStopEvent, sleepTime) == WAIT_OBJECT_0) break;
                    } else {
                        Sleep(sleepTime);
                    }
                }
            }

            pStagingTexture->Release();
            if (!m_isCapturing) return;
        }
    }

    // GDI BitBlt Fallback Path (Ultra-compatible, rock solid on any GPU or CPU)
    HDC hScreenDC = GetDC(NULL);
    HDC hMemoryDC = CreateCompatibleDC(hScreenDC);
    HBITMAP hBitmap = CreateCompatibleBitmap(hScreenDC, m_width, m_height);
    HBITMAP hOldBitmap = (HBITMAP)SelectObject(hMemoryDC, hBitmap);

    BITMAPINFOHEADER bmi = {};
    bmi.biSize = sizeof(BITMAPINFOHEADER);
    bmi.biWidth = m_width;
    bmi.biHeight = -m_height; // Top-down
    bmi.biPlanes = 1;
    bmi.biBitCount = 32;
    bmi.biCompression = BI_RGB;

    while (m_isCapturing) {
        auto frameStartTime = std::chrono::steady_clock::now();

        BitBlt(hMemoryDC, 0, 0, m_width, m_height, hScreenDC, 0, 0, SRCCOPY);
        GetDIBits(hMemoryDC, hBitmap, 0, m_height, frameBuffer.data(), (BITMAPINFO*)&bmi, DIB_RGB_COLORS);

        if (m_frameCallback) {
            m_frameCallback(frameBuffer, m_width, m_height);
        }

        auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - frameStartTime).count();
        if (elapsedMs < targetFrameTimeMs && m_isCapturing) {
            DWORD sleepTime = (DWORD)(targetFrameTimeMs - elapsedMs);
            if (m_hStopEvent) {
                if (WaitForSingleObject(m_hStopEvent, sleepTime) == WAIT_OBJECT_0) break;
            } else {
                Sleep(sleepTime);
            }
        }
    }

    SelectObject(hMemoryDC, hOldBitmap);
    DeleteObject(hBitmap);
    DeleteDC(hMemoryDC);
    ReleaseDC(NULL, hScreenDC);
}
