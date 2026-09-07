'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const media = require('./media');

const isMac = process.platform === 'darwin';
const isDev = process.argv.includes('--dev');
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 980,
    minHeight: 650,
    show: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    backgroundColor: '#1b1030',
    title: 'MMU (Music Metadata Utility)',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
}

app.whenReady().then(() => {
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:get-platform', () => process.platform);
  ipcMain.handle('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow && mainWindow.close());

  ipcMain.handle('media:choose-audio', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Upload your file',
      properties: ['openFile'],
      filters: [{ name: 'Music files', extensions: ['mp3', 'm4a', 'mp4', 'flac', 'ogg', 'opus', 'wav'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return media.probe(result.filePaths[0]);
  });

  ipcMain.handle('media:probe', (_event, filePath) => media.probe(filePath));

  ipcMain.handle('playlist:choose-audio', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Add songs to playlist',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Music files', extensions: ['mp3', 'm4a', 'mp4', 'flac', 'ogg', 'opus', 'wav'] }]
    });
    if (result.canceled || !result.filePaths.length) return [];
    return result.filePaths.map((filePath) => media.probePlaylistEntry(filePath));
  });

  ipcMain.handle('playlist:save', async (_event, payload = {}) => {
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!entries.length) throw new Error('Add at least one song before saving the playlist.');
    const firstPath = entries[0] && entries[0].filePath;
    const baseDir = firstPath && path.isAbsolute(firstPath) ? path.dirname(firstPath) : app.getPath('music');
    const cleanName = String(payload.name || 'My Playlist').trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\.m3u8$/i, '') || 'My Playlist';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save M3U8 playlist',
      defaultPath: path.join(baseDir, `${cleanName}.m3u8`),
      filters: [{ name: 'M3U8 playlist', extensions: ['m3u8'] }]
    });
    if (result.canceled || !result.filePath) return null;
    return media.writePlaylist({
      outputPath: result.filePath,
      entries,
      playlistName: payload.name || cleanName,
      pathMode: payload.pathMode || (payload.relativePaths === false ? 'absolute' : 'relative'),
      devicePath: payload.devicePath || ''
    });
  });

  ipcMain.handle('media:choose-artwork', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose cover artwork',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    return { path: filePath, name: path.basename(filePath), dataUrl: media.imageDataUrl(filePath) };
  });

  ipcMain.handle('media:choose-output', async (_event, inputPath, suggestedName) => {
    if (!inputPath || !fs.existsSync(inputPath)) throw new Error('The original file could not be found.');
    const ext = path.extname(inputPath).toLowerCase();
    const defaultName = String(suggestedName || `${path.basename(inputPath, ext)} - MMU${ext}`).replace(/[\\/:*?"<>|]/g, '-');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save tagged copy',
      defaultPath: path.join(path.dirname(inputPath), defaultName.endsWith(ext) ? defaultName : `${defaultName}${ext}`),
      filters: [{ name: `${ext.slice(1).toUpperCase()} file`, extensions: [ext.slice(1)] }]
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('media:save', (_event, payload) => media.writeMetadata(payload || {}));
  ipcMain.handle('media:reveal', (_event, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
