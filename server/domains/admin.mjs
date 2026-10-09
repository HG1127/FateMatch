import crypto from 'node:crypto'

/**
 * Admin-only operational endpoints that are not part of the safety domain.
 * Shared counters, schema metadata and audit primitives are injected from the gateway.
 */
export function createAdminHandlers({
  q,
  tq,
  needAdmin,
  HttpErr,
  hashPassword,
  metrics,
  secEvent,
  tableCount,
  now = () => Date.now(),
  heapUsedBytes = () => process.memoryUsage().heapUsed,
  randomInt = (max) => crypto.randomInt(max),
}) {
  if (
    typeof q !== 'function' ||
    typeof tq !== 'function' ||
    typeof needAdmin !== 'function' ||
    typeof HttpErr !== 'function' ||
    typeof hashPassword !== 'function' ||
    !metrics ||
    typeof secEvent !== 'function' ||
    typeof tableCount !== 'function'
  ) throw new TypeError('admin domain dependencies are incomplete')

  async function handleAdminResetPassword(idOrEmail, auth) {
    needAdmin(auth)
    const r = await q(`select id, email from ${tq('users')} where id = $1 or lower(email) = lower($1) limit 1`, [idOrEmail])
    const user = r.rows[0]
    if (!user) throw new HttpErr(404, 'The requested resource wasn\'t found.')

    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
    let tempPassword = ''
    for (let i = 0; i < 12; i++) tempPassword += alphabet[randomInt(alphabet.length)]

    await q(
      `update ${tq('users')} set password_hash = $1, updated = now() where id = $2`,
      [hashPassword(tempPassword), user.id],
    )
    metrics.passwordResets += 1
    secEvent('password_reset', {
      actorSid: auth.id,
      identity: user.email,
      detail: { target: user.id },
    })
    return { tempPassword }
  }

  function handleMetrics(auth) {
    needAdmin(auth)
    return {
      code: 200,
      message: 'ok',
      data: {
        ...metrics,
        uptimeSec: Math.round((now() - metrics.startedAt) / 1000),
        avgLatencyMs: metrics.requests ? Math.round(metrics.latencyTotalMs / metrics.requests) : 0,
        tables: tableCount(),
        heapUsedMB: Math.round(heapUsedBytes() / 1048576),
      },
    }
  }

  async function handlePilotMetrics(url, auth) {
    needAdmin(auth)
    const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days') ?? 7) || 7))
    const nowMs = now()
    const since = new Date(nowMs - days * 86400_000)
    const adultCutoff = new Date(nowMs)
    adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - 18)
    const adultCutoffKey = adultCutoff.toISOString().slice(0, 10)
    const demoSids = ['u01','u02','u03','u04','u05','u06','u07','u08','u09','u10','u11','u12','adm']
    const supplyWhere = `coalesce(banned, false) = false and coalesce(role, '') <> 'admin' and not (sid = any($2::text[])) and gender in ('male','female') and seeking in ('male','female') and coalesce(birth_date, '') <> '' and birth_date <= $1 and coalesce(city, '') <> ''`
    const realProfile = (alias) => `coalesce(${alias}.banned, false) = false and coalesce(${alias}.role, '') <> 'admin' and not (${alias}.sid = any($2::text[]))`

    try {
      // Neon 是远程数据库，按指标逐项查询会放大网络往返；这里固定合并成 3 个聚合 round-trip。
      const [supplyR, exposureR, funnelR] = await Promise.all([
        q(`with eligible as (
             select city from ${tq('profiles')} where ${supplyWhere}
           ), by_city as (
             select city, count(*)::int n from eligible group by city order by n desc, city asc limit 8
           )
           select (select count(*)::int from eligible) eligible_profiles,
                  coalesce((select jsonb_agg(jsonb_build_object('city', city, 'n', n) order by n desc, city asc) from by_city), '[]'::jsonb) cities`,
          [adultCutoffKey, demoSids]),
        q(`with base as (
             select de.viewer_sid, de.target_sid, de.source
             from ${tq('discovery_exposures')} de
             join ${tq('profiles')} pv on pv.sid = de.viewer_sid
             join ${tq('profiles')} pt on pt.sid = de.target_sid
             where de.created >= $1 and ${realProfile('pv')} and ${realProfile('pt')}
           ), by_target as (
             select target_sid, count(*)::int n from base group by target_sid
           ), by_source as (
             select source, count(*)::int n from base group by source
           )
           select count(*)::int deliveries,
                  count(distinct viewer_sid)::int viewers,
                  count(distinct target_sid)::int targets,
                  coalesce((select jsonb_agg(jsonb_build_object('target_sid', target_sid, 'n', n) order by n desc, target_sid asc) from by_target), '[]'::jsonb) target_dist,
                  coalesce((select jsonb_agg(jsonb_build_object('source', source, 'n', n) order by n desc, source asc) from by_source), '[]'::jsonb) sources
           from base`, [since, demoSids]),
        q(`with chat_pairs as (
             select least(cm.sid_a, cm.sid_b) sid_a, greatest(cm.sid_a, cm.sid_b) sid_b,
                    count(*)::int message_count, count(distinct cm.from_sid)::int sender_count
             from ${tq('chat_messages')} cm
             join ${tq('profiles')} pa on pa.sid = cm.sid_a
             join ${tq('profiles')} pb on pb.sid = cm.sid_b
             where cm.created >= $1 and coalesce(cm.recalled, false) = false and ${realProfile('pa')} and ${realProfile('pb')}
             group by least(cm.sid_a, cm.sid_b), greatest(cm.sid_a, cm.sid_b)
           )
           select
             (select count(*)::int from ${tq('user_likes')} l
              join ${tq('profiles')} po on po.sid = l.owner_sid
              join ${tq('profiles')} pt on pt.sid = l.target_sid
              where l.created >= $1 and ${realProfile('po')} and ${realProfile('pt')}) likes,
             (select count(*)::int from ${tq('user_likes')} a
              join ${tq('user_likes')} b on b.owner_sid = a.target_sid and b.target_sid = a.owner_sid
              join ${tq('profiles')} pa on pa.sid = a.owner_sid
              join ${tq('profiles')} pb on pb.sid = a.target_sid
              where a.owner_sid < a.target_sid and (a.created >= $1 or b.created >= $1) and ${realProfile('pa')} and ${realProfile('pb')}) mutual_pairs,
             (select count(*)::int from chat_pairs) conversations,
             (select count(*) filter (where sender_count >= 2)::int from chat_pairs) two_way_conversations,
             (select coalesce(sum(message_count), 0)::int from chat_pairs) messages,
             (select count(*)::int from ${tq('event_attendees')} ea
              join ${tq('profiles')} p on p.sid = ea.owner_sid
              where ea.created >= $1 and ${realProfile('p')}) event_joins,
             (select count(*)::int from ${tq('checkins')} ci
              join ${tq('profiles')} p on p.sid = ci.owner_sid
              where ci.created >= $1 and ${realProfile('p')}) event_checkins,
             (select count(*)::int from ${tq('relationship_feedback')} rf
              join ${tq('profiles')} po on po.sid = rf.owner_sid
              join ${tq('profiles')} pt on pt.sid = rf.other_sid
              where rf.updated >= $1 and rf.outcome = 'continue' and ${realProfile('po')} and ${realProfile('pt')}) feedback_continue,
             (select count(*)::int from ${tq('relationship_feedback')} rf
              join ${tq('profiles')} po on po.sid = rf.owner_sid
              join ${tq('profiles')} pt on pt.sid = rf.other_sid
              where rf.updated >= $1 and rf.outcome = 'pause' and ${realProfile('po')} and ${realProfile('pt')}) feedback_pause`, [since, demoSids]),
      ])

      const supply = supplyR.rows[0] ?? {}
      const exposure = exposureR.rows[0] ?? {}
      const funnel = funnelR.rows[0] ?? {}
      const eligibleProfiles = Number(supply.eligible_profiles ?? 0)
      const deliveries = Number(exposure.deliveries ?? 0)
      const viewers = Number(exposure.viewers ?? 0)
      const targets = Number(exposure.targets ?? 0)
      const distRows = Array.isArray(exposure.target_dist) ? exposure.target_dist : []
      const sourceRows = Array.isArray(exposure.sources) ? exposure.sources : []
      const cityRows = Array.isArray(supply.cities) ? supply.cities : []
      const dist = distRows.map(row => Number(row.n ?? 0)).filter(n => n > 0)
      const topN = dist.length ? Math.max(1, Math.ceil(dist.length * 0.1)) : 0
      const topDeliveries = topN ? dist.slice(0, topN).reduce((sum, n) => sum + n, 0) : 0
      const top10Share = deliveries ? Math.round((topDeliveries / deliveries) * 1000) / 10 : 0
      const coverageRate = eligibleProfiles ? Math.min(100, Math.round((targets / eligibleProfiles) * 1000) / 10) : 0

      return {
        available: true,
        days,
        supply: {
          eligibleProfiles,
          byCity: cityRows.map(row => ({ city: String(row.city ?? ''), count: Number(row.n ?? 0) })),
        },
        exposure: {
          deliveries,
          viewers,
          targets,
          coverageRate,
          top10Share,
          maxPerTarget: dist[0] ?? 0,
          sources: sourceRows.map(row => ({ source: String(row.source ?? ''), count: Number(row.n ?? 0) })),
        },
        funnel: {
          likes: Number(funnel.likes ?? 0),
          mutualPairs: Number(funnel.mutual_pairs ?? 0),
          conversations: Number(funnel.conversations ?? 0),
          twoWayConversations: Number(funnel.two_way_conversations ?? 0),
          messages: Number(funnel.messages ?? 0),
          eventJoins: Number(funnel.event_joins ?? 0),
          eventCheckins: Number(funnel.event_checkins ?? 0),
          feedbackContinue: Number(funnel.feedback_continue ?? 0),
          feedbackPause: Number(funnel.feedback_pause ?? 0),
        },
      }
    } catch (error) {
      if (error?.code === '42P01') return { available: false, days, reason: 'migration_required' }
      throw error
    }
  }

  return { handleAdminResetPassword, handleMetrics, handlePilotMetrics }
}
