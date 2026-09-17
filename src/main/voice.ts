import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { app, BrowserWindow } from 'electron'

let child: ChildProcess | null = null

function pipelineDir(): string {
  // In dev this is the repo root; in a packaged build the tools are not
  // bundled, so this feature is dev-only unless `extraResources` is configured.
  return join(app.getAppPath(), 'tools', 'voice-pipeline')
}

function resolvePython(): string {
  const venvPython =
    process.platform === 'win32'
      ? join(pipelineDir(), '.venv', 'Scripts', 'python.exe')
      : join(pipelineDir(), '.venv', 'bin', 'python')
  return existsSync(venvPython) ? venvPython : 'python3'
}

// The prebuilt zips change internal layout across releases, so scan
// recursively. This stays cheap because the extracted dirs hold only a
// handful of files — the full whisper.cpp source tree is never scanned.
function findBinary(dir: string, pattern: RegExp, maxDepth: number): string | undefined {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (pattern.test(entry)) return join(dir, entry)
  }
  if (maxDepth <= 0) return undefined
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      if (statSync(full).isDirectory()) {
        const found = findBinary(full, pattern, maxDepth - 1)
        if (found) return found
      }
    } catch {
      // ignore unreadable entries
    }
  }
  return undefined
}

// Point the pipeline at the whisper.cpp binary and models downloaded by
// start.sh / start.ps1 (only when they actually exist on disk).
function resolveWhisperEnv(): Record<string, string> {
  const dir = pipelineDir()
  const cliCandidates = [
    join(dir, 'vendor', 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
    join(dir, 'vendor', 'whisper.cpp', 'build', 'bin', 'Release', 'whisper-cli'),
    join(dir, 'vendor', 'whisper.cpp', 'build', 'bin', 'Release', 'whisper-cli.exe'),
    join(dir, 'vendor', 'whisper-bin', 'whisper-cli.exe')
  ]

  const env: Record<string, string> = {}
  const cli = cliCandidates.find((p) => existsSync(p))
  if (cli) {
    env.WHISPER_CLI = cli
  } else {
    const found = findBinary(join(dir, 'vendor', 'whisper-bin'), /^whisper-cli(\.exe)?$/i, 3)
    if (found) {
      env.WHISPER_CLI = found
    } else {
      console.warn(
        '[voice] whisper-cli not found — run tools/voice-pipeline/start.sh (or start.ps1 on Windows) first'
      )
    }
  }

  const wakeModel = join(dir, 'models', 'ggml-tiny.bin')
  if (existsSync(wakeModel)) env.WHISPER_WAKE_MODEL = wakeModel

  const transcribeModel = join(dir, 'models', 'ggml-base.bin')
  if (existsSync(transcribeModel)) env.WHISPER_MODEL = transcribeModel

  return env
}

// Point the pipeline at the Alba voice model downloaded by start.sh.
// TTS needs no binary: the pipeline runs `python -m piper` from its own
// venv, whose wheels bundle the native libs on every OS. A missing voice
// only disables spoken replies — transcription keeps working.
function resolvePiperEnv(): Record<string, string> {
  const dir = pipelineDir()
  const env: Record<string, string> = {}

  const voiceModel = join(dir, 'models', 'en_GB-alba-medium.onnx')
  if (existsSync(voiceModel)) {
    env.PIPER_VOICE = voiceModel
  } else {
    console.warn('[voice] Alba voice model not found — spoken replies disabled until start.sh runs')
  }

  return env
}

function onTranscript(text: string): void {
  // Print to the terminal console where the app was launched.
  console.log(text)
  // Also forward to every renderer window (for the DevTools console / UI).
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('voice:transcript', text)
  }
}

function lineSplitter(handler: (line: string) => void): (chunk: Buffer) => void {
  let buffer = ''
  return (chunk) => {
    buffer += chunk.toString()
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) handler(line)
    }
  }
}

export function startVoice(): void {
  if (child) return

  const script = join(pipelineDir(), 'pipeline.py')
  if (!existsSync(script)) {
    console.warn('[voice] tools/voice-pipeline/pipeline.py not found — run ./start.sh there first')
    return
  }

  const python = resolvePython()
  const env = { ...process.env, ...resolveWhisperEnv(), ...resolvePiperEnv() }

  console.log('[voice] starting local transcription pipeline...')
  child = spawn(python, [script], { cwd: pipelineDir(), env })

  if (!child.stdout || !child.stderr || !child.stdin) {
    console.warn('[voice] failed to capture pipeline stdio')
    return
  }

  // A broken stdin pipe (pipeline died) must not take the app down with an
  // unhandled 'error' event; speakResponse() guards before every write.
  child.stdin.on('error', (err) => console.error('[voice] pipeline stdin error:', err))

  child.stdout.on('data', lineSplitter(onTranscript))
  child.stderr.on(
    'data',
    lineSplitter((line) => console.log(`[voice] ${line}`))
  )
  child.on('error', (err) => console.error('[voice] pipeline error:', err))
  child.on('exit', (code) => {
    child = null
    if (code !== 0 && code !== null) {
      console.warn(`[voice] pipeline exited with code ${code}`)
    }
  })
}

export function stopVoice(): void {
  if (child) {
    child.kill()
    child = null
  }
}

/**
 * Ask the running pipeline to speak text aloud (Piper TTS, Alba voice).
 * Fire-and-forget: the pipeline queues, synthesizes and plays it, ducking
 * the mic while our own voice is on the speaker. Returns false when there is
 * nothing to send to (pipeline down, empty text, or a broken pipe).
 */
export function speakResponse(text: string): boolean {
  if (!child || !child.stdin || child.stdin.destroyed) {
    console.warn('[voice] cannot speak: transcription pipeline is not running')
    return false
  }
  if (!text.trim()) return false
  try {
    child.stdin.write(`${JSON.stringify({ speak: text.trim() })}\n`)
    return true
  } catch (err) {
    console.error('[voice] failed to send speak command:', err)
    return false
  }
}
