export const RECENT_CHANGE_TTL_MS = 6 * 60 * 60 * 1000
export const MAX_RECENT_CHANGES = 12

export function branchSubjectKey(branch) {
  const pullRequestNumber = branch.pullRequest?.number
  return pullRequestNumber ? `pr:${pullRequestNumber}` : `branch:${branch.name}`
}

function snapshotChecks(checks) {
  return Object.fromEntries((checks?.items || []).map((check) => [check.name, check.status]))
}

function snapshotBranch(branch) {
  return {
    ahead: branch.ahead || 0,
    behind: branch.behind || 0,
    checks: snapshotChecks(branch.pullRequest?.checks),
    conflict: Boolean(branch.conflict),
    name: branch.name,
    pullRequestNumber: branch.pullRequest?.number || null,
    pullRequestState: branch.pullRequest?.state || null,
    sha: branch.sha || null,
  }
}

export function captureRecentSnapshot(state) {
  const branches = new Map()

  for (const branch of [...(state.branches || []), ...(state.pullRequestBranches || [])]) {
    if (!branch?.name) continue
    branches.set(branchSubjectKey(branch), snapshotBranch(branch))
  }

  return {
    branches: Object.fromEntries(branches),
    repoPath: state.repoPath || null,
  }
}

function changeEvent(kind, subjectKey, branch, observedAt, detail = {}) {
  return {
    ...detail,
    branchName: branch.name,
    id: `${kind}:${subjectKey}:${observedAt}`,
    kind,
    observedAt,
    pullRequestNumber: branch.pullRequestNumber,
    subjectKey,
  }
}

export function detectRecentChanges(previousSnapshot, nextSnapshot, observedAt = Date.now()) {
  if (!previousSnapshot || previousSnapshot.repoPath !== nextSnapshot.repoPath) return []

  const changes = []
  for (const [subjectKey, branch] of Object.entries(nextSnapshot.branches || {})) {
    const previous = previousSnapshot.branches?.[subjectKey]

    if (!previous) {
      if (branch.pullRequestState === 'OPEN') {
        changes.push(changeEvent('pr-opened', subjectKey, branch, observedAt))
      }
      continue
    }

    const pullRequestOpened = previous.pullRequestState !== 'OPEN' && branch.pullRequestState === 'OPEN'
    if (pullRequestOpened) changes.push(changeEvent('pr-opened', subjectKey, branch, observedAt))

    if (!pullRequestOpened && previous.sha && branch.sha && previous.sha !== branch.sha) {
      changes.push(changeEvent('branch-advanced', subjectKey, branch, observedAt, {
        commitsAdded: Math.max(0, branch.ahead - previous.ahead),
        fromAhead: previous.ahead,
        fromSha: previous.sha,
        toAhead: branch.ahead,
        toSha: branch.sha,
      }))
    }

    if (previous.pullRequestNumber && previous.pullRequestNumber === branch.pullRequestNumber) {
      const changedChecks = Object.entries(branch.checks || [])
        .filter(([name, status]) => previous.checks?.[name] && previous.checks[name] !== status)
        .map(([name, status]) => ({ name, status }))

      if (changedChecks.length) {
        changes.push(changeEvent('checks-changed', subjectKey, branch, observedAt, { checks: changedChecks }))
      }
    }

    if (previous.conflict !== branch.conflict) {
      changes.push(changeEvent(branch.conflict ? 'conflict-appeared' : 'conflict-resolved', subjectKey, branch, observedAt))
    }
  }

  return changes
}

export function mergeRecentChanges(existingChanges, detectedChanges, now = Date.now()) {
  const byId = new Map()

  for (const change of [...detectedChanges, ...(existingChanges || [])]) {
    if (!change?.id || now - change.observedAt >= RECENT_CHANGE_TTL_MS) continue
    if (!byId.has(change.id)) byId.set(change.id, change)
  }

  return [...byId.values()]
    .sort((left, right) => right.observedAt - left.observedAt)
    .slice(0, MAX_RECENT_CHANGES)
}

export function recentChangeOpacity(observedAt, now = Date.now()) {
  const progress = Math.min(1, Math.max(0, (now - observedAt) / RECENT_CHANGE_TTL_MS))
  return 0.62 - progress * 0.52
}
