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

// The prebuilt Windows zip changes internal layout across releases, so scan
// whisper-bin recursively. This stays cheap because whisper-bin holds a
// handful of extracted files — the full whisper.cpp source tree is never
// scanned.
function findWhisperExe(dir: string, maxDepth: number): string | undefined {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return undefined
  }
  for (const entry of entries) {
    if (/^whisper-cli(\.exe)?$/i.test(entry)) return join(dir, entry)
  }
  if (maxDepth <= 0) return undefined
  for (const entry of entries) {
    const full = join(dir, entry)
    try {
      if (statSync(full).isDirectory()) {
        const found = findWhisperExe(full, maxDepth - 1)
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
    const found = findWhisperExe(join(dir, 'vendor', 'whisper-bin'), 3)
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
  const env = { ...process.env, ...resolveWhisperEnv() }

  console.log('[voice] starting local transcription pipeline...')
  child = spawn(python, [script], { cwd: pipelineDir(), env })

  if (!child.stdout || !child.stderr) {
    console.warn('[voice] failed to capture pipeline output')
    return
  }

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
