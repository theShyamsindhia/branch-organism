const { app, BrowserWindow, ipcMain, utilityProcess } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const outputPath = process.argv.find((argument) => argument.startsWith('--output='))?.slice('--output='.length)
  || path.join(process.cwd(), 'work', 'electron-smoke.json')

app.whenReady().then(async () => {
  const worker = utilityProcess.fork(path.join(process.cwd(), 'electron', 'git-worker.cjs'), [], {
    serviceName: 'Branch Organism Smoke Git Snapshot',
    stdio: 'ignore',
  })
  const startedAt = Date.now()
  const timerDelay = new Promise((resolve) => setTimeout(() => resolve(Date.now() - startedAt), 20))
  const branchState = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Git worker smoke test timed out.')), 30000)
    worker.once('message', ({ error, state }) => {
      clearTimeout(timeout)
      if (error) reject(new Error(error))
      else resolve(state)
    })
    worker.postMessage({
      id: 1,
      pullRequestState: { status: 'idle', pullRequests: [] },
      repoPath: process.cwd(),
    })
  })
  const [stateFromWorker, timerDelayMs] = await Promise.all([branchState, timerDelay])

  ipcMain.handle('git-state:get', () => ({ ...stateFromWorker, fetch: { status: 'idle' } }))
  ipcMain.handle('layout-state:get', () => ({ docked: true }))
  const window = new BrowserWindow({
    width: 540,
    height: 820,
    show: false,
    webPreferences: {
      preload: path.join(process.cwd(), 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const errors = []

  window.webContents.on('console-message', (event) => {
    if (event.level >= 2) errors.push(event.message)
  })
  await window.loadFile(path.join(process.cwd(), 'dist', 'index.html'))
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000
    const inspect = () => {
      if (document.querySelector('.git-tree')) resolve()
      else if (Date.now() >= deadline) reject(new Error('Tree did not render.'))
      else setTimeout(inspect, 40)
    }
    inspect()
  })`)
  const state = await window.webContents.executeJavaScript(`({
    title: document.title,
    tree: Boolean(document.querySelector('.git-tree')),
    gripper: Boolean(document.querySelector('.tree-gripper')),
    overlayApi: Boolean(window.gitOverlay),
  })`)

  if (!state.tree || !state.gripper || !state.overlayApi || errors.length || timerDelayMs > 200) {
    throw new Error(`Electron smoke check failed: ${JSON.stringify({ ...state, errors, timerDelayMs })}`)
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify({ ...state, errors, timerDelayMs }, null, 2))
  worker.kill()
  app.quit()
}).catch((error) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify({ error: error.message }, null, 2))
  app.exit(1)
})
