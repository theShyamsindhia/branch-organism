const { execFile, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const MAX_BRANCHES = 15

function git(repoPath, args, options = {}) {
  try {
    return execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    }).trim()
  } catch (error) {
    if (options.allowFailure) return null
    const detail = error.stderr?.toString().trim()
    throw new Error(detail || error.message)
  }
}

function readRepositoryFingerprint(inputPath, pullRequestState = { status: 'idle' }) {
  const repoPath = resolveRepositoryPath(inputPath)
  if (!repoPath) return null

  const head = git(repoPath, ['rev-parse', 'HEAD'], { allowFailure: true }) || 'unborn'
  const current = git(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }) || 'detached'
  const refs = git(repoPath, [
    'for-each-ref',
    '--format=%(refname):%(objectname)',
    'refs/heads',
    'refs/remotes',
  ], { allowFailure: true }) || ''

  return JSON.stringify([
    repoPath,
    current,
    head,
    refs,
    new Date().toISOString().slice(0, 10),
    pullRequestState.status || 'idle',
    pullRequestState.checkedAt || 0,
  ])
}

function resolveRepositoryPath(inputPath) {
  const requestedPath = path.resolve(inputPath || process.cwd())
  const direct = git(requestedPath, ['rev-parse', '--show-toplevel'], { allowFailure: true })
  if (direct) return direct

  try {
    const primaryRepositories = fs.readdirSync(requestedPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(requestedPath, entry.name))
      .filter((candidate) => fs.statSync(path.join(candidate, '.git'), { throwIfNoEntry: false })?.isDirectory())

    if (primaryRepositories.length === 1) {
      return git(primaryRepositories[0], ['rev-parse', '--show-toplevel'], { allowFailure: true })
    }
  } catch {
    return null
  }

  return null
}

function selectVisibleBranches(branches, current, base, limit = MAX_BRANCHES) {
  const visible = branches.slice(0, limit)
  const required = [base, current].filter(Boolean)
  const requiredNames = new Set(required)

  for (const branchName of required) {
    if (visible.some((branch) => branch.name === branchName)) continue
    const branch = branches.find((candidate) => candidate.name === branchName)
    const replaceIndex = visible.findLastIndex((candidate) => !requiredNames.has(candidate.name))
    if (branch && replaceIndex >= 0) visible.splice(replaceIndex, 1, branch)
  }

  return visible
}

function findBaseBranch(repoPath, current) {
  const candidates = ['dev', 'develop', 'main', 'master']
  return candidates.find((name) => (
    git(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { allowFailure: true }) !== null
  )) || current
}

function refExists(repoPath, ref) {
  return git(repoPath, ['show-ref', '--verify', '--quiet', `refs/remotes/${ref}`], { allowFailure: true }) !== null
}

function getRemoteWebUrl(remoteUrl) {
  if (!remoteUrl) return null

  const scpMatch = remoteUrl.match(/^git@([^:]+):(.+)$/)
  if (scpMatch) return `https://${scpMatch[1]}/${scpMatch[2].replace(/\.git$/, '')}`

  const sshMatch = remoteUrl.match(/^ssh:\/\/(?:git@)?([^/]+)\/(.+)$/)
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2].replace(/\.git$/, '')}`

  if (/^https?:\/\//.test(remoteUrl)) return remoteUrl.replace(/\.git$/, '')
  return null
}

function findGitHubCli() {
  return ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', 'gh'].find((candidate) => candidate === 'gh' || fs.existsSync(candidate))
}

function summarizeCheckRollup(checks = []) {
  return checks.reduce((summary, check) => {
    const state = check.conclusion || check.state || check.status
    summary.total += 1
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state)) summary.passed += 1
    else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(state)) summary.failed += 1
    else summary.pending += 1
    return summary
  }, { total: 0, passed: 0, failed: 0, pending: 0 })
}

function readGitHubPullRequests(repoPath) {
  const originUrl = git(repoPath, ['remote', 'get-url', 'origin'], { allowFailure: true })
  const webUrl = getRemoteWebUrl(originUrl)
  if (!webUrl?.includes('github.com/')) return Promise.resolve({ status: 'none', pullRequests: [] })

  const executable = findGitHubCli()
  if (!executable) return Promise.resolve({ status: 'unavailable', pullRequests: [] })
  const repository = webUrl.replace(/^https?:\/\//, '')

  return new Promise((resolve) => {
    execFile(executable, [
      '-R', repository,
      'pr', 'list',
      '--state', 'all',
      '--limit', '100',
      '--json', 'number,headRefName,baseRefName,mergeable,mergeStateStatus,title,url,state,mergedAt,updatedAt,statusCheckRollup',
    ], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({ status: 'error', message: stderr?.trim() || error.message, pullRequests: [] })
        return
      }

      try {
        const pullRequests = JSON.parse(stdout).map(({ statusCheckRollup, ...pullRequest }) => ({
          ...pullRequest,
          checks: summarizeCheckRollup(statusCheckRollup),
        }))
        resolve({ status: 'ready', pullRequests, checkedAt: Date.now() })
      } catch (parseError) {
        resolve({ status: 'error', message: parseError.message, pullRequests: [] })
      }
    })
  })
}

function checkMergeConflict(repoPath, baseRef, branchRef) {
  if (!baseRef || !branchRef || baseRef === branchRef) return false

  try {
    execFileSync('git', ['-C', repoPath, 'merge-tree', '--write-tree', baseRef, branchRef], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return false
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`
    return /CONFLICT|<<<<<<<|changed in both/i.test(output) ? true : null
  }
}

function getRelation(repoPath, localRef, remoteRef) {
  if (!localRef || !remoteRef) return null
  const counts = git(repoPath, ['rev-list', '--left-right', '--count', `${localRef}...${remoteRef}`], { allowFailure: true })
  if (!counts) return null
  const [ahead = 0, behind = 0] = counts.split(/\s+/).map(Number)

  return { localRef, remoteRef, ahead, behind }
}

function readCommits(repoPath, refOrRange, limit = 6) {
  if (!refOrRange || limit < 1) return []

  const lines = git(repoPath, [
    'log',
    '--format=%h%x09%ct%x09%s',
    '-n', String(limit),
    refOrRange,
  ], { allowFailure: true })

  return lines
    ? lines.split('\n').map((line) => {
        const [sha, timestamp, ...subjectParts] = line.split('\t')
        return { sha, timestamp: Number(timestamp), subject: subjectParts.join('\t') }
      })
    : []
}

function readIncomingChanges(repoPath, relation) {
  if (!relation || relation.behind < 1) return { incomingCommits: [], changedFiles: [], changedFileCount: 0 }

  const commitLines = git(repoPath, [
    'log',
    '--format=%h%x09%s%x09%an%x09%ar',
    '-n', '4',
    `${relation.localRef}..${relation.remoteRef}`,
  ], { allowFailure: true })
  const incomingCommits = commitLines
    ? commitLines.split('\n').map((line) => {
        const [sha, subject, author, relative] = line.split('\t')
        return { sha, subject, author, relative }
      })
    : []

  const diffLines = git(repoPath, [
    'diff',
    '--name-status',
    `${relation.localRef}...${relation.remoteRef}`,
  ], { allowFailure: true })
  const allChangedFiles = diffLines
    ? diffLines.split('\n').map((line) => {
        const [status, firstPath, secondPath] = line.split('\t')
        return {
          status: status.charAt(0),
          path: secondPath || firstPath,
          previousPath: secondPath ? firstPath : null,
        }
      })
    : []

  return {
    incomingCommits,
    changedFiles: allChangedFiles.slice(0, 5),
    changedFileCount: allChangedFiles.length,
  }
}

function readRemoteState(repoPath, current, base) {
  const remoteNames = (git(repoPath, ['remote'], { allowFailure: true }) || '').split('\n').filter(Boolean)
  if (!remoteNames.length) return { status: 'none' }

  const currentTracking = git(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFailure: true })
  const configuredBaseTracking = git(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${base}@{upstream}`], { allowFailure: true })
  const remoteCandidates = [`origin/${base}`, configuredBaseTracking, `upstream/${base}`, ...remoteNames.map((name) => `${name}/${base}`)]
  const baseTracking = remoteCandidates.find((ref) => ref && refExists(repoPath, ref)) || null
  const currentRelation = getRelation(repoPath, current, currentTracking)
  const baseRelation = getRelation(repoPath, base, baseTracking)
  const focusRelation = [currentRelation, baseRelation].find((relation) => relation?.behind > 0)
    || currentRelation
    || baseRelation
  const remoteRef = focusRelation?.remoteRef || baseTracking || currentTracking
  const remoteName = remoteRef?.split('/')[0] || remoteNames[0]
  const url = git(repoPath, ['remote', 'get-url', remoteName], { allowFailure: true })
  const webUrl = getRemoteWebUrl(url)
  const changes = readIncomingChanges(repoPath, focusRelation)

  return {
    status: 'ready',
    name: remoteName,
    url,
    webUrl,
    provider: webUrl?.includes('github.com/') ? 'github' : 'git',
    base: baseRelation,
    current: currentRelation,
    focus: focusRelation ? { ...focusRelation, ...changes } : null,
    hasIncoming: Boolean(focusRelation?.behind),
  }
}

function fetchRemote(repoPath) {
  const remotes = (git(repoPath, ['remote'], { allowFailure: true }) || '').split('\n').filter(Boolean)
  if (!remotes.length) return Promise.resolve({ status: 'none', checkedAt: Date.now() })

  return new Promise((resolve) => {
    execFile('git', ['-C', repoPath, 'fetch', '--all', '--prune', '--quiet'], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, _stdout, stderr) => {
      if (error) {
        resolve({
          status: error.killed ? 'timeout' : 'error',
          message: stderr?.trim() || error.message,
          checkedAt: Date.now(),
        })
        return
      }
      resolve({ status: 'ready', checkedAt: Date.now() })
    })
  })
}

function readBranchState(inputPath, pullRequestState = { status: 'idle', pullRequests: [] }) {
  const requestedPath = path.resolve(inputPath || process.cwd())

  try {
    const repoPath = resolveRepositoryPath(requestedPath)
    if (!repoPath) throw new Error('No Git repository found.')
    const current = git(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }) || 'detached'
    const base = findBaseBranch(repoPath, current)
    const remote = readRemoteState(repoPath, current, base)
    const comparisonBase = remote.base?.remoteRef || base
    const raw = git(repoPath, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)\t%(objectname:short)\t%(committerdate:unix)\t%(committerdate:relative)\t%(subject)',
      'refs/heads',
    ])

    const allBranches = raw
      ? raw.split('\n').map((line) => {
          const [name, sha, timestamp, relative, ...subjectParts] = line.split('\t')
          return {
            name,
            sha,
            timestamp: Number(timestamp),
            relative,
            subject: subjectParts.join('\t'),
          }
        })
      : []

    const pullRequests = pullRequestState.pullRequests || []
    const branches = selectVisibleBranches(allBranches, current, base).map((branch) => {
      const counts = comparisonBase && branch.name !== base
        ? git(repoPath, ['rev-list', '--left-right', '--count', `${comparisonBase}...${branch.name}`], { allowFailure: true })
        : '0\t0'
      const [behind = 0, ahead = 0] = (counts || '0\t0').split(/\s+/).map(Number)
      const merged = branch.name === base || (
        git(repoPath, ['merge-base', '--is-ancestor', branch.name, base], { allowFailure: true }) !== null
      )
      const matchingPullRequests = pullRequests.filter((candidate) => candidate.headRefName === branch.name && candidate.baseRefName === base)
      const pullRequest = matchingPullRequests.find((candidate) => candidate.state === 'OPEN') || matchingPullRequests[0]
      const remoteConflict = pullRequest?.state === 'OPEN' && (
        pullRequest.mergeable === 'CONFLICTING' || pullRequest.mergeStateStatus === 'DIRTY'
      )
      const localConflict = branch.name === current && !merged
        ? checkMergeConflict(repoPath, comparisonBase, branch.name)
        : null
      const conflict = remoteConflict || localConflict === true
      const ageDays = Math.max(0, Math.floor((Date.now() / 1000 - branch.timestamp) / 86400))
      const commits = branch.name === base
        ? []
        : readCommits(repoPath, `${comparisonBase}..${branch.name}`, Math.min(ahead, 6))

      return {
        ...branch,
        ahead,
        ageDays,
        behind,
        commits,
        conflict,
        conflictSource: remoteConflict ? 'github' : localConflict === true ? 'local' : null,
        merged,
        pullRequest: pullRequest || null,
        stale: behind > 0,
        isBase: branch.name === base,
        isCurrent: branch.name === current,
      }
    })

    return {
      status: branches.length ? 'ready' : 'empty',
      repoName: path.basename(repoPath),
      repoPath,
      current,
      base,
      comparisonBase,
      baseCommits: readCommits(repoPath, comparisonBase, 9),
      remote,
      github: {
        status: pullRequestState.status,
        checkedAt: pullRequestState.checkedAt,
      },
      branches,
      totalBranches: allBranches.length,
      updatedAt: Date.now(),
    }
  } catch (error) {
    return {
      status: 'error',
      repoPath: requestedPath,
      message: 'No Git repository found at this path.',
      detail: error.message,
      updatedAt: Date.now(),
    }
  }
}

module.exports = {
  MAX_BRANCHES,
  fetchRemote,
  getRemoteWebUrl,
  readGitHubPullRequests,
  readBranchState,
  readRepositoryFingerprint,
  resolveRepositoryPath,
  selectVisibleBranches,
  summarizeCheckRollup,
}
