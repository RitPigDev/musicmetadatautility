'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('mmu', {
  app: {
    getVersion: () => invoke('app:get-version'),
    getPlatform: () => invoke('app:get-platform')
  },
  window: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggle-maximize'),
    close: () => invoke('window:close')
  },
  playlist: {
    chooseAudio: () => invoke('playlist:choose-audio'),
    save: (payload) => invoke('playlist:save', payload)
  },
  media: {
    chooseAudio: () => invoke('media:choose-audio'),
    probe: (filePath) => invoke('media:probe', filePath),
    chooseArtwork: () => invoke('media:choose-artwork'),
    chooseOutput: (inputPath, suggestedName) => invoke('media:choose-output', inputPath, suggestedName),
    save: (payload) => invoke('media:save', payload),
    reveal: (filePath) => invoke('media:reveal', filePath)
  }
});
