import crypto from 'node:crypto'

/**
 * Events domain: lightweight event list/detail reads, member activity stats and on-site check-in.
 * Shared DB/auth primitives are injected from the gateway; this module owns no independent state.
 */
export function createEventHandlers({
  q,
  tq,
  needAuth,
  HttpErr,
  toRecord,
  genId,
  getCheckinSecret,
  now = () => Date.now(),
}) {
  const deps = [q, tq, needAuth, HttpErr, toRecord, genId, getCheckinSecret]
  if (deps.some(dep => typeof dep !== 'function')) throw new TypeError('events domain dependencies are incomplete')

  const DEMO_EVENT_IDS = ['e01', 'e02', 'e03', 'e04', 'e05']

  function eventDto(row, attendees = [], comments = []) {
    return {
      id: String(row.sid),
      title: String(row.title ?? ''),
      city: String(row.city ?? ''),
      region: row.region ? String(row.region) : undefined,
      cover: String(row.cover ?? ''),
      date: String(row.date ?? ''),
      time: String(row.time ?? ''),
      capacity: Number(row.capacity ?? 0),
      desc: String(row.desc ?? ''),
      tags: Array.isArray(row.tags) ? row.tags : [],
      attendees,
      host: String(row.host ?? ''),
      creatorId: row.creator_sid ? String(row.creator_sid) : undefined,
      requirements: row.requirements ? String(row.requirements) : undefined,
      venue: row.venue ? String(row.venue) : undefined,
      costNote: row.cost_note ? String(row.cost_note) : undefined,
      cancelNote: row.cancel_note ? String(row.cancel_note) : undefined,
      pinned: !!row.pinned,
      images: Array.isArray(row.images) ? row.images : [],
      comments,
    }
  }

  function anonymousRoster(count, mine, meId, prefix) {
    const roster = mine ? [meId] : []
    for (let i = roster.length; i < count; i++) roster.push(`anon:${prefix}:${i}`)
    return roster
  }

  async function eventHiddenIds() {
    const r = await q(`select hidden_events from ${tq('site_settings')} where sid = 'main' limit 1`)
    return Array.isArray(r.rows[0]?.hidden_events) ? r.rows[0].hidden_events.map(String) : []
  }

  async function handleEventList(url, auth) {
    needAuth(auth)
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
    const requestedPerPage = Math.max(1, Number(url.searchParams.get('perPage') ?? 18) || 18)
    const ids = String(url.searchParams.get('ids') ?? '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 60)
    const requestedScope = String(url.searchParams.get('scope') ?? '')
    const scope = ['upcoming', 'past', 'mine', 'hosted', 'hanfu', 'calendar'].includes(requestedScope)
      ? requestedScope
      : ids.length ? 'ids' : 'upcoming'
    const perPage = Math.min(scope === 'calendar' ? 120 : 36, requestedPerPage)
    const from = String(url.searchParams.get('from') ?? '').slice(0, 10)
    const to = String(url.searchParams.get('to') ?? '').slice(0, 10)
    const localFirst = url.searchParams.get('localFirst') !== '0'
    const requestedCity = String(url.searchParams.get('city') ?? '').trim().slice(0, 30)
    const today = new Date(now()).toISOString().slice(0, 10)

    const meR = await q(`select city from ${tq('profiles')} where sid = $1 limit 1`, [auth.id])
    const myCity = String(meR.rows[0]?.city ?? '')
    const hidden = await eventHiddenIds()

    const params = [auth.id, DEMO_EVENT_IDS]
    // count 查询在 ids/calendar 等 scope 下也必须显式引用 $1，否则 PostgreSQL 无法推断未使用参数类型。
    const conditions = ['$1::text is not null', 'not (e.sid = any($2::text[]))']
    if (auth.role !== 'admin' && hidden.length) {
      params.push(hidden)
      conditions.push(`(not (e.sid = any($${params.length}::text[])) or e.creator_sid = $1)`)
    }
    if (requestedCity) {
      params.push(requestedCity)
      conditions.push(`e.city = $${params.length}`)
    }
    if (ids.length) {
      params.push(ids)
      conditions.push(`e.sid = any($${params.length}::text[])`)
    }
    if (scope === 'upcoming') {
      params.push(today)
      conditions.push(`e.date >= $${params.length}`)
    } else if (scope === 'past') {
      params.push(today)
      conditions.push(`e.date < $${params.length}`)
    } else if (scope === 'mine') {
      conditions.push(`exists (select 1 from ${tq('event_attendees')} ma where ma.event_sid = e.sid and ma.owner_sid = $1)`)
    } else if (scope === 'hosted') {
      conditions.push('e.creator_sid = $1')
    } else if (scope === 'hanfu') {
      params.push(today)
      conditions.push(`e.date >= $${params.length}`)
      conditions.push(`(coalesce(e.tags, '[]'::jsonb) ? '汉服' or e.title ilike '%汉服%')`)
    } else if (scope === 'calendar') {
      if (from) {
        params.push(from)
        conditions.push(`e.date >= $${params.length}`)
      }
      if (to) {
        params.push(to)
        conditions.push(`e.date <= $${params.length}`)
      }
    }

    const where = `where ${conditions.join(' and ')}`
    const cnt = await q(`select count(*)::int n from ${tq('events')} e ${where}`, params)
    const totalItems = Number(cnt.rows[0]?.n ?? 0)
    const listParams = [...params]
    const useCity = localFirst && !!myCity && (scope === 'upcoming' || scope === 'hanfu')
    let cityPos = 0
    if (useCity) {
      listParams.push(myCity)
      cityPos = listParams.length
    }
    listParams.push(perPage, (page - 1) * perPage)
    const limitPos = listParams.length - 1
    const offsetPos = listParams.length
    const order = [
      scope === 'past' ? 'e.date desc' : null,
      useCity ? `(e.city = $${cityPos}) desc` : null,
      scope !== 'past' ? 'coalesce(e.pinned, false) desc' : null,
      scope !== 'past' ? 'e.date asc' : null,
      'e.time asc',
      'e.id asc',
    ].filter(Boolean).join(', ')

    const rows = await q(
      `select e.*, coalesce(a.cnt, 0)::int attendee_count, coalesce(a.mine, false) joined_by_me
       from ${tq('events')} e
       left join lateral (
         select count(*)::int cnt, coalesce(bool_or(owner_sid = $1), false) mine
         from ${tq('event_attendees')}
         where event_sid = e.sid
       ) a on true
       ${where}
       order by ${order}
       limit $${limitPos} offset $${offsetPos}`,
      listParams,
    )

    const eventIds = rows.rows.map(row => String(row.sid))
    const summaryBy = new Map()
    if (eventIds.length) {
      const sr = await q(
        `select distinct on (event_sid) * from ${tq('event_comments')}
         where event_sid = any($1::text[])
         order by event_sid, pinned desc, at desc, created desc`,
        [eventIds],
      )
      for (const c of sr.rows) {
        summaryBy.set(String(c.event_sid), [{
          id: String(c.sid),
          authorId: String(c.author_sid ?? ''),
          text: String(c.text ?? ''),
          at: Number(c.at ?? 0),
          likes: [],
          pinned: !!c.pinned,
        }])
      }
    }

    return {
      page,
      perPage,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
      items: rows.rows.map(row => eventDto(
        row,
        anonymousRoster(Number(row.attendee_count ?? 0), !!row.joined_by_me, auth.id, `event:${row.sid}`),
        summaryBy.get(String(row.sid)) ?? [],
      )),
    }
  }

  async function handleEventDetail(eventSid, auth) {
    needAuth(auth)
    const r = await q(`select * from ${tq('events')} where sid = $1 limit 1`, [eventSid])
    const row = r.rows[0]
    if (!row || DEMO_EVENT_IDS.includes(String(row.sid))) throw new HttpErr(404, '活动不存在或已下线')

    const hidden = await eventHiddenIds()
    const isCreator = String(row.creator_sid ?? '') === auth.id
    if (auth.role !== 'admin' && !isCreator && hidden.includes(String(row.sid))) {
      throw new HttpErr(404, '活动不存在或已下线')
    }

    const ar = await q(
      `select owner_sid from ${tq('event_attendees')} where event_sid = $1 order by created asc, id asc`,
      [eventSid],
    )
    const attendeeIds = ar.rows.map(x => String(x.owner_sid))
    const joined = attendeeIds.includes(auth.id)
    const canSeeRoster = auth.role === 'admin' || isCreator
    const attendees = canSeeRoster
      ? attendeeIds
      : anonymousRoster(attendeeIds.length, joined, auth.id, `event:${eventSid}`)

    const cr = await q(
      `select * from ${tq('event_comments')} where event_sid = $1 order by pinned desc, at asc, created asc, id asc`,
      [eventSid],
    )
    const commentIds = cr.rows.map(x => String(x.sid))
    const likesBy = new Map()
    if (commentIds.length) {
      const lr = await q(
        `select target_sid, count(*)::int cnt, coalesce(bool_or(owner_sid = $2), false) mine
         from ${tq('content_likes')}
         where kind = 'event_comment' and target_sid = any($1::text[])
         group by target_sid`,
        [commentIds, auth.id],
      )
      for (const like of lr.rows) likesBy.set(String(like.target_sid), like)
    }
    const comments = cr.rows.map(c => {
      const like = likesBy.get(String(c.sid))
      return {
        id: String(c.sid),
        authorId: String(c.author_sid ?? ''),
        text: String(c.text ?? ''),
        at: Number(c.at ?? 0),
        likes: anonymousRoster(Number(like?.cnt ?? 0), !!like?.mine, auth.id, `event-comment:${c.sid}`),
        pinned: !!c.pinned,
      }
    })

    const contacts = {}
    if (canSeeRoster) {
      const co = await q(`select user_sid, text from ${tq('contacts')} where event_sid = $1`, [eventSid])
      for (const item of co.rows) contacts[String(item.user_sid)] = String(item.text ?? '')
    }
    return { event: eventDto(row, attendees, comments), contacts }
  }

  async function handleMyActivityStats(auth) {
    needAuth(auth)
    const r = await q(
      `select
         (select count(*)::int from ${tq('event_attendees')} where owner_sid = $1) joined_events,
         (select count(*)::int from ${tq('posts')} where author_sid = $1) own_posts,
         (select coalesce(max(at), 0) from ${tq('post_comments')} where author_sid = $1) last_comment_at`,
      [auth.id],
    )
    return {
      joinedEvents: Number(r.rows[0]?.joined_events ?? 0),
      ownPosts: Number(r.rows[0]?.own_posts ?? 0),
      lastCommentAt: Number(r.rows[0]?.last_comment_at ?? 0),
    }
  }

  function checkinCodeFor(event) {
    const seed = `checkin:${String(event.sid ?? '')}:${String(event.date ?? '')}`
    const hex = crypto.createHmac('sha256', String(getCheckinSecret() ?? '')).update(seed).digest('hex').slice(0, 12)
    return String(parseInt(hex, 16) % 1_000_000).padStart(6, '0')
  }

  function shanghaiDateKey(ms = now()) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms))
  }

  function checkinWindowFor(event) {
    const date = String(event.date ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpErr(400, '活动日期未配置，暂不能签到')
    const match = String(event.time ?? '').match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?:\D|$)/)
    if (!match) {
      return { open: shanghaiDateKey() === date, opensAt: `${date} 00:00`, closesAt: `${date} 23:59` }
    }
    const hh = String(Number(match[1])).padStart(2, '0')
    const mm = match[2]
    const eventAt = new Date(`${date}T${hh}:${mm}:00+08:00`).getTime()
    const opens = eventAt - 2 * 3600_000
    const closes = eventAt + 6 * 3600_000
    const current = now()
    return {
      open: current >= opens && current <= closes,
      opensAt: new Date(opens).toISOString(),
      closesAt: new Date(closes).toISOString(),
    }
  }

  async function eventForCheckin(sidOrId) {
    const r = await q(`select * from ${tq('events')} where sid = $1 or id = $1 limit 1`, [sidOrId])
    if (!r.rows[0]) throw new HttpErr(404, '活动不存在或已下线')
    return r.rows[0]
  }

  async function handleEventCheckinCode(sidOrId, auth) {
    needAuth(auth)
    const event = await eventForCheckin(sidOrId)
    if (auth.role !== 'admin' && String(event.creator_sid ?? '') !== auth.id) {
      throw new HttpErr(403, '仅活动发起人可查看现场签到码')
    }
    const window = checkinWindowFor(event)
    if (!window.open) throw new HttpErr(400, '当前不在活动签到时间窗内', window)
    return { code: checkinCodeFor(event), ...window }
  }

  async function handleEventCheckin(sidOrId, body, auth) {
    needAuth(auth)
    const event = await eventForCheckin(sidOrId)
    const window = checkinWindowFor(event)
    if (!window.open) throw new HttpErr(400, '当前不在活动签到时间窗内', window)
    const code = String(body?.code ?? '').trim()
    if (!/^\d{6}$/.test(code) || code !== checkinCodeFor(event)) {
      throw new HttpErr(400, '签到码不正确，请向现场主办方确认')
    }

    const eventSid = String(event.sid ?? sidOrId)
    const joined = await q(
      `select 1 from ${tq('event_attendees')} where event_sid = $1 and owner_sid = $2 limit 1`,
      [eventSid, auth.id],
    )
    if (!joined.rows[0] && auth.role !== 'admin') throw new HttpErr(403, '仅已报名成员可现场签到')

    const sid = `${auth.id}:${eventSid}`
    const existing = await q(`select * from ${tq('checkins')} where sid = $1 limit 1`, [sid])
    if (existing.rows[0]) return { checkedIn: true, record: toRecord('checkins', existing.rows[0]) }

    const id = genId()
    const inserted = await q(
      `insert into ${tq('checkins')} (id, sid, owner_sid, event_sid, created, updated)
       values ($1,$2,$3,$4,now(),now())
       on conflict (sid) do nothing
       returning *`,
      [id, sid, auth.id, eventSid],
    )
    const record = inserted.rows[0]
      ?? (await q(`select * from ${tq('checkins')} where sid = $1 limit 1`, [sid])).rows[0]
    if (!record) throw new HttpErr(500, '签到记录未保存')
    return { checkedIn: true, record: toRecord('checkins', record) }
  }

  return {
    handleEventList,
    handleEventDetail,
    handleMyActivityStats,
    handleEventCheckinCode,
    handleEventCheckin,
  }
}
