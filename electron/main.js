var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  if (mod && typeof mod === "object" || typeof mod === "function") {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(to, key))
        __defProp(to, key, {
          get: __accessProp.bind(mod, key),
          enumerable: true
        });
  }
  if (canCache)
    cache.set(mod, to);
  return to;
};

// electron/main.ts
var import_electron = require("electron");
var import_node_child_process = require("node:child_process");
var import_node_path = require("node:path");
var import_node_net = require("node:net");
var import_node_https = __toESM(require("node:https"));
var import_node_fs = require("node:fs");
var import_node_util = require("node:util");
var __dirname = "C:\\Users\\ratin\\Desktop\\my-PROJECTS\\Gong Alter\\electron";
var execAsync = import_node_util.promisify(import_node_child_process.exec);
var execFileAsync = import_node_util.promisify(import_node_child_process.execFile);
var mainWindow = null;
var tray = null;
var serverProcess = null;
var serverPort = 3000;
process.on("uncaughtException", (err) => {
  try {
    const errLog = import_node_path.join(import_electron.app.getPath("userData"), "app-error.log");
    import_node_fs.appendFileSync(errLog, `[${new Date().toISOString()}] uncaughtException: ${err?.stack || err}
`);
  } catch {}
});
process.on("unhandledRejection", (reason) => {
  try {
    const errLog = import_node_path.join(import_electron.app.getPath("userData"), "app-error.log");
    import_node_fs.appendFileSync(errLog, `[${new Date().toISOString()}] unhandledRejection: ${reason}
`);
  } catch {}
});
var isDev = !import_electron.app.isPackaged;
function checkPortFree(port) {
  return new Promise((resolve) => {
    const s = import_node_net.createServer();
    s.unref();
    s.on("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => {
      s.close(() => resolve(true));
    });
  });
}
async function getAvailablePort(preferredPort = 3001) {
  if (await checkPortFree(preferredPort)) {
    return preferredPort;
  }
  for (let port = 3002;port < 3050; port++) {
    if (await checkPortFree(port)) {
      return port;
    }
  }
  return 3001;
}
async function waitForServer(url, timeoutMs = 35000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200 || res.status === 401 || res.status === 307 || res.status === 404) {
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}
var OLLAMA_INSTALLER_URL = "https://ollama.com/download/OllamaSetup.exe";
var OLLAMA_REQUIRED_MODELS = ["qwen3:4b", "nomic-embed-text"];
function ollamaReadyFlagPath() {
  return import_node_path.join(import_electron.app.getPath("userData"), ".ollama-ready");
}
async function isOllamaRunning() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
function findOllamaCli() {
  const localAppData = process.env.LOCALAPPDATA || process.env.USERPROFILE || "";
  const programFiles = process.env["PROGRAMFILES(X86)"] || process.env.PROGRAMFILES || "";
  const candidates = [
    import_node_path.join(localAppData, "Programs", "Ollama", "ollama.exe"),
    import_node_path.join(programFiles, "Ollama", "ollama.exe")
  ];
  for (const p of candidates) {
    if (import_node_fs.existsSync(p))
      return p;
  }
  return null;
}
async function waitForOllama(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isOllamaRunning())
      return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Ollama did not start in time");
}
async function downloadOllamaInstaller() {
  const installerPath = import_node_path.join(import_electron.app.getPath("temp"), "OllamaSetup.exe");
  if (import_node_fs.existsSync(installerPath))
    return installerPath;
  await new Promise((resolve, reject) => {
    const file = import_node_fs.createWriteStream(installerPath);
    import_node_https.default.get(OLLAMA_INSTALLER_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download Ollama installer: ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", resolve);
      file.on("error", reject);
    }).on("error", reject);
  });
  return installerPath;
}
async function installOllamaSilently(installerPath) {
  await execFileAsync(installerPath, ["/S"], { timeout: 300000 });
}
async function pullOllamaModel(model) {
  const cli = findOllamaCli();
  if (cli) {
    await execAsync(`"${cli}" pull ${model}`, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
    return;
  }
  const controller = new AbortController;
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  try {
    await fetch(`http://127.0.0.1:11434/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: false }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}
async function ensureOllamaReady() {
  if (import_node_fs.existsSync(ollamaReadyFlagPath()) && await isOllamaRunning()) {
    return;
  }
  if (!await isOllamaRunning()) {
    const win = import_electron.BrowserWindow.getFocusedWindow() || mainWindow;
    if (win && !win.isDestroyed()) {
      import_electron.dialog.showMessageBox(win, {
        type: "info",
        title: "Setting up Ollama",
        message: "VALENCE needs Ollama for local AI. Downloading and installing now. This may take a few minutes.",
        buttons: ["OK"]
      });
    }
    const installerPath = await downloadOllamaInstaller();
    await installOllamaSilently(installerPath);
    await waitForOllama();
  }
  for (const model of OLLAMA_REQUIRED_MODELS) {
    try {
      await pullOllamaModel(model);
    } catch (err) {
      console.error(`[valence-desktop] Failed to pull Ollama model ${model}:`, err);
    }
  }
  import_node_fs.writeFileSync(ollamaReadyFlagPath(), new Date().toISOString());
}
function ensureUserDatabase(userDataDir) {
  const valenceDbPath = import_node_path.join(userDataDir, "valence.db");
  const legacyAmberDbPath = import_node_path.join(userDataDir, "amber.db");
  if (import_node_fs.existsSync(valenceDbPath)) {
    return valenceDbPath;
  }
  if (import_node_fs.existsSync(legacyAmberDbPath)) {
    try {
      import_node_fs.copyFileSync(legacyAmberDbPath, valenceDbPath);
      console.log(`[valence-desktop] Migrated database from ${legacyAmberDbPath} to ${valenceDbPath}`);
      return valenceDbPath;
    } catch (err) {
      console.error("[valence-desktop] Migration error, falling back to legacy db:", err);
      return legacyAmberDbPath;
    }
  }
  const candidatePaths = [
    import_node_path.join(process.resourcesPath, "app", "db", "custom.db"),
    import_node_path.join(process.resourcesPath, "app", ".next", "standalone", "db", "custom.db"),
    import_node_path.join(__dirname, "../db/custom.db"),
    import_node_path.join(__dirname, "../.next/standalone/db/custom.db")
  ];
  for (const sourceDb of candidatePaths) {
    if (import_node_fs.existsSync(sourceDb)) {
      try {
        import_node_fs.mkdirSync(userDataDir, { recursive: true });
        import_node_fs.copyFileSync(sourceDb, valenceDbPath);
        console.log(`[valence-desktop] Seeded database from ${sourceDb} to ${valenceDbPath}`);
        break;
      } catch (err) {
        console.error("[valence-desktop] Error copying initial database:", err);
      }
    }
  }
  return import_node_fs.existsSync(valenceDbPath) ? valenceDbPath : legacyAmberDbPath;
}
async function startServer() {
  serverPort = await getAvailablePort(3001);
  const userDataDir = import_electron.app.getPath("userData");
  const userDbPath = ensureUserDatabase(userDataDir);
  const logFilePath = import_node_path.join(userDataDir, "server.log");
  if (isDev) {
    const devUrl = `http://127.0.0.1:${serverPort}`;
    try {
      await waitForServer(`${devUrl}/api/system/health`, 2000);
      return serverPort;
    } catch {
      serverProcess = import_node_child_process.spawn(process.execPath, [import_node_path.join(__dirname, "../node_modules/next/dist/bin/next"), "dev", "-p", String(serverPort)], {
        cwd: import_node_path.join(__dirname, ".."),
        env: { ...process.env, PORT: String(serverPort), HOSTNAME: "127.0.0.1", ELECTRON_RUN_AS_NODE: "1" },
        stdio: "inherit"
      });
      await waitForServer(`${devUrl}/api/system/health`, 35000);
      return serverPort;
    }
  }
  const candidateStandaloneDirs = [
    import_node_path.join(process.resourcesPath, "app", ".next", "standalone"),
    import_node_path.join(__dirname, "../.next/standalone"),
    import_node_path.join(process.resourcesPath, ".next", "standalone")
  ];
  let standaloneDir = candidateStandaloneDirs[0];
  for (const dir of candidateStandaloneDirs) {
    if (import_node_fs.existsSync(import_node_path.join(dir, "server.js"))) {
      standaloneDir = dir;
      break;
    }
  }
  const serverJs = import_node_path.join(standaloneDir, "server.js");
  if (!import_node_fs.existsSync(serverJs)) {
    throw new Error(`Standalone server.js not found at ${serverJs}`);
  }
  import_node_fs.mkdirSync(userDataDir, { recursive: true });
  const logStream = import_node_fs.createWriteStream(logFilePath, { flags: "a" });
  serverProcess = import_node_child_process.spawn(process.execPath, [serverJs], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(serverPort),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      DATABASE_URL: process.env.DATABASE_URL ?? `file:${userDbPath.replace(/\\/g, "/")}`,
      MEDIA_DIR: process.env.MEDIA_DIR ?? import_node_path.join(userDataDir, "media"),
      BACKUP_DIR: process.env.BACKUP_DIR ?? import_node_path.join(userDataDir, "backups")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (serverProcess.stdout) {
    serverProcess.stdout.pipe(logStream);
  }
  if (serverProcess.stderr) {
    serverProcess.stderr.pipe(logStream);
  }
  serverProcess.on("exit", (code, signal) => {
    const msg = `[${new Date().toISOString()}] serverProcess exited: code=${code}, signal=${signal}
`;
    try {
      import_node_fs.appendFileSync(import_node_path.join(userDataDir, "boot.log"), msg);
    } catch {}
  });
  serverProcess.on("error", (err) => {
    const msg = `[${new Date().toISOString()}] serverProcess error: ${err}
`;
    try {
      import_node_fs.appendFileSync(import_node_path.join(userDataDir, "boot.log"), msg);
    } catch {}
  });
  await waitForServer(`http://127.0.0.1:${serverPort}/api/system/health`, 35000);
  return serverPort;
}
function createMainWindow(port) {
  const iconCandidates = [
    import_node_path.join(__dirname, "../build/icon.png"),
    import_node_path.join(process.resourcesPath, "app", "build", "icon.png"),
    import_node_path.join(__dirname, "../public/icon.png")
  ];
  let iconPath;
  for (const p of iconCandidates) {
    if (import_node_fs.existsSync(p)) {
      iconPath = p;
      break;
    }
  }
  const win = new import_electron.BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: "VALENCE — Sovereign Revenue Intelligence",
    backgroundColor: "#141413",
    icon: iconPath,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: import_node_path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  win.loadURL(`http://127.0.0.1:${port}`);
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
  win.webContents.on("did-finish-load", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
      win.focus();
    }
  }, 2500);
  win.on("close", (e) => {
    try {
      const logPath = import_node_path.join(import_electron.app.getPath("userData"), "window.log");
      import_node_fs.appendFileSync(logPath, "Window close event fired at " + new Date().toISOString() + `
`);
    } catch {}
  });
  win.webContents.on("render-process-gone", (e, details) => {
    try {
      const logPath = import_node_path.join(import_electron.app.getPath("userData"), "window.log");
      import_node_fs.appendFileSync(logPath, `Render process gone: ${JSON.stringify(details)}
`);
    } catch {}
  });
  win.webContents.on("did-fail-load", (e, errorCode, errorDescription) => {
    try {
      const logPath = import_node_path.join(import_electron.app.getPath("userData"), "window.log");
      import_node_fs.appendFileSync(logPath, `did-fail-load: ${errorCode} ${errorDescription}
`);
    } catch {}
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      import_electron.shell.openExternal(url);
    }
    return { action: "deny" };
  });
  return win;
}
function setupSystemTray(win, port) {
  try {
    const iconCandidates = [
      import_node_path.join(__dirname, "../build/icon.ico"),
      import_node_path.join(process.resourcesPath, "app", "build", "icon.ico"),
      import_node_path.join(__dirname, "../build/icon.png"),
      import_node_path.join(process.resourcesPath, "app", "build", "icon.png")
    ];
    let trayIcon;
    for (const p of iconCandidates) {
      if (import_node_fs.existsSync(p)) {
        const img = import_electron.nativeImage.createFromPath(p);
        if (!img.isEmpty()) {
          trayIcon = img.resize({ width: 16, height: 16 });
          break;
        }
      }
    }
    if (!trayIcon || trayIcon.isEmpty()) {
      trayIcon = import_electron.nativeImage.createFromBuffer(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAA0SURBVDhPY/wPBAwUACZGBgaG//8ZqAZGDRjGABhGA2CoGvD/P1SNjAxgNmrAqAHDBAwMAOevGQ5f21/PAAAAAElFTkSuQmCC", "base64"));
    }
    tray = new import_electron.Tray(trayIcon);
    tray.setToolTip("VALENCE — Sovereign Revenue Intelligence");
    const contextMenu = import_electron.Menu.buildFromTemplate([
      {
        label: "Open VALENCE (Alt+V)",
        click: () => {
          win.show();
          win.focus();
        }
      },
      {
        label: "Integrations & Coding Agents",
        click: () => {
          win.show();
          win.focus();
          win.loadURL(`http://127.0.0.1:${port}/#/integrations`);
        }
      },
      {
        label: "Live Sales Assist",
        click: () => {
          win.show();
          win.focus();
          win.loadURL(`http://127.0.0.1:${port}/#/live`);
        }
      },
      {
        label: "Deals Pipeline",
        click: () => {
          win.show();
          win.focus();
          win.loadURL(`http://127.0.0.1:${port}/#/deals`);
        }
      },
      {
        label: "Settings",
        click: () => {
          win.show();
          win.focus();
          win.loadURL(`http://127.0.0.1:${port}/#/settings`);
        }
      },
      { type: "separator" },
      {
        label: "Launch on Windows Startup",
        type: "checkbox",
        checked: import_electron.app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          import_electron.app.setLoginItemSettings({
            openAtLogin: item.checked
          });
        }
      },
      { type: "separator" },
      {
        label: "Quit VALENCE",
        click: () => {
          import_electron.app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
    tray.on("double-click", () => {
      win.show();
      win.focus();
    });
  } catch (err) {
    console.warn("[valence-desktop] Could not initialize system tray:", err);
  }
}
function setupApplicationMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...isMac ? [{ role: "appMenu" }] : [],
    {
      label: "File",
      submenu: [
        isMac ? { role: "close" } : { role: "quit", label: "Exit VALENCE" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        ...isDev ? [{ role: "toggleDevTools" }] : [],
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "VALENCE Documentation",
          click: () => {
            import_electron.shell.openExternal("https://github.com/thecorporategovernanceinstitute");
          }
        }
      ]
    }
  ];
  import_electron.Menu.setApplicationMenu(import_electron.Menu.buildFromTemplate(template));
}
var gotLock = import_electron.app.requestSingleInstanceLock();
try {
  const bootLogPath = import_node_path.join(import_electron.app.getPath("userData"), "boot.log");
  import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] gotLock=${gotLock}, isPackaged=${import_electron.app.isPackaged}
`);
} catch {}
if (!gotLock) {
  try {
    const bootLogPath = import_node_path.join(import_electron.app.getPath("userData"), "boot.log");
    import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] Quitting because gotLock is false
`);
  } catch {}
  import_electron.app.quit();
} else {
  import_electron.app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized())
        mainWindow.restore();
      mainWindow.show();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(false);
      mainWindow.moveTop();
    }
  });
  import_electron.app.whenReady().then(async () => {
    const bootLogPath = import_node_path.join(import_electron.app.getPath("userData"), "boot.log");
    try {
      import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] app.whenReady fired
`);
      import_electron.session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowed = ["media", "audioCapture", "speechRecognition"];
        callback(allowed.includes(permission));
      });
      import_electron.session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
        return ["media", "audioCapture", "speechRecognition"].includes(permission);
      });
      setupApplicationMenu();
      import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] calling startServer
`);
      const port = await startServer();
      import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] startServer returned port ${port}
`);
      await ensureOllamaReady();
      mainWindow = createMainWindow(port);
      mainWindow.show();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(false);
      mainWindow.moveTop();
      import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] mainWindow shown
`);
      try {
        setupSystemTray(mainWindow, port);
        import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] setupSystemTray done
`);
      } catch (trayErr) {
        import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] setupSystemTray error: ${trayErr}
`);
      }
      try {
        import_electron.globalShortcut.register("Alt+V", () => {
          if (!mainWindow)
            return;
          if (mainWindow.isVisible() && mainWindow.isFocused()) {
            mainWindow.hide();
          } else {
            mainWindow.restore();
            mainWindow.show();
            mainWindow.setAlwaysOnTop(true);
            mainWindow.focus();
            mainWindow.setAlwaysOnTop(false);
            mainWindow.moveTop();
          }
        });
      } catch (err) {
        console.warn("Could not register Alt+V global shortcut:", err);
      }
    } catch (err) {
      try {
        const errLog = import_node_path.join(import_electron.app.getPath("userData"), "app-error.log");
        import_node_fs.writeFileSync(errLog, String(err) + `
` + (err instanceof Error ? err.stack : ""));
      } catch {}
      console.error("Failed to launch VALENCE desktop:", err);
    }
  });
  import_electron.app.on("activate", () => {
    if (import_electron.BrowserWindow.getAllWindows().length === 0 && mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  import_electron.app.on("will-quit", () => {
    try {
      const bootLogPath = import_node_path.join(import_electron.app.getPath("userData"), "boot.log");
      import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] will-quit fired
`);
      import_electron.globalShortcut.unregisterAll();
    } catch {}
  });
  import_electron.app.on("before-quit", () => {
    try {
      const bootLogPath = import_node_path.join(import_electron.app.getPath("userData"), "boot.log");
      import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] before-quit fired
`);
    } catch {}
    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch {}
      serverProcess = null;
    }
  });
  import_electron.app.on("window-all-closed", () => {
    try {
      const bootLogPath = import_node_path.join(import_electron.app.getPath("userData"), "boot.log");
      import_node_fs.appendFileSync(bootLogPath, `[${new Date().toISOString()}] window-all-closed fired
`);
    } catch {}
    if (process.platform !== "darwin") {
      import_electron.app.quit();
    }
  });
}
