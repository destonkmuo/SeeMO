import { app, nativeImage } from 'electron'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

/**
 * Keep SeeMO's Dock icon applied on macOS.
 *
 * Dev runs inside Electron.app, so the Dock would otherwise show Electron's
 * bundle icon. Setting it once at startup is not enough: macOS resets a
 * custom Dock icon back to the bundle icon whenever the app's activation
 * policy changes (the PiP orb calls `setActivationPolicy('regular')`) or the
 * app is (re)activated. So this is re-applied at each of those points.
 *
 * Packaged builds already carry `build/icon.icns`, so nothing to do there.
 */
let cached: Electron.NativeImage | null = null

export function applyDockIcon(): void {
  if (!is.dev || process.platform !== 'darwin' || !app.dock) return
  if (!cached) cached = nativeImage.createFromPath(icon)
  if (!cached.isEmpty()) app.dock.setIcon(cached)
}
