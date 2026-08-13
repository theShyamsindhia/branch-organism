import { useEffect, useMemo, useRef, useState } from 'react'

const PALETTE = ['#78a99d', '#b29a70', '#879aba', '#ad786f', '#7f9b76', '#a38198', '#6e9bab', '#a88b79']
const SPINE_SEGMENTS = [
  [{ x: 332, y: 62 }, { x: 400, y: 104 }, { x: 350, y: 240 }, { x: 398, y: 330 }],
  [{ x: 398, y: 330 }, { x: 452, y: 430 }, { x: 414, y: 610 }, { x: 520, y: 720 }],
]
const SPINE_PATH = 'M 332 62 C 400 104 350 240 398 330 C 452 430 414 610 520 720'
const UPSTREAM_MEMORY_KEY = 'branch-organism:upstream-memory'

const demoState = {
  status: 'ready',
  repoName: 'studio',
  current: 'feat/composer-translations',
  base: 'dev',
  comparisonBase: 'origin/dev',
  totalBranches: 42,
  fetch: { status: 'ready', checkedAt: Date.now() },
  remote: {
    status: 'ready',
    base: { localRef: 'dev', remoteRef: 'origin/dev', localSha: 'd82405', remoteSha: 'd82410', ahead: 0, behind: 5 },
  },
  baseCommits: Array.from({ length: 9 }, (_, index) => ({
    sha: `d${String(82410 - index).padStart(5, '0')}`,
    subject: `dev checkpoint ${9 - index}`,
  })),
  branches: [
    ['feat/composer-translations', 14, 5, 0, true, false, false, 'CLEAN'],
    ['dev', 0, 0, 0, false, true, true, null],
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
    pullRequest: mergeStateStatus ? {
      number: 2300 + index,
      mergeStateStatus,
      state: 'OPEN',
      checks: { total: 7, passed: mergeStateStatus === 'DIRTY' ? 4 : 6, failed: mergeStateStatus === 'DIRTY' ? 2 : 0, pending: 1 },
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
      detectedAt: Date.now(),
      fromSha: memory.remoteSha,
      toSha: relation.remoteSha,
    }
  }

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

function ageOpacity(branch) {
  if (branch.isCurrent) return 1
  if (branch.conflict) return 0.86
  return clamp(0.92 - Math.log2((branch.ageDays || 0) + 1) * 0.11, 0.26, 0.92)
}

function checkSummary(checks) {
  if (!checks?.total) return 'checks unavailable'
  const parts = []
  if (checks.passed) parts.push(`${checks.passed} passed`)
  if (checks.failed) parts.push(`${checks.failed} failed`)
  if (checks.pending) parts.push(`${checks.pending} pending`)
  return parts.join(' · ')
}

function prSummary(branch) {
  if (!branch.pullRequest) return 'no pull request'
  const state = branch.pullRequest.state === 'MERGED'
    ? 'merged'
    : (branch.pullRequest.mergeStateStatus || branch.pullRequest.state || '').toLowerCase()
  return `PR #${branch.pullRequest.number} · ${state}`
}

function selectRestingBranches(branches, currentOnSpine, limit = 7) {
  return branches
    .filter((branch) => !branch.isBase && !(branch.isCurrent && currentOnSpine))
    .map((branch, sourceIndex) => ({
      branch,
      sourceIndex,
      score: (branch.isCurrent ? 10000 : 0)
        + (branch.conflict ? 5000 : 0)
        + (branch.ahead > 0 ? 2000 + Math.min(branch.ahead, 100) * 10 : 0)
        + (branch.pullRequest?.state === 'OPEN' ? 500 : 0)
        - sourceIndex,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ branch }) => branch)
    .sort((left, right) => (left.baseDistance || 0) - (right.baseDistance || 0))
}

function branchGeometry(branch, index, spinePosition) {
  const hash = hashName(branch.name)
  const { x: startX, y: startY } = pointOnSpine(spinePosition)
  const requestedLength = branch.ahead > 0 ? 92 + Math.sqrt(branch.ahead) * 24 : 68
  const availableLength = startX - 54
  const length = Math.max(62, Math.min(requestedLength, availableLength))
  const angleMagnitude = 12 + ((hash >>> 3) % 10) + (index % 4) * 4
  const angledRise = Math.tan(angleMagnitude * Math.PI / 180) * Math.min(length, 116)
  const tipX = clamp(startX - length, 42, 482)
  const tipY = clamp(startY - angledRise, 82, 684)
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

  return { curve, hash, startX, startY, stem, tipX, tipY }
}

function TreeBranch({ branch, currentTick, index, spinePosition }) {
  const geometry = branchGeometry(branch, index, spinePosition)
  const { curve, hash, startX, startY, stem, tipX, tipY } = geometry
  const color = PALETTE[hash % PALETTE.length]
  const opacity = ageOpacity(branch)
  const commits = (branch.commits || []).slice(0, 5).reverse()
  const statusLabel = branch.conflict ? 'conflict' : null
  const labelX = tipX - 8
  const labelAnchor = 'end'
  const cardX = tipX < 250 ? clamp(tipX + 12, 12, 306) : clamp(tipX - 206, 12, 306)
  const cardY = clamp(tipY - 64, 12, 616)
  const currentLabel = branch.sha
    ? `current · ${trimName(branch.name, 15)} · ${branch.sha}`
    : `current · ${trimName(branch.name, 20)}`
  const restingLabel = `${trimName(branch.name, 15)} · ${branch.sha || 'unknown'}`

  return (
    <g
      className={`tree-branch ${branch.isCurrent ? 'tree-branch--current' : ''} ${branch.conflict ? 'tree-branch--conflict' : ''} ${currentTick && branch.isCurrent ? 'is-tick' : ''}`}
      style={{ '--branch-color': color, '--branch-opacity': opacity }}
    >
      <path className="branch-hit-area" d={stem} />
      <circle className="branch-junction-ring" cx={startX} cy={startY} r="5">
        <title>merge base · {branch.mergeBaseSha || 'unknown'}</title>
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
        <title>{branch.sha || branch.name} · branch head</title>
      </circle>
      {branch.isCurrent && <circle className="current-ring" cx={tipX} cy={tipY} r="9" />}
      {branch.conflict && (
        <path className="conflict-mark" d={`M ${tipX - 5} ${tipY - 5} l 10 10 M ${tipX + 5} ${tipY - 5} l -10 10`} />
      )}
      <text className={branch.isCurrent ? 'current-label' : 'branch-label__name'} x={labelX} y={tipY - 3} textAnchor={labelAnchor}>
        {branch.isCurrent ? currentLabel : restingLabel}
      </text>
      {statusLabel && (
        <text className="branch-label__progress" x={labelX} y={tipY + 8} textAnchor={labelAnchor}>{statusLabel}</text>
      )}
      <foreignObject className="branch-hover-card" x={cardX} y={cardY} width="202" height="132">
        <div className="branch-hover-card__surface" xmlns="http://www.w3.org/1999/xhtml">
          <strong>{branch.name}</strong>
          <span>{prSummary(branch)}</span>
          {branch.pullRequest?.title && <span className="branch-hover-card__pr-title">{branch.pullRequest.title}</span>}
          <span>{checkSummary(branch.pullRequest?.checks)}</span>
          <span>{branch.ahead} ahead · {branch.behind} behind</span>
          <span>last activity · {branch.relative || 'unknown'}</span>
        </div>
      </foreignObject>
    </g>
  )
}

function GitTree({ state, currentTick, upstreamMovement }) {
  const visibleBranches = state.branches.slice(0, 15)
  const base = state.remote?.base?.remoteRef || state.comparisonBase || state.base
  const baseAhead = state.remote?.base?.ahead || 0
  const baseIncoming = state.remote?.base?.behind || 0
  const rememberedIncoming = baseIncoming || upstreamMovement?.count || 0
  const baseCommits = (state.baseCommits || []).slice(0, 6)
  const baseIsCurrent = state.current === state.base
  const baseBranch = visibleBranches.find((branch) => branch.isBase)
  const currentBranch = visibleBranches.find((branch) => branch.isCurrent)
  const currentOnSpine = baseIsCurrent || currentBranch?.ahead === 0
  const currentAtBaseHead = currentOnSpine && currentBranch?.sha === baseBranch?.sha
  const baseFullySynced = currentAtBaseHead
    && Boolean(state.remote?.base?.remoteRef)
    && baseAhead === 0
    && baseIncoming === 0
  const branches = selectRestingBranches(visibleBranches, currentOnSpine)
  const branchDistances = branches
    .map((branch) => branch.baseDistance)
    .filter((distance) => Number.isFinite(distance) && distance >= 0)
  const maxBaseDistance = Math.max(rememberedIncoming, baseCommits.length - 1, ...branchDistances, 1)
  const spinePositionAtDistance = (distance) => {
    const ratio = Math.log1p(Math.max(0, distance)) / Math.log1p(maxBaseDistance)
    return 0.15 + ratio * 0.7
  }
  const basePointAt = (distance) => pointOnSpine(spinePositionAtDistance(distance))
  const branchSpinePosition = (_branch, index) => branches.length === 1
    ? 0.42
    : 0.18 + (index / (branches.length - 1)) * 0.62
  const exactBaseIndex = baseCommits.findIndex((commit) => commit.sha === baseBranch?.sha)
  const currentBaseDistance = baseIsCurrent
    ? (exactBaseIndex >= 0 ? exactBaseIndex : baseIncoming)
    : (currentBranch?.baseDistance || 0)
  const currentBasePoint = basePointAt(currentBaseDistance)
  const remoteBasePoint = basePointAt(0)
  const upstreamStartPoint = basePointAt(baseIncoming || rememberedIncoming)
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
  const upstreamLabelPoint = pointOnCubic(upstreamCurve, 0.5)

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
          {rememberedIncoming > 0 && (
            <g className="upstream-ghost">
              <title>{base} moved {rememberedIncoming} {rememberedIncoming === 1 ? 'commit' : 'commits'} beyond its previous checkpoint</title>
              <path className="upstream-ghost__underlay" d={upstreamGhostPath} />
              <path className="upstream-ghost__line" d={upstreamGhostPath} />
              <circle className="upstream-ghost__checkpoint" cx={upstreamStartPoint.x} cy={upstreamStartPoint.y} r="2.4" />
              <circle className="upstream-ghost__head" cx={remoteBasePoint.x} cy={remoteBasePoint.y} r="2.8" />
              <text
                className="upstream-ghost__label"
                textAnchor="middle"
                x={upstreamLabelPoint.x}
                y={upstreamLabelPoint.y - 5}
              >
                upstream +{rememberedIncoming}
              </text>
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
                x1={currentBasePoint.x + (baseFullySynced ? -5 : 5)}
                x2={currentBasePoint.x + (baseFullySynced ? -10 : 10)}
                y1={currentBasePoint.y}
                y2={currentBasePoint.y}
              />
              <text
                className="spine-current-label"
                textAnchor={baseFullySynced ? 'end' : 'start'}
                x={currentBasePoint.x + (baseFullySynced ? -13 : 13)}
                y={currentBasePoint.y + 2.5}
              >
                {baseFullySynced
                  ? `current · ${trimName(state.current, 18)} · ${currentBranch?.sha || baseBranch?.sha || 'unknown'}`
                  : `current · ${trimName(state.current, 22)} · ${currentBranch?.sha || baseBranch?.sha || 'unknown'}`}
              </text>
            </g>
          )}
          <circle className="spine-root" cx="332" cy="62" r="3.3" />
          <text x="344" y="57" textAnchor="start" className="base-label">{state.base} · {base} · {state.remote?.base?.remoteSha || baseBranch?.sha || 'unknown'}</text>
        </g>

        {branches.map((branch, index) => (
          <TreeBranch
            branch={branch}
            currentTick={currentTick}
            index={index}
            key={branch.name}
            spinePosition={branchSpinePosition(branch, index)}
          />
        ))}
      </g>
    </svg>
  )
}

function EmptyState({ state }) {
  return (
    <div className="tree-state">
      <span>Branch Organism</span>
      <p>{state.message || 'Choose a Git repository from the menu bar.'}</p>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState(() => window.gitOverlay ? { status: 'loading' } : demoState)
  const [currentTick, setCurrentTick] = useState(false)
  const [upstreamMovement, setUpstreamMovement] = useState(null)
  const [layout, setLayout] = useState(() => ({
    docked: !window.gitOverlay && new URLSearchParams(window.location.search).get('dock') === 'right',
  }))
  const gripperReleaseTimer = useRef()

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

  useEffect(() => () => {
    window.clearTimeout(gripperReleaseTimer.current)
    window.gitOverlay?.setMousePassthrough(true)
  }, [])

  useEffect(() => {
    if (!window.gitOverlay || state.status !== 'ready') return
    setUpstreamMovement(rememberUpstreamMovement(state))
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

  const content = useMemo(() => {
    if (state.status === 'ready') {
      return <GitTree currentTick={currentTick} state={state} upstreamMovement={upstreamMovement} />
    }
    return <EmptyState state={state} />
  }, [currentTick, state, upstreamMovement])

  const wakeGripper = () => {
    window.clearTimeout(gripperReleaseTimer.current)
    window.gitOverlay?.setMousePassthrough(false)
  }
  const releaseGripper = () => {
    window.clearTimeout(gripperReleaseTimer.current)
    gripperReleaseTimer.current = window.setTimeout(() => window.gitOverlay?.setMousePassthrough(true), 320)
  }

  return (
    <main className={`transparent-overlay ${layout.docked ? 'is-docked-right' : ''}`}>
      <div className="tree-canvas">{content}</div>
      <div
        aria-label="Drag to move the Git tree"
        className="tree-gripper"
        onMouseEnter={wakeGripper}
        onMouseLeave={releaseGripper}
        role="button"
        title="Drag tree"
      >
        <span />
      </div>
    </main>
  )
}
