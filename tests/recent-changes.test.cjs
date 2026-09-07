const assert = require('node:assert/strict')
const test = require('node:test')

test('detects branch growth, check transitions, and a new conflict', async () => {
  const { captureRecentSnapshot, detectRecentChanges } = await import('../src/recent-changes.mjs')
  const previous = captureRecentSnapshot({
    repoPath: '/repo',
    branches: [{
      ahead: 1,
      conflict: false,
      name: 'feature/organism-memory',
      pullRequest: {
        checks: { items: [{ name: 'Build', status: 'pending' }] },
        number: 27,
        state: 'OPEN',
      },
      sha: 'a11ce00',
    }],
  })
  const next = captureRecentSnapshot({
    repoPath: '/repo',
    branches: [{
      ahead: 3,
      conflict: true,
      name: 'feature/organism-memory',
      pullRequest: {
        checks: { items: [{ name: 'Build', status: 'passed' }] },
        number: 27,
        state: 'OPEN',
      },
      sha: 'beef123',
    }],
  })

  const changes = detectRecentChanges(previous, next, 123456)

  assert.deepEqual(changes.map((change) => change.kind), [
    'branch-advanced',
    'checks-changed',
    'conflict-appeared',
  ])
  assert.equal(changes[0].commitsAdded, 2)
  assert.deepEqual(changes[1].checks, [{ name: 'Build', status: 'passed' }])
})

test('keeps only recent, unique evidence', async () => {
  const { RECENT_CHANGE_TTL_MS, mergeRecentChanges, recentChangeOpacity } = await import('../src/recent-changes.mjs')
  const now = RECENT_CHANGE_TTL_MS + 5000
  const recent = { id: 'recent', kind: 'pr-opened', observedAt: now - 1000 }
  const expired = { id: 'expired', kind: 'branch-advanced', observedAt: 0 }

  assert.deepEqual(mergeRecentChanges([recent, expired], [recent], now), [recent])
  assert.ok(recentChangeOpacity(recent.observedAt, now) > recentChangeOpacity(now - RECENT_CHANGE_TTL_MS / 2, now))
})
