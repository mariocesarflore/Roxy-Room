import os
import sys
import json
import zipfile
import subprocess

def get_base_dir():
    # Tools folder is one level below project root
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def compile_installer(base_dir, bin_dir):
    print("   -> Criando payload do instalador...")
    zip_path = os.path.join(bin_dir, "app_payload.zip")
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        roxy_exe = os.path.join(bin_dir, "RoxyRoom.exe")
        if not os.path.exists(roxy_exe):
            print("   [ERRO] RoxyRoom.exe nao encontrado! Compile primeiro.")
            return False
        zf.write(roxy_exe, "RoxyRoom.exe")

        dll_path = os.path.join(bin_dir, "WebView2Loader.dll")
        if os.path.exists(dll_path):
            zf.write(dll_path, "WebView2Loader.dll")

        ico_path = os.path.join(base_dir, "src", "app.ico")
        if os.path.exists(ico_path):
            zf.write(ico_path, "app.ico")

        web_dir = os.path.join(base_dir, "web")
        for root, dirs, files in os.walk(web_dir):
            for file in files:
                file_full = os.path.join(root, file)
                rel_path = os.path.relpath(file_full, base_dir)
                zf.write(file_full, rel_path)

    header_path = os.path.join(base_dir, "src", "payload_data.h")
    with open(zip_path, "rb") as f:
        data = f.read()

    with open(header_path, "w") as hf:
        hf.write("#pragma once\n")
        hf.write(f"#define PAYLOAD_ZIP_SIZE {len(data)}\n")
        hf.write("static const unsigned char PAYLOAD_ZIP_DATA[] = {\n")
        chunk_size = 32
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            hex_str = ", ".join(f"0x{b:02X}" for b in chunk)
            hf.write("    " + hex_str + ",\n")
        hf.write("};\n")

    print("   -> Compilando instalador nativo (Roxy Room Setup.exe)...")
    vcvars_prefix = ""
    import shutil
    if not shutil.which("cl"):
        candidates = [
            r"C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
            r"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat",
            r"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
            r"C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat",
        ]
        for c in candidates:
            if os.path.exists(c):
                vcvars_prefix = f'call "{c}" && '
                break

    installer_exe = os.path.join(bin_dir, "Roxy Room Setup.exe")
    cmd = f'{vcvars_prefix}rc /fo bin\\installer.res src\\app.rc && cl /EHsc /std:c++17 /O2 /W1 src\\installer.cpp bin\\installer.res /I src /Fe:"{installer_exe}" /D UNICODE /D _UNICODE /link comctl32.lib shell32.lib shlwapi.lib ole32.lib advapi32.lib user32.lib gdi32.lib /SUBSYSTEM:WINDOWS /ENTRY:WinMainCRTStartup'
    proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=base_dir)

    for temp_file in [zip_path, header_path, os.path.join(bin_dir, "installer.res"), os.path.join(base_dir, "installer.obj")]:
        if os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except Exception:
                pass

    return proc.returncode == 0

def main():
    base_dir = get_base_dir()
    os.chdir(base_dir)

    version_file = os.path.join(base_dir, "version.json")
    if os.path.exists(version_file) and len(sys.argv) <= 1:
        with open(version_file, "r", encoding="utf-8") as f:
            vdata = json.load(f)
            new_version = vdata.get("version", "1.1.0")
            changelog = vdata.get("changelog", "Otimizacao Suprema: Bitrate adaptativo ABR, 1080p nativo para jogos, zero-copy socket e aceleracao D3D11.")
    else:
        new_version = sys.argv[1] if len(sys.argv) > 1 else "1.1.0"
        changelog = sys.argv[2] if len(sys.argv) > 2 else "Otimizacao Suprema: Bitrate adaptativo ABR, 1080p nativo para jogos, zero-copy socket e aceleracao D3D11."

    print("==================================================")
    print(f"  Roxy Room - Empacotador de Releases v{new_version}")
    print("==================================================")

    # 1. Update version.json
    version_data = {
        "version": new_version,
        "name": "Roxy Room",
        "changelog": changelog,
        "downloadUrl": f"https://github.com/mariocesarflore/Roxy-Room/releases/latest/download/RoxyRoom-Update.zip",
        "setupUrl": f"https://github.com/mariocesarflore/Roxy-Room/releases/latest/download/Roxy.Room.Setup.exe"
    }

    with open(version_file, "w", encoding="utf-8") as f:
        json.dump(version_data, f, indent=2, ensure_ascii=False)
    print(f"[1/4] version.json atualizado para v{new_version}")

    # 2. Build binaries using build.bat
    print("[2/4] Compilando executavel do Roxy Room...")
    build_bat = os.path.join(base_dir, "tools", "build.bat")
    proc = subprocess.run(f'cmd /c "{build_bat}"', shell=True, capture_output=True, text=True, cwd=base_dir)
    if proc.returncode != 0:
        print("[ERRO] Falha ao compilar:")
        print(proc.stdout)
        print(proc.stderr)
        return 1

    # 3. Create RoxyRoom-Update.zip
    bin_dir = os.path.join(base_dir, "bin")
    zip_path = os.path.join(bin_dir, "RoxyRoom-Update.zip")
    print(f"[3/4] Gerando pacote de atualizacao automatica: {zip_path}...")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        exe_path = os.path.join(bin_dir, "RoxyRoom.exe")
        if os.path.exists(exe_path):
            zf.write(exe_path, "RoxyRoom.exe")
        dll_path = os.path.join(bin_dir, "WebView2Loader.dll")
        if os.path.exists(dll_path):
            zf.write(dll_path, "WebView2Loader.dll")
        ico_path = os.path.join(base_dir, "src", "app.ico")
        if os.path.exists(ico_path):
            zf.write(ico_path, "app.ico")
        web_dir = os.path.join(base_dir, "web")
        for root, dirs, files in os.walk(web_dir):
            for file in files:
                full_file = os.path.join(root, file)
                rel_file = os.path.relpath(full_file, base_dir)
                zf.write(full_file, rel_file)

    print(f"      RoxyRoom-Update.zip gerado com sucesso!")

    # 4. Generate new setup installer
    print("[4/4] Gerando instalador standalone (Roxy Room Setup.exe)...")
    if compile_installer(base_dir, bin_dir):
        print(f"      Instalador gerado com sucesso em bin/Roxy Room Setup.exe!")
    else:
        print("      [AVISO] Nao foi possivel gerar o instalador.")

    print("\n==================================================")
    print("  SUCESSO! Release empacotada com sucesso.")
    print("==================================================")
    print("Arquivos prontos para anexo em Releases no GitHub:")
    print("  - bin/RoxyRoom-Update.zip")
    print("  - bin/Roxy Room Setup.exe\n")
    return 0

if __name__ == "__main__":
    sys.exit(main())
