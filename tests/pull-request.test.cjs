const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { describePullRequest, executePullRequest, parseGitHubRepository, planPullRequest } = require('../electron/pull-request.cjs')

function run(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim()
}

function commit(repoPath, file, message) {
  fs.writeFileSync(path.join(repoPath, file), `${message}\n`)
  run(repoPath, ['add', file])
  run(repoPath, ['commit', '-m', message])
}

// origin is the team repository, fork is the user's copy; both are local bare
// repositories that the config addresses by their GitHub URLs.
function createForkWorkflow(context) {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vertebrae-pr-'))
  context.after(() => fs.rmSync(rootPath, { recursive: true, force: true }))
  const originPath = path.join(rootPath, 'origin.git')
  const forkPath = path.join(rootPath, 'fork.git')
  const repoPath = path.join(rootPath, 'local')
  run(rootPath, ['init', '--bare', '-b', 'main', originPath])
  run(rootPath, ['init', '--bare', '-b', 'main', forkPath])
  fs.mkdirSync(repoPath)
  run(repoPath, ['init', '-b', 'main'])
  run(repoPath, ['config', 'user.name', 'Local'])
  run(repoPath, ['config', 'user.email', 'local@test.invalid'])
  run(repoPath, ['config', `url.${originPath}.insteadOf`, 'https://github.com/acme/app.git'])
  run(repoPath, ['config', `url.${forkPath}.insteadOf`, 'https://github.com/me/app.git'])
  run(repoPath, ['remote', 'add', 'origin', 'https://github.com/acme/app.git'])
  run(repoPath, ['remote', 'add', 'fork', 'https://github.com/me/app.git'])
  commit(repoPath, 'seed.txt', 'seed')
  run(repoPath, ['push', '-u', 'origin', 'main'])
  // Created the usual way, so it tracks origin/main rather than a home of its own.
  run(repoPath, ['switch', '-c', 'feature', '--track', 'origin/main'])
  commit(repoPath, 'one.txt', 'Add the first piece')
  commit(repoPath, 'two.txt', 'Add the second piece')

  const logPath = path.join(rootPath, 'gh.log')
  const listPath = path.join(rootPath, 'pr-list.json')
  const gh = path.join(rootPath, 'gh')
  fs.writeFileSync(gh, [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> '${logPath}'`,
    'case "$*" in',
    `  *"pr list"*) cat '${listPath}' 2>/dev/null || echo '[]' ;;`,
    '  *"pr create"*) echo "https://github.com/acme/app/pull/7" ;;',
    'esac',
  ].join('\n'))
  fs.chmodSync(gh, 0o755)

  return {
    forkPath,
    gh,
    listPath,
    originPath,
    repoPath,
    ghCalls: () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n') : []),
    request: (overrides = {}) => ({ repoPath, branch: 'feature', base: 'main', comparisonBase: 'origin/main', gh, login: 'me', ...overrides }),
  }
}

test('reads GitHub repositories from remote URLs', () => {
  assert.deepEqual(parseGitHubRepository('git@github.com:acme/app.git'), { owner: 'acme', name: 'app', slug: 'acme/app' })
  assert.equal(parseGitHubRepository('https://github.com/acme/app').slug, 'acme/app')
  assert.equal(parseGitHubRepository('https://gitlab.com/acme/app.git'), null)
})

test('describes a pull request from its commits, oldest first, above the template', () => {
  const description = describePullRequest(
    [{ subject: 'Second' }, { subject: 'First' }],
    '## Testing',
  )
  assert.equal(description.title, 'First')
  assert.equal(description.body, '- First\n- Second\n\n## Testing')
})

test('pushes to the fork and opens the PR against origin', async (context) => {
  const workflow = createForkWorkflow(context)
  fs.mkdirSync(path.join(workflow.repoPath, '.github'))
  fs.writeFileSync(path.join(workflow.repoPath, '.github', 'pull_request_template.md'), '## Testing\n')

  const plan = await planPullRequest(workflow.request())
  assert.deepEqual(plan.blockers, [])
  assert.equal(plan.push.remote, 'fork')
  assert.equal(plan.push.reason, 'your fork')
  assert.equal(plan.head, 'me:feature')
  assert.deepEqual(plan.target, { repository: 'acme/app', base: 'main' })
  assert.equal(plan.push.unpushed, 2)
  assert.equal(plan.description.title, 'Add the first piece')
  assert.match(plan.description.body, /- Add the first piece\n- Add the second piece\n\n## Testing/)

  const steps = []
  const result = await executePullRequest(workflow.repoPath, plan, { gh: workflow.gh, onStep: (step) => steps.push(step) })

  assert.deepEqual(steps, ['pushing', 'opening'])
  assert.deepEqual(result, { number: 7, url: 'https://github.com/acme/app/pull/7', updated: false })
  assert.equal(run(workflow.forkPath, ['rev-parse', 'feature']), run(workflow.repoPath, ['rev-parse', 'feature']))
  assert.throws(() => run(workflow.originPath, ['rev-parse', '--verify', '--quiet', 'refs/heads/feature']))
  assert.equal(run(workflow.repoPath, ['rev-parse', '--abbrev-ref', 'feature@{upstream}']), 'fork/feature')
  const create = workflow.ghCalls().find((call) => call.includes('pr create'))
  assert.match(create, /-R acme\/app pr create --base main --head me:feature --title Add the first piece/)
})

test('falls back to origin when no fork belongs to the user', async (context) => {
  const workflow = createForkWorkflow(context)
  const plan = await planPullRequest(workflow.request({ login: 'someone-else' }))
  assert.equal(plan.push.remote, 'origin')
  assert.equal(plan.head, 'feature')
})

test('updates an existing PR by pushing, without opening another', async (context) => {
  const workflow = createForkWorkflow(context)
  run(workflow.repoPath, ['push', '-u', 'fork', 'feature'])
  fs.writeFileSync(workflow.listPath, JSON.stringify([
    { number: 7, url: 'https://github.com/acme/app/pull/7', headRepositoryOwner: { login: 'me' }, baseRefName: 'main' },
  ]))

  const inSync = await planPullRequest(workflow.request())
  assert.deepEqual(inSync.blockers, ['PR #7 already has every commit.'])

  commit(workflow.repoPath, 'three.txt', 'Address review')
  const plan = await planPullRequest(workflow.request())
  assert.equal(plan.push.reason, 'already tracks it')
  assert.equal(plan.push.unpushed, 1)
  const result = await executePullRequest(workflow.repoPath, plan, { gh: workflow.gh })

  assert.equal(result.updated, true)
  assert.equal(result.number, 7)
  assert.equal(workflow.ghCalls().some((call) => call.includes('pr create')), false)
  assert.equal(run(workflow.forkPath, ['rev-parse', 'feature']), run(workflow.repoPath, ['rev-parse', 'feature']))
})

test('refuses instead of forcing over commits that only the remote has', async (context) => {
  const workflow = createForkWorkflow(context)
  run(workflow.repoPath, ['push', '-u', 'fork', 'feature'])
  run(workflow.repoPath, ['reset', '--hard', 'HEAD~1'])
  commit(workflow.repoPath, 'other.txt', 'Diverge locally')

  const plan = await planPullRequest(workflow.request())
  assert.deepEqual(plan.blockers, ["fork/feature has 1 commit you don't have. Pull them first."])
  await assert.rejects(executePullRequest(workflow.repoPath, plan, { gh: workflow.gh }), /Pull them first/)
})

test('refuses shared branches and branches with nothing to propose', async (context) => {
  const workflow = createForkWorkflow(context)
  assert.match((await planPullRequest(workflow.request({ branch: 'main' }))).blockers[0], /shared branch/)
  assert.match((await planPullRequest(workflow.request({ branch: 'prd', protectedBranches: ['prd'] }))).blockers[0], /shared branch/)
  assert.deepEqual((await planPullRequest(workflow.request({ branch: 'missing' }))).blockers, ['No local branch with this name.'])

  run(workflow.repoPath, ['switch', '-c', 'empty', 'origin/main'])
  assert.deepEqual((await planPullRequest(workflow.request({ branch: 'empty' }))).blockers, ['No commits ahead of main.'])
})

test('warns that uncommitted files stay behind', async (context) => {
  const workflow = createForkWorkflow(context)
  const plan = await planPullRequest(workflow.request({ isCurrent: true, dirtyFiles: 3 }))
  assert.deepEqual(plan.warnings, ['3 uncommitted files stay out of the PR.'])
})
