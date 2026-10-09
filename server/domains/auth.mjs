/**
 * Authentication domain: password login + token refresh.
 *
 * Brute-force state, JWT key/signing and audit persistence remain owned by the gateway
 * and are injected, so this module cannot diverge from the process-wide security state.
 */
export function createAuthHandlers({
  q,
  tq,
  needAuth,
  HttpErr,
  parseAuthBody,
  assertNotLocked,
  noteAuthFail,
  clearAuthFail,
  comparePassword,
  secEvent,
  signToken,
  pwFingerprint,
  colIdOf,
  toRecord,
  nowSeconds = () => Math.floor(Date.now() / 1000),
}) {
  const deps = [
    q, tq, needAuth, HttpErr, parseAuthBody, assertNotLocked, noteAuthFail,
    clearAuthFail, comparePassword, secEvent, signToken, pwFingerprint, colIdOf, toRecord,
  ]
  if (deps.some(dep => typeof dep !== 'function')) throw new TypeError('auth domain dependencies are incomplete')

  const tokenFor = (id, passwordHash) => signToken({
    id,
    type: 'auth',
    collectionId: colIdOf('users'),
    collectionName: 'users',
    refreshable: true,
    pv: pwFingerprint(passwordHash),
    exp: nowSeconds() + 14 * 86400,
  })

  async function handleAuthWithPassword(body, ip) {
    const parsed = parseAuthBody(body)
    const identity = parsed.identity.toLowerCase()
    assertNotLocked(identity, ip)

    const r = await q(`select * from ${tq('users')} where lower(email) = $1`, [identity])
    const user = r.rows[0]
    if (!user || !user.password_hash || !comparePassword(parsed.password, user.password_hash)) {
      noteAuthFail(identity, ip)
      throw new HttpErr(400, 'Failed to authenticate.')
    }

    const prof = await q(`select banned from ${tq('profiles')} where sid = $1 limit 1`, [user.id])
    if (prof.rows[0]?.banned) throw new HttpErr(403, '账号已停用，如有疑问请联系掌柜')

    clearAuthFail(identity)
    secEvent('login_success', { actorSid: user.id, identity, ip })
    return { token: tokenFor(user.id, user.password_hash), record: toRecord('users', user) }
  }

  async function handleAuthRefresh(auth) {
    needAuth(auth)
    const r = await q(`select * from ${tq('users')} where id = $1`, [auth.id])
    const user = r.rows[0]
    if (!user) throw new HttpErr(400, 'Failed to authenticate.')
    return { token: tokenFor(auth.id, user.password_hash), record: toRecord('users', user) }
  }

  return { handleAuthWithPassword, handleAuthRefresh }
}
