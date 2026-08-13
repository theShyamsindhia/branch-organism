const { readBranchState, readRepositoryFingerprint } = require('./git-data.cjs')

const cache = new Map()

process.parentPort.on('message', ({ data }) => {
  const { id, pullRequestState, repoPath } = data

  try {
    const fingerprint = readRepositoryFingerprint(repoPath, pullRequestState)
    const cached = fingerprint ? cache.get(repoPath) : null
    const state = cached?.fingerprint === fingerprint
      ? { ...cached.state, updatedAt: Date.now() }
      : readBranchState(repoPath, pullRequestState)

    if (fingerprint) cache.set(repoPath, { fingerprint, state })
    process.parentPort.postMessage({ id, state })
  } catch (error) {
    process.parentPort.postMessage({ id, error: error.message })
  }
})
