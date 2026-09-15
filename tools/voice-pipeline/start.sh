#!/usr/bin/env bash
#
# SeeMO voice pipeline — one-command setup + launcher.
#
# This script fully bootstraps the "whisper-only" pipeline so the user never
# has to manually download or build anything:
#
#   1. installs any missing build tools (git, cmake, make, cc, python3, curl)
#   2. clones + builds whisper.cpp
#   3. downloads the whisper models (tiny for the wake word, base for commands)
#   4. creates a Python virtualenv and installs numpy + sounddevice
#   5. launches pipeline.py
#
# Usage:
#   ./start.sh          (everything is idempotent — safe to re-run)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR_DIR="$ROOT/vendor"
WHISPER_DIR="$VENDOR_DIR/whisper.cpp"
MODEL_DIR="$ROOT/models"
VENV_DIR="$ROOT/.venv"

log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[error]\033[0m %s\n' "$*"; exit 1; }

# --------------------------------------------------------------------------- #
# 0. Detect OS
# --------------------------------------------------------------------------- #
OS="unknown"
case "$(uname -s)" in
  Darwin) OS="macos" ;;
  Linux)  OS="linux" ;;
  *) err "unsupported OS: $(uname -s)" ;;
esac

# --------------------------------------------------------------------------- #
# 1. Ensure build tools are present
# --------------------------------------------------------------------------- #
MISSING_TOOLS=()
for tool in git cmake make curl python3; do
  command -v "$tool" >/dev/null 2>&1 || MISSING_TOOLS+=("$tool")
done
if ! command -v cc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1; then
  MISSING_TOOLS+=("compiler")
fi

if [ "${#MISSING_TOOLS[@]}" -gt 0 ]; then
  warn "missing tools: ${MISSING_TOOLS[*]}"
  if [ "$OS" = "macos" ]; then
    command -v brew >/dev/null 2>&1 || err "install Homebrew first: https://brew.sh"
    for tool in "${MISSING_TOOLS[@]}"; do
      if [ "$tool" = "compiler" ]; then
        warn "installing Xcode Command Line Tools (a popup may appear)..."
        xcode-select --install || true
        err "re-run ./start.sh after the Command Line Tools finish installing"
      else
        brew install "$tool" || err "brew install $tool failed"
      fi
    done
  else
    sudo apt-get update -y
    sudo apt-get install -y git cmake make build-essential python3 python3-venv curl \
      || err "apt install failed"
  fi
fi

# --------------------------------------------------------------------------- #
# 2. Clone + build whisper.cpp
# --------------------------------------------------------------------------- #
WHISPER_CLI=""
if [ -x "$WHISPER_DIR/build/bin/whisper-cli" ]; then
  WHISPER_CLI="$WHISPER_DIR/build/bin/whisper-cli"
elif [ -x "$WHISPER_DIR/build/bin/Release/whisper-cli" ]; then
  WHISPER_CLI="$WHISPER_DIR/build/bin/Release/whisper-cli"
fi

if [ -z "$WHISPER_CLI" ]; then
  if [ ! -d "$WHISPER_DIR" ]; then
    log "cloning whisper.cpp"
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp "$WHISPER_DIR"
  fi
  log "building whisper.cpp (this takes a few minutes)"
  cmake -S "$WHISPER_DIR" -B "$WHISPER_DIR/build" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$WHISPER_DIR/build" -j

  if [ -x "$WHISPER_DIR/build/bin/whisper-cli" ]; then
    WHISPER_CLI="$WHISPER_DIR/build/bin/whisper-cli"
  elif [ -x "$WHISPER_DIR/build/bin/Release/whisper-cli" ]; then
    WHISPER_CLI="$WHISPER_DIR/build/bin/Release/whisper-cli"
  else
    err "whisper-cli binary not found after build"
  fi
fi
log "whisper-cli: $WHISPER_CLI"

# --------------------------------------------------------------------------- #
# 3. Download whisper models
# --------------------------------------------------------------------------- #
mkdir -p "$MODEL_DIR"

download_model() {
  local name="$1" size="$2"
  local dest="$MODEL_DIR/ggml-$name.bin"
  if [ -f "$dest" ]; then
    log "model ggml-$name.bin already present"
    return
  fi
  log "downloading ggml-$name.bin (~${size}MB)"
  curl -L --fail -o "$dest" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$name.bin" \
    || err "failed to download ggml-$name.bin"
}

download_model tiny 75
download_model base 142

# --------------------------------------------------------------------------- #
# 4. Python virtualenv + deps
# --------------------------------------------------------------------------- #
if [ ! -d "$VENV_DIR" ]; then
  log "creating python virtualenv"
  python3 -m venv "$VENV_DIR"
fi
log "installing python dependencies (numpy, sounddevice)"
"$VENV_DIR/bin/pip" install -q --disable-pip-version-check -r "$ROOT/requirements.txt"

# --------------------------------------------------------------------------- #
# 5. Launch
# --------------------------------------------------------------------------- #
log "starting voice pipeline — say 'hey jarvis' then your command (Ctrl+C to stop)"
exec env \
  WHISPER_CLI="$WHISPER_CLI" \
  WHISPER_WAKE_MODEL="$MODEL_DIR/ggml-tiny.bin" \
  WHISPER_MODEL="$MODEL_DIR/ggml-base.bin" \
  "$VENV_DIR/bin/python" "$ROOT/pipeline.py"
