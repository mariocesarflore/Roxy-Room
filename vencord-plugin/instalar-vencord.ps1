param(
    [switch]$SkipSelfInstall,
    [switch]$ForceClose
)

$ErrorActionPreference = "Stop"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$PluginSrc = Join-Path $PSScriptRoot "roxyRoomScreen"
$AmigoTemplate = Join-Path $PSScriptRoot "amigo-template"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$HelperExe = Join-Path $RepoRoot "bin\RoxyAudioHelper.exe"
$BuildBat = Join-Path $RepoRoot "tools\build.bat"
$VencordDir = Join-Path $env:USERPROFILE "Vencord"
$PluginDest = Join-Path $VencordDir "src\userplugins\roxyRoomScreen"
$FriendsOutDir = Join-Path $PSScriptRoot "RoxyVencord-Amigos"
$FriendsZip = Join-Path $PSScriptRoot "RoxyVencord-Amigos.zip"

Write-Host "=== Roxy Room x Vencord Builder & Installer ===" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $PluginSrc)) {
    Write-Error "Pasta do plugin nao encontrada em: $PluginSrc"
}

if (-not (Test-Path -LiteralPath $HelperExe) -and (Test-Path -LiteralPath $BuildBat)) {
    Write-Host "Compilando RoxyAudioHelper.exe (exclusao de audio do Discord)..." -ForegroundColor Yellow
    cmd.exe /c "`"$BuildBat`""
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js nao encontrado no PATH. Instale Node.js LTS (>= 22) antes de continuar."
}

$NpmGlobalPnpm = Join-Path $env:APPDATA "npm\pnpm.cmd"
$PnpmCmd = $null
if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) {
    $PnpmCmd = "pnpm.cmd"
} elseif (Test-Path -LiteralPath $NpmGlobalPnpm) {
    $PnpmCmd = $NpmGlobalPnpm
} elseif (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $PnpmCmd = "pnpm"
} else {
    Write-Host "pnpm nao encontrado. Instalando globalmente via npm..." -ForegroundColor Yellow
    npm.cmd install -g pnpm
    if (Test-Path -LiteralPath $NpmGlobalPnpm) {
        $PnpmCmd = $NpmGlobalPnpm
    } else {
        $PnpmCmd = "pnpm.cmd"
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $VencordDir "package.json"))) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Error "Git nao encontrado no PATH. Instale Git para clonar o Vencord."
    }
    Write-Host "Clonando Vencord em $VencordDir ..." -ForegroundColor Yellow
    git clone https://github.com/Vendicated/Vencord.git $VencordDir
}

Push-Location -LiteralPath $VencordDir
try {
    Write-Host "Instalando dependencias do Vencord (pnpm install)..." -ForegroundColor Cyan
    & $PnpmCmd install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
        & $PnpmCmd install
    }

    New-Item -ItemType Directory -Force -Path (Split-Path $PluginDest) | Out-Null
    if (Test-Path -LiteralPath $PluginDest) {
        Remove-Item -LiteralPath $PluginDest -Recurse -Force
    }
    Copy-Item -LiteralPath $PluginSrc -Destination $PluginDest -Recurse -Force
    Write-Host "[OK] Plugin copiado para: $PluginDest" -ForegroundColor Green

    Write-Host "Compilando Vencord com RoxyRoomScreen (pnpm build --standalone --disable-updater)..." -ForegroundColor Cyan
    & $PnpmCmd build --standalone --disable-updater
    if ($LASTEXITCODE -ne 0) {
        throw "Falha no pnpm build do Vencord."
    }
}
finally {
    Pop-Location
}

$VencordDist = Join-Path $VencordDir "dist"
if (-not (Test-Path -LiteralPath (Join-Path $VencordDist "patcher.js"))) {
    throw "Arquivos compilados nao encontrados em $VencordDist"
}

if (-not (Select-String -LiteralPath (Join-Path $VencordDist "renderer.js") -Pattern "RoxyRoomScreen" -Quiet)) {
    throw "RoxyRoomScreen nao foi embutido no renderer.js compilado!"
}

Write-Host ""
Write-Host "Montando pacote pronto para amigos em RoxyVencord-Amigos..." -ForegroundColor Cyan
if (Test-Path -LiteralPath $FriendsOutDir) {
    Remove-Item -LiteralPath $FriendsOutDir -Recurse -Force
}
$FriendsDistDir = Join-Path $FriendsOutDir "dist"
New-Item -ItemType Directory -Force -Path $FriendsDistDir | Out-Null

Get-ChildItem -LiteralPath $VencordDist -File | Where-Object { $_.Extension -ne ".map" } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $FriendsDistDir $_.Name) -Force
}
[System.IO.File]::WriteAllText((Join-Path $FriendsDistDir "package.json"), "{}", [System.Text.UTF8Encoding]::new($false))

if (Test-Path -LiteralPath $AmigoTemplate) {
    Get-ChildItem -LiteralPath $AmigoTemplate | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $FriendsOutDir $_.Name) -Recurse -Force
    }
}

if (Test-Path -LiteralPath $HelperExe) {
    Copy-Item -LiteralPath $HelperExe -Destination (Join-Path $FriendsOutDir "RoxyAudioHelper.exe") -Force
} else {
    Write-Warning "RoxyAudioHelper.exe nao encontrado em bin/. O pacote ira sem o helper de audio."
}

$BundledInstallerCli = Join-Path $VencordDist "Installer\VencordInstallerCli.exe"
if (-not (Test-Path -LiteralPath $BundledInstallerCli)) {
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path $BundledInstallerCli) | Out-Null
        Write-Host "Baixando VencordInstallerCli.exe em cache para o pacote dos amigos..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe" -OutFile $BundledInstallerCli -UseBasicParsing
    } catch {
        Write-Warning "Nao foi possivel pre-baixar VencordInstallerCli.exe; o instalador dos amigos baixara automaticamente quando executar."
    }
}
if (Test-Path -LiteralPath $BundledInstallerCli) {
    Copy-Item -LiteralPath $BundledInstallerCli -Destination (Join-Path $FriendsOutDir "VencordInstallerCli.exe") -Force
}

if (Test-Path -LiteralPath $FriendsZip) {
    Remove-Item -LiteralPath $FriendsZip -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipCreated = $false
for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
        Start-Sleep -Milliseconds (200 * $attempt)
        if (Test-Path -LiteralPath $FriendsZip) { Remove-Item -LiteralPath $FriendsZip -Force }
        [System.IO.Compression.ZipFile]::CreateFromDirectory($FriendsOutDir, $FriendsZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
        $zipCreated = $true
        break
    } catch {
        if ($attempt -eq 5) { throw }
    }
}

$zipMb = [Math]::Round((Get-Item -LiteralPath $FriendsZip).Length / 1MB, 2)
Write-Host "[OK] Pacote dos amigos gerado: $FriendsZip ($zipMb MB)" -ForegroundColor Green

if (-not $SkipSelfInstall) {
    Write-Host ""
    Write-Host "Agora instalando no SEU Discord..." -ForegroundColor Cyan
    & (Join-Path $FriendsOutDir "instalar-amigo.ps1") -ForceClose:$ForceClose
}
