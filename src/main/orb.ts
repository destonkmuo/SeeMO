import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * Picture-in-picture orb: when the main window leaves the screen
 * (minimized or hidden), SeeMO keeps hovering in a small always-on-top
 * window with the same live core. Clicking it brings the app back.
 */

const ORB_SIZE = 176
const ORB_MARGIN = 24

let orbWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
// Mirrors the renderer's persisted setting (synced over IPC, defaults on).
// Main can't read the renderer's storage, so the app pushes every change.
let orbEnabled = true

export function trackMainWindow(win: BrowserWindow): void {
  mainWindow = win
  win.on('minimize', () => createOrbWindow())
  win.on('restore', () => destroyOrbWindow())
  win.on('hide', () => createOrbWindow())
  win.on('show', () => destroyOrbWindow())
  win.on('closed', () => {
    mainWindow = null
    destroyOrbWindow()
  })
}

function orbURL(): { file: string; query: Record<string, string> } {
  return { file: join(__dirname, '../renderer/index.html'), query: { orb: '1' } }
}

export function createOrbWindow(): void {
  if (!orbEnabled) return
  if (orbWindow && !orbWindow.isDestroyed()) {
    orbWindow.show()
    return
  }
  orbWindow = new BrowserWindow({
    width: ORB_SIZE,
    height: ORB_SIZE,
    transparent: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  orbWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Park bottom-right of the work area (clear of the dock/taskbar).
  const area = screen.getPrimaryDisplay().workArea
  orbWindow.setPosition(
    area.x + area.width - ORB_SIZE - ORB_MARGIN,
    area.y + area.height - ORB_SIZE - ORB_MARGIN
  )
  const { file, query } = orbURL()
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void orbWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?orb=1`)
  } else {
    void orbWindow.loadFile(file, { query })
  }
  orbWindow.on('closed', () => {
    orbWindow = null
  })
}

export function destroyOrbWindow(): void {
  if (orbWindow && !orbWindow.isDestroyed()) orbWindow.close()
  orbWindow = null
}

function focusMainWindow(): void {
  const main = mainWindow
  if (!main || main.isDestroyed()) {
    destroyOrbWindow()
    return
  }
  if (main.isMinimized()) main.restore()
  if (!main.isVisible()) main.show()
  main.focus()
  destroyOrbWindow()
}

export function registerOrbHandlers(): void {
  ipcMain.handle('orb:focus-app', () => {
    focusMainWindow()
  })
  ipcMain.on('orb:set-enabled', (_event, enabled: unknown) => {
    orbEnabled = enabled === true
    if (!orbEnabled) destroyOrbWindow()
  })
  // Core-state pulses from one window reach all the others, so the orb
  // mirrors agent-side states (speaking/idle) the voice broadcast misses.
  ipcMain.on('core:announce', (event, state: unknown) => {
    if (typeof state !== 'string') return
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents === event.sender) continue
      win.webContents.send('core:remote', state)
    }
  })
}
