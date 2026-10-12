#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <wrl/client.h>
#include <vector>
#include <mutex>
#include <atomic>

using Microsoft::WRL::ComPtr;

class D3D11Renderer {
public:
    D3D11Renderer();
    ~D3D11Renderer();

    // Initialize D3D11 swapchain for a target window handle
    bool Initialize(HWND hwnd);

    // Resize backbuffers when window size changes
    void Resize(int width, int height);

    // Upload and render a new BGRA video frame
    bool UpdateFrame(const BYTE* pData, int width, int height, int stride = 0);

    // Render current frame to screen with letterboxing/pillarboxing
    void Render();

    // Clean up all resources
    void Cleanup();

    // Check if renderer is ready
    bool IsInitialized() const { return m_initialized; }

    // Zoom and pan controls
    void SetZoom(float zoom);
    float GetZoom() const { return m_zoom; }
    void SetPan(float panX, float panY);
    void ResetView();

private:
    bool CreateDeviceAndSwapChain(HWND hwnd);
    bool CreateRenderTarget();
    bool CreateShadersAndPipeline();
    bool UpdateTexture(const BYTE* pData, int width, int height, int stride);
    void UpdateVertexBuffer();

    HWND m_hwnd = nullptr;
    int m_windowWidth = 0;
    int m_windowHeight = 0;
    bool m_initialized = false;

    // D3D11 Core
    ComPtr<ID3D11Device> m_pDevice;
    ComPtr<ID3D11DeviceContext> m_pContext;
    ComPtr<IDXGISwapChain> m_pSwapChain;
    ComPtr<ID3D11RenderTargetView> m_pRTV;

    // Shaders & Pipeline
    ComPtr<ID3D11VertexShader> m_pVertexShader;
    ComPtr<ID3D11PixelShader> m_pPixelShader;
    ComPtr<ID3D11InputLayout> m_pInputLayout;
    ComPtr<ID3D11Buffer> m_pVertexBuffer;
    ComPtr<ID3D11SamplerState> m_pSampler;
    ComPtr<ID3D11RasterizerState> m_pRasterState;

    // Video Texture
    ComPtr<ID3D11Texture2D> m_pVideoTexture;
    ComPtr<ID3D11ShaderResourceView> m_pVideoSRV;
    int m_frameWidth = 0;
    int m_frameHeight = 0;

    std::mutex m_renderMutex;
    float m_zoom = 1.0f;
    float m_panX = 0.0f;
    float m_panY = 0.0f;
    bool m_hasFrame = false;
};
