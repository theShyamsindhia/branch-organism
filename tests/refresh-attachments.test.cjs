const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { readBranchState, readRepositoryFingerprint } = require('../electron/git-data.cjs')
const { createRefreshCoordinator } = require('../electron/refresh-queue.cjs')

function fixture(context) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vertebrae-anchors-'))
  context.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.test')
  git('commit', '--allow-empty', '-m', 'root')
  git('switch', '-c', 'side')
  git('commit', '--allow-empty', '-m', 'shared side history')
  const shared = git('rev-parse', 'HEAD')
  git('switch', '-c', 'fork-main')
  git('commit', '--allow-empty', '-m', 'fork work')
  const head = git('rev-parse', 'HEAD')
  git('update-ref', 'refs/branch-organism/pr/1', head)
  git('switch', 'main')
  git('merge', '--no-ff', 'side', '-m', 'integrate side')
  const checkpoint = git('rev-parse', 'HEAD')
  git('commit', '--allow-empty', '-m', 'new main work')
  const pr = { number: 1, headRefName: 'main', baseRefName: 'main', headRefOid: head, baseRefOid: git('rev-parse', 'main'), isCrossRepository: true, headRepositoryOwner: { login: 'xrehpicx' }, author: { login: 'xrehpicx' }, state: 'OPEN', updatedAt: new Date().toISOString() }
  return { repo, git, shared, head, checkpoint, pr }
}

test('fork PR uses its own head and attaches through the first containing merge', (context) => {
  const { repo, git, shared, checkpoint, pr } = fixture(context)
  const state = readBranchState(repo, { status: 'ready', pullRequests: [pr] })
  const branch = state.pullRequestBranches[0]
  assert.equal(branch.baseDistance, 1)
  assert.equal(branch.attachmentKind, 'merged-history')
  assert.equal(branch.spineAnchorSha, checkpoint.slice(0, 7))
  assert.equal(branch.mergeBaseSha, shared.slice(0, 7))
  assert.equal(branch.hasLocalBranch, false)
  assert.equal(branch.isCurrent, false)
  assert.equal(state.branches.find((item) => item.name === 'main').pullRequest, null)
  assert.equal(state.currentSpineDistance, 0)
  git('switch', 'side')
  const offSpineHead = readBranchState(repo)
  assert.equal(offSpineHead.currentSpineDistance, null, 'projecting an attachment must not project HEAD onto another commit')
  assert.equal(offSpineHead.branches.find((item) => item.isCurrent).baseDistance, 1)
})

test('unavailable PR head never falls back to a same-named local branch or advertised base', (context) => {
  const { repo, pr } = fixture(context)
  const state = readBranchState(repo, { status: 'ready', pullRequests: [{ ...pr, headRefOid: 'f'.repeat(40) }] })
  assert.equal(state.pullRequestBranches[0].baseDistance, null)
  assert.equal(state.pullRequestBranches[0].mergeBaseSha, null)
})

test('a fork checkout can match a PR when both its branch name and commit agree', (context) => {
  const { repo, git, pr } = fixture(context)
  git('switch', 'fork-main')
  const state = readBranchState(repo, { status: 'ready', pullRequests: [{ ...pr, headRefName: 'fork-main' }] })
  assert.equal(state.pullRequestBranches[0].hasLocalBranch, true)
  assert.equal(state.pullRequestBranches[0].isCurrent, true)
  assert.equal(state.branches.find((item) => item.isCurrent).pullRequest.number, 1)
})

test('cache responds to data and private refs, not an unchanged network poll timestamp', (context) => {
  const { repo, git, pr } = fixture(context)
  const first = { status: 'ready', checkedAt: 1, pullRequests: [pr] }
  const fingerprint = readRepositoryFingerprint(repo, first)
  assert.equal(readRepositoryFingerprint(repo, { ...first, checkedAt: 2 }), fingerprint)
  assert.notEqual(readRepositoryFingerprint(repo, { ...first, pullRequests: [{ ...pr, mergeStateStatus: 'DIRTY' }] }), fingerprint)
  git('update-ref', 'refs/branch-organism/pr/1', 'main')
  assert.notEqual(readRepositoryFingerprint(repo, first), fingerprint)
})

test('network work cannot block local checks and overlapping remote polls are coalesced', async () => {
  let release
  const network = new Promise((resolve) => { release = resolve })
  let locals = 0
  let remotes = 0
  const queue = createRefreshCoordinator({
    local: async () => { locals += 1 },
    remote: async () => { remotes += 1; await network },
  })
  const first = queue.request({ fetch: true })
  const second = queue.request({ fetch: true })
  await queue.request()
  assert.equal(locals, 1)
  assert.equal(remotes, 1)
  release()
  await Promise.all([first, second])
  assert.equal(locals, 2, 'remote completion requests a fresh local snapshot')
  assert.equal(remotes, 1)
  await queue.request({ fetch: true })
  assert.equal(remotes, 2)
})

test('switching repositories during a remote poll schedules the new repository too', async () => {
  let generation = 0
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const calls = []
  const queue = createRefreshCoordinator({
    context: () => generation,
    local: async () => {},
    remote: async () => { calls.push(generation); await pending },
  })
  const oldPoll = queue.request({ fetch: true })
  await Promise.resolve()
  generation = 1
  const newPoll = queue.request({ fetch: true })
  release()
  await Promise.all([oldPoll, newPoll])
  assert.deepEqual(calls, [0, 1])
})
