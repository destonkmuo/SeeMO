import { ipcMain, net } from 'electron'

/**
 * Calendar subscriptions: fetch an external ICS feed on behalf of the
 * renderer. Done in the main process so feeds aren't subject to renderer
 * CORS/CSP rules; only http(s) is allowed so a pasted URL can never read
 * local files.
 */

const HTTP_TIMEOUT_MS = 20000
const MAX_ICS_CHARS = 8 * 1024 * 1024

export function registerCalendarHandlers(): void {
  ipcMain.handle('calendar:fetchIcs', async (_event, url: unknown) => {
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new Error('A calendar URL is required.')
    }
    let parsed: URL
    try {
      parsed = new URL(url.trim())
    } catch {
      throw new Error('That does not look like a valid URL.')
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only http(s) calendar URLs are supported.')
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
    try {
      const response = await net.fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: { accept: 'text/calendar, text/plain, */*' }
      })
      if (!response.ok) {
        throw new Error(`The feed responded with ${response.status}.`)
      }
      const text = await response.text()
      if (text.length > MAX_ICS_CHARS) {
        throw new Error('That feed is too large to import.')
      }
      if (!/BEGIN:VCALENDAR/i.test(text)) {
        throw new Error('That URL is not an iCalendar (.ics) feed.')
      }
      return text
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('The feed timed out.')
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  })
}
