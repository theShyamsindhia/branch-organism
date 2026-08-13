const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gitOverlay', {
  getBranchState: () => ipcRenderer.invoke('git-state:get'),
  getLayoutState: () => ipcRenderer.invoke('layout-state:get'),
  setMousePassthrough: (ignore) => ipcRenderer.send('overlay:mouse-passthrough', ignore),
  onBranchState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('git-state:changed', listener)
    return () => ipcRenderer.removeListener('git-state:changed', listener)
  },
  onLayoutState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('layout-state:changed', listener)
    return () => ipcRenderer.removeListener('layout-state:changed', listener)
  },
})
