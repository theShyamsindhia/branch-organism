const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray, utilityProcess } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { fetchPullRequestHeads, fetchRemote, readGitHubPullRequests, reconcilePullRequestState } = require('./git-data.cjs')
const { createRefreshQueue } = require('./refresh-queue.cjs')
const { isNearRightEdge, isPointInsideWindowRegion, settleWindowBounds } = require('./window-layout.cjs')

const LOCAL_REFRESH_MS = 5000
const REMOTE_REFRESH_MS = 60 * 1000
const GRIPPER_HIT_TEST_MS = 50
const APP_NAME = 'vertebrae'
const SETTINGS_DIRECTORY = 'branch-organism'
let overlayWindow
let tray
let trayMenu
let localRefreshTimer
let remoteRefreshTimer
let branchState
let repoPath
let landscapeConfiguration = {}
let isQuitting = false
let pullRequestState = { status: 'idle', pullRequests: [] }
let layoutState = { docked: false }
let moveTimer
let positioningWindow = false
let movingWindow = false
let mousePassthrough = true
let gripperBounds
let gripperHitTestTimer
let gitWorker
let workerRequestId = 0
let repoGeneration = 0
let refreshQueue
let initializationPromise
const workerRequests = new Map()

function getCommandLineRepoPath(argv = process.argv) {
  const direct = argv.find((argument) => argument.startsWith('--repo='))
  if (direct) return direct.slice('--repo='.length)

  const flagIndex = argv.indexOf('--repo')
  if (flagIndex >= 0 && argv[flagIndex + 1]) return argv[flagIndex + 1]
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
  const configPath = getConfigPath()
  const temporaryPath = `${configPath}.tmp`

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(temporaryPath, JSON.stringify({ ...readSettings(), ...patch }, null, 2))
    fs.renameSync(temporaryPath, configPath)
  } catch {
    fs.rmSync(temporaryPath, { force: true })
  }
}

function saveRepoPath(nextRepoPath) {
  saveSettings({ repoPath: nextRepoPath })
}

function getConfiguredRepoPath() {
  const configuredPath = getCommandLineRepoPath() || readSettings().repoPath
  return configuredPath ? path.resolve(configuredPath) : null
}

function getLandscapeConfiguration(targetRepoPath) {
  if (!targetRepoPath) return {}
  return readSettings().landscapes?.[path.resolve(targetRepoPath)] || {}
}

function saveLandscapeConfiguration(nextConfiguration) {
  if (!repoPath) return
  const settings = readSettings()
  landscapeConfiguration = nextConfiguration
  saveSettings({
    landscapes: {
      ...(settings.landscapes || {}),
      [repoPath]: nextConfiguration,
    },
  })
}

function applyLandscapeConfiguration(nextConfiguration) {
  saveLandscapeConfiguration(nextConfiguration)
  repoGeneration += 1
  refreshBranchState({ fetch: true })
}

function rejectWorkerRequests(error) {
  for (const { reject, timer } of workerRequests.values()) {
    clearTimeout(timer)
    reject(error)
  }
  workerRequests.clear()
}

function stopGitWorker(error = new Error('Git background process stopped.')) {
  const worker = gitWorker
  gitWorker = null
  worker?.kill()
  rejectWorkerRequests(error)
}

function ensureGitWorker() {
  if (gitWorker) return gitWorker

  const worker = utilityProcess.fork(path.join(__dirname, 'git-worker.cjs'), [], {
    serviceName: `${APP_NAME} Git Snapshot`,
    stdio: 'ignore',
  })
  gitWorker = worker

  worker.on('message', ({ error, id, state }) => {
    const request = workerRequests.get(id)
    if (!request) return
    clearTimeout(request.timer)
    workerRequests.delete(id)
    if (error) request.reject(new Error(error))
    else request.resolve(state)
  })
  worker.on('exit', (code) => {
    if (gitWorker !== worker) return
    gitWorker = null
    rejectWorkerRequests(new Error(`Git background process exited with code ${code}.`))
  })

  return worker
}

function readBranchStateAsync(targetRepoPath, nextPullRequestState, nextLandscapeConfiguration = landscapeConfiguration) {
  return new Promise((resolve, reject) => {
    const id = ++workerRequestId
    const timer = setTimeout(() => {
      const request = workerRequests.get(id)
      if (!request) return
      workerRequests.delete(id)
      request.reject(new Error('Git snapshot timed out.'))
      stopGitWorker(new Error('Git background process restarted after a timeout.'))
    }, 30000)

    workerRequests.set(id, { reject, resolve, timer })
    ensureGitWorker().postMessage({
      id,
      landscapeConfiguration: nextLandscapeConfiguration,
      pullRequestState: nextPullRequestState,
      repoPath: targetRepoPath,
    })
  })
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

function setMousePassthrough(ignore) {
  if (!overlayWindow || overlayWindow.isDestroyed() || mousePassthrough === ignore) return
  mousePassthrough = ignore
  overlayWindow.setIgnoreMouseEvents(ignore, { forward: true })
}

function updateGripperInteractivity() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible() || movingWindow) return
  const overGripper = isPointInsideWindowRegion(
    screen.getCursorScreenPoint(),
    overlayWindow.getBounds(),
    gripperBounds,
  )
  setMousePassthrough(!overGripper)
}

function toggleOverlay() {
  if (!overlayWindow) return
  if (branchState?.status !== 'ready') {
    chooseRepository()
    return
  }
  if (overlayWindow?.isVisible()) overlayWindow.hide()
  else overlayWindow?.showInactive()
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
  const production = branchState.landscape?.production
  if (production?.status === 'drift') {
    return `Production drift · ${branchState.base} +${production.integrationAhead} · ${production.name} +${production.productionAhead}`
  }
  if (production?.status === 'awaiting-promotion') {
    return `${production.integrationAhead} awaiting promotion to ${production.name}`
  }
  if (production?.status === 'production-ahead') {
    return `${production.name} is ${production.productionAhead} ahead of ${branchState.base}`
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

function getLandscapeMenu() {
  const landscape = branchState?.landscape
  const available = landscape?.availableBranches || []
  const integration = landscape?.integration?.name
  const production = landscape?.production?.name || null
  const retired = new Set((landscape?.retired || []).map((branch) => branch.name))
  const enabled = branchState?.status === 'ready' && available.length > 0

  return {
    label: 'Branch Landscape',
    enabled,
    submenu: [
      {
        label: `Integration · ${integration || 'automatic'}`,
        enabled: false,
      },
      {
        label: 'Integration Spine',
        submenu: available.map((name) => ({
          label: name,
          type: 'radio',
          checked: name === integration,
          click: () => applyLandscapeConfiguration({ ...landscapeConfiguration, integration: name }),
        })),
      },
      {
        label: 'Production Lane',
        submenu: [
          {
            label: 'None',
            type: 'radio',
            checked: production === null,
            click: () => applyLandscapeConfiguration({ ...landscapeConfiguration, production: null }),
          },
          ...available
            .filter((name) => name !== integration)
            .map((name) => ({
              label: name,
              type: 'radio',
              checked: name === production,
              click: () => applyLandscapeConfiguration({ ...landscapeConfiguration, production: name }),
            })),
        ],
      },
      {
        label: 'Retired History',
        submenu: available
          .filter((name) => name !== integration && name !== production)
          .map((name) => ({
            label: name,
            type: 'checkbox',
            checked: retired.has(name),
            click: () => {
              const nextRetired = new Set(
                Array.isArray(landscapeConfiguration.retired)
                  ? landscapeConfiguration.retired
                  : [...retired],
              )
              if (nextRetired.has(name)) nextRetired.delete(name)
              else nextRetired.add(name)
              applyLandscapeConfiguration({ ...landscapeConfiguration, retired: [...nextRetired] })
            },
          })),
      },
      { type: 'separator' },
      {
        label: 'Reset to Automatic Roles',
        click: () => applyLandscapeConfiguration({}),
      },
    ],
  }
}

function updateTrayMenu() {
  if (!tray) return

  const remoteUrl = branchState?.remote?.webUrl
  const remoteLabel = branchState?.remote?.provider === 'github' ? 'Open on GitHub' : 'Open Remote Repository'
  trayMenu = Menu.buildFromTemplate([
    { label: APP_NAME, enabled: false },
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
    getLandscapeMenu(),
    { label: 'Setup Help…', click: showSetupHelp },
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
    { label: `Quit ${APP_NAME}`, click: () => app.quit() },
  ])

  tray.setToolTip(`${APP_NAME} · Click to ${overlayWindow?.isVisible() ? 'hide' : 'show'} · Right-click for menu`)
  if (process.platform === 'darwin') tray.setTitle(getIncomingCount() ? ` ${getIncomingCount()}` : '')
}

async function chooseRepository() {
  const wasVisible = Boolean(overlayWindow?.isVisible())
  if (process.platform === 'darwin') app.focus({ steal: true })
  overlayWindow?.setFocusable(true)
  overlayWindow?.show()
  overlayWindow?.focus()

  const result = await dialog.showOpenDialog(overlayWindow, {
    title: 'Choose a Git repository',
    buttonLabel: 'Track Repository',
    defaultPath: branchState?.status === 'ready' ? branchState.repoPath : undefined,
    properties: ['openDirectory'],
  })
  overlayWindow?.setFocusable(false)
  if (result.canceled || !result.filePaths[0]) {
    if (!wasVisible) overlayWindow?.hide()
    return
  }

  const tracked = await trackRepository(result.filePaths[0], { showError: true })
  if (!tracked && !wasVisible) overlayWindow?.hide()
}

async function showSetupHelp() {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: `${APP_NAME} Setup`,
    message: 'Choose any folder inside a local Git repository.',
    detail: [
      'Git is required. macOS will offer to install the Command Line Tools if Git is missing.',
      '',
      'GitHub CLI is optional, but it enables pull requests, checks, conflicts, and merge activity. Install it, then run: gh auth login',
      '',
      'Your chosen repository and tree position are remembered on this Mac.',
    ].join('\n'),
    buttons: ['Done', 'GitHub CLI Website'],
    defaultId: 0,
    cancelId: 0,
  })
  if (result.response === 1) shell.openExternal('https://cli.github.com/')
}

async function trackRepository(candidatePath, { showError = false } = {}) {
  let candidateState
  let candidateLandscape = getLandscapeConfiguration(candidatePath)
  try {
    candidateState = await readBranchStateAsync(candidatePath, { status: 'idle', pullRequests: [] }, candidateLandscape)
    const savedLandscape = getLandscapeConfiguration(candidateState.repoPath)
    if (JSON.stringify(savedLandscape) !== JSON.stringify(candidateLandscape)) {
      candidateLandscape = savedLandscape
      candidateState = await readBranchStateAsync(candidateState.repoPath, { status: 'idle', pullRequests: [] }, candidateLandscape)
    }
  } catch (error) {
    candidateState = { status: 'error', detail: error.message }
  }

  if (candidateState.status === 'error') {
    if (showError) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Not a Git repository',
        message: 'Choose a folder inside a Git repository.',
        detail: candidateState.detail || candidatePath,
      })
    }
    return false
  }

  repoGeneration += 1
  repoPath = candidateState.repoPath
  landscapeConfiguration = candidateLandscape
  pullRequestState = { status: 'idle', pullRequests: [] }
  saveRepoPath(repoPath)
  branchState = { ...candidateState, fetch: { status: 'idle' } }
  publishBranchState()
  overlayWindow.showInactive()
  await refreshBranchState({ fetch: true })
  return true
}

function refreshBranchState({ fetch = false } = {}) {
  return refreshQueue.request({ fetch })
}

async function runRefresh({ fetch }) {
  const generation = repoGeneration
  const targetRepoPath = repoPath

  try {
    let fetchState = branchState?.fetch || { status: 'idle' }
    if (fetch && branchState?.status === 'ready') {
      fetchState = { status: 'fetching', checkedAt: fetchState.checkedAt }
      branchState = { ...branchState, fetch: fetchState }
      publishBranchState()
      fetchState = await fetchRemote(targetRepoPath)
      const nextPullRequestState = await readGitHubPullRequests(targetRepoPath)
      if (nextPullRequestState.status === 'ready') {
        await fetchPullRequestHeads(targetRepoPath, nextPullRequestState, landscapeConfiguration)
      }
      if (generation !== repoGeneration || targetRepoPath !== repoPath) return
      pullRequestState = reconcilePullRequestState(pullRequestState, nextPullRequestState)
    }

    const nextState = await readBranchStateAsync(targetRepoPath, pullRequestState, landscapeConfiguration)
    if (generation !== repoGeneration || targetRepoPath !== repoPath) return
    if (nextState.status === 'ready') repoPath = nextState.repoPath
    branchState = { ...nextState, fetch: fetchState }
    publishBranchState()
  } catch (error) {
    if (generation !== repoGeneration || targetRepoPath !== repoPath) return
    branchState = {
      ...branchState,
      fetch: { status: 'error', message: error.message, checkedAt: Date.now() },
    }
    publishBranchState()
  }
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
      sandbox: true,
    },
  })

  overlayWindow.setAlwaysOnTop(true, 'floating')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })
  mousePassthrough = true
  placeWindow(overlayWindow)
  overlayWindow.on('move', handleWindowMove)
  overlayWindow.on('will-move', () => {
    movingWindow = true
    setMousePassthrough(false)
  })
  overlayWindow.on('moved', () => {
    movingWindow = false
    updateGripperInteractivity()
  })

  if (process.env.BRANCH_ORGANISM_DEV === '1') {
    overlayWindow.loadURL('http://127.0.0.1:5173')
  } else {
    overlayWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  overlayWindow.once('ready-to-show', () => {
    publishLayoutState()
    if (branchState?.status === 'ready') overlayWindow.showInactive()
  })
  overlayWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      overlayWindow.hide()
    }
  })
}

app.setPath('userData', path.join(app.getPath('appData'), SETTINGS_DIRECTORY))
app.setName(APP_NAME)

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else initializationPromise = app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock.hide()

  repoPath = getConfiguredRepoPath()
  if (repoPath) {
    landscapeConfiguration = getLandscapeConfiguration(repoPath)
    try {
      branchState = {
        ...await readBranchStateAsync(repoPath, pullRequestState, landscapeConfiguration),
        fetch: { status: 'idle' },
      }
    } catch (error) {
      branchState = { status: 'error', repoPath, message: 'Unable to inspect this repository.', detail: error.message }
    }
    if (branchState.status === 'ready') {
      repoPath = branchState.repoPath
      saveRepoPath(repoPath)
    }
  } else {
    branchState = { status: 'error', message: 'Choose a Git repository to begin.' }
  }
  refreshQueue = createRefreshQueue(runRefresh)
  ipcMain.handle('git-state:get', () => branchState)
  ipcMain.handle('layout-state:get', () => layoutState)
  ipcMain.on('overlay:gripper-bounds', (event, bounds) => {
    if (event.sender !== overlayWindow?.webContents) return
    const values = [bounds?.x, bounds?.y, bounds?.width, bounds?.height]
    if (!values.every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return
    gripperBounds = bounds
    updateGripperInteractivity()
  })
  createOverlay()
  gripperHitTestTimer = setInterval(updateGripperInteractivity, GRIPPER_HIT_TEST_MS)
  tray = new Tray(createTrayIcon())
  tray.setIgnoreDoubleClickEvents(true)
  tray.on('click', toggleOverlay)
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu))
  updateTrayMenu()

  if (branchState.status === 'ready') refreshBranchState({ fetch: true })
  else setImmediate(chooseRepository)
  localRefreshTimer = setInterval(() => refreshBranchState(), LOCAL_REFRESH_MS)
  remoteRefreshTimer = setInterval(() => refreshBranchState({ fetch: true }), REMOTE_REFRESH_MS)

  globalShortcut.register('CommandOrControl+Shift+B', toggleOverlay)
})

if (hasSingleInstanceLock) {
  app.on('second-instance', (_event, argv) => {
    initializationPromise.then(async () => {
      const requestedRepoPath = getCommandLineRepoPath(argv)
      if (requestedRepoPath) await trackRepository(requestedRepoPath)
      overlayWindow?.showInactive()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  clearInterval(localRefreshTimer)
  clearInterval(remoteRefreshTimer)
  clearInterval(gripperHitTestTimer)
  clearTimeout(moveTimer)
  stopGitWorker()
  globalShortcut.unregisterAll()
})

app.on('activate', () => overlayWindow?.showInactive())
