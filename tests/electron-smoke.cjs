const { app, BrowserWindow, ipcMain, utilityProcess } = require('electron')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const outputPath = process.argv.find((argument) => argument.startsWith('--output='))?.slice('--output='.length)
  || path.join(process.cwd(), 'work', 'electron-smoke.json')
let smokeRepoPath
let smokeMainSha
let smokeFeatureSha
let smokeMergedResidualSha

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
  runGit(['switch', 'main'])
  runGit(['switch', '-c', 'feature/merged-residual'])
  fs.writeFileSync(path.join(smokeRepoPath, 'merged-residual.txt'), 'merged by squash\n')
  runGit(['add', 'merged-residual.txt'])
  runGit(['commit', '-m', 'merged residual'])
  smokeMergedResidualSha = runGit(['rev-parse', 'HEAD'])
  runGit(['switch', 'feature/smoke'])
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
            { name: 'Optional preview', status: 'COMPLETED', conclusion: 'SKIPPED' },
            { name: 'Security', status: 'QUEUED' },
            { name: 'Advisory', status: 'COMPLETED', conclusion: 'NEUTRAL' },
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
            ...['Lint', 'Security', 'Tests', 'Types'].map((name) => ({ name, conclusion: 'SUCCESS', status: 'COMPLETED' })),
          ],
          title: 'Merged smoke-test PR',
          updatedAt: new Date().toISOString(),
        }, {
          author: { login: 'theShyamsindhia' },
          baseRefName: 'main',
          baseRefOid: smokeMainSha,
          commits: [{ oid: smokeMergedResidualSha, messageHeadline: 'merged residual' }],
          headRefName: 'feature/merged-residual',
          headRefOid: smokeMergedResidualSha,
          mergeCommit: { oid: smokeMainSha },
          mergedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          number: 44,
          state: 'MERGED',
          statusCheckRollup: [
            { name: 'Build', conclusion: 'SUCCESS', status: 'COMPLETED' },
            { name: 'Preview', conclusion: 'SUCCESS', status: 'COMPLETED' },
          ],
          title: 'Merged PR with a surviving branch ref',
          updatedAt: new Date().toISOString(),
        }],
      },
      repoPath: smokeRepoPath,
    })
  })
  const [stateFromWorker, timerDelayMs] = await Promise.all([branchState, timerDelay])
  const renderedState = {
    ...stateFromWorker,
    recentChanges: [{
      branchName: 'feature/smoke',
      commitsAdded: 1,
      fromAhead: 0,
      fromSha: smokeMainSha.slice(0, 7),
      id: 'smoke-branch-growth',
      kind: 'branch-advanced',
      observedAt: Date.now() - 12 * 60 * 1000,
      pullRequestNumber: 42,
      subjectKey: 'pr:42',
      toAhead: 1,
      toSha: smokeFeatureSha.slice(0, 7),
    }, {
      branchName: 'feature/pending-checks',
      checks: [
        { name: 'Build', status: 'passed' },
        { name: 'Lint', status: 'failed' },
        { name: 'Preview', status: 'pending' },
        { name: 'Convex tests (1/4)', status: 'passed' },
        { name: 'Convex tests (2/4)', status: 'pending' },
        { name: 'Public Function Auth Guard', status: 'passed' },
      ],
      id: 'smoke-check-change',
      kind: 'checks-changed',
      observedAt: Date.now() - 4 * 60 * 1000,
      pullRequestNumber: 43,
      subjectKey: 'pr:43',
    }],
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
    activeReview: Boolean(document.querySelector('.tree-branch--review-active')),
    activeReviewTransform: getComputedStyle(document.querySelector('.tree-branch--review-active')).transform,
    completedChecksSettled: !document.querySelector('.tree-branch--pr-open.tree-branch--checks-passed.tree-branch--review-active'),
    checkSegments: document.querySelectorAll('.check-ring__segment').length,
    openBloomPetals: document.querySelectorAll('.tree-branch--pr-open.tree-branch--checks-passed .check-bloom__petal').length,
    partialBloomPetals: document.querySelectorAll('.tree-branch--checks-blooming:not(.tree-branch--checks-passed) .check-bloom__petal').length,
    mergedCheckSegments: document.querySelectorAll('.recent-merge .check-ring__segment').length,
    mergedBloomPetals: document.querySelectorAll('.recent-merge .check-bloom__petal').length,
    mergedHoverCard: document.querySelector('.recent-merge .branch-hover-card')?.textContent,
    mergedHitTarget: getComputedStyle(document.querySelector('.recent-merge__hit-area')).pointerEvents,
    mergedLabel: document.querySelector('.recent-merge__label')?.textContent,
    mergedResidual: Boolean(document.querySelector('.tree-branch--merged-residual')),
    mergedResidualDash: getComputedStyle(document.querySelector('.tree-branch--merged-residual .branch-stem')).strokeDasharray,
    mergedResidualLabel: document.querySelector('.tree-branch--merged-residual .branch-label__progress')?.textContent,
    mergedResidualHoverCard: document.querySelector('.tree-branch--merged-residual .branch-hover-card')?.textContent,
    mergedResidualPetals: document.querySelectorAll('.tree-branch--merged-residual .check-bloom__petal').length,
    productionLane: Boolean(document.querySelector('.production-lane')),
    productionLabel: document.querySelector('.production-lane__label')?.textContent,
    retiredMarker: Boolean(document.querySelector('.retired-branch')),
    retiredLabel: document.querySelector('.retired-branch__label')?.textContent,
    spineLabel: document.querySelector('.base-label')?.textContent,
    recentChangeTrace: Boolean(document.querySelector('.recent-change--branch-advanced .recent-change__trace')),
    recentChangeCount: document.querySelectorAll('.recent-change').length,
    recentChangeLabel: document.querySelector('.recent-change__label')?.textContent,
    recentChangeHoverCard: document.querySelector('.recent-change .branch-hover-card')?.textContent,
    recentCheckRows: document.querySelectorAll('.recent-change .check-list__row').length,
    recentCheckOverflow: getComputedStyle(document.querySelector('.recent-change .check-list__rows')).overflowY,
    recentCheckScrollable: document.querySelector('.recent-change .check-list__rows').scrollHeight > document.querySelector('.recent-change .check-list__rows').clientHeight,
    recentCheckStatuses: [...document.querySelectorAll('.recent-change .check-list__status')].map((status) => status.textContent),
  })`)

  if (!state.tree || !state.gripper || !state.overlayApi || !state.openPullRequest || !state.activeReview || state.activeReviewTransform === 'none' || !state.completedChecksSettled || !state.productionLane || !state.retiredMarker || !state.recentChangeTrace || state.recentChangeCount !== 2 || state.checkSegments !== 5 || state.openBloomPetals !== 3 || state.partialBloomPetals !== 1 || state.mergedCheckSegments !== 0 || state.mergedBloomPetals !== 6 || state.mergedHitTarget !== 'all' || !state.mergedHoverCard?.includes('Merged smoke-test PR') || !state.mergedHoverCard?.includes('6 passed') || state.mergedLabel !== 'merged · #41' || !state.mergedResidual || state.mergedResidualDash === 'none' || state.mergedResidualLabel !== 'merged' || !state.mergedResidualHoverCard?.includes('PR merged · branch ref still diverges from main') || state.mergedResidualPetals !== 2 || state.productionLabel !== 'prd · Production' || state.retiredLabel !== 'dev · retired history' || state.spineLabel !== 'main · Beta / Integration' || !state.recentChangeLabel?.startsWith('was · ') || !state.recentChangeHoverCard?.includes('head moved') || state.recentCheckRows !== 6 || state.recentCheckOverflow !== 'auto' || !state.recentCheckScrollable || !state.recentCheckStatuses.includes('Failed') || !state.recentCheckStatuses.includes('Queued') || errors.length || timerDelayMs > 200) {
    throw new Error(`Electron smoke check failed: ${JSON.stringify({ ...state, errors, timerDelayMs })}`)
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify({ ...state, errors, timerDelayMs }, null, 2))
  const layoutChecks = await window.webContents.executeJavaScript(`(() => {
    const branch = (name) => document.querySelector('[data-branch="' + name + '"]')
    const junction = (name) => {
      const node = branch(name).querySelector('.branch-junction-ring')
      return [node.getAttribute('cx'), node.getAttribute('cy')]
    }
    const list = branch('feature/pending-checks').querySelector('.check-list__rows')
    const mergedList = document.querySelector('.recent-merge .check-list__rows')
    return {
      shared: junction('feature/smoke'),
      other: junction('feature/pending-checks'),
      listCount: list.children.length,
      scrollable: list.scrollHeight > list.clientHeight,
      fourRows: list.clientHeight === list.children[0].offsetHeight * 4,
      statuses: list.textContent,
      mergedScrollable: mergedList.scrollHeight > mergedList.clientHeight,
      names: [...document.querySelectorAll('.branch-label__name')].map((node) => node.textContent),
    }
  })()`)
  assert.deepEqual(layoutChecks.shared, layoutChecks.other, 'shared starting commits must share a junction')
  assert.equal(layoutChecks.listCount, 6)
  assert.ok(layoutChecks.scrollable && layoutChecks.mergedScrollable)
  assert.ok(layoutChecks.fourRows)
  assert.match(layoutChecks.statuses, /Running/)
  assert.match(layoutChecks.statuses, /Skipped/)
  assert.match(layoutChecks.statuses, /Neutral/)
  assert.ok(layoutChecks.names.every((name) => !name.includes(' · ')), 'resting names should not include hashes or authors')
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
  const recentChangePoint = await window.webContents.executeJavaScript(`(() => {
    const bounds = document.querySelector('.recent-change--checks-changed .recent-change__hit-ring')?.getBoundingClientRect()
    return bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null
  })()`)
  if (recentChangePoint) {
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(recentChangePoint.x),
      y: Math.round(recentChangePoint.y),
    })
    await new Promise((resolve) => setTimeout(resolve, 220))
    fs.writeFileSync(
      path.join(process.cwd(), 'work', 'recent-changes-inspected-dark.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
  }
  const listPoint = await window.webContents.executeJavaScript(`(() => {
    const list = document.querySelector('.tree-hover-layer .check-list__rows')
    const bounds = list.getBoundingClientRect()
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  })()`)
  window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(listPoint.x), y: Math.round(listPoint.y) })
  window.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(listPoint.x), y: Math.round(listPoint.y), deltaY: -80, deltaX: 0 })
  await new Promise((resolve) => setTimeout(resolve, 160))
  assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.tree-hover-layer .check-list__rows')?.scrollTop > 0`), 'hover list must actually scroll with the wheel')

  window.webContents.send('git-state:changed', {
    ...renderedState,
    current: 'main',
    currentSpineDistance: 3,
    remote: { base: { localRef: 'main', remoteRef: 'origin/main', localSha: smokeMainSha.slice(0, 7), remoteSha: 'upstream', ahead: 0, behind: 47, spineDistance: 3 } },
    branches: renderedState.branches.map((branch) => ({ ...branch, isCurrent: branch.name === 'main' })),
  })
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000
    const check = () => document.querySelector('.upstream-ghost__checkpoint') ? resolve() : Date.now() > deadline ? reject(new Error('Upstream ghost missing')) : setTimeout(check, 20)
    check()
  })`)
  const attachment = await window.webContents.executeJavaScript(`(() => {
    const point = selector => { const node = document.querySelector(selector); return [node.getAttribute('cx'), node.getAttribute('cy')] }
    return { local: point('.spine-current-dot'), start: point('.upstream-ghost__checkpoint'), end: point('.upstream-ghost__head'), head: point('.spine-root') }
  })()`)
  assert.deepEqual(attachment.start, attachment.local, 'ghost must start at the actual local commit')
  assert.deepEqual(attachment.end, attachment.head, 'ghost must end at the remote head')
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
