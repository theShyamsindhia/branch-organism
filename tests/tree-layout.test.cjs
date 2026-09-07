const assert = require('node:assert/strict')
const test = require('node:test')

test('spine locations are stable while tips can separate shared-origin branches', async () => {
  const { spinePositionAtDistance, branchTipPosition } = await import('../src/tree-layout.mjs')
  const anchor = spinePositionAtDistance(3)
  const branches = [{ distance: 3 }, { distance: 3 }, { distance: 400 }]
  const before = branches.map((branch) => spinePositionAtDistance(branch.distance))
  branches.splice(0, 0, { distance: 1 })
  assert.equal(spinePositionAtDistance(branches[1].distance), before[0])
  assert.equal(spinePositionAtDistance(branches[2].distance), anchor)
  assert.notEqual(branchTipPosition(1, 4), branchTipPosition(2, 4))
  assert.equal(spinePositionAtDistance(null), null)
  assert.equal(spinePositionAtDistance(0), 0)
  assert.ok(spinePositionAtDistance(47) > anchor)
})
