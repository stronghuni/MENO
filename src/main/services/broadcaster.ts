import { BrowserWindow, WebContents } from 'electron'

type Listener = (channel: string, payload: unknown) => void

const externalListeners = new Set<Listener>()

/**
 * Fan a payload out to (a) every Electron BrowserWindow's renderer and
 * (b) any externally registered listener (e.g. the dev HTTP bridge's SSE
 * subscribers). Existing code used to call BrowserWindow.getAllWindows()
 * + webContents.send directly; centralizing it here lets the bridge tap
 * the same stream without changing call sites.
 */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    sendToWebContents(win.webContents, channel, payload)
  }
  for (const listener of externalListeners) {
    try {
      listener(channel, payload)
    } catch (e) {
      console.error('[broadcaster] external listener failed:', e)
    }
  }
}

function sendToWebContents(wc: WebContents, channel: string, payload: unknown): void {
  if (wc.isDestroyed()) return
  wc.send(channel, payload)
}

export function addExternalListener(fn: Listener): () => void {
  externalListeners.add(fn)
  return () => externalListeners.delete(fn)
}
