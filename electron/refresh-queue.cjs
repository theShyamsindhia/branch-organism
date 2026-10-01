function createRefreshQueue(run) {
  let pending = false
  let pendingFetch = false
  let running = null

  function request({ fetch = false } = {}) {
    pending = true
    pendingFetch ||= fetch

    if (!running) {
      running = (async () => {
        while (pending) {
          const shouldFetch = pendingFetch
          pending = false
          pendingFetch = false
          await run({ fetch: shouldFetch })
        }
      })().finally(() => {
        running = null
      })
    }

    return running
  }

  return { request }
}

function createRefreshCoordinator({ local, remote, context = () => null }) {
  const localQueue = createRefreshQueue(local)
  let remoteRun = null
  let remoteContext
  return {
    request({ fetch = false } = {}) {
      if (!fetch) return localQueue.request()
      if (remoteRun && remoteContext !== context()) {
        return remoteRun.then(() => this.request({ fetch: true }))
      }
      // A slow network poll must neither block local HEAD checks nor accumulate
      // another network poll every minute while the first is still running.
      if (!remoteRun) {
        remoteContext = context()
        remoteRun = Promise.resolve().then(remote)
          .then(() => localQueue.request())
          .finally(() => { remoteRun = null })
      }
      return remoteRun
    },
  }
}

module.exports = { createRefreshQueue, createRefreshCoordinator }
