import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { BeatFXApi } from './types';

const api: BeatFXApi = {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readMeta: (path) => ipcRenderer.invoke('track:metadata', path),
  resolve: (path) => ipcRenderer.invoke('track:resolve', path),
  revealFile: (path) => ipcRenderer.invoke('file:reveal', path),
  scanPaths: (paths) => ipcRenderer.invoke('files:scan', paths),
  saveLyrics: (path, lyrics) => ipcRenderer.invoke('lyrics:save', path, lyrics),
  removeLyrics: (path) => ipcRenderer.invoke('lyrics:remove', path),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return (file as File & { path?: string }).path || '';
    }
  },
  windowAction: (action) => ipcRenderer.send('window:action', action),
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openReleases: () => ipcRenderer.invoke('update:open'),
  platform: process.platform,
  onFilesDropped: (callback) => {
    ipcRenderer.on('files:dropped', (_event, paths: string[]) => callback(paths));
  },
  onFilesOpen: (callback) => {
    ipcRenderer.on('files:open', (_event, paths: string[]) => callback(paths));
  },
};

contextBridge.exposeInMainWorld('beatfx', api);
