@echo off
cd /d "%~dp0\.."
if not exist bin mkdir bin

call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

set WV2_INC=packages\webview2\include
set WV2_LIB=packages\webview2\lib

rc /fo bin\app.res src\app.rc

cl /EHsc /std:c++17 /utf-8 /O2 /W1 ^
   src\main.cpp ^
   src\TrayIcon.cpp ^
   src\HotkeyManager.cpp ^
   src\AudioExclusionCapturer.cpp ^
   src\DXGICapturer.cpp ^
   src\WebStreamServer.cpp ^
   src\D3D11Renderer.cpp ^
   src\NativePlayerWindow.cpp ^
   bin\app.res ^
   /I src /I "%WV2_INC%" ^
   /Fe:bin\RoxyRoom.exe ^
   /D UNICODE /D _UNICODE ^
   /link ^
   "%WV2_LIB%\WebView2LoaderStatic.lib" ^
   mmdevapi.lib avrt.lib d3d11.lib dxgi.lib d3dcompiler.lib ^
   ws2_32.lib advapi32.lib crypt32.lib ^
   user32.lib shell32.lib ole32.lib gdi32.lib ^
   shlwapi.lib version.lib dwmapi.lib ^
   /SUBSYSTEM:WINDOWS /ENTRY:WinMainCRTStartup

if %ERRORLEVEL% == 0 (
    echo [OK] COMPILACAO CONCLUIDA COM SUCESSO!
    echo [OK] Executavel gerado em: bin\RoxyRoom.exe
    copy /Y "packages\webview2\lib\WebView2Loader.dll" bin\ >nul 2>&1
    if not exist bin\web mkdir bin\web
    xcopy /E /I /Y web bin\web >nul 2>&1
    del /Q *.obj bin\app.res 2>nul
) else (
    echo [ERRO] FALHA NA COMPILACAO!
    del /Q *.obj bin\app.res 2>nul
)
