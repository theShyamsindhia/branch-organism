const { execFile, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const MAX_BRANCHES = 15
const PR_TRANSITION_MS = 60 * 1000
const RECENT_MERGE_MS = 24 * 60 * 60 * 1000
const WATCHED_PR_AUTHORS = Object.freeze({
  ar13570: 'Arnav',
  ungaaaabungaaa: 'Sammy',
  xrehpicx: 'Raj',
  zendergod: 'Bishal',
})

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

function getWatchedAuthor(author) {
  const login = typeof author === 'string' ? author : author?.login
  return login ? WATCHED_PR_AUTHORS[login.toLowerCase()] || null : null
}

function normalizePullRequest({ statusCheckRollup, ...pullRequest }) {
  const authorLogin = typeof pullRequest.author === 'string'
    ? pullRequest.author
    : pullRequest.author?.login || null
  const authorName = getWatchedAuthor(authorLogin)
  const mergeCommitSha = typeof pullRequest.mergeCommit === 'string'
    ? pullRequest.mergeCommit
    : pullRequest.mergeCommit?.oid || null
  const commits = (pullRequest.commits || []).slice(-6).map((commit) => ({
    sha: (commit.sha || commit.oid || '').slice(0, 7),
    subject: commit.subject || commit.messageHeadline || 'commit',
    timestamp: commit.timestamp || Math.floor(Date.parse(commit.committedDate || '') / 1000) || 0,
  }))

  return {
    ...pullRequest,
    authorLogin,
    authorName,
    checks: pullRequest.checks || summarizeCheckRollup(statusCheckRollup),
    commits,
    headSha: pullRequest.headSha || pullRequest.headRefOid?.slice(0, 7) || commits.at(-1)?.sha || null,
    mergeCommitSha,
    watched: Boolean(authorName),
  }
}

function runPullRequestQuery(executable, repository, state, limit, { includeCommits = false } = {}) {
  const fields = [
    'number', 'headRefName', 'baseRefName', 'headRefOid', 'baseRefOid', 'author', 'isDraft', 'mergeCommit',
    'mergeable', 'mergeStateStatus', 'title', 'url', 'state', 'mergedAt', 'updatedAt', 'statusCheckRollup',
    ...(includeCommits ? ['commits'] : []),
  ].join(',')
  return new Promise((resolve, reject) => {
    execFile(executable, [
      '-R', repository,
      'pr', 'list',
      '--state', state,
      '--limit', String(limit),
      '--json', fields,
    ], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message))
        return
      }

      try {
        resolve(JSON.parse(stdout).map(normalizePullRequest))
      } catch (parseError) {
        reject(parseError)
      }
    })
  })
}

function readGitHubPullRequests(repoPath) {
  const originUrl = git(repoPath, ['remote', 'get-url', 'origin'], { allowFailure: true })
  const webUrl = getRemoteWebUrl(originUrl)
  if (!webUrl?.includes('github.com/')) return Promise.resolve({ status: 'none', pullRequests: [] })

  const executable = findGitHubCli()
  if (!executable) return Promise.resolve({ status: 'unavailable', pullRequests: [] })
  const repository = webUrl.replace(/^https?:\/\//, '')

  return Promise.all([
    runPullRequestQuery(executable, repository, 'open', 40, { includeCommits: true }),
    runPullRequestQuery(executable, repository, 'closed', 30),
  ]).then(([openPullRequests, closedPullRequests]) => {
    const pullRequests = [...openPullRequests, ...closedPullRequests]
      .filter((pullRequest, index, all) => all.findIndex((candidate) => candidate.number === pullRequest.number) === index)
      .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''))
    return { status: 'ready', pullRequests, checkedAt: Date.now() }
  }).catch((error) => ({ status: 'error', message: error.message, pullRequests: [] }))
}

function reconcilePullRequestState(previousState, nextState, now = Date.now()) {
  if (nextState.status !== 'ready') {
    return {
      ...nextState,
      pullRequests: previousState.pullRequests || [],
      transitions: previousState.transitions || [],
    }
  }

  const previousByNumber = new Map((previousState.pullRequests || []).map((pullRequest) => [pullRequest.number, pullRequest]))
  const retainedTransitions = (previousState.transitions || []).filter((transition) => transition.expiresAt > now)
  const detectedTransitions = nextState.pullRequests.flatMap((pullRequest) => {
    const previous = previousByNumber.get(pullRequest.number)
    const watched = previous?.watched || getWatchedAuthor(previous?.authorLogin || previous?.author)
    if (!watched || previous.state !== 'OPEN' || !['MERGED', 'CLOSED'].includes(pullRequest.state)) return []
    return [{
      ...previous,
      ...pullRequest,
      commits: pullRequest.commits?.length ? pullRequest.commits : previous.commits,
      lifecycle: pullRequest.state === 'MERGED' ? 'merging' : 'closing',
      detectedAt: now,
      expiresAt: now + PR_TRANSITION_MS,
    }]
  })
  const transitions = [...detectedTransitions, ...retainedTransitions]
    .filter((transition, index, all) => all.findIndex((candidate) => candidate.number === transition.number) === index)

  return { ...nextState, transitions }
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
  const localSha = git(repoPath, ['rev-parse', '--short', localRef], { allowFailure: true })
  const remoteSha = git(repoPath, ['rev-parse', '--short', remoteRef], { allowFailure: true })

  return { localRef, remoteRef, localSha, remoteSha, ahead, behind }
}

function readCommits(repoPath, refOrRange, limit = 6, { firstParent = false } = {}) {
  if (!refOrRange || limit < 1) return []

  const lines = git(repoPath, [
    'log',
    ...(firstParent ? ['--first-parent'] : []),
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

function fetchPullRequestHeads(repoPath, pullRequestState) {
  const current = git(repoPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }) || 'detached'
  const base = findBaseBranch(repoPath, current)
  const pullRequests = (pullRequestState.pullRequests || [])
    .filter((pullRequest) => pullRequest.watched && pullRequest.state === 'OPEN' && pullRequest.baseRefName === base)
    .slice(0, 12)
  if (!pullRequests.length) return Promise.resolve({ status: 'none' })

  const refspecs = pullRequests.map((pullRequest) => (
    `+refs/pull/${pullRequest.number}/head:refs/branch-organism/pr/${pullRequest.number}`
  ))
  return new Promise((resolve) => {
    execFile('git', ['-C', repoPath, 'fetch', 'origin', '--quiet', ...refspecs], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (error, _stdout, stderr) => {
      resolve(error
        ? { status: error.killed ? 'timeout' : 'error', message: stderr?.trim() || error.message }
        : { status: 'ready' })
    })
  })
}

function resolvePullRequestRef(repoPath, pullRequest) {
  const candidates = [
    pullRequest.number ? `refs/branch-organism/pr/${pullRequest.number}` : null,
    pullRequest.headRefName,
    pullRequest.headRefName ? `origin/${pullRequest.headRefName}` : null,
    pullRequest.headRefOid,
  ].filter(Boolean)

  for (const candidate of candidates) {
    const sha = git(repoPath, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { allowFailure: true })
    if (sha) return candidate
  }
  return null
}

function distanceFromBaseHead(repoPath, comparisonBase, commitSha) {
  if (!comparisonBase || !commitSha) return null
  const commit = git(repoPath, ['rev-parse', '--verify', '--quiet', `${commitSha}^{commit}`], { allowFailure: true })
  if (!commit) return null
  const isAncestor = git(repoPath, ['merge-base', '--is-ancestor', commit, comparisonBase], { allowFailure: true }) !== null
  if (!isAncestor) return null
  const distance = git(repoPath, ['rev-list', '--first-parent', '--count', `${commit}..${comparisonBase}`], { allowFailure: true })
  return distance === null ? null : Number(distance)
}

function relativeActivity(timestamp) {
  const ageDays = Math.max(0, Math.floor((Date.now() / 1000 - timestamp) / 86400))
  return { ageDays, relative: ageDays === 0 ? 'today' : `${ageDays} days ago` }
}

function readPullRequestBranch(repoPath, comparisonBase, current, pullRequest) {
  const branchRef = resolvePullRequestRef(repoPath, pullRequest)
  const counts = branchRef
    ? git(repoPath, ['rev-list', '--left-right', '--count', `${comparisonBase}...${branchRef}`], { allowFailure: true })
    : null
  const [behind = 0, aheadFromGit = pullRequest.commits?.length || 0] = (counts || `0\t${pullRequest.commits?.length || 0}`).split(/\s+/).map(Number)
  const mergeBase = branchRef
    ? git(repoPath, ['merge-base', comparisonBase, branchRef], { allowFailure: true })
    : null
  const mergeBaseSha = mergeBase
    ? git(repoPath, ['rev-parse', '--short', mergeBase], { allowFailure: true })
    : pullRequest.baseRefOid?.slice(0, 7) || null
  const distance = mergeBase
    ? git(repoPath, ['rev-list', '--first-parent', '--count', `${mergeBase}..${comparisonBase}`], { allowFailure: true })
    : null
  const timestamp = Math.floor(Date.parse(pullRequest.updatedAt || '') / 1000) || Math.floor(Date.now() / 1000)
  const activity = relativeActivity(timestamp)
  const commits = pullRequest.commits?.length
    ? pullRequest.commits
    : (branchRef ? readCommits(repoPath, `${comparisonBase}..${branchRef}`, Math.min(aheadFromGit, 6)) : [])
  const conflict = pullRequest.state === 'OPEN' && (
    pullRequest.mergeable === 'CONFLICTING' || pullRequest.mergeStateStatus === 'DIRTY'
  )

  return {
    name: pullRequest.headRefName,
    sha: pullRequest.headSha || (branchRef ? git(repoPath, ['rev-parse', '--short', branchRef], { allowFailure: true }) : null),
    timestamp,
    subject: pullRequest.title,
    ahead: Math.max(aheadFromGit, commits.length),
    ...activity,
    baseDistance: distance === null ? 0 : Number(distance),
    behind,
    commits,
    conflict,
    conflictSource: conflict ? 'github' : null,
    isBase: false,
    isCurrent: pullRequest.headRefName === current,
    isPullRequest: true,
    lifecycle: pullRequest.lifecycle || 'open',
    mergeBaseSha,
    mergeDistance: distanceFromBaseHead(repoPath, comparisonBase, pullRequest.mergeCommitSha),
    merged: pullRequest.state === 'MERGED',
    pullRequest,
    stale: behind > 0,
  }
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

    const pullRequests = (pullRequestState.pullRequests || []).map(normalizePullRequest)
    const pullRequestTransitions = (pullRequestState.transitions || []).map(normalizePullRequest)
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
      const mergeBase = git(repoPath, ['merge-base', comparisonBase, branch.name], { allowFailure: true })
      const mergeBaseSha = mergeBase
        ? git(repoPath, ['rev-parse', '--short', mergeBase], { allowFailure: true })
        : null
      const distanceOutput = mergeBase
        ? git(repoPath, ['rev-list', '--first-parent', '--count', `${mergeBase}..${comparisonBase}`], { allowFailure: true })
        : null

      return {
        ...branch,
        ahead,
        ageDays,
        baseDistance: distanceOutput === null ? null : Number(distanceOutput),
        behind,
        commits,
        conflict,
        conflictSource: remoteConflict ? 'github' : localConflict === true ? 'local' : null,
        merged,
        mergeBaseSha,
        pullRequest: pullRequest || null,
        stale: behind > 0,
        isBase: branch.name === base,
        isCurrent: branch.name === current,
      }
    })

    const pullRequestBranches = [...pullRequests, ...pullRequestTransitions]
      .filter((pullRequest) => (
        pullRequest.watched
        && pullRequest.baseRefName === base
        && (pullRequest.state === 'OPEN' || pullRequest.lifecycle)
      ))
      .filter((pullRequest, index, all) => all.findIndex((candidate) => candidate.number === pullRequest.number) === index)
      .map((pullRequest) => readPullRequestBranch(repoPath, comparisonBase, current, pullRequest))
    const recentMerges = pullRequests
      .filter((pullRequest) => (
        pullRequest.watched
        && pullRequest.baseRefName === base
        && pullRequest.state === 'MERGED'
        && Date.now() - Date.parse(pullRequest.mergedAt || '') <= RECENT_MERGE_MS
      ))
      .sort((left, right) => Date.parse(right.mergedAt || '') - Date.parse(left.mergedAt || ''))
      .slice(0, 4)
      .map((pullRequest) => ({
        authorLogin: pullRequest.authorLogin,
        authorName: pullRequest.authorName,
        mergeDistance: distanceFromBaseHead(repoPath, comparisonBase, pullRequest.mergeCommitSha) ?? 0,
        mergeSha: pullRequest.mergeCommitSha?.slice(0, 7) || null,
        mergedAt: pullRequest.mergedAt,
        number: pullRequest.number,
        title: pullRequest.title,
      }))

    return {
      status: branches.length ? 'ready' : 'empty',
      repoName: path.basename(repoPath),
      repoPath,
      current,
      base,
      comparisonBase,
      baseCommits: readCommits(repoPath, comparisonBase, 9, { firstParent: true }),
      remote,
      github: {
        status: pullRequestState.status,
        checkedAt: pullRequestState.checkedAt,
      },
      branches,
      pullRequestBranches,
      recentMerges,
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
  WATCHED_PR_AUTHORS,
  fetchPullRequestHeads,
  fetchRemote,
  getRemoteWebUrl,
  getWatchedAuthor,
  readGitHubPullRequests,
  readBranchState,
  readRepositoryFingerprint,
  reconcilePullRequestState,
  resolveRepositoryPath,
  selectVisibleBranches,
  summarizeCheckRollup,
}
