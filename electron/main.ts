// VALENCE Desktop — Electron Main Process
// Wraps Next.js standalone server and provides a native Windows desktop experience with tray integration.
import { app, BrowserWindow, Tray, Menu, nativeImage, shell, session, globalShortcut, dialog } from 'electron'
import { spawn, ChildProcess, exec, execFile } from 'node:child_process'
import { join } from 'node:path'
import { createServer } from 'node:net'
import https from 'node:https'
import { existsSync, mkdirSync, copyFileSync, createWriteStream, writeFileSync, appendFileSync } from 'node:fs'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let serverProcess: ChildProcess | null = null
let serverPort = 3000

process.on('uncaughtException', (err) => {
  try {
    const errLog = join(app.getPath('userData'), 'app-error.log')
    appendFileSync(errLog, `[${new Date().toISOString()}] uncaughtException: ${err?.stack || err}\n`)
  } catch {}
})

process.on('unhandledRejection', (reason) => {
  try {
    const errLog = join(app.getPath('userData'), 'app-error.log')
    appendFileSync(errLog, `[${new Date().toISOString()}] unhandledRejection: ${reason}\n`)
  } catch {}
})

const isDev = !app.isPackaged

function checkPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer()
    s.unref()
    s.on('error', () => resolve(false))
    s.listen(port, '127.0.0.1', () => {
      s.close(() => resolve(true))
    })
  })
}

/** Find an available TCP port for the internal Next.js standalone server (defaulting to 3001). */
async function getAvailablePort(preferredPort = 3001): Promise<number> {
  if (await checkPortFree(preferredPort)) {
    return preferredPort
  }
  for (let port = 3002; port < 3050; port++) {
    if (await checkPortFree(port)) {
      return port
    }
  }
  return 3001
}

/** Check if the internal HTTP server is responding. */
async function waitForServer(url: string, timeoutMs = 35000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.status === 200 || res.status === 401 || res.status === 307 || res.status === 404) {
        return
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Timed out waiting for server at ${url}`)
}

// ---------- Ollama auto-setup ----------
const OLLAMA_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe'
const OLLAMA_REQUIRED_MODELS = ['qwen3:4b', 'nomic-embed-text']

function ollamaReadyFlagPath(): string {
  return join(app.getPath('userData'), '.ollama-ready')
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

function findOllamaCli(): string | null {
  const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || ''
  const programFiles = process.env['PROGRAMFILES(X86)'] || process.env.PROGRAMFILES || ''
  const candidates = [
    join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
    join(programFiles, 'Ollama', 'ollama.exe'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

async function waitForOllama(timeoutMs = 120000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isOllamaRunning()) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Ollama did not start in time')
}

async function downloadOllamaInstaller(): Promise<string> {
  const installerPath = join(app.getPath('temp'), 'OllamaSetup.exe')
  if (existsSync(installerPath)) return installerPath

  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(installerPath)
    https.get(OLLAMA_INSTALLER_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download Ollama installer: ${res.statusCode}`))
        return
      }
      res.pipe(file)
      file.on('finish', resolve)
      file.on('error', reject)
    }).on('error', reject)
  })

  return installerPath
}

async function installOllamaSilently(installerPath: string): Promise<void> {
  await execFileAsync(installerPath, ['/S'], { timeout: 300000 })
}

async function pullOllamaModel(model: string): Promise<void> {
  const cli = findOllamaCli()
  if (cli) {
    await execAsync(`"${cli}" pull ${model}`, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 })
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000)
  try {
    await fetch(`http://127.0.0.1:11434/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function ensureOllamaReady(): Promise<void> {
  if (existsSync(ollamaReadyFlagPath()) && (await isOllamaRunning())) {
    return
  }

  if (!(await isOllamaRunning())) {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    if (win && !win.isDestroyed()) {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Setting up Ollama',
        message: 'VALENCE needs Ollama for local AI. Downloading and installing now. This may take a few minutes.',
        buttons: ['OK'],
      })
    }

    const installerPath = await downloadOllamaInstaller()
    await installOllamaSilently(installerPath)
    await waitForOllama()
  }

  for (const model of OLLAMA_REQUIRED_MODELS) {
    try {
      await pullOllamaModel(model)
    } catch (err) {
      console.error(`[valence-desktop] Failed to pull Ollama model ${model}:`, err)
    }
  }

  writeFileSync(ollamaReadyFlagPath(), new Date().toISOString())
}

/** Seed local SQLite database from bundled assets on first run. */
function ensureUserDatabase(userDataDir: string): string {
  const valenceDbPath = join(userDataDir, 'valence.db')
  const legacyAmberDbPath = join(userDataDir, 'amber.db')

  if (existsSync(valenceDbPath)) {
    return valenceDbPath
  }

  // If previous amber.db exists, migrate/copy it
  if (existsSync(legacyAmberDbPath)) {
    try {
      copyFileSync(legacyAmberDbPath, valenceDbPath)
      console.log(`[valence-desktop] Migrated database from ${legacyAmberDbPath} to ${valenceDbPath}`)
      return valenceDbPath
    } catch (err) {
      console.error('[valence-desktop] Migration error, falling back to legacy db:', err)
      return legacyAmberDbPath
    }
  }

  const candidatePaths = [
    join(process.resourcesPath, 'app', 'db', 'custom.db'),
    join(process.resourcesPath, 'app', '.next', 'standalone', 'db', 'custom.db'),
    join(__dirname, '../db/custom.db'),
    join(__dirname, '../.next/standalone/db/custom.db'),
  ]

  for (const sourceDb of candidatePaths) {
    if (existsSync(sourceDb)) {
      try {
        mkdirSync(userDataDir, { recursive: true })
        copyFileSync(sourceDb, valenceDbPath)
        console.log(`[valence-desktop] Seeded database from ${sourceDb} to ${valenceDbPath}`)
        break
      } catch (err) {
        console.error('[valence-desktop] Error copying initial database:', err)
      }
    }
  }

  return existsSync(valenceDbPath) ? valenceDbPath : legacyAmberDbPath
}

/** Spawn the standalone Next.js server child process. */
async function startServer(): Promise<number> {
  serverPort = await getAvailablePort(3001)
  const userDataDir = app.getPath('userData')
  const userDbPath = ensureUserDatabase(userDataDir)
  const logFilePath = join(userDataDir, 'server.log')

  if (isDev) {
    // In dev mode, connect to running dev server or start next dev
    const devUrl = `http://127.0.0.1:${serverPort}`
    try {
      await waitForServer(`${devUrl}/api/system/health`, 2000)
      return serverPort
    } catch {
      // Dev server not already up, spawn next dev
      serverProcess = spawn(
        process.execPath,
        [join(__dirname, '../node_modules/next/dist/bin/next'), 'dev', '-p', String(serverPort)],
        {
          cwd: join(__dirname, '..'),
          env: { ...process.env, PORT: String(serverPort), HOSTNAME: '127.0.0.1', ELECTRON_RUN_AS_NODE: '1' },
          stdio: 'inherit',
        },
      )
      await waitForServer(`${devUrl}/api/system/health`, 35000)
      return serverPort
    }
  }

  // Production standalone server path
  const candidateStandaloneDirs = [
    join(process.resourcesPath, 'app', '.next', 'standalone'),
    join(__dirname, '../.next/standalone'),
    join(process.resourcesPath, '.next', 'standalone'),
  ]

  let standaloneDir = candidateStandaloneDirs[0]
  for (const dir of candidateStandaloneDirs) {
    if (existsSync(join(dir, 'server.js'))) {
      standaloneDir = dir
      break
    }
  }

  const serverJs = join(standaloneDir, 'server.js')
  if (!existsSync(serverJs)) {
    throw new Error(`Standalone server.js not found at ${serverJs}`)
  }

  mkdirSync(userDataDir, { recursive: true })
  const logStream = createWriteStream(logFilePath, { flags: 'a' })

  // When running inside packaged Electron, ELECTRON_RUN_AS_NODE runs the embedded Node runtime
  serverProcess = spawn(process.execPath, [serverJs], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(serverPort),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      DATABASE_URL: process.env.DATABASE_URL ?? `file:${userDbPath.replace(/\\/g, '/')}`,
      MEDIA_DIR: process.env.MEDIA_DIR ?? join(userDataDir, 'media'),
      BACKUP_DIR: process.env.BACKUP_DIR ?? join(userDataDir, 'backups'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (serverProcess.stdout) {
    serverProcess.stdout.pipe(logStream)
  }
  if (serverProcess.stderr) {
    serverProcess.stderr.pipe(logStream)
  }

  serverProcess.on('exit', (code, signal) => {
    const msg = `[${new Date().toISOString()}] serverProcess exited: code=${code}, signal=${signal}\n`
    try { appendFileSync(join(userDataDir, 'boot.log'), msg) } catch {}
  })
  serverProcess.on('error', (err) => {
    const msg = `[${new Date().toISOString()}] serverProcess error: ${err}\n`
    try { appendFileSync(join(userDataDir, 'boot.log'), msg) } catch {}
  })

  await waitForServer(`http://127.0.0.1:${serverPort}/api/system/health`, 35000)
  return serverPort
}

function createMainWindow(port: number): BrowserWindow {
  const iconCandidates = [
    join(__dirname, '../build/icon.png'),
    join(process.resourcesPath, 'app', 'build', 'icon.png'),
    join(__dirname, '../public/icon.png'),
  ]
  let iconPath: string | undefined
  for (const p of iconCandidates) {
    if (existsSync(p)) {
      iconPath = p
      break
    }
  }

  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: 'VALENCE — Sovereign Revenue Intelligence',
    backgroundColor: '#141413', // Claude dark espresso
    icon: iconPath,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  win.loadURL(`http://127.0.0.1:${port}`)

  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) {
      win.show()
      win.focus()
    }
  })

  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show()
      win.focus()
    }
  }, 2500)

  win.on('close', (e) => {
    try {
      const logPath = join(app.getPath('userData'), 'window.log')
      appendFileSync(logPath, 'Window close event fired at ' + new Date().toISOString() + '\n')
    } catch {}
  })

  win.webContents.on('render-process-gone', (e, details) => {
    try {
      const logPath = join(app.getPath('userData'), 'window.log')
      appendFileSync(logPath, `Render process gone: ${JSON.stringify(details)}\n`)
    } catch {}
  })

  win.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
    try {
      const logPath = join(app.getPath('userData'), 'window.log')
      appendFileSync(logPath, `did-fail-load: ${errorCode} ${errorDescription}\n`)
    } catch {}
  })

  // Open external links in default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  return win
}

function setupSystemTray(win: BrowserWindow, port: number) {
  try {
    const iconCandidates = [
      join(__dirname, '../build/icon.ico'),
      join(process.resourcesPath, 'app', 'build', 'icon.ico'),
      join(__dirname, '../build/icon.png'),
      join(process.resourcesPath, 'app', 'build', 'icon.png'),
    ]
    let trayIcon: ReturnType<typeof nativeImage.createFromPath> | undefined
    for (const p of iconCandidates) {
      if (existsSync(p)) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) {
          trayIcon = img.resize({ width: 16, height: 16 })
          break
        }
      }
    }

    if (!trayIcon || trayIcon.isEmpty()) {
      trayIcon = nativeImage.createFromBuffer(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA0SURBVDhPY/wPBAwUACZGBgaG//8ZqAZGDRjGABhGA2CoGvD/P1SNjAxgNmrAqAHDBAwMAOevGQ5f21/PAAAAAElFTkSuQmCC',
          'base64',
        ),
      )
    }

    tray = new Tray(trayIcon)
    tray.setToolTip('VALENCE — Sovereign Revenue Intelligence')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open VALENCE (Alt+V)',
      click: () => {
        win.show()
        win.focus()
      },
    },
    {
      label: 'Integrations & Coding Agents',
      click: () => {
        win.show()
        win.focus()
        win.loadURL(`http://127.0.0.1:${port}/#/integrations`)
      },
    },
    {
      label: 'Live Sales Assist',
      click: () => {
        win.show()
        win.focus()
        win.loadURL(`http://127.0.0.1:${port}/#/live`)
      },
    },
    {
      label: 'Deals Pipeline',
      click: () => {
        win.show()
        win.focus()
        win.loadURL(`http://127.0.0.1:${port}/#/deals`)
      },
    },
    {
      label: 'Settings',
      click: () => {
        win.show()
        win.focus()
        win.loadURL(`http://127.0.0.1:${port}/#/settings`)
      },
    },
    { type: 'separator' },
    {
      label: 'Launch on Windows Startup',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
        })
      },
    },
    { type: 'separator' },
    {
      label: 'Quit VALENCE',
      click: () => {
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    win.show()
    win.focus()
  })
  } catch (err) {
    console.warn('[valence-desktop] Could not initialize system tray:', err)
  }
}

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const, label: 'Exit VALENCE' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'VALENCE Documentation',
          click: () => {
            void shell.openExternal('https://github.com/thecorporategovernanceinstitute')
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Single instance lock
const gotLock = app.requestSingleInstanceLock()
try {
  const bootLogPath = join(app.getPath('userData'), 'boot.log')
  appendFileSync(bootLogPath, `[${new Date().toISOString()}] gotLock=${gotLock}, isPackaged=${app.isPackaged}\n`)
} catch {}
if (!gotLock) {
  try {
    const bootLogPath = join(app.getPath('userData'), 'boot.log')
    appendFileSync(bootLogPath, `[${new Date().toISOString()}] Quitting because gotLock is false\n`)
  } catch {}
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.setAlwaysOnTop(true)
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(false)
      mainWindow.moveTop()
    }
  })

  app.whenReady().then(async () => {
    const bootLogPath = join(app.getPath('userData'), 'boot.log')
    try {
      appendFileSync(bootLogPath, `[${new Date().toISOString()}] app.whenReady fired\n`)

      // Auto-grant microphone & speech recognition permissions for Voice Copilot
      session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowed = ['media', 'audioCapture', 'speechRecognition']
        callback(allowed.includes(permission))
      })
      session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
        return ['media', 'audioCapture', 'speechRecognition'].includes(permission)
      })

      setupApplicationMenu()
      appendFileSync(bootLogPath, `[${new Date().toISOString()}] calling startServer\n`)
      const port = await startServer()
      appendFileSync(bootLogPath, `[${new Date().toISOString()}] startServer returned port ${port}\n`)
      await ensureOllamaReady()
      mainWindow = createMainWindow(port)
      mainWindow.show()
      mainWindow.setAlwaysOnTop(true)
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(false)
      mainWindow.moveTop()
      appendFileSync(bootLogPath, `[${new Date().toISOString()}] mainWindow shown\n`)

      try {
        setupSystemTray(mainWindow, port)
        appendFileSync(bootLogPath, `[${new Date().toISOString()}] setupSystemTray done\n`)
      } catch (trayErr) {
        appendFileSync(bootLogPath, `[${new Date().toISOString()}] setupSystemTray error: ${trayErr}\n`)
      }

      // Register global hotkey Alt+V to toggle/focus VALENCE window from anywhere
      try {
        globalShortcut.register('Alt+V', () => {
          if (!mainWindow) return
          if (mainWindow.isVisible() && mainWindow.isFocused()) {
            mainWindow.hide()
          } else {
            mainWindow.restore()
            mainWindow.show()
            mainWindow.setAlwaysOnTop(true)
            mainWindow.focus()
            mainWindow.setAlwaysOnTop(false)
            mainWindow.moveTop()
          }
        })
      } catch (err) {
        console.warn('Could not register Alt+V global shortcut:', err)
      }
    } catch (err) {
      try {
        const errLog = join(app.getPath('userData'), 'app-error.log')
        writeFileSync(errLog, String(err) + '\n' + (err instanceof Error ? err.stack : ''))
      } catch {}
      console.error('Failed to launch VALENCE desktop:', err)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('will-quit', () => {
    try {
      const bootLogPath = join(app.getPath('userData'), 'boot.log')
      appendFileSync(bootLogPath, `[${new Date().toISOString()}] will-quit fired\n`)
      globalShortcut.unregisterAll()
    } catch {}
  })

  app.on('before-quit', () => {
    try {
      const bootLogPath = join(app.getPath('userData'), 'boot.log')
      appendFileSync(bootLogPath, `[${new Date().toISOString()}] before-quit fired\n`)
    } catch {}
    if (serverProcess) {
      try {
        serverProcess.kill()
      } catch {
        // ignore
      }
      serverProcess = null
    }
  })

  app.on('window-all-closed', () => {
    try {
      const bootLogPath = join(app.getPath('userData'), 'boot.log')
      appendFileSync(bootLogPath, `[${new Date().toISOString()}] window-all-closed fired\n`)
    } catch {}
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
