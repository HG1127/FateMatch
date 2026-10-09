/**
 * node-postgres emits 'error' on an idle client when Neon closes/reset its socket.
 * With no Pool listener this becomes a fatal unhandled EventEmitter error.
 * pg-pool removes the failed client; fresh queries can open a replacement.
 * Never log the raw Error/client object: it can contain SQL and connection metadata.
 */
export function registerIdlePoolErrorHandler(pool, report = message => console.warn(message)) {
  pool.on('error', error => {
    const code = typeof error?.code === 'string' && /^[A-Z0-9]{2,12}$/.test(error.code)
      ? error.code : 'unknown'
    report(`[database] idle connection dropped (code=${code}); new connections may be opened automatically`)
  })
}
