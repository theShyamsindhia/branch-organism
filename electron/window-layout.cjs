const RIGHT_SNAP_DISTANCE = 120

function isNearRightEdge(bounds, workArea, distance = RIGHT_SNAP_DISTANCE) {
  const windowRight = bounds.x + bounds.width
  const workAreaRight = workArea.x + workArea.width
  return windowRight >= workAreaRight - distance
}

function clampWindowY(y, height, workArea) {
  const maximum = Math.max(workArea.y, workArea.y + workArea.height - height)
  return Math.min(
    maximum,
    Math.max(workArea.y, y),
  )
}

function clampWindowX(x, width, workArea) {
  const maximum = Math.max(workArea.x, workArea.x + workArea.width - width)
  return Math.min(maximum, Math.max(workArea.x, x))
}

function settleWindowBounds(bounds, workArea) {
  const docked = isNearRightEdge(bounds, workArea)
  return {
    docked,
    x: docked
      ? Math.max(workArea.x, workArea.x + workArea.width - bounds.width)
      : clampWindowX(bounds.x, bounds.width, workArea),
    y: clampWindowY(bounds.y, bounds.height, workArea),
  }
}

function isPointInsideWindowRegion(point, windowBounds, region) {
  if (!point || !windowBounds || !region) return false
  const left = windowBounds.x + region.x
  const top = windowBounds.y + region.y

  return point.x >= left
    && point.x <= left + region.width
    && point.y >= top
    && point.y <= top + region.height
}

module.exports = {
  RIGHT_SNAP_DISTANCE,
  clampWindowX,
  clampWindowY,
  isNearRightEdge,
  isPointInsideWindowRegion,
  settleWindowBounds,
}
