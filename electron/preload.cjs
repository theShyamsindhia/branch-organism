const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gitOverlay', {
  getBranchState: () => ipcRenderer.invoke('git-state:get'),
  getLayoutState: () => ipcRenderer.invoke('layout-state:get'),
  setGripperBounds: (bounds) => ipcRenderer.send('overlay:gripper-bounds', bounds),
  setInteractiveBounds: (bounds) => ipcRenderer.send('overlay:interactive-bounds', bounds),
  openExternal: (url) => ipcRenderer.send('overlay:open-external', url),
  getBranchActions: () => ipcRenderer.invoke('branch-actions:get'),
  planPullRequest: (branch) => ipcRenderer.invoke('pull-request:plan', branch),
  openPullRequest: (branch) => ipcRenderer.send('pull-request:open', branch),
  onBranchActions: (callback) => {
    const listener = (_event, actions) => callback(actions)
    ipcRenderer.on('branch-actions:changed', listener)
    return () => ipcRenderer.removeListener('branch-actions:changed', listener)
  },
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
