const { app, BrowserWindow, ipcMain, utilityProcess } = require('electron')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const outputPath = process.argv.find((argument) => argument.startsWith('--output='))?.slice('--output='.length)
  || path.join(process.cwd(), 'work', 'electron-smoke.json')
let smokeRepoPath
let smokeMainSha
let smokeFeatureSha

function runGit(args) {
  return execFileSync('git', ['-C', smokeRepoPath, ...args], { encoding: 'utf8' }).trim()
}

function createSmokeRepository() {
  smokeRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-organism-electron-'))
  runGit(['init', '-b', 'main'])
  runGit(['config', 'user.name', 'vertebrae Smoke'])
  runGit(['config', 'user.email', 'smoke@branch-organism.invalid'])
  fs.writeFileSync(path.join(smokeRepoPath, 'seed.txt'), 'seed\n')
  runGit(['add', 'seed.txt'])
  runGit(['commit', '-m', 'seed'])
  smokeMainSha = runGit(['rev-parse', 'HEAD'])
  runGit(['switch', '-c', 'feature/smoke'])
  fs.writeFileSync(path.join(smokeRepoPath, 'feature.txt'), 'feature\n')
  runGit(['add', 'feature.txt'])
  runGit(['commit', '-m', 'feature'])
  smokeFeatureSha = runGit(['rev-parse', 'HEAD'])
}

app.whenReady().then(async () => {
  createSmokeRepository()
  const worker = utilityProcess.fork(path.join(process.cwd(), 'electron', 'git-worker.cjs'), [], {
    serviceName: 'vertebrae Smoke Git Snapshot',
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
          baseRefName: 'main',
          baseRefOid: smokeMainSha,
          commits: [{ oid: smokeFeatureSha, messageHeadline: 'feature' }],
          headRefName: 'feature/smoke',
          headRefOid: smokeFeatureSha,
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'UNSTABLE',
          number: 42,
          state: 'OPEN',
          statusCheckRollup: [
            { name: 'Build', conclusion: 'SUCCESS', status: 'COMPLETED' },
            { name: 'Lint', conclusion: 'SUCCESS', status: 'COMPLETED' },
            { name: 'Preview', conclusion: 'SUCCESS', status: 'COMPLETED' },
          ],
          title: 'Smoke-test PR status',
          updatedAt: new Date().toISOString(),
        }, {
          author: { login: 'ZenderGoD' },
          baseRefName: 'main',
          baseRefOid: smokeMainSha,
          commits: [{ oid: smokeMainSha, messageHeadline: 'pending checks' }],
          headRefName: 'feature/pending-checks',
          headRefOid: smokeMainSha,
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'UNSTABLE',
          number: 43,
          state: 'OPEN',
          statusCheckRollup: [
            { name: 'Build', conclusion: 'SUCCESS', status: 'COMPLETED' },
            { name: 'Lint', conclusion: 'FAILURE', status: 'COMPLETED' },
            { name: 'Preview', status: 'IN_PROGRESS' },
          ],
          title: 'Pending smoke-test PR',
          updatedAt: new Date().toISOString(),
        }, {
          author: { login: 'AR13570' },
          baseRefName: 'main',
          headRefName: 'merged/smoke',
          headRefOid: smokeMainSha,
          mergeCommit: { oid: smokeMainSha },
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
  const renderedState = {
    ...stateFromWorker,
    landscape: {
      availableBranches: ['main', 'prd', 'dev'],
      integration: { label: 'Beta / Integration', name: 'main' },
      production: {
        commits: [
          { sha: '9b4e1cc', subject: 'production checkpoint' },
          { sha: '71cdd42', subject: 'release hardening' },
        ],
        integrationAhead: 1,
        mergeBaseSha: smokeMainSha.slice(0, 7),
        mergeDistance: 1,
        name: 'prd',
        productionAhead: 2,
        ref: 'origin/prd',
        sha: '9b4e1cc',
        status: 'drift',
      },
      retired: [{
        contained: true,
        mergeDistance: 2,
        name: 'dev',
        ref: 'origin/dev',
        sha: smokeMainSha.slice(0, 7),
        uniqueCommits: 0,
      }],
    },
  }

  ipcMain.handle('git-state:get', () => ({ ...renderedState, fetch: { status: 'idle' } }))
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
    openBloomPetals: document.querySelectorAll('.tree-branch--pr-open.tree-branch--checks-passed .check-bloom__petal').length,
    partialBloomPetals: document.querySelectorAll('.tree-branch--checks-blooming:not(.tree-branch--checks-passed) .check-bloom__petal').length,
    mergedCheckSegments: document.querySelectorAll('.recent-merge .check-ring__segment').length,
    mergedBloomPetals: document.querySelectorAll('.recent-merge .check-bloom__petal').length,
    mergedHoverCard: document.querySelector('.recent-merge .branch-hover-card')?.textContent,
    mergedHitTarget: getComputedStyle(document.querySelector('.recent-merge__hit-area')).pointerEvents,
    mergedLabel: document.querySelector('.recent-merge__label')?.textContent,
    productionLane: Boolean(document.querySelector('.production-lane')),
    productionLabel: document.querySelector('.production-lane__label')?.textContent,
    retiredMarker: Boolean(document.querySelector('.retired-branch')),
    retiredLabel: document.querySelector('.retired-branch__label')?.textContent,
    spineLabel: document.querySelector('.base-label')?.textContent,
  })`)

  if (!state.tree || !state.gripper || !state.overlayApi || !state.openPullRequest || !state.productionLane || !state.retiredMarker || state.checkSegments !== 2 || state.openBloomPetals !== 3 || state.partialBloomPetals !== 1 || state.mergedCheckSegments !== 0 || state.mergedBloomPetals !== 2 || state.mergedHitTarget !== 'all' || !state.mergedHoverCard?.includes('Merged smoke-test PR') || !state.mergedHoverCard?.includes('2 passed') || state.mergedLabel !== 'merged · Arnav #41' || state.productionLabel !== 'prd · Production' || state.retiredLabel !== 'dev · retired history' || state.spineLabel !== 'main · Beta / Integration' || errors.length || timerDelayMs > 200) {
    throw new Error(`Electron smoke check failed: ${JSON.stringify({ ...state, errors, timerDelayMs })}`)
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify({ ...state, errors, timerDelayMs }, null, 2))
  await new Promise((resolve) => setTimeout(resolve, 700))
  await window.webContents.executeJavaScript(`{
    document.documentElement.style.setProperty('background', '#ffffff', 'important')
    document.body.style.setProperty('background', '#ffffff', 'important')
    document.getElementById('root').style.setProperty('background', '#ffffff', 'important')
  }`)
  fs.writeFileSync(path.join(process.cwd(), 'work', 'forward-landscape.png'), (await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`{
    document.documentElement.style.setProperty('background', '#101514', 'important')
    document.body.style.setProperty('background', '#101514', 'important')
    document.getElementById('root').style.setProperty('background', '#101514', 'important')
  }`)
  fs.writeFileSync(path.join(process.cwd(), 'work', 'forward-landscape-dark.png'), (await window.webContents.capturePage()).toPNG())
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
