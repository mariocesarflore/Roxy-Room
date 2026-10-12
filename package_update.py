import os
import sys
import json
import zipfile
import subprocess

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)

    new_version = sys.argv[1] if len(sys.argv) > 1 else "1.0.1"
    changelog = sys.argv[2] if len(sys.argv) > 2 else "Melhorias gerais e atualizações do sistema."

    print("==================================================")
    print(f"  Roxy Room - Empacotador de Atualizações v{new_version}")
    print("==================================================")

    # 1. Update version.json
    version_file = os.path.join(base_dir, "version.json")
    version_data = {
        "version": new_version,
        "name": "Roxy Room",
        "changelog": changelog,
        "downloadUrl": f"https://github.com/mariocesarflore/Roxy-Room/releases/latest/download/RoxyRoom-Update.zip",
        "setupUrl": f"https://github.com/mariocesarflore/Roxy-Room/releases/latest/download/Roxy.Room.Setup.exe"
    }

    with open(version_file, "w", encoding="utf-8") as f:
        json.dump(version_data, f, indent=2, ensure_ascii=False)
    print(f"[1/4] version.json atualizado para a versao {new_version}!")

    # 2. Build binaries using build.bat
    print("[2/4] Compilando executavel do Roxy Room...")
    build_bat = os.path.join(base_dir, "build.bat")
    proc = subprocess.run(f'cmd /c "{build_bat}"', shell=True, capture_output=True, text=True)
    if proc.returncode != 0:
        print("[ERRO] Falha ao compilar bin/RoxyRoom.exe:")
        print(proc.stdout)
        print(proc.stderr)
        return 1

    # 3. Create RoxyRoom-Update.zip
    bin_dir = os.path.join(base_dir, "bin")
    zip_path = os.path.join(bin_dir, "RoxyRoom-Update.zip")
    print(f"[3/4] Gerando pacote de atualizacao: {zip_path}...")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # Exe
        exe_path = os.path.join(bin_dir, "RoxyRoom.exe")
        if os.path.exists(exe_path):
            zf.write(exe_path, "RoxyRoom.exe")
        # DLL
        dll_path = os.path.join(bin_dir, "WebView2Loader.dll")
        if os.path.exists(dll_path):
            zf.write(dll_path, "WebView2Loader.dll")
        # Icon
        ico_path = os.path.join(base_dir, "src", "app.ico")
        if os.path.exists(ico_path):
            zf.write(ico_path, "app.ico")
        # Web files
        web_dir = os.path.join(base_dir, "web")
        for root, dirs, files in os.walk(web_dir):
            for file in files:
                full_file = os.path.join(root, file)
                rel_file = os.path.relpath(full_file, base_dir)
                zf.write(full_file, rel_file)

    print(f"      RoxyRoom-Update.zip gerado com sucesso! ({os.path.getsize(zip_path):,} bytes)")

    # 4. Generate new setup installer
    print("[4/4] Gerando instalador para novos usuarios (Roxy Room Setup.exe)...")
    installer_proc = subprocess.run([sys.executable, "build_installer.py"], capture_output=True, text=True)
    if installer_proc.returncode != 0:
        print("[AVISO] Nao foi possivel gerar instalador completo automaticamente:")
        print(installer_proc.stdout)
    else:
        print("      Instalador gerado com sucesso em bin/Roxy Room Setup.exe!")

    print("\n==================================================")
    print("  SUCESSO! Pacote de atualizacao pronto.")
    print("==================================================")
    print("Proximos passos para enviar ao seu GitHub:")
    print("1. git add .")
    print(f'2. git commit -m "Release v{new_version}"')
    print(f"3. git tag v{new_version}")
    print("4. git push origin main --tags")
    print("\nNo GitHub, va em Releases -> Create a new release:")
    print(f"  - Tag: v{new_version}")
    print("  - Anexe os arquivos da pasta 'bin':")
    print("     * RoxyRoom-Update.zip (para quem ja tem o app atualizar sozinho!)")
    print("     * Roxy Room Setup.exe (para novos usuarios instalarem)")
    print("==================================================\n")
    return 0

if __name__ == "__main__":
    sys.exit(main())
