/**
 * Safety domain: report resolution / appeal, security-event reads and word-filter admin endpoints.
 *
 * The gateway keeps shared auth, DB pool and audit primitives; they are injected here so
 * safety rules can be tested independently without introducing another persistence layer.
 */
export function createSafetyHandlers({
  q,
  tq,
  needAuth,
  needAdmin,
  HttpErr,
  pool,
  toRecord,
  secEvent,
  defaultBlockedWords,
  getExtraBlockedWords,
  setExtraBlockedWords,
  now = () => Date.now(),
}) {
  if (
    typeof q !== 'function' ||
    typeof tq !== 'function' ||
    typeof needAuth !== 'function' ||
    typeof needAdmin !== 'function' ||
    typeof HttpErr !== 'function' ||
    !pool?.connect ||
    typeof toRecord !== 'function' ||
    typeof secEvent !== 'function' ||
    !Array.isArray(defaultBlockedWords) ||
    typeof getExtraBlockedWords !== 'function' ||
    typeof setExtraBlockedWords !== 'function'
  ) {
    throw new TypeError('safety domain dependencies are incomplete')
  }

  /** 举报工单处理：处置结果与封禁在同一事务完成。 */
  async function handleAdminResolveReport(sidOrId, body, auth) {
    needAdmin(auth)
    const action = String(body?.action ?? '')
    if (!['ban', 'dismiss'].includes(action)) throw new HttpErr(400, '处理动作无效')

    const client = await pool.connect()
    let report
    try {
      await client.query('begin')
      const found = await client.query(
        `select * from ${tq('reports')} where sid = $1 or id = $1 limit 1 for update`,
        [sidOrId],
      )
      report = found.rows[0]
      if (!report) throw new HttpErr(404, '举报记录不存在')

      const resolvedAt = now()
      await client.query(
        `update ${tq('reports')}
         set status = 'done', resolution = $1, resolved_at = $2,
             appeal_status = case when appeal_status = 'open' then 'resolved' else appeal_status end,
             updated = now()
         where id = $3`,
        [action, resolvedAt, report.id],
      )
      if (action === 'ban' && report.target_sid) {
        await client.query(
          `update ${tq('profiles')} set banned = true, updated = now() where sid = $1`,
          [report.target_sid],
        )
      }
      await client.query('commit')
    } catch (error) {
      try { await client.query('rollback') } catch {}
      throw error
    } finally {
      client.release()
    }

    secEvent('report_resolved', {
      actorSid: auth.id,
      detail: { report: report.sid, action, target: report.target_sid },
    })
    const out = await q(`select * from ${tq('reports')} where id = $1`, [report.id])
    return toRecord('reports', out.rows[0])
  }

  /**
   * 举报人只能在处理完成后申诉一次。
   * 使用 FOR UPDATE 串行化同一工单的并发申诉，避免两个请求同时通过“尚未申诉”检查。
   */
  async function handleReportAppeal(sidOrId, body, auth) {
    needAuth(auth)
    const note = String(body?.note ?? '').trim()
    if (note.length < 5 || note.length > 1000) {
      throw new HttpErr(400, 'Validation failed.', { note: { message: '申诉说明请填写 5–1000 字' } })
    }

    const client = await pool.connect()
    let report
    try {
      await client.query('begin')
      const found = await client.query(
        `select * from ${tq('reports')}
         where (sid = $1 or id = $1) and by_sid = $2
         limit 1 for update`,
        [sidOrId, auth.id],
      )
      report = found.rows[0]
      if (!report) throw new HttpErr(404, '举报记录不存在')
      if (String(report.status ?? '') !== 'done') throw new HttpErr(400, '举报尚未处理完成，暂不能申诉')
      if (String(report.appeal_status ?? '')) throw new HttpErr(400, '该举报已提交过申诉')

      const appealAt = now()
      await client.query(
        `update ${tq('reports')}
         set appeal_note = $1, appeal_at = $2, appeal_status = 'open', updated = now()
         where id = $3`,
        [note, appealAt, report.id],
      )
      await client.query('commit')
    } catch (error) {
      try { await client.query('rollback') } catch {}
      throw error
    } finally {
      client.release()
    }

    secEvent('report_appealed', { actorSid: auth.id, detail: { report: report.sid } })
    const out = await q(`select * from ${tq('reports')} where id = $1`, [report.id])
    return toRecord('reports', out.rows[0])
  }

  /** 会员自己的举报工单按需读取；管理员仍通过管理世界读取全量工单。 */
  async function handleMyReports(auth) {
    needAuth(auth)
    const r = await q(
      `select * from ${tq('reports')} where by_sid = $1 order by "at" desc, created desc, id desc limit 500`,
      [auth.id],
    )
    return { items: r.rows.map(row => toRecord('reports', row)) }
  }

  /** 最近安全事件（倒序，可按合法 type 过滤；limit ≤ 200）。 */
  async function handleAdminSecurityEvents(url, auth) {
    needAdmin(auth)
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100))
    const type = String(url.searchParams.get('type') ?? '')
    const params = [limit]
    let where = ''
    if (type && /^[a-z_]{1,40}$/.test(type)) {
      where = 'where "type" = $2'
      params.push(type)
    }
    const r = await q(
      `select id, "type", actor_sid, identity, ip, detail, "at"
       from ${tq('security_events')} ${where}
       order by "at" desc limit $1`,
      params,
    )
    return { items: r.rows }
  }

  /** 敏感词表读取 / 保存；保存后即时刷新网关内存状态并写审计事件。 */
  async function handleAdminWordFilter(req, body, auth) {
    needAdmin(auth)
    if (req.method === 'GET') {
      return { defaults: defaultBlockedWords, words: getExtraBlockedWords() }
    }

    const raw = body?.words
    if (!Array.isArray(raw)) {
      throw new HttpErr(400, 'Validation failed.', { words: { message: '词表须为数组' } })
    }
    const words = [...new Set(raw.map(x => String(x ?? '').trim().slice(0, 30)).filter(Boolean))].slice(0, 200)
    await q(
      `insert into ${tq('gateway_meta')} (key, value) values ('blocked_words', $1)
       on conflict (key) do update set value = $1`,
      [JSON.stringify(words)],
    )
    setExtraBlockedWords(words)
    secEvent('word_filter_updated', { actorSid: auth.id, detail: { count: words.length } })
    return { defaults: defaultBlockedWords, words }
  }

  return {
    handleAdminResolveReport,
    handleReportAppeal,
    handleMyReports,
    handleAdminSecurityEvents,
    handleAdminWordFilter,
  }
}
