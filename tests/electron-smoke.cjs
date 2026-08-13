const { app, BrowserWindow, ipcMain, utilityProcess } = require('electron')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const outputPath = process.argv.find((argument) => argument.startsWith('--output='))?.slice('--output='.length)
  || path.join(process.cwd(), 'work', 'electron-smoke.json')
let smokeRepoPath
let smokeDevSha
let smokeFeatureSha

function runGit(args) {
  return execFileSync('git', ['-C', smokeRepoPath, ...args], { encoding: 'utf8' }).trim()
}

function createSmokeRepository() {
  smokeRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-organism-electron-'))
  runGit(['init', '-b', 'dev'])
  runGit(['config', 'user.name', 'Branch Organism Smoke'])
  runGit(['config', 'user.email', 'smoke@branch-organism.invalid'])
  fs.writeFileSync(path.join(smokeRepoPath, 'seed.txt'), 'seed\n')
  runGit(['add', 'seed.txt'])
  runGit(['commit', '-m', 'seed'])
  smokeDevSha = runGit(['rev-parse', 'HEAD'])
  runGit(['switch', '-c', 'feature/smoke'])
  fs.writeFileSync(path.join(smokeRepoPath, 'feature.txt'), 'feature\n')
  runGit(['add', 'feature.txt'])
  runGit(['commit', '-m', 'feature'])
  smokeFeatureSha = runGit(['rev-parse', 'HEAD'])
}

app.whenReady().then(async () => {
  createSmokeRepository()
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
      pullRequestState: {
        status: 'ready',
        pullRequests: [{
          author: { login: 'xrehpicx' },
          baseRefName: 'dev',
          baseRefOid: smokeDevSha,
          commits: [{ oid: smokeFeatureSha, messageHeadline: 'feature' }],
          headRefName: 'feature/smoke',
          headRefOid: smokeFeatureSha,
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'UNSTABLE',
          number: 42,
          state: 'OPEN',
          statusCheckRollup: [
            { name: 'Build', conclusion: 'SUCCESS', status: 'COMPLETED' },
            { name: 'Lint', conclusion: 'FAILURE', status: 'COMPLETED' },
            { name: 'Preview', status: 'IN_PROGRESS' },
          ],
          title: 'Smoke-test PR status',
          updatedAt: new Date().toISOString(),
        }, {
          author: { login: 'AR13570' },
          baseRefName: 'dev',
          headRefName: 'merged/smoke',
          headRefOid: smokeDevSha,
          mergeCommit: { oid: smokeDevSha },
          mergedAt: new Date().toISOString(),
          number: 41,
          state: 'MERGED',
          statusCheckRollup: [
            { name: 'Build', conclusion: 'SUCCESS', status: 'COMPLETED' },
            { name: 'Preview', conclusion: 'SUCCESS', status: 'COMPLETED' },
          ],
          title: 'Merged smoke-test PR',
          updatedAt: new Date().toISOString(),
        }],
      },
      repoPath: smokeRepoPath,
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
    openPullRequest: Boolean(document.querySelector('.tree-branch--pr-open:not(.tree-branch--pr-ghost)')),
    checkSegments: document.querySelectorAll('.check-ring__segment').length,
    mergedCheckSegments: document.querySelectorAll('.recent-merge .check-ring__segment').length,
    mergedLabel: document.querySelector('.recent-merge__label')?.textContent,
  })`)

  if (!state.tree || !state.gripper || !state.overlayApi || !state.openPullRequest || state.checkSegments !== 5 || state.mergedCheckSegments !== 2 || state.mergedLabel !== 'merged · Arnav #41' || errors.length || timerDelayMs > 200) {
    throw new Error(`Electron smoke check failed: ${JSON.stringify({ ...state, errors, timerDelayMs })}`)
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify({ ...state, errors, timerDelayMs }, null, 2))
  worker.kill()
  fs.rmSync(smokeRepoPath, { force: true, recursive: true })
  app.quit()
}).catch((error) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify({ error: error.message }, null, 2))
  fs.rmSync(smokeRepoPath, { force: true, recursive: true })
  process.stderr.write(`[electron-smoke] ${error.stack || error.message}\n`)
  app.exit(1)
})
