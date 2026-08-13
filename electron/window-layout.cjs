const RIGHT_SNAP_DISTANCE = 120

function isNearRightEdge(bounds, workArea, distance = RIGHT_SNAP_DISTANCE) {
  const windowRight = bounds.x + bounds.width
  const workAreaRight = workArea.x + workArea.width
  return windowRight >= workAreaRight - distance
}

function clampWindowY(y, height, workArea) {
  return Math.min(
    workArea.y + workArea.height - height,
    Math.max(workArea.y, y),
  )
}

function settleWindowBounds(bounds, workArea) {
  const docked = isNearRightEdge(bounds, workArea)
  return {
    docked,
    x: docked ? workArea.x + workArea.width - bounds.width : bounds.x,
    y: clampWindowY(bounds.y, bounds.height, workArea),
  }
}

module.exports = {
  RIGHT_SNAP_DISTANCE,
  isNearRightEdge,
  settleWindowBounds,
}
