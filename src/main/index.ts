import { app, shell, BrowserWindow, Menu, nativeImage, nativeTheme, protocol } from 'electron'
import { createReadStream, existsSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc'
import { buildAppMenu } from './menu'
import { gracefulShutdown } from './services/recording'
import { startDevBridge } from './devBridge'
import { getMeeting } from './services/storage'
import { loadSettings } from './services/settings'

// Register `meno-audio://` as a privileged scheme so the renderer can use
// it inside an <audio> tag and CSP allows fetching from it. Must be done
// before app.whenReady — registerSchemesAsPrivileged is rejected later.
// Force the app name to "MENO" so the macOS menu bar, About dialog, and
// `app.getName()`-driven menu labels don't show "Electron" in dev. Packaged
// builds get the name from electron-builder's productName, but dev launches
// from the bare Electron binary which reports "Electron". Must run before
// app is ready and before buildAppMenu().
app.setName('MENO')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'meno-audio',
    privileges: {
      standard: true,
      stream: true,
      supportFetchAPI: true,
      secure: true
    }
  }
])


// One-shot migration: if a previous build wrote to `meeting-notes/`,
// rename the whole directory to `meno/` so users keep their meetings,
// models, settings and chat history across the rename. Must run before
// any Electron API touches paths, which is why it sits at module top.
function migrateUserDataDir(): void {
  const appData = app.getPath('appData')
  const oldDir = join(appData, 'meeting-notes')
  const newDir = join(appData, 'meno')
  if (existsSync(oldDir) && !existsSync(newDir)) {
    try {
      renameSync(oldDir, newDir)
      console.log(`[migration] userData: ${oldDir} → ${newDir}`)
    } catch (e) {
      console.error('[migration] userData rename failed:', e)
    }
  }
}
migrateUserDataDir()
app.setPath('userData', join(app.getPath('appData'), 'meno'))

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
  electronApp.setAppUserModelId('io.namuneulbo.meno')

  // Sync the macOS vibrancy material to the app's theme. The `vibrancy:
  // 'sidebar'` window material follows nativeTheme, NOT our CSS theme
  // classes — so when the OS is dark but the user forces the app to
  // light, the sidebar stayed dark charcoal. Driving themeSource from
  // the saved app theme makes the sidebar render light in light mode.
  const savedTheme = loadSettings().theme
  nativeTheme.themeSource = savedTheme === 'auto' ? 'system' : savedTheme

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(icon))
  }

  Menu.setApplicationMenu(buildAppMenu())

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Serve meeting audio for the inline player. Looks up the meeting by id
  // from the URL host (meno-audio://<meetingId>) and streams the WAV file
  // back with Range support so the <audio> element can seek without
  // re-downloading from byte 0.
  protocol.handle('meno-audio', async (req) => {
    const url = new URL(req.url)
    const meetingId = url.hostname
    const m = getMeeting(meetingId)
    if (!m?.audioPath || !existsSync(m.audioPath)) {
      return new Response('Audio not found', { status: 404 })
    }
    const stat = statSync(m.audioPath)
    const range = req.headers.get('Range')
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range)
      if (match) {
        const start = parseInt(match[1], 10)
        const end = match[2] ? parseInt(match[2], 10) : stat.size - 1
        const stream = createReadStream(m.audioPath, { start, end })
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': 'audio/wav',
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes'
          }
        })
      }
    }
    const stream = createReadStream(m.audioPath)
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes'
      }
    })
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
