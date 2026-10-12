import os
import zipfile

def create_portable():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    bin_dir = os.path.join(base_dir, "bin")
    zip_path = os.path.join(bin_dir, "Roxy_Room_Portable.zip")

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Exe
        exe_path = os.path.join(bin_dir, "RoxyRoom.exe")
        if not os.path.exists(exe_path):
            print("ERRO: RoxyRoom.exe nao encontrado!")
            return
        zf.write(exe_path, "Roxy Room/RoxyRoom.exe")
        # DLL
        dll_path = os.path.join(bin_dir, "WebView2Loader.dll")
        if os.path.exists(dll_path):
            zf.write(dll_path, "Roxy Room/WebView2Loader.dll")
        # Icon
        ico_path = os.path.join(base_dir, "src", "app.ico")
        if os.path.exists(ico_path):
            zf.write(ico_path, "Roxy Room/app.ico")
        # Web
        web_dir = os.path.join(base_dir, "web")
        for root, dirs, files in os.walk(web_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, base_dir)
                zf.write(full_path, os.path.join("Roxy Room", rel_path))

    print(f"[OK] Portable ZIP criado em: {zip_path} ({os.path.getsize(zip_path):,} bytes)")

if __name__ == "__main__":
    create_portable()
