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

module.exports = { createRefreshQueue }
