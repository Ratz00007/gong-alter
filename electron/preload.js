// electron/preload.ts
var import_electron = require("electron");
var desktopBridge = {
  isDesktop: true,
  platform: process.platform,
  version: "1.0.0"
};
import_electron.contextBridge.exposeInMainWorld("valenceDesktop", desktopBridge);
import_electron.contextBridge.exposeInMainWorld("amberDesktop", desktopBridge);
