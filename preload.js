const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  ice: () => ipcRenderer.invoke('app:ice'),
  attention: () => ipcRenderer.send('app:attention'),
  input: (evt) => ipcRenderer.send('input:event', evt),
  inputEnable: (on) => ipcRenderer.send('input:enable', !!on),
  inputRelease: () => ipcRenderer.send('input:release'),
  setViewerPlatform: (p) => ipcRenderer.send('input:viewer-platform', p),
  perms: () => ipcRenderer.invoke('app:perms'),
  stage: (on) => ipcRenderer.send('ui:stage', !!on),
});
