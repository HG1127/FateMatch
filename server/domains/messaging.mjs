/**
 * Messaging read domain.
 *
 * Keep HTTP routing in neon-gateway.mjs; this module owns only authenticated
 * conversation read queries and DTO mapping. Dependencies are injected so
 * the gateway can be split domain-by-domain without introducing a second DB
 * client, schema resolver, or auth implementation.
 */
export function createMessagingHandlers({ q, tq, needAuth, HttpErr }) {
  if (typeof q !== 'function' || typeof tq !== 'function' || typeof needAuth !== 'function' || typeof HttpErr !== 'function') {
    throw new TypeError('messaging domain dependencies are incomplete')
  }

  /** 登录首包只返回每个会话最后一条消息与未读数，不返回完整聊天历史。 */
  async function handleChatSummaries(auth) {
    needAuth(auth)
    const r = await q(
      `with mine as (
         select
           case when sid_a = $1 then sid_b else sid_a end other_sid,
           from_sid, text, recalled, at, created, id
         from ${tq('chat_messages')}
         where sid_a = $1 or sid_b = $1
       ),
       latest as (
         select distinct on (other_sid)
           other_sid, from_sid, text, recalled, at
         from mine
         order by other_sid, at desc, created desc, id desc
       )
       select
         l.other_sid,
         l.from_sid as last_from,
         l.text as last_text,
         l.recalled,
         l.at as last_at,
         (
           select count(*)::int
           from mine m
           where m.other_sid = l.other_sid
             and m.from_sid <> $1
             and m.at > coalesce((
               select max(ur.at)
               from ${tq('user_reads')} ur
               where ur.owner_sid = $1 and ur.other_sid = l.other_sid
             ), 0)
         ) as unread
       from latest l
       order by l.at desc, l.other_sid asc`,
      [auth.id],
    )
    return {
      items: r.rows.map((row) => ({
        otherId: String(row.other_sid ?? ''),
        lastAt: Number(row.last_at ?? 0),
        lastText: row.recalled ? '消息已撤回' : String(row.last_text ?? ''),
        lastFrom: String(row.last_from ?? ''),
        unread: Number(row.unread ?? 0),
      })),
    }
  }

  /** 周报只读取轻量时间/方向，不需要加载任何聊天正文或图片。 */
  async function handleChatActivity(url, auth) {
    needAuth(auth)
    const since = Number(url.searchParams.get('since') ?? 0)
    if (!Number.isFinite(since) || since <= 0) throw new HttpErr(400, 'since 参数无效')
    const r = await q(
      `select
         case when sid_a = $1 then sid_b else sid_a end other_sid,
         "at",
         case when from_sid = $1 then 'sent' else 'received' end direction
       from ${tq('chat_messages')}
       where (sid_a = $1 or sid_b = $1) and "at" >= $2
       order by "at" asc, created asc, id asc`,
      [auth.id, since],
    )
    return {
      items: r.rows.map(row => ({
        otherId: String(row.other_sid ?? ''),
        at: Number(row.at ?? 0),
        direction: row.direction === 'sent' ? 'sent' : 'received',
      })),
    }
  }

  async function relationshipFeedbackState(otherSid, auth) {
    needAuth(auth)
    const otherId = String(otherSid ?? '').trim()
    if (!otherId || otherId === auth.id) throw new HttpErr(400, '会话对象无效')
    try {
      const r = await q(
        `select
           (exists(select 1 from ${tq('user_likes')} a where a.owner_sid = $1 and a.target_sid = $2)
            and exists(select 1 from ${tq('user_likes')} b where b.owner_sid = $2 and b.target_sid = $1)) mutual,
           exists(
             select 1 from ${tq('chat_messages')} cm
             where ((cm.sid_a = $1 and cm.sid_b = $2) or (cm.sid_a = $2 and cm.sid_b = $1))
               and coalesce(cm.recalled, false) = false
           ) has_chat,
           (select rf.outcome from ${tq('relationship_feedback')} rf where rf.owner_sid = $1 and rf.other_sid = $2 limit 1) outcome`,
        [auth.id, otherId],
      )
      const row = r.rows[0] ?? {}
      const outcome = row.outcome === 'continue' || row.outcome === 'pause' ? row.outcome : null
      return { available: true, eligible: !!row.mutual && !!row.has_chat, outcome }
    } catch (error) {
      if (error?.code === '42P01') return { available: false, eligible: false, outcome: null }
      throw error
    }
  }

  /** 本人只读自己的当前关系反馈；不读取对方选择。 */
  async function handleRelationshipFeedback(otherSid, auth) {
    return relationshipFeedbackState(otherSid, auth)
  }

  /** 只有互相有意且已经发生真实消息后才允许提交；null 表示撤回。 */
  async function handleRelationshipFeedbackSet(otherSid, body, auth) {
    needAuth(auth)
    const otherId = String(otherSid ?? '').trim()
    if (!otherId || otherId === auth.id) throw new HttpErr(400, '会话对象无效')
    const raw = body?.outcome
    const outcome = raw === null || raw === undefined || raw === '' ? null : String(raw)
    if (outcome !== null && outcome !== 'continue' && outcome !== 'pause') {
      throw new HttpErr(400, '反馈选项无效')
    }
    if (outcome === null) {
      try {
        await q(`delete from ${tq('relationship_feedback')} where owner_sid = $1 and other_sid = $2`, [auth.id, otherId])
      } catch (error) {
        if (error?.code === '42P01') return { available: false, eligible: false, outcome: null }
        throw error
      }
      return { available: true, eligible: true, outcome: null }
    }

    const state = await relationshipFeedbackState(otherId, auth)
    if (!state.available) throw new HttpErr(503, '反馈功能暂未就绪')
    if (!state.eligible) throw new HttpErr(400, '发生真实交流后再留下关系反馈')
    const at = Date.now()
    await q(
      `insert into ${tq('relationship_feedback')} (id, owner_sid, other_sid, outcome, "at", created, updated)
       values ($1,$2,$3,$4,$5,now(),now())
       on conflict (owner_sid, other_sid)
       do update set outcome = excluded.outcome, "at" = excluded."at", updated = now()`,
      [`${auth.id}:${otherId}`, auth.id, otherId, outcome, at],
    )
    return { available: true, eligible: true, outcome }
  }

  /** 只允许当前登录会员读取自己与指定对象之间的消息。 */
  async function handleChatConversation(otherSid, auth) {
    needAuth(auth)
    const otherId = String(otherSid ?? '').trim()
    if (!otherId || otherId === auth.id) throw new HttpErr(400, '会话对象无效')
    const r = await q(
      `select *
       from ${tq('chat_messages')}
       where (sid_a = $1 and sid_b = $2) or (sid_a = $2 and sid_b = $1)
       order by at asc, created asc, id asc`,
      [auth.id, otherId],
    )
    return {
      items: r.rows.map((row) => ({
        id: String(row.sid ?? ''),
        recordId: String(row.id ?? ''),
        from: String(row.from_sid ?? ''),
        text: String(row.text ?? ''),
        at: Number(row.at ?? 0),
        recalled: !!row.recalled,
        images: Array.isArray(row.images) ? row.images.map(String) : [],
      })),
    }
  }

  return { handleChatSummaries, handleChatConversation, handleChatActivity, handleRelationshipFeedback, handleRelationshipFeedbackSet }
}
