const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { fetchRemote, getRemoteWebUrl, getWatchedAuthor, readBranchState, readRepositoryFingerprint, reconcilePullRequestState, resolveRepositoryPath, selectVisibleBranches, summarizeCheckRollup } = require('../electron/git-data.cjs')
const { createRefreshQueue } = require('../electron/refresh-queue.cjs')
const { clampWindowX, clampWindowY, isNearRightEdge, isPointInsideWindowRegion, settleWindowBounds } = require('../electron/window-layout.cjs')

function run(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim()
}

test('keeps the current and base branches inside the visible limit', () => {
  const branches = Array.from({ length: 20 }, (_, index) => ({ name: `branch-${index}` }))
  const visible = selectVisibleBranches(branches, 'branch-19', 'branch-18', 15)

  assert.equal(visible.length, 15)
  assert.ok(visible.some((branch) => branch.name === 'branch-19'))
  assert.ok(visible.some((branch) => branch.name === 'branch-18'))
})

test('snaps near-right windows flush to the display edge', () => {
  const workArea = { x: 0, y: 24, width: 1512, height: 958 }
  const bounds = { x: 900, y: 80, width: 540, height: 820 }

  assert.equal(isNearRightEdge(bounds, workArea), true)
  assert.deepEqual(settleWindowBounds(bounds, workArea), { docked: true, x: 972, y: 80 })
})

test('keeps a freely positioned window upright', () => {
  const workArea = { x: 0, y: 24, width: 1512, height: 958 }
  const bounds = { x: 310, y: 52, width: 540, height: 820 }

  assert.deepEqual(settleWindowBounds(bounds, workArea), { docked: false, x: 310, y: 52 })
})

test('keeps saved windows inside the current display', () => {
  const workArea = { x: 80, y: 24, width: 1280, height: 720 }

  assert.equal(clampWindowX(-900, 540, workArea), 80)
  assert.equal(clampWindowY(900, 820, workArea), 24)
  assert.deepEqual(
    settleWindowBounds({ x: 1900, y: -400, width: 540, height: 820 }, workArea),
    { docked: true, x: 820, y: 24 },
  )
})

test('detects the gripper inside a click-through window', () => {
  const windowBounds = { x: 1260, y: 197, width: 540, height: 820 }
  const gripperBounds = { x: 492, y: 758, width: 44, height: 44 }

  assert.equal(isPointInsideWindowRegion({ x: 1774, y: 977 }, windowBounds, gripperBounds), true)
  assert.equal(isPointInsideWindowRegion({ x: 1700, y: 977 }, windowBounds, gripperBounds), false)
  assert.equal(isPointInsideWindowRegion({ x: 1774, y: 900 }, windowBounds, gripperBounds), false)
})

test('preserves a queued remote refresh while a local refresh is running', async () => {
  const calls = []
  let finishFirst
  const firstRun = new Promise((resolve) => { finishFirst = resolve })
  const queue = createRefreshQueue(async ({ fetch }) => {
    calls.push(fetch)
    if (calls.length === 1) await firstRun
  })

  const running = queue.request()
  queue.request({ fetch: true })
  queue.request()
  finishFirst()
  await running

  assert.deepEqual(calls, [false, true])
})

test('marks a branch behind dev as stale', (context) => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-organism-'))
  context.after(() => fs.rmSync(repoPath, { recursive: true, force: true }))

  run(repoPath, ['init', '-b', 'dev'])
  run(repoPath, ['config', 'user.name', 'Branch Test'])
  run(repoPath, ['config', 'user.email', 'branch@test.local'])
  fs.writeFileSync(path.join(repoPath, 'seed.txt'), 'seed\n')
  run(repoPath, ['add', 'seed.txt'])
  run(repoPath, ['commit', '-m', 'seed'])
  run(repoPath, ['checkout', '-b', 'feature/lateral-growth'])
  fs.writeFileSync(path.join(repoPath, 'feature.txt'), 'feature\n')
  run(repoPath, ['add', 'feature.txt'])
  run(repoPath, ['commit', '-m', 'feature'])
  run(repoPath, ['checkout', 'dev'])
  fs.writeFileSync(path.join(repoPath, 'dev.txt'), 'dev\n')
  run(repoPath, ['add', 'dev.txt'])
  run(repoPath, ['commit', '-m', 'dev moved'])

  const state = readBranchState(repoPath)
  const feature = state.branches.find((branch) => branch.name === 'feature/lateral-growth')

  assert.equal(state.status, 'ready')
  assert.equal(state.base, 'dev')
  assert.equal(state.current, 'dev')
  assert.equal(feature.behind, 1)
  assert.equal(feature.ahead, 1)
  assert.equal(feature.commits.length, 1)
  assert.equal(feature.commits[0].subject, 'feature')
  assert.equal(feature.baseDistance, 1)
  assert.equal(feature.mergeBaseSha, run(repoPath, ['rev-parse', '--short', 'HEAD~1']))
  assert.equal(state.baseCommits[0].subject, 'dev moved')
  assert.equal(feature.stale, true)
  assert.ok(readRepositoryFingerprint(repoPath))
})

test('invalidates a cached snapshot when checkout changes at the same commit', (context) => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-organism-fingerprint-'))
  context.after(() => fs.rmSync(repoPath, { recursive: true, force: true }))

  run(repoPath, ['init', '-b', 'main'])
  run(repoPath, ['config', 'user.name', 'Branch Test'])
  run(repoPath, ['config', 'user.email', 'branch@test.local'])
  fs.writeFileSync(path.join(repoPath, 'seed.txt'), 'seed\n')
  run(repoPath, ['add', 'seed.txt'])
  run(repoPath, ['commit', '-m', 'seed'])
  const mainFingerprint = readRepositoryFingerprint(repoPath)
  run(repoPath, ['switch', '-c', 'feature/same-commit'])

  assert.notEqual(readRepositoryFingerprint(repoPath), mainFingerprint)
})

test('normalizes GitHub remotes into browser URLs', () => {
  assert.equal(getRemoteWebUrl('git@github.com:studio/branch-organism.git'), 'https://github.com/studio/branch-organism')
  assert.equal(getRemoteWebUrl('https://github.com/studio/branch-organism.git'), 'https://github.com/studio/branch-organism')
})

test('summarizes GitHub check rollups for branch hover details', () => {
  assert.deepEqual(summarizeCheckRollup([
    { name: 'Build', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'CI' },
    { name: 'Lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'Preview', status: 'IN_PROGRESS', conclusion: '' },
    { context: 'deploy', state: 'SUCCESS' },
  ]), {
    total: 4,
    passed: 2,
    failed: 1,
    pending: 1,
    items: [
      { name: 'Build', status: 'passed', workflow: 'CI' },
      { name: 'Lint', status: 'failed', workflow: null },
      { name: 'Preview', status: 'pending', workflow: null },
      { name: 'deploy', status: 'passed', workflow: null },
    ],
  })
})

test('maps the monitored PR authors to their display names', () => {
  assert.equal(getWatchedAuthor('xrehpicx'), 'Raj')
  assert.equal(getWatchedAuthor('AR13570'), 'Arnav')
  assert.equal(getWatchedAuthor('ZenderGoD'), 'Bishal')
  assert.equal(getWatchedAuthor('ungaaaabungaaa'), 'Sammy')
  assert.equal(getWatchedAuthor('someone-else'), null)
})

test('shows PRs from GitHub authors outside the original team', (context) => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-organism-generic-pr-'))
  context.after(() => fs.rmSync(repoPath, { recursive: true, force: true }))

  run(repoPath, ['init', '-b', 'main'])
  run(repoPath, ['config', 'user.name', 'Branch Test'])
  run(repoPath, ['config', 'user.email', 'branch@test.invalid'])
  fs.writeFileSync(path.join(repoPath, 'seed.txt'), 'seed\n')
  run(repoPath, ['add', 'seed.txt'])
  run(repoPath, ['commit', '-m', 'seed'])
  const sha = run(repoPath, ['rev-parse', 'HEAD'])

  const state = readBranchState(repoPath, {
    status: 'ready',
    pullRequests: [{
      author: { login: 'octofriend' },
      baseRefName: 'main',
      commits: [{ oid: sha, messageHeadline: 'shared branch' }],
      headRefName: 'friend/shared-branch',
      headRefOid: sha,
      mergeable: 'MERGEABLE',
      number: 7,
      state: 'OPEN',
      updatedAt: new Date().toISOString(),
    }],
  })

  assert.equal(state.pullRequestBranches[0].pullRequest.authorName, 'octofriend')
})

test('detects watched PR merge and close transitions', () => {
  const previous = {
    status: 'ready',
    pullRequests: [
      { number: 81, authorLogin: 'xrehpicx', state: 'OPEN', watched: true },
      { number: 82, authorLogin: 'AR13570', state: 'OPEN', watched: true },
    ],
  }
  const next = {
    status: 'ready',
    checkedAt: 2000,
    pullRequests: [
      { number: 81, authorLogin: 'xrehpicx', state: 'MERGED', watched: true },
      { number: 82, authorLogin: 'AR13570', state: 'CLOSED', watched: true },
    ],
  }
  const reconciled = reconcilePullRequestState(previous, next, 1000)

  assert.equal(reconciled.transitions.find((transition) => transition.number === 81).lifecycle, 'merging')
  assert.equal(reconciled.transitions.find((transition) => transition.number === 82).lifecycle, 'closing')
})

test('resolves a parent folder with one primary worktree', (context) => {
  const parentPath = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-organism-parent-'))
  const repoPath = path.join(parentPath, 'studio')
  context.after(() => fs.rmSync(parentPath, { recursive: true, force: true }))

  fs.mkdirSync(repoPath)
  run(repoPath, ['init', '-b', 'dev'])

  assert.equal(resolveRepositoryPath(parentPath), fs.realpathSync(repoPath))
})

test('uses GitHub mergeability to mark PR conflicts', (context) => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-organism-conflict-'))
  context.after(() => fs.rmSync(repoPath, { recursive: true, force: true }))

  run(repoPath, ['init', '-b', 'dev'])
  run(repoPath, ['config', 'user.name', 'Branch Test'])
  run(repoPath, ['config', 'user.email', 'branch@test.invalid'])
  fs.writeFileSync(path.join(repoPath, 'seed.txt'), 'seed\n')
  run(repoPath, ['add', 'seed.txt'])
  run(repoPath, ['commit', '-m', 'seed'])
  run(repoPath, ['checkout', '-b', 'feature/conflict'])
  fs.writeFileSync(path.join(repoPath, 'seed.txt'), 'feature\n')
  run(repoPath, ['add', 'seed.txt'])
  run(repoPath, ['commit', '-m', 'feature'])
  run(repoPath, ['checkout', 'dev'])
  fs.writeFileSync(path.join(repoPath, 'seed.txt'), 'dev\n')
  run(repoPath, ['add', 'seed.txt'])
  run(repoPath, ['commit', '-m', 'dev'])

  const state = readBranchState(repoPath, {
    status: 'ready',
    pullRequests: [{
      author: { login: 'xrehpicx' },
      baseRefName: 'dev',
      commits: [{ oid: run(repoPath, ['rev-parse', 'feature/conflict']), messageHeadline: 'feature' }],
      headRefName: 'feature/conflict',
      headRefOid: run(repoPath, ['rev-parse', 'feature/conflict']),
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      number: 82,
      state: 'OPEN',
      updatedAt: new Date().toISOString(),
    }],
  })
  const branch = state.branches.find((candidate) => candidate.name === 'feature/conflict')
  const pullRequestBranch = state.pullRequestBranches.find((candidate) => candidate.name === 'feature/conflict')

  assert.equal(branch.conflict, true)
  assert.equal(branch.conflictSource, 'github')
  assert.deepEqual(branch.conflictDetails, {
    files: [{ path: 'seed.txt', type: 'content' }],
    status: 'conflicting',
    total: 1,
  })
  assert.equal(branch.pullRequest.number, 82)
  assert.equal(pullRequestBranch.isPullRequest, true)
  assert.equal(pullRequestBranch.hasLocalBranch, true)
  assert.equal(pullRequestBranch.pullRequest.authorName, 'Raj')
  assert.equal(pullRequestBranch.commits[0].subject, 'feature')
  assert.deepEqual(pullRequestBranch.conflictDetails, branch.conflictDetails)
})

test('models integration, production, and retired branches without merged canopy noise', (context) => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vertebrae-landscape-'))
  const remotePath = path.join(rootPath, 'remote.git')
  const repoPath = path.join(rootPath, 'local')
  context.after(() => fs.rmSync(rootPath, { recursive: true, force: true }))

  fs.mkdirSync(repoPath)
  run(rootPath, ['init', '--bare', remotePath])
  run(repoPath, ['init', '-b', 'main'])
  run(repoPath, ['config', 'user.name', 'Landscape Test'])
  run(repoPath, ['config', 'user.email', 'landscape@test.invalid'])
  fs.writeFileSync(path.join(repoPath, 'seed.txt'), 'seed\n')
  run(repoPath, ['add', 'seed.txt'])
  run(repoPath, ['commit', '-m', 'seed'])
  run(repoPath, ['branch', 'dev'])
  run(repoPath, ['switch', '-c', 'prd'])
  fs.writeFileSync(path.join(repoPath, 'production-one.txt'), 'production one\n')
  run(repoPath, ['add', 'production-one.txt'])
  run(repoPath, ['commit', '-m', 'production one'])
  fs.writeFileSync(path.join(repoPath, 'production-two.txt'), 'production two\n')
  run(repoPath, ['add', 'production-two.txt'])
  run(repoPath, ['commit', '-m', 'production two'])
  run(repoPath, ['switch', 'main'])
  fs.writeFileSync(path.join(repoPath, 'integration.txt'), 'integration\n')
  run(repoPath, ['add', 'integration.txt'])
  run(repoPath, ['commit', '-m', 'integration'])
  run(repoPath, ['branch', 'feature/already-merged'])
  run(repoPath, ['switch', '-c', 'feature/active'])
  fs.writeFileSync(path.join(repoPath, 'active.txt'), 'active\n')
  run(repoPath, ['add', 'active.txt'])
  run(repoPath, ['commit', '-m', 'active feature'])
  run(repoPath, ['remote', 'add', 'origin', remotePath])
  run(repoPath, ['push', 'origin', 'main', 'dev', 'prd'])
  run(repoPath, ['branch', '-D', 'prd'])

  const configuration = { integration: 'main', production: 'prd', retired: ['dev'] }
  const state = readBranchState(repoPath, { status: 'idle', pullRequests: [] }, configuration)
  const automaticState = readBranchState(repoPath)
  const branchNames = state.branches.map((branch) => branch.name)

  assert.equal(state.base, 'main')
  assert.equal(automaticState.base, 'main')
  assert.equal(automaticState.landscape.production.name, 'prd')
  assert.equal(automaticState.landscape.retired[0].name, 'dev')
  assert.deepEqual(state.landscape.integration, { label: 'Beta / Integration', name: 'main' })
  assert.equal(state.landscape.production.ref, 'origin/prd')
  assert.equal(state.landscape.production.status, 'drift')
  assert.equal(state.landscape.production.integrationAhead, 1)
  assert.equal(state.landscape.production.productionAhead, 2)
  assert.deepEqual(state.landscape.retired.map((branch) => ({ contained: branch.contained, name: branch.name, uniqueCommits: branch.uniqueCommits })), [
    { contained: true, name: 'dev', uniqueCommits: 0 },
  ])
  assert.ok(branchNames.includes('main'))
  assert.ok(branchNames.includes('feature/active'))
  assert.ok(!branchNames.includes('feature/already-merged'))
  assert.ok(!branchNames.includes('dev'))
  assert.ok(!branchNames.includes('prd'))
  assert.notEqual(
    readRepositoryFingerprint(repoPath, { status: 'idle' }, configuration),
    readRepositoryFingerprint(repoPath, { status: 'idle' }, { integration: 'dev' }),
  )
})

test('fetches and describes incoming upstream changes', async (context) => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-organism-remote-'))
  const remotePath = path.join(rootPath, 'remote.git')
  const repoPath = path.join(rootPath, 'local')
  const publisherPath = path.join(rootPath, 'publisher')
  context.after(() => fs.rmSync(rootPath, { recursive: true, force: true }))

  fs.mkdirSync(repoPath)
  run(rootPath, ['init', '--bare', remotePath])
  run(repoPath, ['init', '-b', 'dev'])
  run(repoPath, ['config', 'user.name', 'Local Branch'])
  run(repoPath, ['config', 'user.email', 'local@test.invalid'])
  fs.writeFileSync(path.join(repoPath, 'seed.txt'), 'seed\n')
  run(repoPath, ['add', 'seed.txt'])
  run(repoPath, ['commit', '-m', 'seed'])
  run(repoPath, ['remote', 'add', 'origin', remotePath])
  run(repoPath, ['push', '-u', 'origin', 'dev'])

  run(rootPath, ['clone', '-b', 'dev', remotePath, publisherPath])
  run(publisherPath, ['config', 'user.name', 'Remote Branch'])
  run(publisherPath, ['config', 'user.email', 'remote@test.invalid'])
  fs.writeFileSync(path.join(publisherPath, 'remote-shape.txt'), 'new upstream shape\n')
  run(publisherPath, ['add', 'remote-shape.txt'])
  run(publisherPath, ['commit', '-m', 'extend upstream shape'])
  run(publisherPath, ['push', 'origin', 'dev'])

  const fetchState = await fetchRemote(repoPath)
  const state = readBranchState(repoPath)

  assert.equal(fetchState.status, 'ready')
  assert.equal(state.remote.status, 'ready')
  assert.equal(state.remote.focus.remoteRef, 'origin/dev')
  assert.equal(state.remote.focus.behind, 1)
  assert.equal(state.remote.base.remoteSha, run(repoPath, ['rev-parse', '--short', 'origin/dev']))
  assert.equal(state.remote.focus.incomingCommits[0].subject, 'extend upstream shape')
  assert.deepEqual(state.remote.focus.changedFiles[0], {
    status: 'A',
    path: 'remote-shape.txt',
    previousPath: null,
  })
})
