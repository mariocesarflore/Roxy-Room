#include "D3D11Renderer.h"
#include <d3dcompiler.h>
#include <iostream>
#include <algorithm>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "d3dcompiler.lib")

struct Vertex {
    float x, y, z;
    float u, v;
};

// HLSL Shaders
static const char* g_vertexShaderSource = R"(
struct VS_INPUT {
    float3 pos : POSITION;
    float2 tex : TEXCOORD0;
};
struct PS_INPUT {
    float4 pos : SV_POSITION;
    float2 tex : TEXCOORD0;
};
PS_INPUT main(VS_INPUT input) {
    PS_INPUT output;
    output.pos = float4(input.pos, 1.0f);
    output.tex = input.tex;
    return output;
}
)";

static const char* g_pixelShaderSource = R"(
Texture2D texVideo : register(t0);
SamplerState sampLinear : register(s0);

struct PS_INPUT {
    float4 pos : SV_POSITION;
    float2 tex : TEXCOORD0;
};

float4 main(PS_INPUT input) : SV_TARGET {
    return texVideo.Sample(sampLinear, input.tex);
}
)";

D3D11Renderer::D3D11Renderer() {}

D3D11Renderer::~D3D11Renderer() {
    Cleanup();
}

void D3D11Renderer::Cleanup() {
    std::lock_guard<std::mutex> lock(m_renderMutex);
    m_initialized = false;
    m_hasFrame = false;

    m_pVideoSRV.Reset();
    m_pVideoTexture.Reset();
    m_pRasterState.Reset();
    m_pSampler.Reset();
    m_pVertexBuffer.Reset();
    m_pInputLayout.Reset();
    m_pPixelShader.Reset();
    m_pVertexShader.Reset();
    m_pRTV.Reset();
    m_pSwapChain.Reset();
    if (m_pContext) {
        m_pContext->ClearState();
        m_pContext->Flush();
        m_pContext.Reset();
    }
    m_pDevice.Reset();
}

bool D3D11Renderer::Initialize(HWND hwnd) {
    Cleanup();

    if (!hwnd || !IsWindow(hwnd)) return false;
    m_hwnd = hwnd;

    RECT rc;
    GetClientRect(hwnd, &rc);
    m_windowWidth = std::max(1, (int)(rc.right - rc.left));
    m_windowHeight = std::max(1, (int)(rc.bottom - rc.top));

    if (!CreateDeviceAndSwapChain(hwnd)) {
        std::wcerr << L"[D3D11Renderer] Falha ao criar D3D11 Device e SwapChain." << std::endl;
        return false;
    }

    if (!CreateRenderTarget()) {
        std::wcerr << L"[D3D11Renderer] Falha ao criar RenderTargetView." << std::endl;
        return false;
    }

    if (!CreateShadersAndPipeline()) {
        std::wcerr << L"[D3D11Renderer] Falha ao criar shaders e pipeline D3D11." << std::endl;
        return false;
    }

    m_initialized = true;
    std::wcout << L"[D3D11Renderer] Inicializado com sucesso para janela HWND: " << hwnd << std::endl;
    return true;
}

bool D3D11Renderer::CreateDeviceAndSwapChain(HWND hwnd) {
    DXGI_SWAP_CHAIN_DESC scDesc = {};
    scDesc.BufferCount = 2;
    scDesc.BufferDesc.Width = m_windowWidth;
    scDesc.BufferDesc.Height = m_windowHeight;
    scDesc.BufferDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    scDesc.BufferDesc.RefreshRate.Numerator = 60;
    scDesc.BufferDesc.RefreshRate.Denominator = 1;
    scDesc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    scDesc.OutputWindow = hwnd;
    scDesc.SampleDesc.Count = 1;
    scDesc.SampleDesc.Quality = 0;
    scDesc.Windowed = TRUE;
    scDesc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
    scDesc.Flags = 0;

    UINT createFlags = 0;
#if defined(_DEBUG)
    createFlags |= D3D11_CREATE_DEVICE_DEBUG;
#endif

    D3D_FEATURE_LEVEL featureLevels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
        D3D_FEATURE_LEVEL_10_1,
        D3D_FEATURE_LEVEL_10_0
    };
    D3D_FEATURE_LEVEL featureLevel;

    // First try hardware acceleration
    HRESULT hr = D3D11CreateDeviceAndSwapChain(
        nullptr,
        D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        createFlags,
        featureLevels,
        ARRAYSIZE(featureLevels),
        D3D11_SDK_VERSION,
        &scDesc,
        &m_pSwapChain,
        &m_pDevice,
        &featureLevel,
        &m_pContext
    );

    // If hardware is unavailable (very old PC or VM), fall back to WARP (high-speed software rasterizer)
    if (FAILED(hr)) {
        std::wcout << L"[D3D11Renderer] Aceleracao de hardware indisponivel. Ativando driver WARP de software..." << std::endl;
        hr = D3D11CreateDeviceAndSwapChain(
            nullptr,
            D3D_DRIVER_TYPE_WARP,
            nullptr,
            createFlags,
            featureLevels,
            ARRAYSIZE(featureLevels),
            D3D11_SDK_VERSION,
            &scDesc,
            &m_pSwapChain,
            &m_pDevice,
            &featureLevel,
            &m_pContext
        );
    }

    return SUCCEEDED(hr);
}

bool D3D11Renderer::CreateRenderTarget() {
    if (!m_pSwapChain || !m_pDevice) return false;

    ComPtr<ID3D11Texture2D> pBackBuffer;
    HRESULT hr = m_pSwapChain->GetBuffer(0, IID_PPV_ARGS(&pBackBuffer));
    if (FAILED(hr) || !pBackBuffer) return false;

    hr = m_pDevice->CreateRenderTargetView(pBackBuffer.Get(), nullptr, &m_pRTV);
    return SUCCEEDED(hr);
}

bool D3D11Renderer::CreateShadersAndPipeline() {
    ComPtr<ID3DBlob> vsBlob, psBlob, errBlob;

    // Compile Vertex Shader
    HRESULT hr = D3DCompile(
        g_vertexShaderSource, strlen(g_vertexShaderSource),
        "VS", nullptr, nullptr, "main", "vs_4_0", 0, 0, &vsBlob, &errBlob
    );
    if (FAILED(hr)) {
        if (errBlob) {
            std::cerr << "[D3D11Renderer] VS Error: " << (char*)errBlob->GetBufferPointer() << std::endl;
        }
        return false;
    }

    hr = m_pDevice->CreateVertexShader(vsBlob->GetBufferPointer(), vsBlob->GetBufferSize(), nullptr, &m_pVertexShader);
    if (FAILED(hr)) return false;

    // Input Layout
    D3D11_INPUT_ELEMENT_DESC layoutDesc[] = {
        { "POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0 },
        { "TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 12, D3D11_INPUT_PER_VERTEX_DATA, 0 }
    };
    hr = m_pDevice->CreateInputLayout(layoutDesc, ARRAYSIZE(layoutDesc), vsBlob->GetBufferPointer(), vsBlob->GetBufferSize(), &m_pInputLayout);
    if (FAILED(hr)) return false;

    // Compile Pixel Shader
    hr = D3DCompile(
        g_pixelShaderSource, strlen(g_pixelShaderSource),
        "PS", nullptr, nullptr, "main", "ps_4_0", 0, 0, &psBlob, &errBlob
    );
    if (FAILED(hr)) {
        if (errBlob) {
            std::cerr << "[D3D11Renderer] PS Error: " << (char*)errBlob->GetBufferPointer() << std::endl;
        }
        return false;
    }

    hr = m_pDevice->CreatePixelShader(psBlob->GetBufferPointer(), psBlob->GetBufferSize(), nullptr, &m_pPixelShader);
    if (FAILED(hr)) return false;

    // Sampler State: Bilinear filtering with clamp for sharp, clean scaling
    D3D11_SAMPLER_DESC sampDesc = {};
    sampDesc.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sampDesc.AddressU = D3D11_TEXTURE_ADDRESS_CLAMP;
    sampDesc.AddressV = D3D11_TEXTURE_ADDRESS_CLAMP;
    sampDesc.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    sampDesc.ComparisonFunc = D3D11_COMPARISON_NEVER;
    sampDesc.MinLOD = 0;
    sampDesc.MaxLOD = D3D11_FLOAT32_MAX;
    hr = m_pDevice->CreateSamplerState(&sampDesc, &m_pSampler);
    if (FAILED(hr)) return false;

    // Rasterizer State: No culling, fill solid
    D3D11_RASTERIZER_DESC rastDesc = {};
    rastDesc.FillMode = D3D11_FILL_SOLID;
    rastDesc.CullMode = D3D11_CULL_NONE;
    rastDesc.DepthClipEnable = FALSE;
    hr = m_pDevice->CreateRasterizerState(&rastDesc, &m_pRasterState);
    if (FAILED(hr)) return false;

    // Vertex Buffer: Dynamic buffer for quad
    D3D11_BUFFER_DESC vbDesc = {};
    vbDesc.ByteWidth = sizeof(Vertex) * 6;
    vbDesc.Usage = D3D11_USAGE_DYNAMIC;
    vbDesc.BindFlags = D3D11_BIND_VERTEX_BUFFER;
    vbDesc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    hr = m_pDevice->CreateBuffer(&vbDesc, nullptr, &m_pVertexBuffer);
    if (FAILED(hr)) return false;

    UpdateVertexBuffer();
    return true;
}

void D3D11Renderer::UpdateVertexBuffer() {
    if (!m_pVertexBuffer || !m_pContext) return;

    // Calculate aspect ratio preserving quad dimensions (Letterboxing/Pillarboxing)
    float quadW = 1.0f;
    float quadH = 1.0f;

    if (m_frameWidth > 0 && m_frameHeight > 0 && m_windowWidth > 0 && m_windowHeight > 0) {
        float srcAspect = (float)m_frameWidth / (float)m_frameHeight;
        float dstAspect = (float)m_windowWidth / (float)m_windowHeight;

        if (srcAspect > dstAspect) {
            // Source is wider -> letterbox (black bars top/bottom)
            quadW = 1.0f;
            quadH = dstAspect / srcAspect;
        } else {
            // Source is taller -> pillarbox (black bars left/right)
            quadW = srcAspect / dstAspect;
            quadH = 1.0f;
        }
    }

    // Apply zoom and pan
    quadW *= m_zoom;
    quadH *= m_zoom;

    float left = -quadW + m_panX;
    float right = quadW + m_panX;
    float top = quadH + m_panY;
    float bottom = -quadH + m_panY;

    Vertex vertices[6] = {
        // Triangle 1
        { left,  top,    0.0f, 0.0f, 0.0f },
        { right, top,    0.0f, 1.0f, 0.0f },
        { left,  bottom, 0.0f, 0.0f, 1.0f },
        // Triangle 2
        { right, top,    0.0f, 1.0f, 0.0f },
        { right, bottom, 0.0f, 1.0f, 1.0f },
        { left,  bottom, 0.0f, 0.0f, 1.0f },
    };

    D3D11_MAPPED_SUBRESOURCE mapped;
    if (SUCCEEDED(m_pContext->Map(m_pVertexBuffer.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped))) {
        memcpy(mapped.pData, vertices, sizeof(vertices));
        m_pContext->Unmap(m_pVertexBuffer.Get(), 0);
    }
}

void D3D11Renderer::Resize(int width, int height) {
    std::lock_guard<std::mutex> lock(m_renderMutex);
    if (!m_initialized || !m_pSwapChain || width <= 0 || height <= 0) return;

    m_windowWidth = width;
    m_windowHeight = height;

    m_pContext->OMSetRenderTargets(0, nullptr, nullptr);
    m_pRTV.Reset();

    HRESULT hr = m_pSwapChain->ResizeBuffers(0, width, height, DXGI_FORMAT_UNKNOWN, 0);
    if (SUCCEEDED(hr)) {
        CreateRenderTarget();
        UpdateVertexBuffer();
    }
}

bool D3D11Renderer::UpdateTexture(const BYTE* pData, int width, int height, int stride) {
    if (!m_pDevice || !m_pContext || !pData || width <= 0 || height <= 0) return false;

    // If texture dimensions changed, recreate texture and SRV
    if (!m_pVideoTexture || m_frameWidth != width || m_frameHeight != height) {
        m_pVideoSRV.Reset();
        m_pVideoTexture.Reset();

        D3D11_TEXTURE2D_DESC texDesc = {};
        texDesc.Width = width;
        texDesc.Height = height;
        texDesc.MipLevels = 1;
        texDesc.ArraySize = 1;
        texDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        texDesc.SampleDesc.Count = 1;
        texDesc.Usage = D3D11_USAGE_DYNAMIC;
        texDesc.BindFlags = D3D11_BIND_SHADER_RESOURCE;
        texDesc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;

        HRESULT hr = m_pDevice->CreateTexture2D(&texDesc, nullptr, &m_pVideoTexture);
        if (FAILED(hr) || !m_pVideoTexture) return false;

        D3D11_SHADER_RESOURCE_VIEW_DESC srvDesc = {};
        srvDesc.Format = texDesc.Format;
        srvDesc.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
        srvDesc.Texture2D.MipLevels = 1;

        hr = m_pDevice->CreateShaderResourceView(m_pVideoTexture.Get(), &srvDesc, &m_pVideoSRV);
        if (FAILED(hr) || !m_pVideoSRV) return false;

        m_frameWidth = width;
        m_frameHeight = height;
        UpdateVertexBuffer();
    }

    // Direct GPU Map / Unmap upload (Zero intermediate memory allocations!)
    D3D11_MAPPED_SUBRESOURCE mapped;
    HRESULT hr = m_pContext->Map(m_pVideoTexture.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped);
    if (SUCCEEDED(hr)) {
        BYTE* pDst = (BYTE*)mapped.pData;
        const BYTE* pSrc = pData;
        UINT srcPitch = (stride > 0) ? stride : (width * 4);
        UINT dstPitch = mapped.RowPitch;
        UINT rowBytes = width * 4;

        if (srcPitch == dstPitch && dstPitch == rowBytes) {
            memcpy(pDst, pSrc, rowBytes * height);
        } else {
            for (int y = 0; y < height; ++y) {
                memcpy(pDst + y * dstPitch, pSrc + y * srcPitch, rowBytes);
            }
        }
        m_pContext->Unmap(m_pVideoTexture.Get(), 0);
        m_hasFrame = true;
        return true;
    }

    return false;
}

bool D3D11Renderer::UpdateFrame(const BYTE* pData, int width, int height, int stride) {
    std::lock_guard<std::mutex> lock(m_renderMutex);
    if (!m_initialized) return false;

    if (UpdateTexture(pData, width, height, stride)) {
        Render();
        return true;
    }
    return false;
}

void D3D11Renderer::Render() {
    if (!m_initialized || !m_pContext || !m_pRTV || !m_pSwapChain) return;

    // Clear background to RoxyRoom dark theme color (#060911)
    const float clearColor[4] = { 6.0f / 255.0f, 9.0f / 255.0f, 17.0f / 255.0f, 1.0f };
    m_pContext->ClearRenderTargetView(m_pRTV.Get(), clearColor);

    if (m_hasFrame && m_pVideoSRV) {
        // Set Viewport
        D3D11_VIEWPORT vp = {};
        vp.Width = (float)m_windowWidth;
        vp.Height = (float)m_windowHeight;
        vp.MinDepth = 0.0f;
        vp.MaxDepth = 1.0f;
        m_pContext->RSSetViewports(1, &vp);

        // Bind Render Target
        ID3D11RenderTargetView* rtvList[] = { m_pRTV.Get() };
        m_pContext->OMSetRenderTargets(1, rtvList, nullptr);

        // Set Pipeline State
        m_pContext->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        m_pContext->IASetInputLayout(m_pInputLayout.Get());

        UINT stride = sizeof(Vertex);
        UINT offset = 0;
        m_pContext->IASetVertexBuffers(0, 1, m_pVertexBuffer.GetAddressOf(), &stride, &offset);

        m_pContext->VSSetShader(m_pVertexShader.Get(), nullptr, 0);
        m_pContext->PSSetShader(m_pPixelShader.Get(), nullptr, 0);

        ID3D11ShaderResourceView* srvList[] = { m_pVideoSRV.Get() };
        m_pContext->PSSetShaderResources(0, 1, srvList);

        ID3D11SamplerState* samplerList[] = { m_pSampler.Get() };
        m_pContext->PSSetSamplers(0, 1, samplerList);

        m_pContext->RSSetState(m_pRasterState.Get());

        // Draw quad
        m_pContext->Draw(6, 0);
    }

    // Present with V-Sync (1) for smooth, tearing-free display with minimum power usage
    m_pSwapChain->Present(1, 0);
}

void D3D11Renderer::SetZoom(float zoom) {
    std::lock_guard<std::mutex> lock(m_renderMutex);
    m_zoom = zoom;
    UpdateVertexBuffer();
}

void D3D11Renderer::SetPan(float panX, float panY) {
    std::lock_guard<std::mutex> lock(m_renderMutex);
    m_panX = panX;
    m_panY = panY;
    UpdateVertexBuffer();
}

void D3D11Renderer::ResetView() {
    std::lock_guard<std::mutex> lock(m_renderMutex);
    m_zoom = 1.0f;
    m_panX = 0.0f;
    m_panY = 0.0f;
    UpdateVertexBuffer();
}
