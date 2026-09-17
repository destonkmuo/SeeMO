# SeeMO voice pipeline — Windows (PowerShell) setup + launcher.
#
# Mirrors start.sh but runs natively on Windows without Git Bash:
#   1. downloads the prebuilt whisper.cpp CPU binary (whisper-cli.exe)
#   2. downloads the whisper models (tiny for wake word, base for commands)
#   3. creates a Python virtualenv and installs numpy + sounddevice
#   4. launches pipeline.py
#
# Usage (PowerShell):
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\start.ps1
#
# Requires: git (optional), Python 3.10+ on PATH.
#   winget install Git.Git Python.Python.3.12

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$VendorDir = Join-Path $Root 'vendor'
$WhisperBinDir = Join-Path $VendorDir 'whisper-bin'
$ModelDir = Join-Path $Root 'models'
$VenvDir = Join-Path $Root '.venv'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'

function Write-Setup($msg) { Write-Host "[setup] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[error] $msg" -ForegroundColor Red; exit 1 }

# 0. Check for python
$PythonBin = $null
foreach ($candidate in @('py', 'python', 'python3')) {
  if (Get-Command $candidate -ErrorAction SilentlyContinue) { $PythonBin = $candidate; break }
}
if (-not $PythonBin) {
  Fail "python not found — install Python 3.10+ from https://www.python.org/downloads (check 'Add to PATH') or run: winget install Python.Python.3.12"
}
Write-Setup "using python: $PythonBin"

# 1. Prebuilt whisper.cpp binary (no MSVC/CMake build required)
$WhisperCli = $null
foreach ($candidate in @(
  (Join-Path $WhisperBinDir 'whisper-cli.exe'),
  (Join-Path $VendorDir 'whisper.cpp\build\bin\Release\whisper-cli.exe')
)) {
  if (Test-Path $candidate) { $WhisperCli = $candidate; break }
}
if (-not $WhisperCli) {
  $ZipUrl = 'https://github.com/ggerganov/whisper.cpp/releases/latest/download/whisper-bin-x64.zip'
  $ZipPath = Join-Path $VendorDir 'whisper-bin-x64.zip'
  New-Item -ItemType Directory -Force -Path $VendorDir, $WhisperBinDir | Out-Null
  Write-Setup 'downloading prebuilt whisper.cpp for Windows'
  try {
    Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
  } catch {
    Fail "failed to download whisper-bin-x64.zip from $ZipUrl : $_"
  }
  Write-Setup 'extracting whisper-bin-x64.zip'
  Expand-Archive -Path $ZipPath -DestinationPath $WhisperBinDir -Force
  $WhisperCli = Get-ChildItem -Path $WhisperBinDir -Recurse -Filter 'whisper-cli.exe' |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $WhisperCli) {
    # Very old zips shipped main.exe instead of whisper-cli.exe.
    $WhisperCli = Get-ChildItem -Path $WhisperBinDir -Recurse -Filter 'main.exe' |
      Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $WhisperCli) { Fail 'whisper-cli.exe not found after extracting whisper-bin-x64.zip' }
}
Write-Setup "whisper-cli: $WhisperCli"

# 2. Download whisper models
$Models = @(
  @{ Name = 'tiny'; Size = '~75MB' },
  @{ Name = 'base'; Size = '~142MB' }
)
New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null
foreach ($m in $Models) {
  $dest = Join-Path $ModelDir "ggml-$($m.Name).bin"
  if (Test-Path $dest) {
    Write-Setup "model ggml-$($m.Name).bin already present"
    continue
  }
  $url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$($m.Name).bin"
  Write-Setup "downloading ggml-$($m.Name).bin ($($m.Size))"
  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  } catch {
    Fail "failed to download ggml-$($m.Name).bin : $_"
  }
}

# 3. Python virtualenv + deps
if (-not (Test-Path $VenvPython)) {
  Write-Setup 'creating python virtualenv'
  if ($PythonBin -eq 'py') {
    & py -3 -m venv $VenvDir
  } else {
    & $PythonBin -m venv $VenvDir
  }
  if (-not (Test-Path $VenvPython)) { Fail 'failed to create virtualenv' }
}
Write-Setup 'installing python dependencies (numpy, sounddevice)'
& $VenvPython -m pip install -q --disable-pip-version-check -r (Join-Path $Root 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Fail 'pip install failed' }

# 4. Launch
Write-Setup "starting voice pipeline — say 'hey jarvis' then your command (Ctrl+C to stop)"
$env:WHISPER_CLI = $WhisperCli
$env:WHISPER_WAKE_MODEL = Join-Path $ModelDir 'ggml-tiny.bin'
$env:WHISPER_MODEL = Join-Path $ModelDir 'ggml-base.bin'
& $VenvPython (Join-Path $Root 'pipeline.py')
