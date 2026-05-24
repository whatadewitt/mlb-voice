# One-keystroke demo (PowerShell): boots the TTS server, kicks HLS, runs a
# named scenario, then waits on the server until Ctrl-C.
#
# Usage: .\scripts\demo.ps1 standard|homer|ads
#   Env: $env:TTS_BACKEND='stub' (or openai/dia2, default dia2)
param([Parameter(Mandatory = $true)][ValidateSet('standard', 'homer', 'ads')][string]$Scenario)

$ErrorActionPreference = 'Stop'

$file = switch ($Scenario) {
    'standard' { 'scenarios/standard_game.yaml' }
    'homer'    { 'scenarios/go_ahead_homer.yaml' }
    'ads'      { 'scenarios/inning_break_into_ads.yaml' }
}

# Clean state.
Get-ChildItem -Path queue -Filter *.wav -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem -Path hls -Filter *.ts -ErrorAction SilentlyContinue | Remove-Item -Force
if (Test-Path hls/playlist.m3u8) { Remove-Item hls/playlist.m3u8 -Force }

$backend = if ($env:TTS_BACKEND) { $env:TTS_BACKEND } else { 'dia2' }
Write-Host "-> Starting TTS server (backend=$backend)..."
$server = Start-Process -PassThru -NoNewWindow -FilePath 'uv' -ArgumentList 'run', 'python', 'server.py'

try {
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $r = Invoke-WebRequest -Uri 'http://localhost:5025/health' -UseBasicParsing -TimeoutSec 1
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw 'server did not become healthy within 30s' }

    Invoke-WebRequest -Uri 'http://localhost:5025/start_hls' -Method POST -UseBasicParsing | Out-Null
    Write-Host ""
    Write-Host "-> Running scenario: $Scenario ($file)"
    & node src/scenarios/run.js $file
    Write-Host "-> Scenario complete. Server PID $($server.Id) still running; Ctrl-C to stop."
    Wait-Process -Id $server.Id
} finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
}
