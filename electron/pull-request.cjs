const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { getRemoteWebUrl } = require('./git-data.cjs')

// Opening a pull request is two deterministic steps: push the branch, then ask
// GitHub for the PR. Everything else here decides where those steps point and
// refuses the cases a script should not guess its way through.

const PUSH_TIMEOUT_MS = 2 * 60 * 1000
const GH_TIMEOUT_MS = 60 * 1000
// Packaged apps start with launchd's PATH, which lacks Homebrew.
const CHILD_PATH = [...new Set(['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH || '/usr/bin:/bin').split(':')])].join(':')
const CHILD_ENV = { ...process.env, PATH: CHILD_PATH, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' }
const TEMPLATE_PATHS = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
]

function run(executable, args, { cwd, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { cwd, encoding: 'utf8', env: CHILD_ENV, maxBuffer: 4 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error((stderr || '').trim() || error.message)
        failure.timedOut = Boolean(error.killed)
        reject(failure)
        return
      }
      resolve(stdout.trim())
    })
  })
}

function git(repoPath, args, options) {
  return run('git', ['-C', repoPath, ...args], options)
}

function gitOrNull(repoPath, args) {
  return git(repoPath, args).catch(() => null)
}

function findGitHubCli() {
  return ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'].find((candidate) => fs.existsSync(candidate)) || 'gh'
}

function parseGitHubRepository(remoteUrl) {
  const match = getRemoteWebUrl(remoteUrl)?.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/)
  return match ? { owner: match[1], name: match[2], slug: `${match[1]}/${match[2]}` } : null
}

async function readRemotes(repoPath) {
  const names = ((await gitOrNull(repoPath, ['remote'])) || '').split('\n').filter(Boolean)
  // The configured URL, before insteadOf rewriting, names the GitHub repository.
  const remotes = await Promise.all(names.map(async (name) => ({
    name,
    repository: parseGitHubRepository(
      await gitOrNull(repoPath, ['config', '--get', `remote.${name}.pushurl`])
      || await gitOrNull(repoPath, ['config', '--get', `remote.${name}.url`]),
    ),
  })))
  return remotes
}

// The PR always targets origin, the same repository vertebrae reads PRs from.
// The push goes wherever this branch is already meant to go, otherwise to the
// user's own fork when there is one, otherwise to origin.
async function choosePushRemote(repoPath, branch, remotes, login) {
  const known = new Set(remotes.map((remote) => remote.name))
  const configured = await gitOrNull(repoPath, ['config', '--get', `branch.${branch}.pushRemote`])
    || await gitOrNull(repoPath, ['config', '--get', 'remote.pushDefault'])
  if (configured && known.has(configured)) return { name: configured, reason: 'configured push remote' }

  const trackingRemote = await gitOrNull(repoPath, ['config', '--get', `branch.${branch}.remote`])
  const trackingMerge = await gitOrNull(repoPath, ['config', '--get', `branch.${branch}.merge`])
  // A branch created from origin/main tracks origin/main; that is not a home for it.
  if (trackingRemote && known.has(trackingRemote) && trackingMerge === `refs/heads/${branch}`) {
    return { name: trackingRemote, reason: 'already tracks it' }
  }

  const fork = login && remotes.find((remote) => (
    remote.name !== 'origin' && remote.repository?.owner.toLowerCase() === login.toLowerCase()
  ))
  if (fork) return { name: fork.name, reason: 'your fork' }
  return { name: 'origin', reason: 'origin' }
}

let cachedLogin
async function readGitHubLogin(gh) {
  if (cachedLogin) return cachedLogin
  cachedLogin = await run(gh, ['api', 'user', '--jq', '.login'], { timeout: GH_TIMEOUT_MS }).catch(() => null)
  return cachedLogin
}

async function readExistingPullRequest(gh, target, branch, headOwner) {
  const output = await run(gh, [
    '-R', target.slug,
    'pr', 'list',
    '--head', branch,
    '--state', 'open',
    '--json', 'number,url,headRepositoryOwner,baseRefName',
  ], { timeout: GH_TIMEOUT_MS })
  return JSON.parse(output || '[]').find((pullRequest) => (
    pullRequest.headRepositoryOwner?.login?.toLowerCase() === headOwner.toLowerCase()
  )) || null
}

function readTemplate(repoPath) {
  for (const candidate of TEMPLATE_PATHS) {
    try {
      return fs.readFileSync(path.join(repoPath, candidate), 'utf8').trim()
    } catch {
      // Try the next conventional location.
    }
  }
  return ''
}

const TRAILER = /^[A-Za-z][\w-]*: \S/

// Co-Authored-By and friends belong to the commit, not the description.
function stripTrailers(message) {
  const paragraphs = message.trim().split(/\n\s*\n/)
  const last = paragraphs.at(-1)?.split('\n') || []
  if (paragraphs.length && last.every((line) => TRAILER.test(line))) paragraphs.pop()
  return paragraphs.join('\n\n').trim()
}

// Commit bodies are wrapped near 72 columns, and GitHub renders every newline
// in a PR body as a break, so rejoin wrapped lines. Lists, quotes, headings,
// tables and code keep their own lines.
function unwrapMessage(message) {
  const lines = []
  let fenced = false
  let joinable = false
  for (const line of message.split('\n')) {
    const fence = /^\s*```/.test(line)
    const block = fence || fenced || !line.trim() || /^(\s{4}|\s*[>|#])/.test(line)
    const item = /^\s*([-*+]|\d+[.)])\s/.test(line)
    if (joinable && !block && !item) lines[lines.length - 1] += ` ${line.trim()}`
    else lines.push(line)
    if (fence) fenced = !fenced
    joinable = !block && !fenced
  }
  return lines.join('\n')
}

function commitBody(commit) {
  return unwrapMessage(stripTrailers(commit.body || ''))
}

// Title from the first commit. A single commit's message becomes the body, the
// way GitHub fills it; several commits become a list, each with its message.
// The repository's own PR template follows, so nothing depends on gh guessing.
function describePullRequest(commits, template = '') {
  const ordered = [...commits].reverse()
  const title = ordered[0]?.subject || 'Update'
  const bodies = ordered.map(commitBody)
  const summary = ordered.length === 1
    ? bodies[0]
    : ordered.map((commit, index) => (
        bodies[index]
          ? `- **${commit.subject}**\n\n${bodies[index].replace(/^(?=.)/gm, '  ')}`
          : `- ${commit.subject}`
      )).join(bodies.some(Boolean) ? '\n\n' : '\n')
  return { title, body: [summary, template].filter(Boolean).join('\n\n') }
}

async function readCommitsAhead(repoPath, baseRef, branch) {
  const records = await gitOrNull(repoPath, ['log', '--format=%h%x1f%s%x1f%b%x1e', `${baseRef}..refs/heads/${branch}`])
  return (records || '').split('\x1e').map((record) => record.replace(/^\n/, '')).filter(Boolean).map((record) => {
    const [sha, subject, body = ''] = record.split('\x1f')
    return { sha, subject, body: body.trim() }
  })
}

async function planPullRequest({ repoPath, branch, base, comparisonBase, protectedBranches = [], dirtyFiles = 0, isCurrent = false, gh = findGitHubCli(), login }) {
  const blockers = []
  const warnings = []
  const plan = { branch, base, blockers, warnings }

  if (!branch || branch === base || protectedBranches.includes(branch)) {
    blockers.push(`${branch || 'This'} is a shared branch, not work to propose.`)
    return plan
  }
  if (await gitOrNull(repoPath, ['check-ref-format', '--branch', branch]) === null
    || await gitOrNull(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]) === null) {
    blockers.push('No local branch with this name.')
    return plan
  }

  const remotes = await readRemotes(repoPath)
  const origin = remotes.find((remote) => remote.name === 'origin')
  if (!origin?.repository) {
    blockers.push('origin is not a GitHub repository.')
    return plan
  }

  const resolvedLogin = login === undefined ? await readGitHubLogin(gh) : login
  const pushRemote = await choosePushRemote(repoPath, branch, remotes, resolvedLogin)
  const pushRepository = remotes.find((remote) => remote.name === pushRemote.name)?.repository
  if (!pushRepository) {
    blockers.push(`${pushRemote.name} is not a GitHub repository.`)
    return plan
  }

  const commits = await readCommitsAhead(repoPath, comparisonBase || base, branch)
  const localSha = await git(repoPath, ['rev-parse', `refs/heads/${branch}`])
  const remoteRef = `refs/remotes/${pushRemote.name}/${branch}`
  const remoteSha = await gitOrNull(repoPath, ['rev-parse', '--verify', '--quiet', remoteRef])
  const remoteOnly = remoteSha
    ? Number(await gitOrNull(repoPath, ['rev-list', '--count', `refs/heads/${branch}..${remoteRef}`]) || 0)
    : 0
  const unpushed = remoteSha
    ? Number(await gitOrNull(repoPath, ['rev-list', '--count', `${remoteRef}..refs/heads/${branch}`]) || 0)
    : commits.length
  const sameRepository = pushRepository.slug.toLowerCase() === origin.repository.slug.toLowerCase()

  Object.assign(plan, {
    commits,
    head: sameRepository ? branch : `${pushRepository.owner}:${branch}`,
    localSha: localSha.slice(0, 7),
    push: { remote: pushRemote.name, repository: pushRepository.slug, reason: pushRemote.reason, unpushed, needed: unpushed > 0 || !remoteSha },
    target: { repository: origin.repository.slug, base },
  })

  if (!commits.length) blockers.push(`No commits ahead of ${base}.`)
  // Never force: someone else's commits on the remote branch are theirs to keep.
  if (remoteOnly > 0) blockers.push(`${pushRemote.name}/${branch} has ${remoteOnly} ${remoteOnly === 1 ? 'commit' : 'commits'} you don't have. Pull them first.`)
  if (isCurrent && dirtyFiles > 0) warnings.push(`${dirtyFiles} uncommitted ${dirtyFiles === 1 ? 'file stays' : 'files stay'} out of the PR.`)
  if (blockers.length) return plan

  try {
    plan.existing = await readExistingPullRequest(gh, origin.repository, branch, pushRepository.owner)
  } catch (error) {
    blockers.push(`GitHub unavailable: ${error.message}`)
    return plan
  }
  if (plan.existing && !plan.push.needed) blockers.push(`PR #${plan.existing.number} already has every commit.`)
  if (!plan.existing) plan.description = describePullRequest(commits, readTemplate(repoPath))
  return plan
}

async function pushBranch(repoPath, plan) {
  const tracking = await gitOrNull(repoPath, ['config', '--get', `branch.${plan.branch}.merge`])
  // Set the upstream only when the branch has no same-name home yet.
  const setUpstream = tracking !== `refs/heads/${plan.branch}`
  await git(repoPath, [
    'push',
    ...(setUpstream ? ['--set-upstream'] : []),
    plan.push.remote,
    `refs/heads/${plan.branch}:refs/heads/${plan.branch}`,
  ], { timeout: PUSH_TIMEOUT_MS })
}

async function createPullRequest(plan, { gh = findGitHubCli() } = {}) {
  const output = await run(gh, [
    '-R', plan.target.repository,
    'pr', 'create',
    '--base', plan.target.base,
    '--head', plan.head,
    '--title', plan.description.title,
    '--body', plan.description.body,
  ], { timeout: GH_TIMEOUT_MS })
  const url = output.split('\n').reverse().find((line) => /^https:\/\/github\.com\/.+\/pull\/\d+/.test(line.trim()))?.trim() || null
  return { url, number: Number(url?.match(/\/pull\/(\d+)/)?.[1]) || null }
}

// Runs a plan that planPullRequest produced moments ago. onStep reports progress.
async function executePullRequest(repoPath, plan, { onStep = () => {}, gh } = {}) {
  if (plan.blockers.length) throw new Error(plan.blockers[0])
  if (plan.push.needed) {
    onStep('pushing')
    await pushBranch(repoPath, plan)
  }
  if (plan.existing) return { number: plan.existing.number, url: plan.existing.url, updated: true }
  onStep('opening')
  return { ...await createPullRequest(plan, { gh }), updated: false }
}

module.exports = {
  choosePushRemote,
  describePullRequest,
  executePullRequest,
  parseGitHubRepository,
  planPullRequest,
}
