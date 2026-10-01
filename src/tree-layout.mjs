// A fixed, compressed history scale. Adding a visible branch never moves commits.
export function spinePositionAtDistance(distance) {
  if (!Number.isFinite(distance) || distance < 0) return null
  const depth = Math.log1p(distance)
  return 0.88 * depth / (depth + 2.5)
}

// One layout for every spine consumer. Equal distances are the same commit and
// order is always preserved, but spacing is set in screen space by what hangs
// off each commit: a commit that branches reserves room for its tips, a bare
// commit dot only a little. Entries are distances or { distance, room, side },
// where room is the vertical space (viewBox units) a mark needs below its commit.
const SPINE_END = 0.88
const MIN_COMMIT_ROOM = 14
const MAX_STRETCH = 1.25

function inverse(yAt, y) {
  let low = 0
  let high = 1
  for (let step = 0; step < 32; step += 1) {
    const middle = (low + high) / 2
    if (yAt(middle) < y) low = middle
    else high = middle
  }
  return (low + high) / 2
}

export function createSpineLayout(entries, { yAt = (t) => t * 760 } = {}) {
  // Marks on the left (branch tips) and right (flowers, HEAD, production) of
  // the spine stack independently, so a commit needs the larger side, not both.
  const rooms = new Map([[0, { left: 0, right: 0 }]])
  for (const entry of entries) {
    const isObject = typeof entry === 'object' && entry !== null
    const distance = isObject ? entry.distance : entry
    if (!Number.isFinite(distance) || distance < 0) continue
    const room = rooms.get(distance) || { left: 0, right: 0 }
    if (isObject && entry.room) room[entry.side === 'right' ? 'right' : 'left'] += entry.room
    rooms.set(distance, room)
  }
  const ordered = [...rooms.keys()].sort((a, b) => a - b)
  const roomBelow = (distance) => Math.max(MIN_COMMIT_ROOM, rooms.get(distance).left, rooms.get(distance).right)
  const offsets = [0]
  for (let index = 1; index < ordered.length; index += 1) {
    offsets.push(offsets[index - 1] + roomBelow(ordered[index - 1]))
  }
  const top = yAt(0)
  const available = yAt(SPINE_END) - top
  const total = offsets.at(-1)
  const scale = total ? Math.min(MAX_STRETCH, available / total) : 1
  const byDistance = new Map(ordered.map((distance, index) => [
    distance,
    index === 0 ? 0 : Math.min(SPINE_END, inverse(yAt, top + offsets[index] * scale)),
  ]))
  return (distance) => byDistance.get(distance) ?? spinePositionAtDistance(distance)
}

export function groupSpineJunctions(branches) {
  const groups = new Map()
  for (const branch of branches) {
    if (!Number.isFinite(branch.baseDistance) || branch.baseDistance < 0) continue
    const group = groups.get(branch.baseDistance) || { distance: branch.baseDistance, branches: [] }
    group.branches.push(branch)
    groups.set(branch.baseDistance, group)
  }
  return [...groups.values()].sort((a, b) => a.distance - b.distance).map((group) => {
    const sha = group.branches[0].mergeBaseSha?.slice(0, 7)
    return {
      ...group,
      sha: group.branches[0].spineAnchorSha || sha,
      sharedAncestor: Boolean(sha) && group.branches.every((branch) => (
        branch.attachmentKind !== 'merged-history' && branch.mergeBaseSha?.slice(0, 7) === sha
      )),
    }
  })
}

export function branchDisplayName(name, limit = 28) {
  const label = name.replace(/^(?:feat|feature|fix|chore|codex|refactor|experiment)\//, '')
  return label.length <= limit ? label : `${label.slice(0, limit - 1)}…`
}

export function branchTipPosition(index, count) {
  return count <= 1 ? 280 : 138 + index * Math.min(50, 480 / (count - 1))
}

// Each tip hangs a short drop below its own junction, so a stem always leaves
// the spine in the direction of its tip. Tips that would collide are pushed
// down (siblings from one commit stack into a fan); overflow is pulled back up.
export const BRANCH_TIP_GAP = 46

export function layoutBranchTips(anchorYs, currentY, { drop = 24, gap = BRANCH_TIP_GAP, top = 96, bottom = 700 } = {}) {
  const count = anchorYs.length
  if (!count) return []
  const spacing = Math.min(gap, (bottom - top) / Math.max(1, count - 1))
  const tips = []
  let previous = -Infinity
  for (const anchorY of anchorYs) {
    const anchor = Number.isFinite(anchorY) ? anchorY : previous
    let y = Math.max(top, anchor + drop, previous + spacing)
    if (Number.isFinite(currentY) && Math.abs(y - currentY) < 28) y = currentY + 28
    tips.push(y)
    previous = y
  }
  for (let index = count - 1; index >= 0; index -= 1) {
    const limit = index === count - 1 ? bottom : tips[index + 1] - spacing
    if (tips[index] > limit) tips[index] = limit
  }
  return tips
}
