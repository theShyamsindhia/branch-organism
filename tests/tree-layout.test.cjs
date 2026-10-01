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

test('spine joints keep commit order and reserve the room their marks need', async () => {
  const { createSpineLayout } = await import('../src/tree-layout.mjs')
  const yAt = (t) => 62 + t * 700
  const distances = [0, 2, 5, 26, 26, 26, 26, 45, 52, 62]
  const position = createSpineLayout(distances, { yAt })
  const unique = [...new Set(distances)]
  assert.equal(position(0), 0)
  assert.equal(position(null), null)
  for (let index = 1; index < unique.length; index += 1) assert.ok(position(unique[index]) > position(unique[index - 1]))
  const reordered = createSpineLayout([...distances].reverse(), { yAt })
  unique.forEach((distance) => assert.equal(position(distance), reordered(distance)))

  // Three branches from one commit push the next commit down by three tip gaps;
  // marks on the opposite side share that height instead of adding to it.
  const branched = createSpineLayout([
    { distance: 4, room: 46, side: 'left' },
    { distance: 4, room: 46, side: 'left' },
    { distance: 4, room: 46, side: 'left' },
    { distance: 4, room: 40, side: 'right' },
    9,
  ], { yAt })
  // (short trees may stretch to fill the canvas, so compare against a bare commit step)
  const bareStep = yAt(branched(4)) - yAt(branched(0))
  assert.ok(Math.abs((yAt(branched(9)) - yAt(branched(4))) / bareStep - 138 / 14) < 0.01)

  const crowded = createSpineLayout(Array.from({ length: 40 }, (_, index) => ({ distance: index * 100, room: 46 })), { yAt })
  assert.equal(crowded(0), 0)
  assert.ok(crowded(3900) <= 0.88)
  for (let index = 1; index < 40; index += 1) assert.ok(crowded(index * 100) > crowded((index - 1) * 100))
})

test('one joint per commit distinguishes shared ancestors from projected side histories', async () => {
  const { groupSpineJunctions } = await import('../src/tree-layout.mjs')
  const branches = ['a', 'b', 'c', 'd'].map((name) => ({ name, baseDistance: 26, mergeBaseSha: '262a9cfc5', attachmentKind: 'direct' }))
  const groups = groupSpineJunctions([...branches,
    { name: 'e', baseDistance: 45, mergeBaseSha: 'dbaff78ae' },
    { name: 'f', baseDistance: 52, mergeBaseSha: '64414ee7a' },
    { name: 'unknown', baseDistance: null },
  ])
  assert.deepEqual(groups.map((group) => group.distance), [26, 45, 52])
  assert.equal(groups[0].branches.length, 4)
  assert.equal(groups[0].sharedAncestor, true)
  const projected = groupSpineJunctions([
    { baseDistance: 2, mergeBaseSha: 'aaaaaaa', spineAnchorSha: 'ccccccc', attachmentKind: 'merged-history' },
    { baseDistance: 2, mergeBaseSha: 'bbbbbbb', spineAnchorSha: 'ccccccc', attachmentKind: 'merged-history' },
  ])
  assert.equal(projected.length, 1)
  assert.equal(projected[0].sharedAncestor, false)
  assert.equal(projected[0].sha, 'ccccccc')
})

test('tips hang just below their own junction and fan out when they share one', async () => {
  const { layoutBranchTips } = await import('../src/tree-layout.mjs')
  const tips = layoutBranchTips([200, 200, 200, 420])
  assert.deepEqual(tips, [224, 270, 316, 444])

  for (const currentY of [138, 210, 275, 330, 600]) {
    const crowded = layoutBranchTips(Array.from({ length: 11 }, (_, index) => 120 + index * 20), currentY)
    crowded.forEach((y, index) => {
      if (index) assert.ok(y - crowded[index - 1] >= 46 - 1e-9)
    })
    assert.ok(crowded.at(-1) <= 700)
  }
  assert.ok(layoutBranchTips([300], 320)[0] >= 348, 'tips step past the HEAD marker')
})
