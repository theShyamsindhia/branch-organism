const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { readWorkingTree, readRepositoryFingerprint } = require('../electron/git-data.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vertebrae-working-'))
  const repo = path.join(root, 'repo')
  fs.mkdirSync(repo)
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' }).toString().trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'initial\n')
  git('add', '.')
  git('commit', '-m', 'Initial')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, repo, git }
}

test('working changes count files once, preserve status spaces and unusual filenames', (t) => {
  const { repo, git } = fixture(t)
  assert.equal(readWorkingTree(repo).dirty, false)
  const fingerprint = readRepositoryFingerprint(repo)
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'staged\n')
  git('add', 'tracked.txt')
  fs.appendFileSync(path.join(repo, 'tracked.txt'), 'unstaged\n')
  fs.writeFileSync(path.join(repo, 'new\nwith spaces.txt'), 'untracked')
  assert.deepEqual(readWorkingTree(repo), {
    status: 'ready', dirty: true, total: 2, staged: 1, unstaged: 1, untracked: 1, conflicted: 0,
  })
  assert.equal(readRepositoryFingerprint(repo), fingerprint, 'working edits must not invalidate the expensive graph cache')
})

test('renames consume both filenames and deletions remain unstaged', (t) => {
  const { repo, git } = fixture(t)
  git('mv', 'tracked.txt', 'renamed\nfile.txt')
  fs.unlinkSync(path.join(repo, 'renamed\nfile.txt'))
  assert.deepEqual(readWorkingTree(repo), {
    status: 'ready', dirty: true, total: 1, staged: 1, unstaged: 1, untracked: 0, conflicted: 0,
  })
})

test('working changes belong to the selected linked worktree only', (t) => {
  const { root, repo, git } = fixture(t)
  const linked = path.join(root, 'linked')
  git('worktree', 'add', '-b', 'feature/linked', linked)
  fs.appendFileSync(path.join(linked, 'tracked.txt'), 'worktree edit\n')
  assert.equal(readWorkingTree(repo).dirty, false)
  assert.equal(readWorkingTree(linked).unstaged, 1)
  assert.equal(readWorkingTree(linked).total, 1)
  assert.deepEqual(readWorkingTree(path.join(root, 'missing')), { status: 'unavailable' })
})

test('unmerged files count as conflicts instead of staged or unstaged', (t) => {
  const { repo, git } = fixture(t)
  git('switch', '-c', 'other')
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'other\n')
  git('commit', '-am', 'Other')
  git('switch', 'main')
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'main\n')
  git('commit', '-am', 'Main')
  assert.throws(() => git('merge', 'other'))
  assert.deepEqual(readWorkingTree(repo), {
    status: 'ready', dirty: true, total: 1, staged: 0, unstaged: 0, untracked: 0, conflicted: 1,
  })
})
