const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { fetchRemote, readBranchState, readGitHubPullRequests } = require('./git-data.cjs')
const { isNearRightEdge, settleWindowBounds } = require('./window-layout.cjs')

const LOCAL_REFRESH_MS = 5000
const REMOTE_REFRESH_MS = 5 * 60 * 1000
const DEFAULT_REPO_PATH = process.cwd()

let overlayWindow
let tray
let localRefreshTimer
let remoteRefreshTimer
let branchState
let repoPath
let refreshPromise
let isQuitting = false
let pullRequestState = { status: 'idle', pullRequests: [] }
let layoutState = { docked: false }
let moveTimer
let positioningWindow = false

function getCommandLineRepoPath() {
  const direct = process.argv.find((argument) => argument.startsWith('--repo='))
  if (direct) return direct.slice('--repo='.length)

  const flagIndex = process.argv.indexOf('--repo')
  if (flagIndex >= 0 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1]
  return process.env.BRANCH_ORGANISM_REPO || null
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'))
  } catch {
    return {}
  }
}

function saveSettings(patch) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true })
  fs.writeFileSync(getConfigPath(), JSON.stringify({ ...readSettings(), ...patch }, null, 2))
}

function saveRepoPath(nextRepoPath) {
  saveSettings({ repoPath: nextRepoPath })
}

function getInitialRepoPath() {
  return path.resolve(getCommandLineRepoPath() || readSettings().repoPath || DEFAULT_REPO_PATH)
}

function placeWindow(window) {
  const savedLayout = readSettings().layout
  const [width, height] = window.getSize()
  if (savedLayout && Number.isFinite(savedLayout.x) && Number.isFinite(savedLayout.y)) {
    const savedBounds = { x: savedLayout.x, y: savedLayout.y, width, height }
    const { workArea } = screen.getDisplayMatching(savedBounds)
    if (savedLayout.docked) savedBounds.x = workArea.x + workArea.width - width
    const settled = settleWindowBounds(savedBounds, workArea)
    layoutState = { docked: Boolean(savedLayout.docked || settled.docked) }
    window.setPosition(settled.x, settled.y)
    saveSettings({ layout: { x: settled.x, y: settled.y, docked: layoutState.docked } })
    return
  }
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + workArea.width - width)
  const y = Math.round(workArea.y + (workArea.height - height) / 2)
  layoutState = { docked: true }
  window.setPosition(x, y)
  saveSettings({ layout: { x, y, docked: true } })
}

function publishLayoutState() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('layout-state:changed', layoutState)
  }
  updateTrayMenu()
}

function handleWindowMove() {
  if (!overlayWindow || positioningWindow) return
  const bounds = overlayWindow.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const docked = isNearRightEdge(bounds, display.workArea)
  if (docked !== layoutState.docked) {
    layoutState = { docked }
    publishLayoutState()
  }

  clearTimeout(moveTimer)
  moveTimer = setTimeout(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    const currentBounds = overlayWindow.getBounds()
    const currentDisplay = screen.getDisplayMatching(currentBounds)
    const settled = settleWindowBounds(currentBounds, currentDisplay.workArea)
    positioningWindow = true
    overlayWindow.setPosition(settled.x, settled.y)
    positioningWindow = false
    layoutState = { docked: settled.docked }
    saveSettings({ layout: { x: settled.x, y: settled.y, docked: settled.docked } })
    publishLayoutState()
  }, 220)
}

function toggleOverlay() {
  if (!overlayWindow) return
  if (overlayWindow.isVisible()) overlayWindow.hide()
  else overlayWindow.showInactive()
  updateTrayMenu()
}

function publishBranchState() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('git-state:changed', branchState)
  }
  updateTrayMenu()
}

function getIncomingCount() {
  return branchState?.remote?.focus?.behind || 0
}

function getTrayStatusLabel() {
  if (!branchState || branchState.status === 'error') return 'No repository selected'
  if (branchState.fetch?.status === 'fetching') return 'Checking the remote…'
  if (getIncomingCount()) {
    const target = branchState.remote.focus.remoteRef
    return `${getIncomingCount()} incoming on ${target}`
  }
  if (branchState.fetch?.status === 'error' || branchState.fetch?.status === 'timeout') return 'Remote unavailable · local view is live'
  if (branchState.remote?.status === 'none') return 'Local only · no remote configured'
  return 'Up to date with the remote'
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <g fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 2.5c-.8 3.2.8 5.5 0 8.5s.8 5.5 0 8.5"/>
        <path d="M11 7c-2.8 0-3.5-1.8-5.7-2.8M11 12c2.8 0 3.7-1.8 5.9-2.6M11 16c-2.6 0-3.5 1.4-5.3 2.2"/>
        <circle cx="5.1" cy="4.1" r="1" fill="#000"/>
        <circle cx="17.2" cy="9.3" r="1" fill="#000"/>
      </g>
    </svg>`
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  icon.setTemplateImage(true)
  return icon
}

function updateTrayMenu() {
  if (!tray) return

  const remoteUrl = branchState?.remote?.webUrl
  const remoteLabel = branchState?.remote?.provider === 'github' ? 'Open on GitHub' : 'Open Remote Repository'
  const menu = Menu.buildFromTemplate([
    { label: 'Branch Organism', enabled: false },
    { label: branchState?.repoName || 'No repository', enabled: false },
    { label: getTrayStatusLabel(), enabled: false },
    { type: 'separator' },
    { label: 'Choose Repository…', click: chooseRepository },
    {
      label: 'Refresh From Remote',
      enabled: branchState?.status === 'ready' && branchState?.fetch?.status !== 'fetching',
      click: () => refreshBranchState({ fetch: true }),
    },
    { label: remoteLabel, visible: Boolean(remoteUrl), click: () => shell.openExternal(remoteUrl) },
    {
      label: 'Dock Tree to Right Edge',
      type: 'checkbox',
      checked: layoutState.docked,
      click: () => {
        const bounds = overlayWindow.getBounds()
        const { workArea } = screen.getDisplayMatching(bounds)
        const docked = !layoutState.docked
        const x = docked
          ? workArea.x + workArea.width - bounds.width
          : workArea.x + workArea.width - bounds.width - 96
        const y = Math.max(workArea.y, bounds.y)
        positioningWindow = true
        overlayWindow.setPosition(x, y)
        positioningWindow = false
        layoutState = { docked }
        saveSettings({ layout: { x, y, docked } })
        publishLayoutState()
      },
    },
    { type: 'separator' },
    {
      label: 'Show Overlay',
      type: 'checkbox',
      checked: Boolean(overlayWindow?.isVisible()),
      click: toggleOverlay,
    },
    { type: 'separator' },
    { label: 'Quit Branch Organism', click: () => app.quit() },
  ])

  tray.setContextMenu(menu)
  tray.setToolTip(`Branch Organism · ${branchState?.repoName || 'choose a repository'}`)
  if (process.platform === 'darwin') tray.setTitle(getIncomingCount() ? ` ${getIncomingCount()}` : '')
}

async function chooseRepository() {
  const result = await dialog.showOpenDialog({
    title: 'Choose a Git repository',
    buttonLabel: 'Track Repository',
    defaultPath: branchState?.status === 'ready' ? branchState.repoPath : undefined,
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return

  const candidateState = readBranchState(result.filePaths[0], pullRequestState)
  if (candidateState.status === 'error') {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Not a Git repository',
      message: 'Choose a folder inside a Git repository.',
      detail: result.filePaths[0],
    })
    return
  }

  repoPath = candidateState.repoPath
  saveRepoPath(repoPath)
  branchState = { ...candidateState, fetch: { status: 'idle' } }
  publishBranchState()
  overlayWindow.showInactive()
  await refreshBranchState({ fetch: true })
}

function refreshBranchState({ fetch = false } = {}) {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    let fetchState = branchState?.fetch || { status: 'idle' }
    if (fetch && branchState?.status === 'ready') {
      fetchState = { status: 'fetching', checkedAt: fetchState.checkedAt }
      branchState = { ...branchState, fetch: fetchState }
      publishBranchState()
      fetchState = await fetchRemote(repoPath)
      pullRequestState = await readGitHubPullRequests(repoPath)
    }

    const nextState = readBranchState(repoPath, pullRequestState)
    if (nextState.status === 'ready') repoPath = nextState.repoPath
    branchState = { ...nextState, fetch: fetchState }
    publishBranchState()
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

function createOverlay() {
  overlayWindow = new BrowserWindow({
    width: 540,
    height: 820,
    transparent: true,
    frame: false,
    resizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  overlayWindow.setAlwaysOnTop(true, 'floating')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  placeWindow(overlayWindow)
  overlayWindow.on('move', handleWindowMove)

  if (process.env.BRANCH_ORGANISM_DEV === '1') {
    overlayWindow.loadURL('http://127.0.0.1:5173')
  } else {
    overlayWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  overlayWindow.once('ready-to-show', () => {
    publishLayoutState()
    overlayWindow.showInactive()
  })
  overlayWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      overlayWindow.hide()
    }
  })
}

app.whenReady().then(() => {
  app.setName('Branch Organism')
  if (process.platform === 'darwin') app.dock.hide()

  repoPath = getInitialRepoPath()
  branchState = { ...readBranchState(repoPath, pullRequestState), fetch: { status: 'idle' } }
  if (branchState.status === 'ready') {
    repoPath = branchState.repoPath
    saveRepoPath(repoPath)
  }
  ipcMain.handle('git-state:get', () => branchState)
  ipcMain.handle('layout-state:get', () => layoutState)
  ipcMain.on('overlay:mouse-passthrough', (_event, ignore) => {
    overlayWindow?.setIgnoreMouseEvents(Boolean(ignore), { forward: true })
  })
  createOverlay()
  tray = new Tray(createTrayIcon())
  updateTrayMenu()

  refreshBranchState({ fetch: true })
  localRefreshTimer = setInterval(() => refreshBranchState(), LOCAL_REFRESH_MS)
  remoteRefreshTimer = setInterval(() => refreshBranchState({ fetch: true }), REMOTE_REFRESH_MS)

  globalShortcut.register('CommandOrControl+Shift+B', toggleOverlay)
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  clearInterval(localRefreshTimer)
  clearInterval(remoteRefreshTimer)
  clearTimeout(moveTimer)
  globalShortcut.unregisterAll()
})

app.on('activate', () => overlayWindow?.showInactive())
