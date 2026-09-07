import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { branchDisplayName, branchTipPosition, spinePositionAtDistance } from './tree-layout.mjs'
import {
  RECENT_CHANGE_TTL_MS,
  branchSubjectKey,
  captureRecentSnapshot,
  detectRecentChanges,
  mergeRecentChanges,
  recentChangeOpacity,
} from './recent-changes.mjs'

const PALETTE = ['#78a99d', '#b29a70', '#879aba', '#ad786f', '#7f9b76', '#a38198', '#6e9bab', '#a88b79']
const PR_AUTHOR_COLORS = {
  Arnav: '#b29a70',
  Bishal: '#78a99d',
  Raj: '#6e9bab',
  Sammy: '#ad786f',
}
const PR_OPEN_COLOR = '#e0c95a'
const MERGED_COLOR = '#8f78a8'
const CHECK_COLORS = {
  passed: '#7fa884',
  failed: '#c66f5d',
  pending: '#858c89',
  running: '#9cb5bc',
  skipped: '#858c89',
  neutral: '#858c89',
}
const SPINE_SEGMENTS = [
  [{ x: 332, y: 62 }, { x: 400, y: 104 }, { x: 350, y: 240 }, { x: 398, y: 330 }],
  [{ x: 398, y: 330 }, { x: 452, y: 430 }, { x: 414, y: 610 }, { x: 520, y: 720 }],
]
const SPINE_PATH = 'M 332 62 C 400 104 350 240 398 330 C 452 430 414 610 520 720'
const UPSTREAM_MEMORY_KEY = 'branch-organism:upstream-memory'
const RECENT_CHANGES_MEMORY_KEY = 'vertebrae:recent-changes'

const demoState = {
  status: 'ready',
  repoName: 'studio',
  current: 'feat/composer-translations',
  base: 'main',
  comparisonBase: 'origin/main',
  totalBranches: 42,
  fetch: { status: 'ready', checkedAt: Date.now() },
  recentChanges: [
    {
      branchName: 'feat/composer-translations',
      commitsAdded: 3,
      fromAhead: 11,
      fromSha: 'c82e19a',
      id: 'demo-branch-growth',
      kind: 'branch-advanced',
      observedAt: Date.now() - 12 * 60 * 1000,
      pullRequestNumber: 2300,
      subjectKey: 'pr:2300',
      toAhead: 14,
      toSha: 'd17e8bf',
    },
    {
      branchName: 'codex/composer-workflow-ia',
      checks: [
        { name: 'Accessibility', status: 'passed' },
        { name: 'Preview', status: 'passed' },
      ],
      id: 'demo-checks-cleared',
      kind: 'checks-changed',
      observedAt: Date.now() - 4 * 60 * 1000,
      pullRequestNumber: 2302,
      subjectKey: 'pr:2302',
    },
  ],
  remote: {
    status: 'ready',
    base: { localRef: 'main', remoteRef: 'origin/main', localSha: 'd82405', remoteSha: 'd82410', ahead: 0, behind: 5 },
  },
  landscape: {
    availableBranches: ['main', 'prd', 'dev'],
    integration: { label: 'Beta / Integration', name: 'main' },
    production: {
      commits: [
        { sha: '9b4e1cc', subject: 'production checkpoint' },
        { sha: '71cdd42', subject: 'release hardening' },
      ],
      integrationAhead: 1,
      mergeBaseSha: '68b24d1',
      mergeDistance: 4,
      name: 'prd',
      productionAhead: 2,
      ref: 'origin/prd',
      sha: '9b4e1cc',
      status: 'drift',
    },
    retired: [{ contained: true, mergeDistance: 7, name: 'dev', ref: 'origin/dev', sha: '8abd3ed', uniqueCommits: 0 }],
  },
  baseCommits: Array.from({ length: 9 }, (_, index) => ({
    sha: `d${String(82410 - index).padStart(5, '0')}`,
    subject: `main checkpoint ${9 - index}`,
  })),
  branches: [
    ['feat/composer-translations', 14, 5, 0, true, false, false, 'CLEAN'],
    ['main', 0, 0, 0, false, true, true, null],
    ['codex/composer-workflow-ia', 8, 2, 1, false, false, false, 'UNSTABLE'],
    ['experiment/category-colors', 5, 0, 3, false, false, false, 'CLEAN'],
    ['fix/shopify-connection', 4, 9, 8, false, false, false, 'DIRTY'],
    ['feat/brand-avatar-tools', 11, 3, 12, false, false, false, 'CLEAN'],
    ['codex/landing-chatbar', 7, 1, 19, false, false, false, 'BLOCKED'],
    ['chore/landing-consolidation', 2, 0, 27, false, false, true, null],
    ['experiment/dynamic-cards', 9, 6, 38, false, false, false, 'UNSTABLE'],
    ['codex/dev-seo-readiness', 3, 4, 52, false, false, false, 'DIRTY'],
    ['feat/arrival-choreography', 6, 0, 75, false, false, true, null],
    ['claude/quizzical-northcutt', 12, 17, 103, false, false, false, null],
    ['codex/guided-composer', 5, 8, 144, false, false, false, null],
    ['experiment/bottom-task-dock', 4, 21, 211, false, false, false, null],
    ['codex/market-response-loop', 10, 13, 286, false, false, false, null],
  ].map(([name, ahead, behind, ageDays, isCurrent, isBase, merged, mergeStateStatus], index) => ({
    name,
    sha: `${(hashName(name) + 31).toString(16).slice(0, 7)}`,
    ahead,
    baseDistance: [0, 5, 1, 3, 3, 7, 10, 14, 18, 18, 24, 31, 45, 62, 86][index],
    behind,
    commits: Array.from({ length: Math.min(ahead, 6) }, (_, commitIndex) => ({
      sha: `${(hashName(name) + commitIndex).toString(16).slice(0, 7)}`,
      subject: `${name} commit ${commitIndex + 1}`,
    })),
    ageDays,
    relative: ageDays === 0 ? 'today' : `${ageDays} days ago`,
    isCurrent,
    isBase,
    merged,
    conflict: mergeStateStatus === 'DIRTY',
    conflictDetails: mergeStateStatus === 'DIRTY' ? {
      files: [
        { path: 'src/components/Composer.jsx', type: 'content' },
        { path: 'src/styles/composer.css', type: 'modify / delete' },
      ],
      status: 'conflicting',
      total: 2,
    } : null,
    pullRequest: mergeStateStatus ? {
      number: 2300 + index,
      mergeStateStatus,
      state: 'OPEN',
      checks: {
        total: 7,
        passed: mergeStateStatus === 'DIRTY' ? 4 : 6,
        failed: mergeStateStatus === 'DIRTY' ? 2 : 0,
        pending: 1,
        items: [
          { name: 'Build', status: 'passed', workflow: 'CI' },
          { name: 'Typecheck', status: 'passed', workflow: 'CI' },
          { name: 'Unit tests', status: 'passed', workflow: 'CI' },
          { name: 'Preview', status: 'pending', workflow: 'Deploy' },
          { name: 'Lint', status: mergeStateStatus === 'DIRTY' ? 'failed' : 'passed', workflow: 'CI' },
          { name: 'Integration tests', status: mergeStateStatus === 'DIRTY' ? 'failed' : 'passed', workflow: 'CI' },
          { name: 'Accessibility', status: 'passed', workflow: 'Quality' },
        ],
      },
    } : null,
  })),
}

function hashName(name) {
  return Math.abs([...name].reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0))
}

function trimName(name, length = 22) {
  if (name.length <= length) return name
  return `${name.slice(0, 9)}…${name.slice(-(length - 10))}`
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function pointOnCubic([p0, p1, p2, p3], t) {
  const inverse = 1 - t
  const weight0 = inverse ** 3
  const weight1 = 3 * inverse ** 2 * t
  const weight2 = 3 * inverse * t ** 2
  const weight3 = t ** 3

  return {
    x: p0.x * weight0 + p1.x * weight1 + p2.x * weight2 + p3.x * weight3,
    y: p0.y * weight0 + p1.y * weight1 + p2.y * weight2 + p3.y * weight3,
  }
}

function pointOnBranchCurve(curve, t) {
  if (t <= 0.5) return pointOnCubic(curve[0], t * 2)
  return pointOnCubic(curve[1], (t - 0.5) * 2)
}

function pointOnSpine(t) {
  const bounded = clamp(t, 0, 1)
  if (bounded <= 0.5) return pointOnCubic(SPINE_SEGMENTS[0], bounded * 2)
  return pointOnCubic(SPINE_SEGMENTS[1], (bounded - 0.5) * 2)
}

function rememberUpstreamMovement(state) {
  const relation = state.remote?.base
  if (!state.repoPath || !relation?.remoteRef || !relation.remoteSha) return null

  let memory = null
  try {
    memory = JSON.parse(window.localStorage.getItem(UPSTREAM_MEMORY_KEY))
  } catch {
    memory = null
  }

  const sameRemote = memory?.repoPath === state.repoPath && memory.remoteRef === relation.remoteRef
  let movement = sameRemote ? memory.movement : null
  if (sameRemote && memory.remoteSha && memory.remoteSha !== relation.remoteSha) {
    const previousIndex = (state.baseCommits || []).findIndex((commit) => commit.sha === memory.remoteSha)
    movement = {
      count: Math.max(previousIndex, relation.behind || 0, 1),
      distance: previousIndex >= 0 ? previousIndex : null,
      detectedAt: Date.now(),
      fromSha: memory.remoteSha,
      toSha: relation.remoteSha,
    }
  }
  if (movement && Date.now() - movement.detectedAt >= RECENT_CHANGE_TTL_MS) movement = null

  try {
    window.localStorage.setItem(UPSTREAM_MEMORY_KEY, JSON.stringify({
      movement,
      remoteRef: relation.remoteRef,
      remoteSha: relation.remoteSha,
      repoPath: state.repoPath,
    }))
  } catch {
    return movement
  }

  return movement
}

function rememberRecentChanges(state) {
  const snapshot = captureRecentSnapshot(state)
  let memory = null

  try {
    memory = JSON.parse(window.localStorage.getItem(RECENT_CHANGES_MEMORY_KEY))
  } catch {
    memory = null
  }

  const detected = detectRecentChanges(memory?.snapshot, snapshot)
  const changes = mergeRecentChanges(memory?.changes, detected)

  try {
    window.localStorage.setItem(RECENT_CHANGES_MEMORY_KEY, JSON.stringify({ changes, snapshot }))
  } catch {
    return changes
  }

  return changes
}

function ageOpacity(branch) {
  if (branch.isCurrent) return 1
  if (branch.pullRequest?.state === 'OPEN' || branch.lifecycle === 'merging') return 1
  if (branch.conflict) return 0.86
  return clamp(0.92 - Math.log2((branch.ageDays || 0) + 1) * 0.11, 0.26, 0.92)
}

function checkSummary(checks) {
  if (!checks?.total) return 'checks unavailable'
  const parts = []
  if (checks.passed) parts.push(`${checks.passed} passed`)
  if (checks.failed) parts.push(`${checks.failed} failed`)
  if (checks.pending) parts.push(`${checks.pending} pending`)
  if (checks.skipped) parts.push(`${checks.skipped} skipped`)
  if (checks.neutral) parts.push(`${checks.neutral} neutral`)
  return parts.join(' · ')
}

function prSummary(branch) {
  if (!branch.pullRequest) return 'no pull request'
  const state = branch.lifecycle === 'merging'
    ? 'merging'
    : branch.lifecycle === 'closing'
      ? 'closed without merge'
      : branch.pullRequest.state === 'MERGED'
    ? 'merged'
    : (branch.pullRequest.mergeStateStatus || branch.pullRequest.state || '').toLowerCase()
  return `${branch.pullRequest.isDraft ? 'draft PR' : 'PR'} #${branch.pullRequest.number} · ${state}`
}

function checkProgressLabel(branch) {
  const checks = branch.pullRequest?.checks
  if (!checks?.total) return null
  if (checks.failed) return `${checks.failed} ${checks.failed === 1 ? 'check' : 'checks'} failed`
  return null
}

const CHECK_LABELS = { passed: 'Passed', failed: 'Failed', running: 'Running', pending: 'Queued', skipped: 'Skipped', neutral: 'Neutral' }

const HoverContext = createContext(null)

function HoverGroup({ children, ...props }) {
  const anchor = useRef(null)
  const [hovered, setHovered] = useState(false)
  return (
    <HoverContext.Provider value={{ anchor, hovered }}>
      <g {...props} ref={anchor} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        {children}
      </g>
    </HoverContext.Provider>
  )
}

function HoverCard({ children, ...props }) {
  const { anchor, hovered } = useContext(HoverContext)
  const layer = anchor.current?.ownerSVGElement?.querySelector('.tree-hover-layer')
  const card = <foreignObject {...props} className={`branch-hover-card ${hovered ? 'is-visible' : ''}`}>{children}</foreignObject>
  return hovered && layer ? createPortal(card, layer) : card
}

function CheckList({ items = [] }) {
  if (!items.length) return null
  return (
    <div className="check-list" aria-label="Checks">
      <div className="check-list__rows" role="list">
        {items.map((check, index) => (
          <div className="check-list__row" role="listitem" key={`${check.workflow || ''}-${check.name}-${index}`} title={`${check.workflow ? `${check.workflow} · ` : ''}${check.name} · ${CHECK_LABELS[check.status] || check.status}`}>
            <span className={`check-list__symbol check-list__symbol--${check.status}`} aria-hidden="true">
              {check.status === 'passed' ? '✓' : check.status === 'failed' ? '×' : check.status === 'running' ? '◔' : check.status === 'skipped' ? '−' : '○'}
            </span>
            <span className="check-list__name">{check.name}</span>
            <span className={`check-list__status check-list__status--${check.status}`}>{CHECK_LABELS[check.status] || check.status}</span>
          </div>
        ))}
      </div>
      {items.length > 4 && <span className="check-list__hint">{items.length} checks · scroll for more</span>}
    </div>
  )
}

function CheckRing({ checks, color, hidePassed = false, x, y }) {
  if (!checks?.items?.length) return null

  const visibleChecks = hidePassed
    ? checks.items.filter((check) => check.status !== 'passed')
    : checks.items
  if (!visibleChecks.length) return null

  const radius = 8.2
  const circumference = 2 * Math.PI * radius
  const gap = Math.min(2, circumference / (checks.items.length * 3))
  const segment = circumference / checks.items.length - gap

  return (
    <g className="check-ring" transform={`rotate(-90 ${x} ${y})`}>
      <circle className="check-ring__track" cx={x} cy={y} r={radius} />
      {checks.items.map((check, index) => hidePassed && check.status === 'passed' ? null : (
        <circle
          className={`check-ring__segment check-ring__segment--${check.status}`}
          cx={x}
          cy={y}
          key={`${check.name}-${index}`}
          r={radius}
          strokeDasharray={`${segment} ${circumference - segment}`}
          strokeDashoffset={-(index * circumference / checks.items.length)}
          style={{ '--check-color': color || CHECK_COLORS[check.status] || CHECK_COLORS.pending }}
        >
          <title>{check.name} · {check.status}</title>
        </circle>
      ))}
    </g>
  )
}

function checksFullyPassed(checks) {
  return Boolean(
    checks?.items?.length
    && checks.total === checks.passed
    && checks.failed === 0
    && checks.pending === 0
    && checks.items.every((check) => check.status === 'passed'),
  )
}

function checksInProgress(checks) {
  return Boolean(checks?.total && checks.pending > 0)
}

function CheckBloom({ checks, color, x, y }) {
  const passedChecks = (checks?.items || [])
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => check.status === 'passed')
  if (!passedChecks.length) return null

  const count = checks.items.length
  const petalDistance = clamp(7.8 + count * 0.08, 8, 9.6)
  const petalLength = clamp(3.4 - Math.max(0, count - 12) * 0.05, 2.6, 3.4)
  const petalWidth = clamp((Math.PI * petalDistance / count) * 0.42, 1.1, 2.55)

  return (
    <g className="check-bloom" transform={`translate(${x} ${y})`}>
      {passedChecks.map(({ check, index }) => (
        <g key={`${check.name}-${index}`} transform={`rotate(${index * 360 / count})`}>
          <ellipse
            className="check-bloom__petal"
            cx="0"
            cy={-petalDistance}
            rx={petalWidth}
            ry={petalLength}
            style={{
              '--check-color': color || CHECK_COLORS.passed,
              '--petal-delay': `${index * 34}ms`,
            }}
          >
            <title>{check.name} · passed</title>
          </ellipse>
        </g>
      ))}
    </g>
  )
}

function formatTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatRecentAge(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h`
}

function formatRecentObservation(value) {
  const age = formatRecentAge(value)
  return age === 'now' ? 'noticed just now' : `noticed ${age} ago`
}

function recentChangeDescription(change) {
  if (change.kind === 'branch-advanced') {
    const commitLabel = change.commitsAdded > 0
      ? ` · +${change.commitsAdded} ${change.commitsAdded === 1 ? 'commit' : 'commits'}`
      : ''
    return `head moved · ${change.fromSha} → ${change.toSha}${commitLabel}`
  }
  if (change.kind === 'pr-opened') return `PR #${change.pullRequestNumber} opened`
  if (change.kind === 'conflict-appeared') return 'merge conflict appeared'
  if (change.kind === 'conflict-resolved') return 'merge conflict cleared'
  if (change.kind === 'checks-changed') return `${change.checks.length} checks updated`
  return 'repository state changed'
}

function MergedCheckpoint({ merge, mergeIndex, point }) {
  const checkItems = merge.checks?.items || []
  const cardHeight = 148 + (checkItems.length ? 114 : 0)
  const cardX = point.x < 250 ? clamp(point.x + 12, 12, 288) : clamp(point.x - 224, 12, 288)
  const cardY = clamp(point.y - 64, 12, 748 - cardHeight)

  return (
    <HoverGroup className="recent-merge" style={{ '--branch-color': MERGED_COLOR }}>
      <circle className="recent-merge__hit-area" cx={point.x} cy={point.y} r="12" />
      <circle className="recent-merge__ring" cx={point.x} cy={point.y} r="4.2">
        <title>{merge.authorName} merged PR #{merge.number} · {merge.title}</title>
      </circle>
      <CheckRing checks={merge.checks} color={MERGED_COLOR} hidePassed x={point.x} y={point.y} />
      <CheckBloom checks={merge.checks} color={MERGED_COLOR} x={point.x} y={point.y} />
      <text className="recent-merge__label" textAnchor="end" x={point.x - 7} y={point.y - 5 - (mergeIndex % 2) * 6}>
        merged · #{merge.number}
      </text>
      <HoverCard x={cardX} y={cardY} width="220" height={cardHeight}>
        <div className="branch-hover-card__surface" xmlns="http://www.w3.org/1999/xhtml">
          <strong>{merge.title || `PR #${merge.number}`}</strong>
          <span>{merge.authorName === merge.authorLogin
            ? `@${merge.authorLogin}`
            : `${merge.authorName} · @${merge.authorLogin}`}</span>
          <span>PR #{merge.number} · merged</span>
          <span>merge commit · {merge.mergeSha || 'unknown'}</span>
          <span>{checkSummary(merge.checks)}</span>
          <CheckList items={checkItems} />
          <span>merged · {formatTimestamp(merge.mergedAt)}</span>
        </div>
      </HoverCard>
    </HoverGroup>
  )
}

function ProductionLane({ integrationName, lane, spinePosition }) {
  if (!lane) return null

  const start = pointOnSpine(spinePosition)
  const length = clamp(74 + Math.sqrt(lane.productionAhead || 0) * 16, 82, 122)
  const tip = {
    x: clamp(start.x + length, 80, 500),
    y: clamp(start.y - 42 - Math.sqrt(lane.productionAhead || 0) * 8, 76, 692),
  }
  const curve = [
    start,
    { x: start.x + length * 0.18, y: start.y + 5 },
    { x: tip.x - length * 0.22, y: tip.y + 17 },
    tip,
  ]
  const path = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${curve[1].x.toFixed(1)} ${curve[1].y.toFixed(1)}, ${curve[2].x.toFixed(1)} ${curve[2].y.toFixed(1)}, ${tip.x.toFixed(1)} ${tip.y.toFixed(1)}`
  const commits = (lane.commits || []).slice(0, 4).reverse()
  const status = lane.status === 'drift'
    ? `drift · ${integrationName} +${lane.integrationAhead} · ${lane.name} +${lane.productionAhead}`
    : lane.status === 'awaiting-promotion'
      ? `awaiting promotion · +${lane.integrationAhead}`
      : lane.status === 'production-ahead'
        ? `production ahead · +${lane.productionAhead}`
        : 'synced'
  const cardX = clamp(tip.x - 224, 12, 288)
  const cardY = clamp(tip.y - 60, 12, 608)

  return (
    <HoverGroup className={`production-lane production-lane--${lane.status}`}>
      <path className="production-lane__hit-area" d={path} />
      <path className="production-lane__line" d={path} />
      <circle className="production-lane__junction" cx={start.x} cy={start.y} r="4.2">
        <title>promotion base · {lane.mergeBaseSha || 'unknown'}</title>
      </circle>
      {commits.map((commit, index) => {
        const ratio = commits.length === 1 ? 0.68 : 0.34 + (index / (commits.length - 1)) * 0.44
        const point = pointOnCubic(curve, ratio)
        return (
          <circle className="production-lane__commit" cx={point.x} cy={point.y} key={`${commit.sha}-${index}`} r="1.5">
            <title>{commit.sha} · {commit.subject}</title>
          </circle>
        )
      })}
      <circle className="production-lane__tip" cx={tip.x} cy={tip.y} r="3.2" />
      <text className="production-lane__label" textAnchor="end" x={tip.x - 7} y={tip.y - 4}>{lane.name} · Production</text>
      <text className="production-lane__status" textAnchor="end" x={tip.x - 7} y={tip.y + 7}>{status}</text>
      <HoverCard x={cardX} y={cardY} width="220" height="126">
        <div className="branch-hover-card__surface" xmlns="http://www.w3.org/1999/xhtml">
          <strong>{lane.name} · Production</strong>
          <span>{status}</span>
          <span>{lane.ref} · {lane.sha || 'unknown'}</span>
          <span>diverged at · {lane.mergeBaseSha || 'unknown'}</span>
          <span>{integrationName} has {lane.integrationAhead} unique · {lane.name} has {lane.productionAhead} unique</span>
        </div>
      </HoverCard>
    </HoverGroup>
  )
}

function RetiredMarker({ branch, index, spinePosition }) {
  const start = pointOnSpine(spinePosition)
  const tip = {
    x: clamp(start.x - 58 - index * 8, 56, 460),
    y: clamp(start.y + 16 + index * 9, 78, 704),
  }
  const path = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${(start.x - 16).toFixed(1)} ${(start.y + 2).toFixed(1)}, ${(tip.x + 19).toFixed(1)} ${(tip.y - 5).toFixed(1)}, ${tip.x.toFixed(1)} ${tip.y.toFixed(1)}`
  const cardX = tip.x < 250 ? clamp(tip.x + 10, 12, 288) : clamp(tip.x - 224, 12, 288)
  const cardY = clamp(tip.y - 54, 12, 622)

  return (
    <HoverGroup className="retired-branch">
      <path className="retired-branch__hit-area" d={path} />
      <path className="retired-branch__line" d={path} />
      <circle className="retired-branch__junction" cx={start.x} cy={start.y} r="2.2" />
      <circle className="retired-branch__tip" cx={tip.x} cy={tip.y} r="2.2" />
      <text className="retired-branch__label" textAnchor="end" x={tip.x - 6} y={tip.y - 2}>{branch.name} · retired history</text>
      <HoverCard x={cardX} y={cardY} width="220" height="112">
        <div className="branch-hover-card__surface" xmlns="http://www.w3.org/1999/xhtml">
          <strong>{branch.name} · Retired history</strong>
          <span>{branch.contained ? 'fully contained in the integration spine' : 'kept for historical context'}</span>
          <span>{branch.uniqueCommits} unique {branch.uniqueCommits === 1 ? 'commit' : 'commits'}</span>
          <span>{branch.ref} · {branch.sha || 'unknown'}</span>
        </div>
      </HoverCard>
    </HoverGroup>
  )
}

function selectRestingBranches(branches, currentOnSpine, limit = 7) {
  return branches
    .filter((branch) => (!branch.isBase || (branch.isCurrent && !currentOnSpine)) && !(branch.isCurrent && currentOnSpine))
    .map((branch, sourceIndex) => ({
      branch,
      sourceIndex,
      score: (branch.isCurrent ? 10000 : 0)
        + (branch.conflict ? 5000 : 0)
        + (branch.ahead > 0 ? 2000 + Math.min(branch.ahead, 100) * 10 : 0)
        - sourceIndex,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ branch }) => branch)
    .sort((left, right) => (left.baseDistance || 0) - (right.baseDistance || 0))
}

function selectPullRequestBranches(branches, limit = 4) {
  const authors = new Set()

  return [...branches]
    .sort((left, right) => (
      Number(right.lifecycle !== 'open') - Number(left.lifecycle !== 'open')
      || (right.timestamp || 0) - (left.timestamp || 0)
      || Number(right.conflict) - Number(left.conflict)
    ))
    .filter((branch) => {
      const author = branch.pullRequest?.authorLogin || branch.pullRequest?.authorName || branch.name
      if (authors.has(author)) return false
      authors.add(author)
      return true
    })
    .slice(0, limit)
}

function branchGeometry(branch, index, spinePosition, tipPosition) {
  const hash = hashName(branch.name)
  const anchored = Number.isFinite(spinePosition)
  const start = anchored ? pointOnSpine(spinePosition) : { x: 310, y: tipPosition + 16 }
  const { x: startX, y: startY } = start
  const requestedLength = branch.ahead > 0 ? 104 + Math.sqrt(branch.ahead) * 12 : 82
  const availableLength = startX - 184
  const length = Math.max(62, Math.min(requestedLength, availableLength))
  const tipX = clamp(startX - length, 184, 270)
  const tipY = tipPosition
  const rise = tipY - startY
  const bow = 12 + ((hash >>> 7) % 11)
  const bowDirection = (hash >>> 2) % 2 === 0 ? -1 : 1
  const departure = 6 + ((hash >>> 11) % 8)
  const midpoint = {
    x: startX - length * 0.5,
    y: startY + rise * 0.46 + bowDirection * bow * 0.38,
  }
  const curve = [
    [
      { x: startX, y: startY },
      { x: startX - length * 0.08, y: startY + bowDirection * departure },
      { x: startX - length * 0.3, y: startY + rise * 0.28 + bowDirection * bow },
      midpoint,
    ],
    [
      midpoint,
      { x: startX - length * 0.7, y: startY + rise * 0.65 - bowDirection * bow * 0.52 },
      { x: tipX + length * 0.1, y: tipY - bowDirection * departure * 0.32 },
      { x: tipX, y: tipY },
    ],
  ]
  const stem = [
    `M ${startX.toFixed(1)} ${startY.toFixed(1)}`,
    `C ${curve[0][1].x.toFixed(1)} ${curve[0][1].y.toFixed(1)},`,
    `${curve[0][2].x.toFixed(1)} ${curve[0][2].y.toFixed(1)},`,
    `${curve[0][3].x.toFixed(1)} ${curve[0][3].y.toFixed(1)}`,
    `C ${curve[1][1].x.toFixed(1)} ${curve[1][1].y.toFixed(1)},`,
    `${curve[1][2].x.toFixed(1)} ${curve[1][2].y.toFixed(1)},`,
    `${curve[1][3].x.toFixed(1)} ${curve[1][3].y.toFixed(1)}`,
  ].join(' ')

  return { anchored, curve, hash, startX, startY, stem, tipX, tipY }
}

function branchColor(branch) {
  if (branch.lifecycle === 'merging' || branch.merged || branch.pullRequest?.state === 'MERGED') return MERGED_COLOR
  if (branch.pullRequest?.state === 'OPEN' && branch.lifecycle !== 'closing') return PR_OPEN_COLOR
  return PR_AUTHOR_COLORS[branch.pullRequest?.authorName] || PALETTE[hashName(branch.name) % PALETTE.length]
}

function RecentChangeEvidence({ branch, changes, index, spinePosition, tipPosition }) {
  if (!changes.length) return null

  const visibleChanges = changes.slice(0, 3)
  const latestChange = visibleChanges[0]
  const branchMovement = visibleChanges.find((change) => change.kind === 'branch-advanced')
  const currentGeometry = branchGeometry(branch, index, spinePosition, tipPosition)
  const previousGeometry = branchMovement
    ? branchGeometry({ ...branch, ahead: branchMovement.fromAhead }, index, spinePosition, tipPosition)
    : null
  const markerX = previousGeometry?.tipX ?? currentGeometry.tipX
  const markerY = previousGeometry?.tipY ?? currentGeometry.tipY
  const label = branchMovement
    ? `was · ${formatRecentAge(branchMovement.observedAt)}`
    : latestChange.kind === 'checks-changed'
      ? `checks · ${formatRecentAge(latestChange.observedAt)}`
      : latestChange.kind === 'pr-opened'
        ? `opened · ${formatRecentAge(latestChange.observedAt)}`
        : latestChange.kind === 'conflict-resolved'
          ? `cleared · ${formatRecentAge(latestChange.observedAt)}`
          : `changed · ${formatRecentAge(latestChange.observedAt)}`
  const cardHeight = 54 + visibleChanges.reduce((height, change) => (
    height + (change.kind === 'checks-changed' ? 148 : 42)
  ), 0)
  const cardX = markerX < 250 ? clamp(markerX + 12, 12, 288) : clamp(markerX - 224, 12, 288)
  const cardY = clamp(markerY - 48, 12, 748 - cardHeight)
  const opacity = Math.max(...visibleChanges.map((change) => recentChangeOpacity(change.observedAt)))
  const markerRadius = branchMovement
    ? 3.2
    : latestChange.kind === 'checks-changed'
      ? branch.isCurrent ? 19 : 16
      : 11.5
  const changedCheckStatuses = latestChange.checks?.map((check) => check.status) || []
  const evidenceColor = branchMovement
    ? branchColor(branch)
    : latestChange.kind === 'conflict-appeared' || changedCheckStatuses.includes('failed')
      ? CHECK_COLORS.failed
      : latestChange.kind === 'conflict-resolved' || (changedCheckStatuses.length && changedCheckStatuses.every((status) => status === 'passed'))
        ? CHECK_COLORS.passed
        : branchColor(branch)

  return (
    <HoverGroup
      className={`recent-change ${branchMovement ? 'recent-change--branch-advanced' : `recent-change--${latestChange.kind}`}`}
      style={{ '--change-color': evidenceColor, '--change-opacity': opacity }}
    >
      {previousGeometry && (
        <>
          <path className="recent-change__hit-area" d={previousGeometry.stem} />
          <path className="recent-change__trace" d={previousGeometry.stem} />
        </>
      )}
      <circle className="recent-change__hit-ring" cx={markerX} cy={markerY} r="13" />
      <circle
        className="recent-change__marker"
        cx={markerX}
        cy={markerY}
        r={markerRadius}
      />
      <text
        className="recent-change__label"
        textAnchor={branchMovement ? 'end' : 'start'}
        x={markerX + (branchMovement ? -6 : 14)}
        y={markerY + 2}
      >
        {label}
      </text>
      <HoverCard x={cardX} y={cardY} width="220" height={cardHeight}>
        <div className="branch-hover-card__surface" xmlns="http://www.w3.org/1999/xhtml">
          <strong>Changed recently</strong>
          <span>{branch.name}</span>
          {visibleChanges.map((change) => (
            <span
              className={`recent-change__detail ${change.kind === 'checks-changed' ? 'recent-change__detail--checks' : ''}`}
              key={change.id}
            >
              <span className="recent-change__detail-heading">
                <span>{recentChangeDescription(change)}</span>
                <span>{formatRecentObservation(change.observedAt)}</span>
              </span>
              {change.kind === 'checks-changed' && <CheckList items={change.checks} />}
            </span>
          ))}
        </div>
      </HoverCard>
    </HoverGroup>
  )
}

function TreeBranch({ branch, currentTick, index, integrationName, mergeSpinePosition, spinePosition, tipPosition }) {
  const geometry = branchGeometry(branch, index, spinePosition, tipPosition)
  const { anchored, curve, startX, startY, stem, tipX, tipY } = geometry
  const mergePoint = Number.isFinite(mergeSpinePosition) ? pointOnSpine(mergeSpinePosition) : { x: startX, y: startY }
  const isOpenPullRequest = branch.pullRequest?.state === 'OPEN' && branch.lifecycle !== 'closing'
  const isMergedBranch = branch.lifecycle === 'merging' || branch.merged
  const isMergedResidual = branch.pullRequest?.state === 'MERGED' && !isMergedBranch
  const isGhostPullRequest = branch.isPullRequest && !branch.hasLocalBranch
  const color = branchColor(branch)
  const opacity = ageOpacity(branch)
  const commits = (branch.commits || []).slice(0, 5).reverse()
  const checks = branch.pullRequest?.checks
  const checksPassed = checksFullyPassed(checks)
  const isReviewActive = isOpenPullRequest && checksInProgress(checks)
  const passedCheckCount = (checks?.items || []).filter((check) => check.status === 'passed').length
  const checkItems = checks?.items || []
  const conflictItems = (branch.conflictDetails?.files || []).slice(0, 5)
  const conflictTotal = branch.conflictDetails?.total ?? conflictItems.length
  const checkLabel = checkProgressLabel(branch)
  const statusLabel = !anchored
    ? 'off spine · inspect'
    : branch.conflict
    ? 'conflict'
    : isMergedBranch
      ? 'merged'
      : isMergedResidual
        ? 'merged'
      : branch.lifecycle === 'closing'
        ? 'closed'
        : branch.pullRequest?.isDraft
          ? checkLabel ? `draft · ${checkLabel}` : 'draft'
          : isOpenPullRequest ? checkLabel : null
  const labelX = tipX - 8
  const labelAnchor = 'end'
  const cardHeight = 166
    + (isMergedResidual ? 16 : 0)
    + (checkItems.length ? 114 : 0)
    + (branch.conflict ? 28 + conflictItems.length * 13 : 0)
  const cardX = tipX < 250 ? clamp(tipX + 12, 12, 288) : clamp(tipX - 224, 12, 288)
  const cardY = clamp(tipY - 64, 12, 748 - cardHeight)
  const currentLabel = `${branchDisplayName(branch.name, 24)} · current`
  const restingLabel = branchDisplayName(branch.name)

  return (
    <HoverGroup
      data-branch={branch.name}
      data-spine-distance={branch.baseDistance ?? 'unknown'}
      className={`tree-branch ${branch.isCurrent ? 'tree-branch--current' : ''} ${branch.pullRequest ? 'tree-branch--pull-request' : ''} ${isOpenPullRequest ? 'tree-branch--pr-open' : ''} ${isReviewActive ? 'tree-branch--review-active' : ''} ${isMergedBranch ? 'tree-branch--merged' : ''} ${isMergedResidual ? 'tree-branch--merged-residual' : ''} ${isGhostPullRequest ? 'tree-branch--pr-ghost' : ''} ${branch.pullRequest?.isDraft ? 'tree-branch--draft' : ''} ${branch.lifecycle === 'merging' ? 'tree-branch--merging' : ''} ${branch.lifecycle === 'closing' ? 'tree-branch--closing' : ''} ${branch.conflict ? 'tree-branch--conflict' : ''} ${passedCheckCount ? 'tree-branch--checks-blooming' : ''} ${checksPassed ? 'tree-branch--checks-passed' : ''} ${currentTick && branch.isCurrent ? 'is-tick' : ''}`}
      style={{
        '--branch-color': color,
        '--branch-opacity': opacity,
        '--merge-shift-x': `${mergePoint.x - startX}px`,
        '--merge-shift-y': `${mergePoint.y - startY}px`,
        transformOrigin: `${startX}px ${startY}px`,
      }}
    >
      <path className="branch-hit-area" d={stem} />
      <circle className="branch-junction-ring" cx={startX} cy={startY} r={anchored ? 3 : 2}>
        <title>{anchored ? 'shared starting commit' : 'starting commit is outside the displayed first-parent spine'} · {branch.mergeBaseSha || 'unknown'}</title>
      </circle>
      <path className="branch-stem" d={stem} />
      {commits.map((commit, commitIndex) => {
        const ratio = commits.length === 1 ? 0.72 : 0.2 + (commitIndex / (commits.length - 1)) * 0.65
        const point = pointOnBranchCurve(curve, ratio)
        return (
          <circle className="branch-commit" cx={point.x} cy={point.y} key={`${commit.sha}-${commitIndex}`} r="1.45">
            <title>{commit.sha} · {commit.subject}</title>
          </circle>
        )
      })}
      <circle className="branch-tip" cx={tipX} cy={tipY} r={branch.isCurrent ? 4.5 : 3}>
        <title>{branch.isPullRequest ? `${branch.pullRequest.authorName} · PR #${branch.pullRequest.number}` : branch.sha || branch.name} · branch head</title>
      </circle>
      {(isOpenPullRequest || isMergedBranch || isMergedResidual) && (
        <>
          <CheckRing checks={checks} color={isMergedBranch || isMergedResidual ? MERGED_COLOR : undefined} hidePassed x={tipX} y={tipY} />
          <CheckBloom checks={checks} color={isMergedBranch || isMergedResidual ? MERGED_COLOR : undefined} x={tipX} y={tipY} />
        </>
      )}
      {branch.isCurrent && <circle className="current-ring" cx={tipX} cy={tipY} r={passedCheckCount ? 16.5 : isOpenPullRequest ? 11.5 : 9} />}
      {branch.conflict && (
        <path className="conflict-mark" d={`M ${tipX - 5} ${tipY - 5} l 10 10 M ${tipX + 5} ${tipY - 5} l -10 10`} />
      )}
      <text className={branch.isCurrent ? 'current-label' : 'branch-label__name'} x={labelX} y={tipY - 3} textAnchor={labelAnchor}>
        {branch.isCurrent ? currentLabel : restingLabel}
      </text>
      {statusLabel && (
        <text className="branch-label__progress" x={labelX} y={tipY + 8} textAnchor={labelAnchor}>{statusLabel}</text>
      )}
      <HoverCard x={cardX} y={cardY} width="220" height={cardHeight}>
        <div className="branch-hover-card__surface" xmlns="http://www.w3.org/1999/xhtml">
          <strong>{branch.name}</strong>
          <span>head · {branch.sha || 'unknown'} · base · {branch.mergeBaseSha || 'unknown'}</span>
          {!anchored && <span>Starting commit is outside the displayed first-parent spine, or unavailable locally.</span>}
          {branch.pullRequest?.authorName && (
            <span>{branch.pullRequest.authorName === branch.pullRequest.authorLogin
              ? `@${branch.pullRequest.authorLogin}`
              : `${branch.pullRequest.authorName} · @${branch.pullRequest.authorLogin}`}</span>
          )}
          <span>{prSummary(branch)}</span>
          {branch.pullRequest?.title && <span className="branch-hover-card__pr-title">{branch.pullRequest.title}</span>}
          {isMergedResidual && (
            <span className="branch-hover-card__residual">
              PR merged · branch ref still diverges from {integrationName}
            </span>
          )}
          {branch.conflict && (
            <span className="branch-hover-card__conflicts">
              <span className="branch-hover-card__section-title">merge conflict</span>
              {conflictItems.map((file) => (
                <span className="branch-hover-card__conflict" key={file.path}>
                  <span>{file.path}</span>
                  <span>{file.type}</span>
                </span>
              ))}
              {conflictTotal > conflictItems.length && <span>+{conflictTotal - conflictItems.length} more files</span>}
              {branch.conflictDetails?.status === 'clean' && <span>GitHub reports conflict · local refs merge cleanly</span>}
              {(!branch.conflictDetails || branch.conflictDetails.status === 'unavailable') && (
                <span>GitHub reports conflict · file details unavailable locally</span>
              )}
            </span>
          )}
          <span>{checkSummary(branch.pullRequest?.checks)}</span>
          <CheckList items={checkItems} />
          <span>{branch.ahead} ahead · {branch.behind} behind</span>
          <span>last activity · {branch.relative || 'unknown'}</span>
        </div>
      </HoverCard>
    </HoverGroup>
  )
}

function GitTree({ state, currentTick, recentChanges, upstreamMovement }) {
  const visibleBranches = state.branches
    .filter((branch) => !branch.merged || branch.isCurrent || branch.isBase)
    .slice(0, 15)
  const pullRequestBranches = selectPullRequestBranches(state.pullRequestBranches || [])
  const pullRequestBranchNames = new Set(pullRequestBranches.map((branch) => branch.name))
  const recentMerges = (state.recentMerges || []).filter((merge) => Number.isFinite(merge.mergeDistance))
  const production = Number.isFinite(state.landscape?.production?.mergeDistance) ? state.landscape.production : null
  const retiredBranches = (state.landscape?.retired || []).filter((branch) => Number.isFinite(branch.mergeDistance))
  const integrationRole = state.landscape?.integration?.label || 'Integration'
  const base = state.remote?.base?.remoteRef || state.comparisonBase || state.base
  const baseAhead = state.remote?.base?.ahead || 0
  const baseIncoming = state.remote?.base?.behind || 0
  const baseCommits = (state.baseCommits || []).slice(0, 6)
  const baseIsCurrent = state.current === state.base
  const baseBranch = visibleBranches.find((branch) => branch.isBase)
  const currentBranch = visibleBranches.find((branch) => branch.isCurrent)
  const currentOnSpine = state.currentSpineDistance !== undefined
    ? Number.isFinite(state.currentSpineDistance)
    : (baseIsCurrent && baseAhead === 0) || (currentBranch?.ahead === 0 && Number.isFinite(currentBranch?.baseDistance))
  const currentAtBaseHead = currentOnSpine && currentBranch?.sha === baseBranch?.sha
  const baseFullySynced = currentAtBaseHead
    && Boolean(state.remote?.base?.remoteRef)
    && baseAhead === 0
    && baseIncoming === 0
  const localBranches = selectRestingBranches(
    visibleBranches.filter((branch) => !pullRequestBranchNames.has(branch.name) || branch.isCurrent),
    currentOnSpine,
  )
  const localBranchNames = new Set(localBranches.map((branch) => branch.name))
  const branches = [
    ...localBranches,
    ...pullRequestBranches.filter((branch) => !localBranchNames.has(branch.name)),
  ].sort((left, right) => (left.baseDistance || 0) - (right.baseDistance || 0))
  const changesBySubject = new Map()
  for (const change of recentChanges || []) {
    const subjectChanges = changesBySubject.get(change.subjectKey) || []
    subjectChanges.push(change)
    subjectChanges.sort((left, right) => right.observedAt - left.observedAt)
    changesBySubject.set(change.subjectKey, subjectChanges)
  }
  const basePointAt = (distance) => pointOnSpine(spinePositionAtDistance(distance))
  const exactBaseIndex = baseCommits.findIndex((commit) => commit.sha === baseBranch?.sha)
  const currentBaseDistance = state.currentSpineDistance ?? (baseIsCurrent
    ? (exactBaseIndex >= 0 ? exactBaseIndex : state.remote?.base?.spineDistance)
    : currentBranch?.baseDistance)
  const currentBasePoint = basePointAt(currentBaseDistance)
  const currentSpineLabel = `${branchDisplayName(state.current, 24)} · current`
  const currentLabelSide = currentBasePoint.x + 13 + currentSpineLabel.length * 5.4 < 508 ? 1 : -1
  const remoteBasePoint = basePointAt(0)
  const upstreamDistance = baseIncoming > 0 ? state.remote?.base?.spineDistance : upstreamMovement?.distance
  const showUpstreamGhost = Number.isFinite(upstreamDistance) && upstreamDistance > 0
  const upstreamStartPoint = basePointAt(upstreamDistance)
  const upstreamSide = upstreamStartPoint.x > 390 ? -1 : 1
  const upstreamOffset = clamp(20 + Math.abs(upstreamStartPoint.y - remoteBasePoint.y) * 0.12, 22, 44)
  const upstreamCurve = [
    upstreamStartPoint,
    {
      x: upstreamStartPoint.x + upstreamSide * upstreamOffset,
      y: upstreamStartPoint.y - Math.abs(upstreamStartPoint.y - remoteBasePoint.y) * 0.28,
    },
    {
      x: remoteBasePoint.x + upstreamSide * upstreamOffset,
      y: remoteBasePoint.y + Math.abs(upstreamStartPoint.y - remoteBasePoint.y) * 0.28,
    },
    remoteBasePoint,
  ]
  const upstreamGhostPath = [
    `M ${upstreamStartPoint.x.toFixed(1)} ${upstreamStartPoint.y.toFixed(1)}`,
    `C ${upstreamCurve[1].x.toFixed(1)} ${upstreamCurve[1].y.toFixed(1)},`,
    `${upstreamCurve[2].x.toFixed(1)} ${upstreamCurve[2].y.toFixed(1)},`,
    `${remoteBasePoint.x.toFixed(1)} ${remoteBasePoint.y.toFixed(1)}`,
  ].join(' ')
  return (
    <svg className="git-tree" viewBox="0 0 520 760" role="img" aria-label={`Git tree for ${state.repoName}`}>
      <g className="tree-heading">
        <text x="30" y="34" className="repo-name">{state.repoName}</text>
        <text x="30" y="51" className="repo-current">on {trimName(state.current, 34)}</text>
      </g>

      <g className="organism-growth">
        <g className={`base-spine ${currentOnSpine ? 'base-spine--current' : ''} ${currentOnSpine && currentTick ? 'is-tick' : ''}`}>
          <path className="base-spine__underlay" d={SPINE_PATH} />
          <path className="base-spine__line" d={SPINE_PATH} />
          {showUpstreamGhost && (
            <g className="upstream-ghost">
              <title>{baseIncoming > 0 ? `${baseIncoming} incoming commits across ${upstreamDistance} first-parent steps` : 'Recently observed upstream movement · already synced'}</title>
              <path className="upstream-ghost__underlay" d={upstreamGhostPath} />
              <path className="upstream-ghost__line" d={upstreamGhostPath} />
              <circle className="upstream-ghost__checkpoint" cx={upstreamStartPoint.x} cy={upstreamStartPoint.y} r="2.4" />
              <circle className="upstream-ghost__head" cx={remoteBasePoint.x} cy={remoteBasePoint.y} r="2.8" />
              <text
                className="upstream-ghost__label"
                textAnchor="end"
                x="502"
                y={upstreamStartPoint.y + 22}
              >
                {baseIncoming > 0 ? `${baseIncoming} incoming` : 'recent upstream change'}
              </text>
              {baseIncoming > 0 && <text className="upstream-ghost__label" textAnchor="end" x="502" y={upstreamStartPoint.y + 34}>across {upstreamDistance} spine {upstreamDistance === 1 ? 'step' : 'steps'}</text>}
              {!baseIsCurrent && baseIncoming > 0 && <text className="base-state" textAnchor="end" x={upstreamStartPoint.x - 8} y={upstreamStartPoint.y + 3}>{state.base} · local</text>}
            </g>
          )}
          {baseCommits.map((commit, commitIndex) => {
            const { x, y } = basePointAt(commitIndex)
            return (
              <circle className="base-commit" cx={x} cy={y} key={commit.sha} r="1.8">
                <title>{commit.sha} · {commit.subject}</title>
              </circle>
            )
          })}
          {currentOnSpine && (
            <g className={`spine-current-position ${baseFullySynced ? 'is-synced' : ''}`}>
              <title>Current: {state.current} at {currentBranch?.sha || baseBranch?.sha || 'unknown commit'}</title>
              <circle className="spine-current-ring" cx={currentBasePoint.x} cy={currentBasePoint.y} r="7" />
              <circle className="spine-current-dot" cx={currentBasePoint.x} cy={currentBasePoint.y} r="2.5" />
              <line
                className="spine-current-leader"
                x1={currentBasePoint.x + currentLabelSide * 5}
                x2={currentBasePoint.x + currentLabelSide * 10}
                y1={currentBasePoint.y}
                y2={currentBasePoint.y}
              />
              <text
                className="spine-current-label"
                textAnchor={currentLabelSide === 1 ? 'start' : 'end'}
                x={currentBasePoint.x + currentLabelSide * 13}
                y={currentBasePoint.y + 2.5}
              >
                {currentSpineLabel}
              </text>
            </g>
          )}
          <circle className="spine-root" cx="332" cy="62" r="3.3" />
          <text x="344" y="55" textAnchor="start" className="base-label">{state.base} · {integrationRole}</text>
          <text x="344" y="66" textAnchor="start" className="base-source-label">{base}</text>
        </g>

        {retiredBranches.map((branch, index) => (
          <RetiredMarker
            branch={branch}
            index={index}
            key={branch.name}
            spinePosition={spinePositionAtDistance(branch.mergeDistance || 0)}
          />
        ))}
        {recentMerges.map((merge, mergeIndex) => (
          <MergedCheckpoint
            key={`${merge.number}-${merge.mergeSha}`}
            merge={merge}
            mergeIndex={mergeIndex}
            point={basePointAt(merge.mergeDistance)}
          />
        ))}
        {branches.map((branch, index) => {
          const spinePosition = spinePositionAtDistance(branch.baseDistance)
          const tipPosition = branchTipPosition(index, branches.length)
          return (
            <g key={branch.isPullRequest ? `pr-${branch.pullRequest.number}` : branch.name}>
              <TreeBranch
                branch={branch}
                currentTick={currentTick}
                index={index}
                integrationName={state.base}
                mergeSpinePosition={Number.isFinite(branch.mergeDistance) ? spinePositionAtDistance(branch.mergeDistance) : undefined}
                spinePosition={spinePosition}
                tipPosition={tipPosition}
              />
              <RecentChangeEvidence
                branch={branch}
                changes={changesBySubject.get(branchSubjectKey(branch)) || []}
                index={index}
                spinePosition={spinePosition}
                tipPosition={tipPosition}
              />
            </g>
          )
        })}
        <ProductionLane
          integrationName={state.base}
          lane={production}
          spinePosition={spinePositionAtDistance(production?.mergeDistance || 0)}
        />
      </g>
      <g className="tree-hover-layer" />
    </svg>
  )
}

function EmptyState({ state }) {
  return (
    <div className="tree-state">
      <span>vertebrae</span>
      <p>{state.message || 'Choose a Git repository from the menu bar.'}</p>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState(() => window.gitOverlay ? { status: 'loading' } : demoState)
  const [currentTick, setCurrentTick] = useState(false)
  const [recentChanges, setRecentChanges] = useState(() => window.gitOverlay ? [] : demoState.recentChanges)
  const [upstreamMovement, setUpstreamMovement] = useState(null)
  const [layout, setLayout] = useState(() => ({
    docked: !window.gitOverlay && new URLSearchParams(window.location.search).get('dock') === 'right',
  }))
  const gripperRef = useRef()

  useEffect(() => {
    if (!window.gitOverlay) return undefined

    let active = true
    window.gitOverlay.getBranchState().then((nextState) => {
      if (active) setState(nextState)
    })
    const unsubscribe = window.gitOverlay.onBranchState((nextState) => {
      if (active) setState(nextState)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!window.gitOverlay || state.status !== 'ready') return
    setUpstreamMovement(rememberUpstreamMovement(state))
    setRecentChanges(rememberRecentChanges(state))
  }, [state])

  useEffect(() => {
    if (!window.gitOverlay) return undefined

    let active = true
    window.gitOverlay.getLayoutState().then((nextLayout) => {
      if (active) setLayout(nextLayout)
    })
    const unsubscribe = window.gitOverlay.onLayoutState((nextLayout) => {
      if (active) setLayout(nextLayout)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let tickTimeout
    const interval = window.setInterval(() => {
      setCurrentTick(true)
      tickTimeout = window.setTimeout(() => setCurrentTick(false), 260)
    }, 4000)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(tickTimeout)
    }
  }, [])

  useEffect(() => {
    const bounds = gripperRef.current?.getBoundingClientRect()
    if (!bounds) return
    window.gitOverlay?.setGripperBounds({
      height: bounds.height,
      width: bounds.width,
      x: bounds.x,
      y: bounds.y,
    })
  }, [layout.docked])

  useEffect(() => {
    if (!window.gitOverlay?.setInteractiveBounds) return undefined

    let frame
    let previousSignature = ''
    const updateInteractiveBounds = () => {
      frame = undefined
      const cards = document.querySelectorAll('.tree-hover-layer .branch-hover-card__surface')
      const nextBounds = [...cards].slice(0, 4).map((card) => {
        const { height, width, x, y } = card.getBoundingClientRect()
        return { height, width, x, y }
      })
      const signature = JSON.stringify(nextBounds)
      if (signature === previousSignature) return
      previousSignature = signature
      window.gitOverlay.setInteractiveBounds(nextBounds)
    }
    const handleMouseMove = () => {
      if (!frame) frame = window.requestAnimationFrame(updateInteractiveBounds)
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (frame) window.cancelAnimationFrame(frame)
      window.gitOverlay.setInteractiveBounds([])
    }
  }, [])

  const content = useMemo(() => {
    if (state.status === 'ready') {
      return <GitTree currentTick={currentTick} recentChanges={state.recentChanges || recentChanges} state={state} upstreamMovement={upstreamMovement} />
    }
    return <EmptyState state={state} />
  }, [currentTick, recentChanges, state, upstreamMovement])

  return (
    <main className={`transparent-overlay ${layout.docked ? 'is-docked-right' : ''}`}>
      <div className="tree-canvas">{content}</div>
      <div
        aria-label="Drag to move the Git tree"
        className="tree-gripper"
        ref={gripperRef}
        role="button"
        title="Drag tree"
      >
        <span />
      </div>
    </main>
  )
}
