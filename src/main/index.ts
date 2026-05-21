import { app, shell, BrowserWindow, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'
import { buildAppMenu } from './menu'
import { gracefulShutdown } from './services/recording'
import { startDevBridge } from './devBridge'

// Preserve the existing userData directory so that renaming the app to
// MENO doesn't strand users' meetings, models, settings and chat
// history at the old `meeting-notes` path. Must run before any Electron
// API touches paths, which is why it sits at module top.
app.setPath('userData', join(app.getPath('appData'), 'meeting-notes'))

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'MENO',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    // Vibrancy + transparent gives macOS the native translucent sidebar look
    // while keeping the OS-managed rounded window corners. The OS picks
    // light/dark variants of the sidebar material automatically.
    ...(isMac
      ? {
          vibrancy: 'sidebar' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000',
          transparent: true
        }
      : { backgroundColor: '#ffffff' }),
    roundedCorners: true,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('io.namuneulbo.meetingnotes')

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(icon))
  }

  Menu.setApplicationMenu(buildAppMenu())

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  if (is.dev) startDevBridge()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Finalize any active recordings (patch WAV headers) before the app exits,
// otherwise crashes mid-recording leave 0-byte WAV files behind.
let isShuttingDown = false
app.on('before-quit', async (e) => {
  if (isShuttingDown) return
  isShuttingDown = true
  e.preventDefault()
  try {
    await gracefulShutdown()
  } finally {
    app.exit(0)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
