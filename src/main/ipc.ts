import { ipcMain } from 'electron'
import { handlers } from './handlers'

/**
 * Wires the shared handler registry into Electron's IPC. The dev HTTP
 * bridge uses the same registry, so both Electron renderer and a browser
 * tab on http://localhost:5173 execute identical handler code.
 */
export function registerIpcHandlers(): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_e, ...args) => handler(...args))
  }
}
