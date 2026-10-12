import os
import sys
import zipfile
import subprocess

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)

    bin_dir = os.path.join(base_dir, "bin")
    os.makedirs(bin_dir, exist_ok=True)

    zip_path = os.path.join(bin_dir, "app_payload.zip")
    print(f"[1/4] Criando pacote do aplicativo: {zip_path}...")

    # Pack files into zip
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Main exe
        roxy_exe = os.path.join(bin_dir, "RoxyRoom.exe")
        if os.path.exists(roxy_exe):
            zf.write(roxy_exe, "RoxyRoom.exe")
        else:
            print("ERRO: Executavel RoxyRoom.exe nao encontrado! Execute build.bat primeiro.")
            return 1

        # DLL
        dll_path = os.path.join(bin_dir, "WebView2Loader.dll")
        if os.path.exists(dll_path):
            zf.write(dll_path, "WebView2Loader.dll")

        # Icon
        ico_path = os.path.join(base_dir, "src", "app.ico")
        if os.path.exists(ico_path):
            zf.write(ico_path, "app.ico")

        # Web folder
        web_dir = os.path.join(base_dir, "web")
        for root, dirs, files in os.walk(web_dir):
            for file in files:
                file_full = os.path.join(root, file)
                rel_path = os.path.relpath(file_full, base_dir)
                zf.write(file_full, rel_path)

    zip_size = os.path.getsize(zip_path)
    print(f"      Pacote compactado com sucesso! Tamanho: {zip_size:,} bytes")

    # Generate src/payload_data.h
    print("[2/4] Gerando header C++ com dados do payload...")
    header_path = os.path.join(base_dir, "src", "payload_data.h")
    with open(zip_path, "rb") as f:
        data = f.read()

    with open(header_path, "w") as hf:
        hf.write("#pragma once\n")
        hf.write(f"#define PAYLOAD_ZIP_SIZE {len(data)}\n")
        hf.write("static const unsigned char PAYLOAD_ZIP_DATA[] = {\n")
        
        # Write bytes in chunks
        chunk_size = 32
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            hex_str = ", ".join(f"0x{b:02X}" for b in chunk)
            hf.write("    " + hex_str + ",\n")
        
        hf.write("};\n")
    print(f"      src/payload_data.h gerado.")

    # Compile installer
    print("[3/4] Compilando instalador nativo Win32 (Roxy Room Setup.exe)...")
    vcvars = r"C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    
    installer_exe = os.path.join(bin_dir, "Roxy Room Setup.exe")
    
    cmd = f'call "{vcvars}" && rc /fo bin\\installer.res src\\app.rc && cl /EHsc /std:c++17 /O2 /W1 src\\installer.cpp bin\\installer.res /I src /Fe:"{installer_exe}" /D UNICODE /D _UNICODE /link comctl32.lib shell32.lib shlwapi.lib ole32.lib advapi32.lib user32.lib gdi32.lib /SUBSYSTEM:WINDOWS /ENTRY:WinMainCRTStartup'
    
    proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if proc.returncode != 0:
        print("ERRO na compilacao do instalador:")
        print(proc.stdout)
        print(proc.stderr)
        return 1

    print("[4/4] INSTALADOR CRIADO COM SUCESSO!")
    print(f"      Arquivo gerado: {installer_exe}")
    print(f"      Tamanho do instalador: {os.path.getsize(installer_exe):,} bytes")

    # Cleanup temporary build files
    for temp_file in [zip_path, header_path, os.path.join(bin_dir, "installer.res"), "installer.obj"]:
        if os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except Exception:
                pass

    return 0

if __name__ == "__main__":
    sys.exit(main())
