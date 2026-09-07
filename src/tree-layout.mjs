// A fixed, compressed history scale. Adding a visible branch never moves commits.
export function spinePositionAtDistance(distance) {
  if (!Number.isFinite(distance) || distance < 0) return null
  const depth = Math.log1p(distance)
  return 0.88 * depth / (depth + 2.5)
}

export function branchDisplayName(name, limit = 28) {
  const label = name.replace(/^(?:feat|feature|fix|chore|codex|refactor|experiment)\//, '')
  return label.length <= limit ? label : `${label.slice(0, limit - 1)}…`
}

export function branchTipPosition(index, count) {
  return count <= 1 ? 280 : 138 + index * Math.min(50, 480 / (count - 1))
}
