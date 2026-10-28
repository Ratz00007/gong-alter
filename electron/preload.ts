// VALENCE Desktop — Preload Script
import { contextBridge, ipcRenderer } from 'electron'

const desktopBridge = {
  isDesktop: true,
  platform: process.platform,
  version: '1.0.0',
}

contextBridge.exposeInMainWorld('valenceDesktop', desktopBridge)
contextBridge.exposeInMainWorld('amberDesktop', desktopBridge)
