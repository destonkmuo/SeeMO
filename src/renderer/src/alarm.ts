import classicUrl from './assets/alarm.wav'
import chimeUrl from './assets/alarm-chime.wav'
import sirenUrl from './assets/alarm-siren.wav'

export interface BuiltInAlarmSound {
  id: string
  label: string
  url: string
}

export const BUILT_IN_SOUNDS: BuiltInAlarmSound[] = [
  { id: 'classic', label: 'Classic beeps', url: classicUrl },
  { id: 'chime', label: 'Gentle chime', url: chimeUrl },
  { id: 'siren', label: 'Siren sweep', url: sirenUrl }
]

export const DEFAULT_SOUND_ID = BUILT_IN_SOUNDS[0].id

export function isKnownSoundId(id: string): boolean {
  return BUILT_IN_SOUNDS.some((sound) => sound.id === id) || id === 'custom'
}

export function builtInSoundUrl(id: string): string | null {
  return BUILT_IN_SOUNDS.find((sound) => sound.id === id)?.url ?? null
}

/** Resolve the playable URL for a selection (custom file or built-in sound). */
export function resolveSoundUrl(soundId: string, customUrl: string | null): string {
  if (soundId === 'custom' && customUrl) return customUrl
  return builtInSoundUrl(soundId) ?? BUILT_IN_SOUNDS[0].url
}

/**
 * Single shared loop element. Centralizing playback here (instead of one
 * <audio> per mini-app) guarantees only one alarm ever rings at a time:
 * starting a new one always stops the previous first. Rebuilt whenever the
 * sound URL changes so loops never mix audio.
 */
let loopEl: HTMLAudioElement | null = null
let loopUrl: string | null = null
let previewEl: HTMLAudioElement | null = null

function stopPreview(): void {
  if (!previewEl) return
  previewEl.pause()
  previewEl.onended = null
  previewEl = null
}

/** Start the looping on-device alarm sound. */
export function startAlarmLoop(url: string): void {
  stopAlarm()
  if (!loopEl || loopUrl !== url) {
    loopEl = new Audio(url)
    loopEl.loop = true
    loopEl.preload = 'auto'
    loopUrl = url
  }
  loopEl.currentTime = 0
  void loopEl.play().catch((error) => {
    console.error('[alarm] audio playback blocked:', error)
  })
}

/** Play a sound once (picker preview), without touching the loop. */
export function previewSound(url: string): void {
  stopPreview()
  previewEl = new Audio(url)
  previewEl.preload = 'auto'
  previewEl.onended = () => {
    previewEl = null
  }
  void previewEl.play().catch((error) => {
    console.error('[alarm] preview playback blocked:', error)
  })
}

/** Silence the alarm (loop and any preview). */
export function stopAlarm(): void {
  if (loopEl) {
    loopEl.pause()
    loopEl.currentTime = 0
  }
  stopPreview()
}

/** True while the alarm loop is currently audible. */
export function isAlarmRinging(): boolean {
  return loopEl !== null && !loopEl.paused && !loopEl.ended
}
