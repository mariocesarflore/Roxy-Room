@echo off
cd /d "%~dp0\.."
if not exist bin mkdir bin

where cl >nul 2>&1 || if exist "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

set WV2_INC=packages\webview2\include
set WV2_LIB=packages\webview2\lib

rc /fo bin\app.res src\app.rc

cl /EHsc /std:c++17 /utf-8 /O2 /Ob3 /Ot /Oi /Oy /Gy /Gw /GL /fp:fast /W1 ^
   src\main.cpp ^
   src\TrayIcon.cpp ^
   src\HotkeyManager.cpp ^
   src\AudioExclusionCapturer.cpp ^
   src\DXGICapturer.cpp ^
   src\WebStreamServer.cpp ^
   src\D3D11Renderer.cpp ^
   src\NativePlayerWindow.cpp ^
   src\DiscordManager.cpp ^
   bin\app.res ^
   /I src /I "%WV2_INC%" ^
   /Fe:bin\RoxyRoom.exe ^
   /D UNICODE /D _UNICODE /D NDEBUG ^
   /link ^
   "%WV2_LIB%\WebView2LoaderStatic.lib" ^
   mmdevapi.lib avrt.lib d3d11.lib dxgi.lib d3dcompiler.lib ^
   ws2_32.lib advapi32.lib crypt32.lib winhttp.lib ^
   user32.lib shell32.lib ole32.lib gdi32.lib ^
   shlwapi.lib version.lib dwmapi.lib ^
   /SUBSYSTEM:WINDOWS /ENTRY:WinMainCRTStartup /OPT:REF /OPT:ICF /LTCG /DYNAMICBASE /NXCOMPAT

if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] FALHA NA COMPILACAO!
    del /Q *.obj bin\app.res 2>nul
    exit /b 1
)

echo [OK] COMPILACAO CONCLUIDA COM SUCESSO!
echo [OK] Executavel gerado em: bin\RoxyRoom.exe
copy /Y "packages\webview2\lib\WebView2Loader.dll" bin\ >nul 2>&1
if not exist bin\web mkdir bin\web
xcopy /E /I /Y web bin\web >nul 2>&1
del /Q *.obj bin\app.res 2>nul

echo.
echo Compilando helper de audio sem eco para Vencord...
cl /EHsc /std:c++17 /utf-8 /O2 /Ob3 /Ot /Oi /Oy /Gy /Gw /GL /fp:fast /W1 ^
   src\AudioHelperMain.cpp ^
   src\AudioExclusionCapturer.cpp ^
   src\WebStreamServer.cpp ^
   /I src ^
   /Fe:bin\RoxyAudioHelper.exe ^
   /D UNICODE /D _UNICODE /D NDEBUG ^
   /link ^
   mmdevapi.lib avrt.lib ws2_32.lib advapi32.lib crypt32.lib ole32.lib ^
   /SUBSYSTEM:CONSOLE /OPT:REF /OPT:ICF /LTCG /DYNAMICBASE /NXCOMPAT

if %ERRORLEVEL% == 0 (
    echo [OK] RoxyAudioHelper.exe gerado com sucesso!
    if not exist "%LOCALAPPDATA%\RoxyRoom" mkdir "%LOCALAPPDATA%\RoxyRoom"
    copy /Y "bin\RoxyAudioHelper.exe" "%LOCALAPPDATA%\RoxyRoom\RoxyAudioHelper.exe" >nul 2>&1
) else (
    echo [AVISO] Falha ao compilar RoxyAudioHelper.exe.
)
del /Q *.obj 2>nul
