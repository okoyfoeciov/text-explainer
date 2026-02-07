const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onStreamData: (callback) => ipcRenderer.on('stream-data', (_event, value) => callback(value)),
    onStreamEnd: (callback) => ipcRenderer.on('stream-end', (_event) => callback()),
    onStreamError: (callback) => ipcRenderer.on('stream-error', (_event, value) => callback(value))
});
