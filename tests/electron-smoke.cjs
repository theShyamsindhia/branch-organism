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
      const distance = branch(name).dataset.spineDistance
      const node = document.querySelector('[data-junction-distance="' + distance + '"] .spine-junction__hit')
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
      currentAuthor: branch('feature/smoke').querySelector('.branch-label__author')?.textContent,
      ghostAuthor: branch('feature/pending-checks').querySelector('.branch-label__author')?.textContent,
      residualAuthor: branch('feature/merged-residual').querySelector('.branch-label__author')?.textContent,
      authorFontSize: getComputedStyle(branch('feature/smoke').querySelector('.branch-label__author')).fontSize,
    }
  })()`)
  assert.deepEqual(layoutChecks.shared, layoutChecks.other, 'shared starting commits must share a junction')
  assert.equal(layoutChecks.currentAuthor, 'Raj · #42')
  assert.equal(layoutChecks.ghostAuthor, 'Bishal · #43')
  assert.equal(layoutChecks.residualAuthor, 'theShyamsindhia · #44')
  assert.equal(layoutChecks.authorFontSize, '8px')
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
    await new Promise((resolve) => setTimeout(resolve, 450))
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
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('.spine-current-detail').textContent`), new RegExp(smokeMainSha.slice(0, 7)), 'current location shows its actual commit')

  const forkBranch = {
    ...renderedState.pullRequestBranches[0],
    name: 'main',
    isCurrent: false,
    hasLocalBranch: false,
    baseDistance: 1,
    attachmentKind: 'merged-history',
    spineAnchorSha: 'abcdef1',
    pullRequest: { ...renderedState.pullRequestBranches[0].pullRequest, number: 99, isCrossRepository: true, headRepositoryOwner: { login: 'xrehpicx' } },
  }
  window.webContents.send('git-state:changed', {
    ...renderedState,
    current: 'main',
    currentSpineDistance: 0,
    branches: renderedState.branches.map((branch) => ({ ...branch, isCurrent: branch.name === 'main', pullRequest: null })),
    pullRequestBranches: [forkBranch],
  })
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000
    const check = () => document.querySelector('[data-attachment="merged-history"]') ? resolve() : Date.now() > deadline ? reject(new Error('Fork branch missing')) : setTimeout(check, 20)
    check()
  })`)
  const forkView = await window.webContents.executeJavaScript(`(() => {
    const branch = document.querySelector('[data-attachment="merged-history"]')
    return { label: branch.querySelector('.branch-label__name').textContent, current: branch.classList.contains('tree-branch--current'), title: document.querySelector('[data-junction-distance="1"] > title').textContent }
  })()`)
  assert.equal(forkView.label, 'xrehpicx:main')
  assert.equal(forkView.current, false)
  assert.match(forkView.title, /1 visible branch connects here · abcdef1/)

  window.webContents.send('git-state:changed', { ...renderedState, pullRequestBranches: [{ ...forkBranch, baseDistance: null, attachmentKind: 'unknown' }] })
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000
    const check = () => document.querySelector('[data-attachment="unknown"]') ? resolve() : Date.now() > deadline ? reject(new Error('Unknown branch missing')) : setTimeout(check, 20)
    check()
  })`)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-attachment="unknown"] .branch-stem')`), null, 'unknown history must not draw a floating stem')

  const jointBranches = [26, 26, 26, 26, 45, 52].map((distance, index) => ({
    name: `feature/joint-${index}`, sha: `head${index}`, ahead: 1, behind: distance,
    baseDistance: distance, mergeBaseSha: distance === 26 ? '262a9cfc5' : distance === 45 ? 'dbaff78ae' : '64414ee7a',
    attachmentKind: 'direct', ageDays: 0, commits: [], isCurrent: false, isBase: false, merged: false,
  }))
  window.webContents.send('git-state:changed', {
    ...renderedState, current: 'main', currentSpineDistance: 0, recentChanges: [], recentMerges: [], pullRequestBranches: [],
    branches: [{ ...renderedState.branches.find((branch) => branch.isBase), isCurrent: true }, ...jointBranches],
  })
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000
    const check = () => document.querySelector('[data-junction-count="4"]') ? resolve() : Date.now() > deadline ? reject(new Error('Shared junction missing')) : setTimeout(check, 20)
    check()
  })`)
  const joints = await window.webContents.executeJavaScript(`(() => {
    const groups = [...document.querySelectorAll('.spine-junction')]
    const start = (path) => path.getAttribute('d').match(/^M ([\\d.]+) ([\\d.]+)/).slice(1).map(Number)
    return {
      counts: groups.map(g => Number(g.dataset.junctionCount)),
      points: groups.map(g => { const dot = g.querySelector('.spine-junction__dot'); return [Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))] }),
      starts: [...document.querySelectorAll('[data-spine-distance="26"] .branch-stem')].map(start),
      duplicateRings: document.querySelectorAll('.tree-branch .branch-junction-ring').length,
    }
  })()`)
  assert.deepEqual(joints.counts, [4, 1, 1])
  assert.equal(joints.duplicateRings, 0)
  joints.starts.forEach((point) => {
    assert.ok(Math.abs(point[0] - joints.points[0][0]) < 0.1)
    assert.ok(Math.abs(point[1] - joints.points[0][1]) < 0.1)
  })
  assert.ok(joints.points[1][1] - joints.points[0][1] >= 18)
  assert.ok(joints.points[2][1] - joints.points[1][1] >= 18)
  const jointHit = await window.webContents.executeJavaScript(`(() => {
    const r = document.querySelector('[data-junction-count="4"] .spine-junction__hit').getBoundingClientRect()
    return {x: r.x + r.width / 2, y: r.y + r.height / 2}
  })()`)
  window.webContents.sendInputEvent({ type: 'mouseMove', x: 20, y: 20 })
  await new Promise((resolve) => setTimeout(resolve, 180))
  window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(jointHit.x), y: Math.round(jointHit.y) })
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000
    const check = () => document.querySelector('.tree-hover-layer .spine-junction__card') ? resolve() : Date.now() > deadline ? reject(new Error('Junction hover missing')) : setTimeout(check, 20)
    check()
  })`)
  assert.match(await window.webContents.executeJavaScript(`document.querySelector('.tree-hover-layer .spine-junction__card').textContent`), /4 visible branches share this ancestor/)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-junction-highlighted="true"]').length`), 4)
  const readCachedSnapshot = () => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Cached snapshot timed out')), 30000)
    worker.once('message', ({ error, state }) => {
      clearTimeout(timeout)
      if (error) reject(new Error(error))
      else resolve(state)
    })
    worker.postMessage({ id: 2, repoPath: smokeRepoPath, pullRequestState: { status: 'idle' } })
  })
  const cleanSnapshot = await readCachedSnapshot()
  fs.appendFileSync(path.join(smokeRepoPath, 'feature.txt'), 'working change\n')
  const dirtySnapshot = await readCachedSnapshot()
  assert.equal(cleanSnapshot.workingTree.dirty, false)
  assert.equal(dirtySnapshot.workingTree.unstaged, 1, 'a graph cache hit must still refresh working changes')
  assert.deepEqual(cleanSnapshot.branches, dirtySnapshot.branches, 'working edits do not alter commit topology')

  for (const onSpine of [false, true]) {
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 20, y: 20 })
    window.webContents.send('git-state:changed', {
      ...dirtySnapshot,
      current: onSpine ? 'main' : dirtySnapshot.current,
      currentSpineDistance: onSpine ? 0 : null,
      branches: dirtySnapshot.branches.map(branch => ({ ...branch, isCurrent: onSpine ? branch.isBase : branch.isCurrent })),
    })
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 2000
      const check = () => document.querySelector('.working-changes') && Boolean(document.querySelector('.spine-current-dot')) === ${onSpine} ? resolve() : Date.now() > deadline ? reject(new Error('Working changes missing')) : setTimeout(check, 20)
      check()
    })`)
    const working = await window.webContents.executeJavaScript(`(() => {
      const group = document.querySelector('.working-changes')
      const head = document.querySelector('${onSpine ? '.spine-current-dot' : '.tree-branch--current .branch-tip'}')
      const start = group.querySelector('path').getAttribute('d').match(/^M ([\\d.]+) ([\\d.]+)/).slice(1).map(Number)
      const r = group.querySelector('.working-changes__tip').getBoundingClientRect()
      return { count: document.querySelectorAll('.working-changes').length, start, head: [Number(head.getAttribute('cx')), Number(head.getAttribute('cy'))], fill: getComputedStyle(group.querySelector('circle')).fill, x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    assert.equal(working.count, 1)
    assert.deepEqual(working.start, working.head, 'offshoot must start at HEAD, not the branch fork')
    assert.equal(working.fill, 'none', 'working changes are hollow, not a commit')
    await new Promise(resolve => setTimeout(resolve, 180))
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(working.x), y: Math.round(working.y) })
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 2000
      const check = () => document.querySelector('.working-changes__card') ? resolve() : Date.now() > deadline ? reject(new Error('Working changes hover missing')) : setTimeout(check, 20)
      check()
    })`)
    const card = await window.webContents.executeJavaScript(`document.querySelector('.working-changes__card').textContent`)
    assert.ok(card.includes(smokeRepoPath))
    assert.match(card, /0 staged · 1 unstaged/)
    assert.equal(await window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.working-changes__card')
      return card.scrollWidth <= card.clientWidth
    })()`), true, 'checkout paths must wrap inside the hover card')
  }
  window.webContents.send('git-state:changed', cleanSnapshot)
  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 2000
    const check = () => !document.querySelector('.working-changes') ? resolve() : Date.now() > deadline ? reject(new Error('Clean checkout still shows working changes')) : setTimeout(check, 20)
    check()
  })`)
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
