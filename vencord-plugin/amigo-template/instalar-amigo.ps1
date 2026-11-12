param(
    [switch]$ForceClose
)

$ErrorActionPreference = "Stop"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$PkgDir = $PSScriptRoot
$DistSrc = Join-Path $PkgDir "dist"
$HelperSrc = Join-Path $PkgDir "RoxyAudioHelper.exe"
$LocalCliSrc = Join-Path $PkgDir "VencordInstallerCli.exe"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Roxy Room P2P para Discord (Vencord)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path -LiteralPath (Join-Path $DistSrc "patcher.js"))) {
    Write-Error "Pasta 'dist\patcher.js' nao encontrada junto ao instalador. Extraia todo o ZIP antes de rodar!"
}

# 1. Verifica Discord (e helper) abertos e fecha com seguranca antes de modificar arquivos
$procsToStop = @("Discord", "DiscordPTB", "DiscordCanary", "RoxyAudioHelper")
$runningDiscord = Get-Process -Name "Discord", "DiscordPTB", "DiscordCanary" -ErrorAction SilentlyContinue
if ($runningDiscord) {
    $shouldClose = $ForceClose
    if (-not $ForceClose) {
        Write-Host "O Discord esta aberto no momento. Ele precisa ser fechado para instalar." -ForegroundColor Yellow
        $resp = Read-Host "Deseja fechar o Discord agora automaticamente? [S/n]"
        $shouldClose = [string]::IsNullOrWhiteSpace($resp) -or $resp -match "^[sSyY]"
    }
    if ($shouldClose) {
        Get-Process -Name $procsToStop -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        for ($i = 0; $i -lt 12; $i++) {
            Start-Sleep -Milliseconds 500
            if (-not (Get-Process -Name "Discord", "DiscordPTB", "DiscordCanary" -ErrorAction SilentlyContinue)) {
                break
            }
        }
    } else {
        Write-Warning "Continuando com Discord aberto (se falhar por arquivo em uso, feche o Discord e rode novamente)."
    }
} else {
    Get-Process -Name "RoxyAudioHelper" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# Garante que o instalador oficial nunca herde caminhos dev antigos de outro ambiente
$env:VENCORD_DEV_INSTALL = $null
$env:VENCORD_USER_DATA_DIR = $null

$VencordAppData = Join-Path $env:APPDATA "Vencord"
$VencordDistDest = Join-Path $VencordAppData "dist"
$ExpectedPatcherPath = Join-Path $VencordDistDest "patcher.js"

function Get-LatestAppDir([string]$BaseDir) {
    if (-not (Test-Path -LiteralPath $BaseDir)) { return $null }
    $appDirs = Get-ChildItem -LiteralPath $BaseDir -Directory -Filter "app-*" -ErrorAction SilentlyContinue
    if (-not $appDirs) { return $null }
    return $appDirs | Sort-Object {
        $verStr = $_.Name -replace '^app-', ''
        try { [version]$verStr } catch { [version]"0.0.0.0" }
    } -Descending | Select-Object -First 1
}

function Test-VencordInjectedCorrectly([System.IO.DirectoryInfo]$AppDir, [string]$PatcherPath) {
    if (-not $AppDir) { return "missing-app" }
    $resDir = Join-Path $AppDir.FullName "resources"
    $backupAsar = Join-Path $resDir "_app.asar"
    $activeAsar = Join-Path $resDir "app.asar"
    if (-not (Test-Path -LiteralPath $backupAsar)) { return "not-injected" }
    if (-not (Test-Path -LiteralPath $activeAsar)) { return "needs-repair" }
    try {
        $raw = [System.IO.File]::ReadAllBytes($activeAsar)
        $txt = [System.Text.Encoding]::UTF8.GetString($raw)
        $escaped = $PatcherPath.Replace("\", "\\")
        if (($txt.IndexOf($PatcherPath, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
            ($txt.IndexOf($escaped, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
            return "ok"
        }
        return "wrong-target"
    } catch {
        return "needs-repair"
    }
}

function Get-VencordInstallerCli {
    if (Test-Path -LiteralPath $LocalCliSrc) {
        return $LocalCliSrc
    }
    $cliPath = Join-Path $env:TEMP "VencordInstallerCli.exe"
    Write-Host "Baixando instalador oficial do Vencord..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe" -OutFile $cliPath -UseBasicParsing
    return $cliPath
}

# 2. Verifica a versao MAIS RECENTE de cada Discord instalado
$branches = @(
    @{ Name = "stable"; Label = "Discord";       Path = Join-Path $env:LOCALAPPDATA "Discord" },
    @{ Name = "ptb";    Label = "Discord PTB";   Path = Join-Path $env:LOCALAPPDATA "DiscordPTB" },
    @{ Name = "canary"; Label = "Discord Canary"; Path = Join-Path $env:LOCALAPPDATA "DiscordCanary" }
)

$foundAnyDiscord = $false
$cliExe = $null

foreach ($b in $branches) {
    $latestApp = Get-LatestAppDir $b.Path
    if (-not $latestApp) { continue }
    $foundAnyDiscord = $true

    $state = Test-VencordInjectedCorrectly $latestApp $ExpectedPatcherPath
    if ($state -eq "ok") {
        Write-Host "[OK] Vencord ja esta injetado corretamente em $($b.Label) ($($latestApp.Name))!" -ForegroundColor Green
        continue
    }

    if (-not $cliExe) {
        $cliExe = Get-VencordInstallerCli
    }

    if ($state -eq "not-injected") {
        Write-Host "Injetando Vencord em $($b.Label) ($($latestApp.Name))..." -ForegroundColor Cyan
        & $cliExe -install -branch $b.Name
        if ($LASTEXITCODE -ne 0) {
            & $cliExe -install -location $b.Path
        }
    } else {
        Write-Host "Reparando injecao do Vencord em $($b.Label) ($($latestApp.Name)) [$state]..." -ForegroundColor Yellow
        & $cliExe -repair -branch $b.Name
        if ($LASTEXITCODE -ne 0) {
            & $cliExe -uninstall -branch $b.Name | Out-Null
            & $cliExe -install -branch $b.Name
        }
    }

    $postState = Test-VencordInjectedCorrectly $latestApp $ExpectedPatcherPath
    if ($postState -ne "ok") {
        Write-Host "Abrindo menu interativo do Vencord para selecionar seu Discord manualmente..." -ForegroundColor Yellow
        & $cliExe
    }
}

if (-not $foundAnyDiscord) {
    Write-Warning "Nenhuma pasta padrao do Discord foi encontrada em $env:LOCALAPPDATA. Abrindo instalador oficial do Vencord..."
    $cliExe = Get-VencordInstallerCli
    & $cliExe
}

# 3. Atualiza %APPDATA%\Vencord\dist de forma limpa (sem sobras antigas de builds oficiais)
New-Item -ItemType Directory -Force -Path $VencordDistDest | Out-Null
Get-ChildItem -LiteralPath $VencordDistDest -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".js", ".css", ".txt", ".map") } |
    Remove-Item -Force -ErrorAction SilentlyContinue

Get-ChildItem -LiteralPath $DistSrc -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $VencordDistDest $_.Name) -Force
}

$distPkgJson = Join-Path $VencordDistDest "package.json"
if (-not (Test-Path -LiteralPath $distPkgJson)) {
    [System.IO.File]::WriteAllText($distPkgJson, "{}", [System.Text.UTF8Encoding]::new($false))
}

$destRenderer = Join-Path $VencordDistDest "renderer.js"
if (-not (Select-String -LiteralPath $destRenderer -Pattern "RoxyRoomScreen" -Quiet)) {
    throw "Falha na verificacao: RoxyRoomScreen nao encontrado em $destRenderer."
}
Write-Host "[OK] Plugin RoxyRoomScreen instalado e verificado em: $VencordDistDest" -ForegroundColor Green

# 4. Copia o helper nativo anti-eco (RoxyAudioHelper.exe)
if (Test-Path -LiteralPath $HelperSrc) {
    $LocalRoxyDir = Join-Path $env:LOCALAPPDATA "RoxyRoom"
    New-Item -ItemType Directory -Force -Path $LocalRoxyDir | Out-Null
    Copy-Item -LiteralPath $HelperSrc -Destination (Join-Path $LocalRoxyDir "RoxyAudioHelper.exe") -Force
    Copy-Item -LiteralPath $HelperSrc -Destination (Join-Path $VencordAppData "RoxyAudioHelper.exe") -Force
    Copy-Item -LiteralPath $HelperSrc -Destination (Join-Path $VencordDistDest "RoxyAudioHelper.exe") -Force
    Write-Host "[OK] Helper anti-eco (sem voz do Discord) instalado!" -ForegroundColor Green
} else {
    Write-Warning "RoxyAudioHelper.exe nao estava no pacote. A tela transmitira sem audio para evitar eco."
}

# 5. Garante RoxyRoomScreen ativado E desativa autoUpdate do Vencord (senao ele sobrescreve o plugin!)
$SettingsDir = Join-Path $VencordAppData "settings"
$SettingsFile = Join-Path $SettingsDir "settings.json"
New-Item -ItemType Directory -Force -Path $SettingsDir | Out-Null

try {
    if (Test-Path -LiteralPath $SettingsFile) {
        $rawJson = Get-Content -LiteralPath $SettingsFile -Raw -Encoding UTF8
        $cfg = $rawJson | ConvertFrom-Json
    } else {
        $cfg = [PSCustomObject]@{}
    }

    if ($cfg.PSObject.Properties.Name -contains "autoUpdate") {
        $cfg.autoUpdate = $false
    } else {
        $cfg | Add-Member -NotePropertyName "autoUpdate" -NotePropertyValue $false
    }

    if ($cfg.PSObject.Properties.Name -contains "autoUpdateNotification") {
        $cfg.autoUpdateNotification = $false
    } else {
        $cfg | Add-Member -NotePropertyName "autoUpdateNotification" -NotePropertyValue $false
    }

    if (-not ($cfg.PSObject.Properties.Name -contains "plugins")) {
        $cfg | Add-Member -NotePropertyName "plugins" -NotePropertyValue ([PSCustomObject]@{})
    }

    if ($cfg.plugins.PSObject.Properties.Name -contains "RoxyRoomScreen") {
        $cfg.plugins.RoxyRoomScreen.enabled = $true
    } else {
        $cfg.plugins | Add-Member -NotePropertyName "RoxyRoomScreen" -NotePropertyValue ([PSCustomObject]@{ enabled = $true })
    }

    $jsonOut = $cfg | ConvertTo-Json -Depth 15
    [System.IO.File]::WriteAllText($SettingsFile, $jsonOut, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[OK] Plugin RoxyRoomScreen ativado e auto-update do Vencord protegido!" -ForegroundColor Green
} catch {
    Write-Warning "Nao foi possivel atualizar settings.json ($($_.Exception.Message)). Ative RoxyRoomScreen manualmente em Configuracoes -> Vencord -> Plugins."
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  INSTALACAO CONCLUIDA COM SUCESSO!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host "Agora abra o Discord, entre em uma call de voz e use o botao Roxy!" -ForegroundColor White
