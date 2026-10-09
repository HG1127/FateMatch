/**
 * Matching write guards: block enforcement + reciprocal-like requirement for chat.
 * DB/auth primitives are injected from the gateway; no independent state is kept here.
 */
export function createMatchingGuards({ q, tq, HttpErr }) {
  if (typeof q !== 'function' || typeof tq !== 'function' || typeof HttpErr !== 'function') {
    throw new TypeError('matching domain dependencies are incomplete')
  }

  async function assertNoBlock(a, b, auth, message) {
    if (!a || !b || a === b) return
    if (auth?.role === 'admin') return
    const r = await q(
      `select 1 from ${tq('blocks')}
       where (owner_sid = $1 and target_sid = $2) or (owner_sid = $2 and target_sid = $1)
       limit 1`,
      [a, b],
    )
    if (r.rows[0]) throw new HttpErr(403, message)
  }

  async function assertMutualChat(data, auth) {
    const a = String(data.get('sid_a') ?? '')
    const b = String(data.get('sid_b') ?? '')
    const from = String(data.get('from_sid') ?? '')
    if (!auth) throw new HttpErr(403, 'You are not allowed to perform this operation.')
    if (!a || !b || a === b || !from || (from !== a && from !== b)) {
      throw new HttpErr(400, 'Validation failed.', { chat: { message: '会话成员信息无效' } })
    }
    if (from !== auth.id) throw new HttpErr(403, '不能以其他会员身份发送消息')

    await assertNoBlock(a, b, auth, '消息未发送：双方当前不可互动')
    const likes = await q(
      `select owner_sid, target_sid from ${tq('user_likes')}
       where (owner_sid = $1 and target_sid = $2) or (owner_sid = $2 and target_sid = $1)`,
      [a, b],
    )
    const aLikesB = likes.rows.some(row => String(row.owner_sid) === a && String(row.target_sid) === b)
    const bLikesA = likes.rows.some(row => String(row.owner_sid) === b && String(row.target_sid) === a)
    if (!aLikesB || !bLikesA) throw new HttpErr(403, '双方互道有意后才能发送消息')
  }

  async function assertLikeAllowed(data, auth) {
    return assertNoBlock(
      String(data.get('owner_sid') ?? ''),
      String(data.get('target_sid') ?? ''),
      auth,
      '对方已将你加入黑名单，无法互动',
    )
  }

  return { assertNoBlock, assertMutualChat, assertLikeAllowed }
}
