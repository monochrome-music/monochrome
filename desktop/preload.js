const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    onNavigate: (callback) => ipcRenderer.on('navigate', (_event, path) => callback(path)),
});
