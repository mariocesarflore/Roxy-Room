#include "AudioExclusionCapturer.h"
#include <iostream>
#include <algorithm>
#include <cstdio>
#include <cstdint>
#include <memory>
#include <sstream>
#include <avrt.h>
#include <Psapi.h>
#include <wrl.h>
#include <wrl/implements.h>

#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "avrt.lib")
#pragma comment(lib, "ole32.lib")

using namespace Microsoft::WRL;

static const IID IID_IAudioClient_Local = __uuidof(IAudioClient);
static const IID IID_IAudioCaptureClient_Local = __uuidof(IAudioCaptureClient);

AudioExclusionCapturer::AudioExclusionCapturer() {
    m_hStopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
}

AudioExclusionCapturer::~AudioExclusionCapturer() {
    StopCapture();
    if (m_hStopEvent) {
        CloseHandle(m_hStopEvent);
        m_hStopEvent = nullptr;
    }
}

DWORD AudioExclusionCapturer::FindProcessId(const std::wstring& processName) {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return 0;

    PROCESSENTRY32W processEntry;
    processEntry.dwSize = sizeof(processEntry);

    std::vector<PROCESSENTRY32W> matches;
    if (Process32FirstW(snapshot, &processEntry)) {
        do {
            if (_wcsicmp(processEntry.szExeFile, processName.c_str()) == 0) {
                matches.push_back(processEntry);
            }
        } while (Process32NextW(snapshot, &processEntry));
    }
    CloseHandle(snapshot);

    if (matches.empty()) return 0;

    // To exclude the entire tree, find the root process whose parent is not another process with the same name
    for (const auto& candidate : matches) {
        bool parentIsMatch = false;
        for (const auto& other : matches) {
            if (candidate.th32ParentProcessID == other.th32ProcessID) {
                parentIsMatch = true;
                break;
            }
        }
        if (!parentIsMatch) {
            std::wcout << L"[AudioExclusionCapturer] Processo raiz de " << processName 
                       << L" encontrado: PID " << candidate.th32ProcessID << std::endl;
            return candidate.th32ProcessID;
        }
    }

    return matches[0].th32ProcessID;
}

DWORD AudioExclusionCapturer::GetRootProcessId(DWORD pid) {
    if (pid == 0) return 0;

    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return pid;

    PROCESSENTRY32W pe;
    pe.dwSize = sizeof(pe);

    std::wstring targetExe;
    std::vector<PROCESSENTRY32W> allProcs;

    if (Process32FirstW(snapshot, &pe)) {
        do {
            allProcs.push_back(pe);
            if (pe.th32ProcessID == pid) {
                targetExe = pe.szExeFile;
            }
        } while (Process32NextW(snapshot, &pe));
    }
    CloseHandle(snapshot);

    if (targetExe.empty()) return pid;

    // Walk up the tree as long as the parent has the same executable name (with cycle detection)
    DWORD currentPid = pid;
    std::vector<DWORD> visited;
    visited.push_back(currentPid);
    bool foundParent = true;
    int maxHops = 32;

    while (foundParent && maxHops-- > 0) {
        foundParent = false;
        for (const auto& p : allProcs) {
            if (p.th32ProcessID == currentPid) {
                for (const auto& parent : allProcs) {
                    if (parent.th32ProcessID == p.th32ParentProcessID &&
                        parent.th32ProcessID != currentPid &&
                        std::find(visited.begin(), visited.end(), parent.th32ProcessID) == visited.end() &&
                        _wcsicmp(parent.szExeFile, targetExe.c_str()) == 0) {
                        currentPid = parent.th32ProcessID;
                        visited.push_back(currentPid);
                        foundParent = true;
                        break;
                    }
                }
                break;
            }
        }
    }

    std::wcout << L"[AudioExclusionCapturer] PID fornecido: " << pid 
               << L" -> PID Raiz resolvido: " << currentPid 
               << L" (" << targetExe << L")" << std::endl;
    return currentPid;
}

static std::wstring GetProcessExeName(DWORD pid) {
    HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!hProc) return L"";
    WCHAR exePath[MAX_PATH] = {};
    DWORD size = MAX_PATH;
    if (QueryFullProcessImageNameW(hProc, 0, exePath, &size)) {
        CloseHandle(hProc);
        std::wstring full(exePath);
        auto pos = full.find_last_of(L"\\/");
        return (pos != std::wstring::npos) ? full.substr(pos + 1) : full;
    }
    CloseHandle(hProc);
    return L"";
}

std::vector<AudioAppInfo> AudioExclusionCapturer::EnumerateAudioApps() {
    std::vector<AudioAppInfo> result;
    std::vector<std::wstring> seenExes;

    HRESULT hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);
    bool needUninit = (hr == S_OK || hr == S_FALSE);

    IMMDeviceEnumerator* pEnumerator = NULL;
    IMMDevice* pDevice = NULL;
    IAudioSessionManager2* pSessionManager = NULL;
    IAudioSessionEnumerator* pSessionEnumerator = NULL;

    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), NULL, CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator), (void**)&pEnumerator);
    if (FAILED(hr) || !pEnumerator) goto cleanup;

    hr = pEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &pDevice);
    if (FAILED(hr) || !pDevice) goto cleanup;

    hr = pDevice->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, NULL, (void**)&pSessionManager);
    if (FAILED(hr) || !pSessionManager) goto cleanup;

    hr = pSessionManager->GetSessionEnumerator(&pSessionEnumerator);
    if (FAILED(hr) || !pSessionEnumerator) goto cleanup;

    {
        int count = 0;
        pSessionEnumerator->GetCount(&count);

        for (int i = 0; i < count; i++) {
            IAudioSessionControl* pSessionCtrl = NULL;
            IAudioSessionControl2* pSessionCtrl2 = NULL;

            hr = pSessionEnumerator->GetSession(i, &pSessionCtrl);
            if (FAILED(hr) || !pSessionCtrl) continue;

            hr = pSessionCtrl->QueryInterface(__uuidof(IAudioSessionControl2), (void**)&pSessionCtrl2);
            if (FAILED(hr) || !pSessionCtrl2) {
                pSessionCtrl->Release();
                continue;
            }

            if (pSessionCtrl2->IsSystemSoundsSession() == S_OK) {
                pSessionCtrl2->Release();
                pSessionCtrl->Release();
                continue;
            }

            DWORD pid = 0;
            pSessionCtrl2->GetProcessId(&pid);

            if (pid == 0) {
                pSessionCtrl2->Release();
                pSessionCtrl->Release();
                continue;
            }

            std::wstring exeName = GetProcessExeName(pid);
            if (exeName.empty()) {
                pSessionCtrl2->Release();
                pSessionCtrl->Release();
                continue;
            }

            // Deduplicate by exe name so multiple Discord/Chrome audio sessions become ONE entry
            std::wstring lowerExe = exeName;
            for (auto& c : lowerExe) c = towlower(c);
            bool alreadySeen = false;
            for (const auto& s : seenExes) {
                if (s == lowerExe) { alreadySeen = true; break; }
            }
            if (alreadySeen) {
                pSessionCtrl2->Release();
                pSessionCtrl->Release();
                continue;
            }
            seenExes.push_back(lowerExe);

            // Get root PID for this process tree
            DWORD rootPid = GetRootProcessId(pid);

            LPWSTR displayName = NULL;
            pSessionCtrl->GetDisplayName(&displayName);
            std::wstring name;
            if (displayName && wcslen(displayName) > 0) {
                name = displayName;
                CoTaskMemFree(displayName);
            }

            if (name.empty()) {
                name = exeName;
                auto dotPos = name.find_last_of(L'.');
                if (dotPos != std::wstring::npos) {
                    name = name.substr(0, dotPos);
                }
            }

            AudioAppInfo info;
            info.pid = rootPid;
            info.displayName = name;
            info.exeName = exeName;
            result.push_back(info);
        }
    }

    // Ensure Discord is always in the list if running on the system
    {
        DWORD discordPid = FindProcessId(L"Discord.exe");
        if (!discordPid) discordPid = FindProcessId(L"DiscordCanary.exe");
        if (!discordPid) discordPid = FindProcessId(L"DiscordPTB.exe");
        if (discordPid) {
            bool discordSeen = false;
            for (const auto& s : seenExes) {
                if (s.find(L"discord") != std::wstring::npos) {
                    discordSeen = true;
                    break;
                }
            }
            if (!discordSeen) {
                AudioAppInfo info;
                info.pid = GetRootProcessId(discordPid);
                info.displayName = L"Discord (Voz e Áudio)";
                info.exeName = L"Discord.exe";
                result.insert(result.begin(), info);
            }
        }
    }

cleanup:
    if (pSessionEnumerator) pSessionEnumerator->Release();
    if (pSessionManager) pSessionManager->Release();
    if (pDevice) pDevice->Release();
    if (pEnumerator) pEnumerator->Release();
    if (needUninit) CoUninitialize();

    return result;
}

// Agile completion handler required by Windows ActivateAudioInterfaceAsync
class ActivateAudioInterfaceCompletionHandler : 
    public RuntimeClass<RuntimeClassFlags<ClassicCom>, IActivateAudioInterfaceCompletionHandler, FtmBase> {
public:
    HANDLE hEvent = CreateEvent(NULL, FALSE, FALSE, NULL);
    HRESULT hrResult = E_FAIL;
    HRESULT hrActivate = E_FAIL;
    ComPtr<IAudioClient> audioClient;

    ~ActivateAudioInterfaceCompletionHandler() {
        if (hEvent) CloseHandle(hEvent);
    }

    STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
        IUnknown* unk = NULL;
        hrResult = operation->GetActivateResult(&hrActivate, &unk);
        if (SUCCEEDED(hrResult) && SUCCEEDED(hrActivate) && unk) {
            unk->QueryInterface(IID_PPV_ARGS(&audioClient));
            unk->Release();
        } else {
            std::wcerr << L"[AudioCapturer] GetActivateResult falhou: hr=0x" << std::hex << hrResult 
                       << L" hrActivate=0x" << hrActivate << std::endl;
        }
        SetEvent(hEvent);
        return S_OK;
    }
};

bool AudioExclusionCapturer::StartCapture(DWORD excludePid, AudioCallback callback) {
    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_isCapturing) return true;

    if (m_captureThread.joinable()) m_captureThread.join();
    if (m_hStopEvent) ResetEvent(m_hStopEvent);
    m_audioCallback = callback;
    m_isCapturing = true;
    m_captureThread = std::thread(&AudioExclusionCapturer::CaptureThreadFunc, this, excludePid);
    return true;
}

void AudioExclusionCapturer::StopCapture() {
    m_isCapturing = false;
    if (m_hStopEvent) {
        SetEvent(m_hStopEvent);
    }
    if (m_captureThread.joinable()) {
        m_captureThread.join();
    }
}

// Convert any WASAPI audio format into guaranteed normalized 32-bit Float
static void ConvertToFloat32(const BYTE* pSrcData, UINT32 numFrames, const WAVEFORMATEX* pwfx, std::vector<float>& outFloats) {
    if (!pSrcData || numFrames == 0 || !pwfx) return;

    UINT32 channels = pwfx->nChannels;
    UINT32 totalSamples = numFrames * channels;
    if (outFloats.size() < totalSamples) {
        outFloats.resize(totalSamples);
    }
    float* pDst = outFloats.data();

    WORD formatTag = pwfx->wFormatTag;
    WORD bitsPerSample = pwfx->wBitsPerSample;
    bool isFloat = (formatTag == WAVE_FORMAT_IEEE_FLOAT);

    if (formatTag == WAVE_FORMAT_EXTENSIBLE && pwfx->cbSize >= 22) {
        const WAVEFORMATEXTENSIBLE* pExt = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(pwfx);
        if (pExt->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) {
            isFloat = true;
        } else if (pExt->SubFormat == KSDATAFORMAT_SUBTYPE_PCM) {
            isFloat = false;
        }
    }

    if (isFloat) {
        if (bitsPerSample == 32) {
            // Already 32-bit float, direct fast copy
            memcpy(pDst, pSrcData, totalSamples * sizeof(float));
            return;
        } else if (bitsPerSample == 64) {
            const double* pSrc = reinterpret_cast<const double*>(pSrcData);
            for (UINT32 i = 0; i < totalSamples; ++i) {
                pDst[i] = static_cast<float>(pSrc[i]);
            }
            return;
        }
    }

    // Integer PCM formats
    if (bitsPerSample == 16) {
        const int16_t* pSrc = reinterpret_cast<const int16_t*>(pSrcData);
        for (UINT32 i = 0; i < totalSamples; ++i) {
            pDst[i] = pSrc[i] / 32768.0f;
        }
    } else if (bitsPerSample == 24) {
        const BYTE* pSrc = pSrcData;
        for (UINT32 i = 0; i < totalSamples; ++i) {
            int32_t val = (static_cast<int32_t>(pSrc[0])) |
                          (static_cast<int32_t>(pSrc[1]) << 8) |
                          (static_cast<int32_t>(static_cast<int8_t>(pSrc[2])) << 16);
            pDst[i] = val / 8388608.0f;
            pSrc += 3;
        }
    } else if (bitsPerSample == 32) {
        const int32_t* pSrc = reinterpret_cast<const int32_t*>(pSrcData);
        for (UINT32 i = 0; i < totalSamples; ++i) {
            pDst[i] = pSrc[i] / 2147483648.0f;
        }
    } else if (bitsPerSample == 8) {
        const uint8_t* pSrc = reinterpret_cast<const uint8_t*>(pSrcData);
        for (UINT32 i = 0; i < totalSamples; ++i) {
            pDst[i] = (static_cast<int32_t>(pSrc[i]) - 128) / 128.0f;
        }
    } else {
        memset(pDst, 0, totalSamples * sizeof(float));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log em arquivo (%TEMP%\RoxyRoom_audio.log). O app e SUBSYSTEM:WINDOWS, entao
// std::wcout nao aparece em lugar nenhum - este log permite diagnosticar o audio.
// ─────────────────────────────────────────────────────────────────────────────
static std::wstring AudioLogPath() {
    WCHAR tmp[MAX_PATH] = {};
    DWORD n = GetTempPathW(MAX_PATH, tmp);
    if (n == 0 || n >= MAX_PATH) return L"";
    return std::wstring(tmp, n) + L"RoxyRoom_audio.log";
}

static void AudioLog(const std::wstring& msg) {
    static std::mutex s_logMutex;
    std::lock_guard<std::mutex> lk(s_logMutex);
    std::wstring path = AudioLogPath();
    if (path.empty()) return;
    FILE* f = nullptr;
    if (_wfopen_s(&f, path.c_str(), L"a+, ccs=UTF-8") != 0 || !f) return;
    SYSTEMTIME st;
    GetLocalTime(&st);
    fwprintf(f, L"[%02d:%02d:%02d.%03d] %ls\n", st.wHour, st.wMinute, st.wSecond, st.wMilliseconds, msg.c_str());
    fclose(f);
}

static void RotateAudioLog() {
    std::wstring path = AudioLogPath();
    if (path.empty()) return;
    WIN32_FILE_ATTRIBUTE_DATA info;
    if (GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &info)) {
        if (info.nFileSizeHigh > 0 || info.nFileSizeLow > 1024 * 1024) DeleteFileW(path.c_str());
    }
}

static std::wstring HrStr(HRESULT hr) {
    wchar_t b[24];
    swprintf_s(b, L"0x%08X", (unsigned)hr);
    return b;
}

static std::wstring FmtStr(const WAVEFORMATEX* f) {
    if (!f) return L"(null)";
    std::wostringstream ss;
    ss << f->nSamplesPerSec << L"Hz " << f->nChannels << L"ch " << f->wBitsPerSample << L"bit tag=0x"
       << std::hex << f->wFormatTag;
    return ss.str();
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalizacao: qualquer formato de entrada -> float32 ESTEREO 48000 Hz.
// O lado JS assume exatamente esse formato; antes o C++ mandava o formato nativo
// do dispositivo (44.1k, 96k, 5.1, 7.1...) e o som saia errado ou mudo.
// ─────────────────────────────────────────────────────────────────────────────
static void DownmixToStereo(const float* in, UINT32 frames, UINT32 ch, std::vector<float>& st) {
    st.resize((size_t)frames * 2);
    const float k = 0.70710678f;
    float gain = 1.0f;
    if (ch == 4) gain = 1.0f / (1.0f + k);
    else if (ch >= 5 && ch < 8) gain = 1.0f / (1.0f + 2.0f * k);
    else if (ch >= 8) gain = 1.0f / (1.0f + 3.0f * k);

    for (UINT32 f = 0; f < frames; ++f) {
        const float* s = in + (size_t)f * ch;
        float l, r;
        if (ch == 1) {
            l = r = s[0];
        } else if (ch == 2) {
            l = s[0]; r = s[1];
        } else if (ch == 4) {              // quad: FL FR BL BR
            l = s[0] + s[2] * k;
            r = s[1] + s[3] * k;
            l *= gain; r *= gain;
        } else {                           // 3, 5, 6, 8+: FL FR FC LFE BL BR (SL SR)
            l = s[0]; r = s[1];
            float c = s[2] * k;
            l += c; r += c;
            if (ch >= 6) { l += s[4] * k; r += s[5] * k; }
            if (ch >= 8) { l += s[6] * k; r += s[7] * k; }
            l *= gain; r *= gain;
        }
        st[(size_t)f * 2]     = l;
        st[(size_t)f * 2 + 1] = r;
    }
}

class StereoResampler48k {
public:
    void Configure(UINT32 srcRate, UINT32 srcChannels) {
        m_ch = srcChannels ? srcChannels : 2;
        m_step = (srcRate && srcRate != 48000) ? (double)srcRate / 48000.0 : 1.0;
        m_pos = 0.0;
        m_prevL = m_prevR = 0.0f;
    }

    // in: float intercalado (srcChannels); out: estereo 48k intercalado (append)
    void Process(const float* in, UINT32 frames, std::vector<float>& out) {
        if (!in || frames == 0) return;
        DownmixToStereo(in, frames, m_ch, m_tmp);

        if (m_step == 1.0) {
            out.insert(out.end(), m_tmp.begin(), m_tmp.end());
            return;
        }

        // Interpolacao linear com estado entre pacotes. a[0] = amostra anterior, a[1..n] = atual.
        const double n = (double)frames;
        double p = m_pos;
        auto sample = [&](size_t k, int c) -> float {
            if (k == 0) return c == 0 ? m_prevL : m_prevR;
            return m_tmp[(k - 1) * 2 + c];
        };
        while (p < n) {
            size_t k = (size_t)p;
            float fr = (float)(p - (double)k);
            out.push_back(sample(k, 0) * (1.0f - fr) + sample(k + 1, 0) * fr);
            out.push_back(sample(k, 1) * (1.0f - fr) + sample(k + 1, 1) * fr);
            p += m_step;
        }
        m_pos = p - n;
        m_prevL = m_tmp[(size_t)(frames - 1) * 2];
        m_prevR = m_tmp[(size_t)(frames - 1) * 2 + 1];
    }

private:
    UINT32 m_ch = 2;
    double m_step = 1.0;
    double m_pos = 0.0;
    float m_prevL = 0.0f, m_prevR = 0.0f;
    std::vector<float> m_tmp;
};

// Ativa o cliente de Process Loopback (modo EXCLUDE: captura tudo MENOS a arvore do PID).
static ComPtr<IAudioClient> ActivateProcessLoopbackClient(DWORD rootPid) {
    AUDIOCLIENT_ACTIVATION_PARAMS params = {};
    params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.TargetProcessId = rootPid;
    params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

    PROPVARIANT activateParams = {};
    activateParams.vt = VT_BLOB;
    activateParams.blob.cbSize = sizeof(params);
    activateParams.blob.pBlobData = (BYTE*)&params;

    auto handler = Make<ActivateAudioInterfaceCompletionHandler>();
    ComPtr<IActivateAudioInterfaceAsyncOperation> asyncOp;

    HRESULT hr = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        IID_IAudioClient_Local,
        &activateParams,
        handler.Get(),
        &asyncOp);
    if (FAILED(hr)) {
        AudioLog(L"ActivateAudioInterfaceAsync falhou: " + HrStr(hr) +
                 L" (exclusao por processo exige Windows 10 versao 2004 / build 19041 ou superior)");
        return nullptr;
    }

    if (WaitForSingleObject(handler->hEvent, 5000) != WAIT_OBJECT_0) {
        AudioLog(L"Timeout aguardando ativacao do Process Loopback");
        return nullptr;
    }
    if (!handler->audioClient) {
        AudioLog(L"Process Loopback nao ativou: hrResult=" + HrStr(handler->hrResult) +
                 L" hrActivate=" + HrStr(handler->hrActivate));
        return nullptr;
    }
    return handler->audioClient;
}

void AudioExclusionCapturer::ReportStatus(const std::wstring& state) {
    AudioLog(L"Status do audio: " + state);
    if (m_statusCallback) {
        try { m_statusCallback(state); } catch (...) {}
    }
}

struct HandleGuard {
    HANDLE h = nullptr;
    ~HandleGuard() { if (h) CloseHandle(h); }
};

AudioExclusionCapturer::SessionResult AudioExclusionCapturer::RunSession(DWORD excludePid) {
    ComPtr<IMMDeviceEnumerator> pEnumerator;
    ComPtr<IMMDevice> pDevice;
    ComPtr<IAudioClient> pClient;
    ComPtr<IAudioCaptureClient> pCapture;
    HandleGuard eventGuard;

    // 1) Dispositivo de saida padrao + formato de mixagem
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&pEnumerator));
    if (FAILED(hr)) { AudioLog(L"CoCreateInstance(MMDeviceEnumerator) falhou: " + HrStr(hr)); return SessionResult::Failed; }

    hr = pEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &pDevice);
    if (FAILED(hr) || !pDevice) { AudioLog(L"Sem dispositivo de saida padrao: " + HrStr(hr)); return SessionResult::Failed; }

    std::unique_ptr<WAVEFORMATEX, void(*)(WAVEFORMATEX*)> mixFmt(nullptr, [](WAVEFORMATEX* p) { CoTaskMemFree(p); });
    {
        ComPtr<IAudioClient> probe;
        hr = pDevice->Activate(IID_IAudioClient_Local, CLSCTX_ALL, nullptr, reinterpret_cast<void**>(probe.GetAddressOf()));
        if (FAILED(hr) || !probe) { AudioLog(L"Activate(IAudioClient) falhou: " + HrStr(hr)); return SessionResult::Failed; }
        WAVEFORMATEX* raw = nullptr;
        hr = probe->GetMixFormat(&raw);
        if (FAILED(hr) || !raw) { AudioLog(L"GetMixFormat falhou: " + HrStr(hr)); return SessionResult::Failed; }
        mixFmt.reset(raw);
    }
    AudioLog(L"Dispositivo padrao, formato de mixagem: " + FmtStr(mixFmt.get()));

    // Formato de saida garantido para o JS: float32 estereo 48 kHz
    WAVEFORMATEX ourFmt = {};
    ourFmt.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    ourFmt.nChannels = 2;
    ourFmt.nSamplesPerSec = 48000;
    ourFmt.wBitsPerSample = 32;
    ourFmt.nBlockAlign = ourFmt.nChannels * sizeof(float);
    ourFmt.nAvgBytesPerSec = ourFmt.nSamplesPerSec * ourFmt.nBlockAlign;
    ourFmt.cbSize = 0;
    m_waveFormat = ourFmt;

    const WAVEFORMATEX* capFmt = nullptr;
    bool eventMode = false;
    bool exclusionActive = false;

    // 2) Modo EXCLUIR APP: Process Loopback
    if (excludePid != 0) {
        DWORD rootPid = GetRootProcessId(excludePid);
        AudioLog(L"Tentando Process Loopback EXCLUDE, PID raiz = " + std::to_wstring(rootPid));

        const DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                            AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
        const WAVEFORMATEX* candidates[2] = { &ourFmt, mixFmt.get() };

        for (const WAVEFORMATEX* cand : candidates) {
            ComPtr<IAudioClient> c = ActivateProcessLoopbackClient(rootPid);
            if (!c) break;   // ativacao falhou: tentar outro formato nao adianta
            hr = c->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, cand, nullptr);
            if (SUCCEEDED(hr)) {
                pClient = c;
                capFmt = cand;
                eventMode = true;
                exclusionActive = true;
                AudioLog(L"Process Loopback EXCLUDE ativo com formato " + FmtStr(cand));
                break;
            }
            AudioLog(L"Initialize do Process Loopback falhou (" + FmtStr(cand) + L"): " + HrStr(hr));
        }
    }

    // 3) Fallback / modo TODO O SOM: loopback padrao do dispositivo (formato nativo, convertido por nos)
    if (!pClient) {
        ComPtr<IAudioClient> c;
        hr = pDevice->Activate(IID_IAudioClient_Local, CLSCTX_ALL, nullptr, reinterpret_cast<void**>(c.GetAddressOf()));
        if (FAILED(hr) || !c) { AudioLog(L"Activate(loopback) falhou: " + HrStr(hr)); return SessionResult::Failed; }

        hr = c->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 1000000, 0, mixFmt.get(), nullptr);
        if (FAILED(hr)) { AudioLog(L"Initialize(loopback) falhou: " + HrStr(hr)); return SessionResult::Failed; }

        pClient = c;
        capFmt = mixFmt.get();
        eventMode = false;
    }

    ReportStatus(exclusionActive ? L"exclude" : (excludePid != 0 ? L"fallback" : L"all"));

    if (eventMode) {
        eventGuard.h = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        if (!eventGuard.h || FAILED(pClient->SetEventHandle(eventGuard.h))) {
            AudioLog(L"SetEventHandle falhou");
            return SessionResult::Failed;
        }
    }

    hr = pClient->GetService(IID_IAudioCaptureClient_Local, reinterpret_cast<void**>(pCapture.GetAddressOf()));
    if (FAILED(hr) || !pCapture) { AudioLog(L"GetService(IAudioCaptureClient) falhou: " + HrStr(hr)); return SessionResult::Failed; }

    hr = pClient->Start();
    if (FAILED(hr)) { AudioLog(L"Start falhou: " + HrStr(hr)); return SessionResult::Failed; }
    AudioLog(L"Captura iniciada. Formato de captura: " + FmtStr(capFmt) + L" -> saida 48000Hz 2ch float");

    StereoResampler48k resampler;
    resampler.Configure(capFmt->nSamplesPerSec, capFmt->nChannels);

    std::vector<float> conv;
    std::vector<float> outStereo;
    HANDLE waits[2] = { m_hStopEvent, eventGuard.h };
    const DWORD nWaits = eventGuard.h ? 2 : 1;
    const DWORD timeoutMs = eventGuard.h ? 30 : 8;

    SessionResult result = SessionResult::Stopped;
    ULONGLONG lastStat = GetTickCount64();
    UINT64 packets = 0, silentPackets = 0;
    float peak = 0.0f;
    bool done = false;

    while (m_isCapturing && !done) {
        DWORD w = WaitForMultipleObjects(nWaits, waits, FALSE, timeoutMs);
        if (w == WAIT_OBJECT_0) break;   // evento de parada
        if (!m_isCapturing) break;

        // Drena todos os pacotes disponiveis
        for (;;) {
            UINT32 pktFrames = 0;
            hr = pCapture->GetNextPacketSize(&pktFrames);
            if (FAILED(hr)) {
                AudioLog(L"GetNextPacketSize falhou: " + HrStr(hr));
                result = (hr == AUDCLNT_E_DEVICE_INVALIDATED || hr == AUDCLNT_E_SERVICE_NOT_RUNNING)
                             ? SessionResult::DeviceLost : SessionResult::Failed;
                done = true;
                break;
            }
            if (pktFrames == 0) break;

            BYTE* pData = nullptr;
            UINT32 frames = 0;
            DWORD fl = 0;
            hr = pCapture->GetBuffer(&pData, &frames, &fl, nullptr, nullptr);
            if (FAILED(hr)) {
                AudioLog(L"GetBuffer falhou: " + HrStr(hr));
                result = (hr == AUDCLNT_E_DEVICE_INVALIDATED) ? SessionResult::DeviceLost : SessionResult::Failed;
                done = true;
                break;
            }
            if (hr == AUDCLNT_S_BUFFER_EMPTY || frames == 0) break;

            ++packets;
            if (m_audioCallback && (fl & AUDCLNT_BUFFERFLAGS_SILENT) == 0) {
                ConvertToFloat32(pData, frames, capFmt, conv);
                outStereo.clear();
                resampler.Process(conv.data(), frames, outStereo);
                if (!outStereo.empty()) {
                    for (float v : outStereo) { float a = v < 0 ? -v : v; if (a > peak) peak = a; }
                    m_audioCallback(reinterpret_cast<const BYTE*>(outStereo.data()),
                                    (UINT32)(outStereo.size() / 2), &m_waveFormat);
                }
            } else {
                ++silentPackets;
            }
            pCapture->ReleaseBuffer(frames);
        }

        ULONGLONG now = GetTickCount64();
        if (now - lastStat >= 10000) {
            AudioLog(L"Stats 10s: pacotes=" + std::to_wstring(packets) + L" silenciosos=" +
                     std::to_wstring(silentPackets) + L" pico=" + std::to_wstring(peak));
            lastStat = now;
            packets = silentPackets = 0;
            peak = 0.0f;
        }
    }

    pClient->Stop();
    return result;
}

void AudioExclusionCapturer::CaptureThreadFunc(DWORD excludePid) {
    HRESULT hrInit = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    RotateAudioLog();
    AudioLog(L"==== Nova captura de audio (excludePid=" + std::to_wstring(excludePid) + L") ====");

    DWORD taskIndex = 0;
    HANDLE hTask = AvSetMmThreadCharacteristicsW(L"Audio", &taskIndex);

    int failures = 0;
    while (m_isCapturing) {
        SessionResult r = RunSession(excludePid);   // ComPtrs liberados antes do CoUninitialize
        if (r == SessionResult::Stopped || !m_isCapturing) break;

        if (r == SessionResult::Failed) {
            if (++failures >= 3) {
                ReportStatus(L"failed");
                break;
            }
        } else {
            AudioLog(L"Dispositivo de audio mudou/foi removido, reiniciando captura...");
            failures = 0;
        }
        if (m_hStopEvent && WaitForSingleObject(m_hStopEvent, 700) == WAIT_OBJECT_0) break;
    }

    if (hTask) AvRevertMmThreadCharacteristics(hTask);
    AudioLog(L"Captura de audio encerrada");
    if (SUCCEEDED(hrInit)) CoUninitialize();
}
