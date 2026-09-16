"""
Real-time local voice assistant — wake word + transcription, powered entirely by
whisper.cpp (no openWakeWord, no Silero VAD).

Architecture:
  * A background thread continuously transcribes a rolling window of microphone
    audio with a *tiny* whisper model to detect the wake phrase ("hey jarvis").
  * The main thread captures audio and uses a tiny built-in energy gate (pure
    numpy, not an external model) to detect the end of the utterance.
  * The captured buffer is then transcribed with a larger whisper model and the
    plain text is printed to stdout.

Only whisper.cpp is used for the ML; there are no other model downloads.
The accompanying `start.sh` builds whisper.cpp, downloads the models, and
installs the two tiny Python packages for you — nothing is downloaded by hand.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import wave
from collections import deque

import numpy as np
import sounddevice as sd

# --------------------------------------------------------------------------- #
# Configuration (all overridable via environment variables)
# --------------------------------------------------------------------------- #

SAMPLE_RATE = 16000           # whisper.cpp + PortAudio target rate
CHUNK_SAMPLES = 1280          # 80 ms frames
CHANNELS = 1

WHISPER_CLI = os.environ.get("WHISPER_CLI", "whisper-cli")

# A tiny model for the always-on wake-word listener (fast on CPU).
WAKE_MODEL = os.environ.get("WHISPER_WAKE_MODEL", "models/ggml-tiny.bin")
# A larger model for the final command transcription.
TRANSCRIBE_MODEL = os.environ.get("WHISPER_MODEL", "models/ggml-base.bin")

# Wake-word listener tuning.
WAKE_WINDOW_SECONDS = 4.0      # audio window fed to whisper each check
WAKE_INTERVAL = 1.0            # seconds between wake-word checks
# Whisper sometimes hears "jarvis" slightly differently; keep a small alias set.
WAKE_ALIASES = ("simo", "sima", "simmo", "simoe", "seema", "sema")

# Endpointing via a simple RMS energy gate.
ENERGY_THRESHOLD = 0.012       # RMS in [0, 1]
MIN_SILENCE_MS = 600           # trailing silence that ends an utterance
MAX_UTTERANCE_SECONDS = 15.0   # hard cap on one command
NO_SPEECH_TIMEOUT = 4.0        # give up if nothing is said after the wake word
PRE_ROLL_SECONDS = 0.5         # keep a little audio before speech start

# How long the wake listener must be quiet (no fresh transcript) before we
# consider the speaker done and print the merged line. Must comfortably exceed
# WAKE_INTERVAL + one whisper.cpp call, hence the generous value.
SILENCE_FINALIZE_SEC = 1.5


# --------------------------------------------------------------------------- #
# Rolling transcript accumulator + fuzzy merger
# --------------------------------------------------------------------------- #
# Every transcript whisper returns is merged into one growing string. Overlap
# between consecutive rolling-window transcripts is detected via longest common
# substring and removed. The string is printed once — and only once — after the
# speaker has actually stopped.

_accumulated: str = ""
_accumulated_lock = threading.Lock()
_last_transcript_time: float = 0.0


def _longest_common_substring(a: str, b: str) -> tuple[int, int, int]:
    """Return (start_in_a, start_in_b, length) of the longest common substring."""
    if not a or not b:
        return (0, 0, 0)
    la, lb = len(a), len(b)
    al, bl = a.lower(), b.lower()
    prev = [0] * (lb + 1)
    best = (0, 0, 0)
    for i in range(1, la + 1):
        cur = [0] * (lb + 1)
        ai = al[i - 1]
        for j in range(1, lb + 1):
            if ai == bl[j - 1]:
                cur[j] = prev[j - 1] + 1
                if cur[j] > best[2]:
                    best = (i - cur[j], j - cur[j], cur[j])
        prev = cur
    return best


def _merge_two(a: str, b: str) -> str:
    """Merge two transcripts, dropping the shared overlap; prefer the newer text."""
    if not a:
        return b
    if not b:
        return a
    la, lb = a.lower(), b.lower()
    if lb in la:                # b already covered by a
        return a
    if la in lb:                # a is contained in b → take the newer, longer one
        return b
    sa, sb, length = _longest_common_substring(a, b)
    if length < 3:              # nothing meaningful shared → concatenate
        return a.rstrip() + " " + b.lstrip()
    return (a[:sa].rstrip() + " " + b[sb:].lstrip()).strip()


def _accumulate(text: str) -> None:
    """Merge a fresh transcript into the running merged string."""
    global _accumulated, _last_transcript_time
    text = (text or "").strip()
    if not text or text.startswith(("(", "[")):   # skip [BLANK_AUDIO] etc.
        return
    with _accumulated_lock:
        _accumulated = _merge_two(_accumulated, text)
        _last_transcript_time = time.time()


def _clear_accumulated() -> None:
    global _accumulated
    with _accumulated_lock:
        _accumulated = ""


def finalize_transcript() -> None:
    """Print the merged transcript (if any) and start a fresh one."""
    global _accumulated
    with _accumulated_lock:
        text = _accumulated.strip()
        _accumulated = ""
    if text:
        print(f"Transcribed: {text}", flush=True)


def _should_finalize() -> bool:
    """True once we have content and the wake listener has gone quiet."""
    with _accumulated_lock:
        if not _accumulated.strip():
            return False
        return (time.time() - _last_transcript_time) > SILENCE_FINALIZE_SEC


# --------------------------------------------------------------------------- #
# whisper.cpp helper
# --------------------------------------------------------------------------- #

def run_whisper(model_path: str, samples: np.ndarray) -> str:
    """Transcribe int16 samples with a whisper.cpp model and return plain text."""
    if samples.size == 0:
        return ""

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        with wave.open(tmp.name, "wb") as wav:
            wav.setnchannels(CHANNELS)
            wav.setsampwidth(2)
            wav.setframerate(SAMPLE_RATE)
            wav.writeframes(samples.astype(np.int16).tobytes())

        proc = subprocess.run(
            [WHISPER_CLI, "-m", model_path, "-f", tmp.name, "-nt", "-np"],
            capture_output=True,
            text=True,
            timeout=120,
        )
    finally:
        os.unlink(tmp.name)

    if proc.returncode != 0:
        raise RuntimeError(f"whisper-cli failed: {proc.stderr.strip()}")

    text = " ".join(line.strip() for line in proc.stdout.splitlines() if line.strip())

    # 📍 Merge into the rolling accumulator instead of printing. The actual
    # print happens once the speaker goes quiet — see finalize_transcript().
    _accumulate(text)

    return text


def normalize(text: str) -> str:
    """Lowercase and strip punctuation so wake-word matching is forgiving."""
    return re.sub(r"[^a-z0-9 ]", "", text.lower())


def contains_wake_word(text: str) -> bool:
    return any(alias in text for alias in WAKE_ALIASES)


# --------------------------------------------------------------------------- #
# Wake-word listener (runs whisper in a background thread)
# --------------------------------------------------------------------------- #

class WakeListener(threading.Thread):
    """Keeps a rolling audio window and periodically asks whisper for text."""

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self._lock = threading.Lock()
        self._buffer: deque[np.ndarray] = deque()
        self._length = 0
        self._window = int(WAKE_WINDOW_SECONDS * SAMPLE_RATE)
        self._enabled = True
        self.detected = threading.Event()

    # -- audio bookkeeping (called from the main thread) ---------------------

    def add(self, chunk: np.ndarray) -> None:
        with self._lock:
            self._buffer.append(chunk)
            self._length += len(chunk)
            while self._length > self._window:
                self._length -= len(self._buffer.popleft())

    def recent(self, seconds: float) -> np.ndarray:
        """Return the last `seconds` of audio (used as pre-roll after a trigger)."""
        target = int(seconds * SAMPLE_RATE)
        with self._lock:
            chunks = list(self._buffer)
        if not chunks or target == 0:
            return np.array([], dtype=np.int16)
        tail: list[np.ndarray] = []
        count = 0
        for c in reversed(chunks):
            tail.append(c)
            count += len(c)
            if count >= target:
                break
        tail.reverse()
        return np.concatenate(tail)[-target:]

    def snapshot(self) -> np.ndarray | None:
        """Full window for whisper, or None if there isn't enough audio yet."""
        with self._lock:
            if self._length < SAMPLE_RATE:
                return None
            return np.concatenate(list(self._buffer))

    # -- lifecycle ------------------------------------------------------------

    def enable(self, enabled: bool) -> None:
        with self._lock:
            self._enabled = enabled

    def reset(self) -> None:
        with self._lock:
            self._buffer.clear()
            self._length = 0
        self.detected.clear()

    # -- worker loop -----------------------------------------------------------

    def run(self) -> None:
        while True:
            with self._lock:
                enabled = self._enabled
            if enabled:
                samples = self.snapshot()
                if samples is not None:
                    try:
                        text = normalize(run_whisper(WAKE_MODEL, samples))
                        if contains_wake_word(text):
                            self.detected.set()
                    except Exception as exc:  # noqa: BLE001
                        sys.stderr.write(f"[error] wake listener: {exc}\n")
            time.sleep(WAKE_INTERVAL)


# --------------------------------------------------------------------------- #
# Energy gate (endpointing) — pure numpy, no external model
# --------------------------------------------------------------------------- #

class EnergyGate:
    def __init__(self) -> None:
        self._threshold = ENERGY_THRESHOLD
        self._min_silence = int(SAMPLE_RATE * MIN_SILENCE_MS / 1000)
        self._silence_run = 0
        self._speaking = False
        self._clock = 0.0

    def __call__(self, chunk: np.ndarray) -> dict | None:
        rms = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2)) / 32768.0)
        chunk_seconds = len(chunk) / SAMPLE_RATE
        self._clock += chunk_seconds

        if rms > self._threshold:
            self._silence_run = 0
            if not self._speaking:
                self._speaking = True
                return {"start": self._clock - chunk_seconds}
        elif self._speaking:
            self._silence_run += len(chunk)
            if self._silence_run >= self._min_silence:
                self._speaking = False
                self._silence_run = 0
                return {"end": self._clock}
        return None


# --------------------------------------------------------------------------- #
# Main pipeline
# --------------------------------------------------------------------------- #

def main() -> None:
    for path, name in ((WAKE_MODEL, "wake"), (TRANSCRIBE_MODEL, "transcribe")):
        if not os.path.exists(path):
            sys.stderr.write(
                f"[error] missing {name} model '{path}' — run start.sh to download it\n"
            )
            sys.exit(1)

    listener = WakeListener()
    listener.start()
    sys.stderr.write("[info] listening for 'hey simo'... (speak to interact)\n")

    state = "LISTEN"
    gate = EnergyGate()
    speech_chunks: list[np.ndarray] = []
    speech_start_sec: float | None = None
    captured_seconds = 0.0
    silence_since_wake = 0.0

    def transcribe_and_reset() -> None:
        nonlocal state
        samples = np.concatenate(speech_chunks)
        if speech_start_sec is not None:
            keep_from = max(0, int((speech_start_sec - PRE_ROLL_SECONDS) * SAMPLE_RATE))
            samples = samples[keep_from:]

        if samples.size < SAMPLE_RATE * 0.2:
            sys.stderr.write("[wake] utterance too short, ignored\n")
        else:
            try:
                run_whisper(TRANSCRIBE_MODEL, samples)
                # 📍 Print the merged, de-duplicated accumulator instead of the
                # raw utterance transcript.
                finalize_transcript()
            except Exception as exc:  # noqa: BLE001
                sys.stderr.write(f"[error] transcription failed: {exc}\n")

        listener.reset()
        listener.enable(True)
        state = "LISTEN"

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
        blocksize=CHUNK_SAMPLES,
    ) as stream:
        while True:
            block, _overflowed = stream.read(CHUNK_SAMPLES)
            chunk = block.flatten()

            if state == "LISTEN":
                listener.add(chunk)

                if listener.detected.is_set():
                    sys.stderr.write("[wake] wake word detected\n")
                    listener.enable(False)
                    # 📍 Drop whatever the wake listener accumulated — it
                    # contains the wake phrase, not the command.
                    _clear_accumulated()
                    speech_chunks = [listener.recent(PRE_ROLL_SECONDS)]
                    gate = EnergyGate()
                    speech_start_sec = None
                    captured_seconds = len(speech_chunks[0]) / SAMPLE_RATE
                    silence_since_wake = 0.0
                    state = "CAPTURE"
                    continue

                # 📍 Only finalize once the wake listener has gone quiet for
                # SILENCE_FINALIZE_SEC. This collapses the stream of
                # near-duplicate rolling-window transcripts into one line.
                if _should_finalize():
                    finalize_transcript()

            elif state == "CAPTURE":
                speech_chunks.append(chunk)
                captured_seconds += len(chunk) / SAMPLE_RATE

                result = gate(chunk)
                if result is not None:
                    if "start" in result and speech_start_sec is None:
                        speech_start_sec = result["start"]
                    elif "end" in result and speech_start_sec is not None:
                        transcribe_and_reset()
                        continue

                if speech_start_sec is None:
                    silence_since_wake += len(chunk) / SAMPLE_RATE
                    if silence_since_wake >= NO_SPEECH_TIMEOUT:
                        sys.stderr.write("[wake] no speech, back to listening\n")
                        listener.reset()
                        listener.enable(True)
                        state = "LISTEN"
                        continue

                if captured_seconds >= MAX_UTTERANCE_SECONDS:
                    transcribe_and_reset()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.stderr.write("\n[info] stopped\n")
