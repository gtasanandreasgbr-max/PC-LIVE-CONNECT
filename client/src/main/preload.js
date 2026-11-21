const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pcLiveAPI', {
  getCaptureSources: () => ipcRenderer.invoke('capture:get-sources'),
  getSettings: () => ipcRenderer.invoke('db:get-settings'),
  saveSetting: (key, value) => ipcRenderer.invoke('db:save-setting', key, value),
  logSession: (data) => ipcRenderer.invoke('db:log-session', data),
  getHistory: () => ipcRenderer.invoke('db:get-history'),
  notify: (title, body) => ipcRenderer.send('notify:show', { title, body }),
  toggleCleanWindow: (open) => ipcRenderer.invoke('obs:toggle-clean-window', open),
  startVirtualCam: (deviceName, fps) => ipcRenderer.invoke('obs:start-virtual-cam', deviceName, fps),
  pushVirtualCamFrame: (buffer) => ipcRenderer.send('obs:push-frame', buffer),
  stopVirtualCam: () => ipcRenderer.invoke('obs:stop-virtual-cam'),
  log: (level, module, message) => ipcRenderer.send('log:write', { level, module, message }),
  onCleanWindowClosed: (cb) => ipcRenderer.on('obs-clean-window-closed', cb),
});
