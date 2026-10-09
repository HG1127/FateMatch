/**
 * Profile read domain: explicit-id hydration + discovery filtering.
 * Writes and generic collection permissions remain in the gateway for now.
 */
export function createProfileHandlers({ q, tq, needAuth, HttpErr, toRecord, now = () => new Date() }) {
  if (
    typeof q !== 'function' ||
    typeof tq !== 'function' ||
    typeof needAuth !== 'function' ||
    typeof HttpErr !== 'function' ||
    typeof toRecord !== 'function'
  ) {
    throw new TypeError('profile domain dependencies are incomplete')
  }

  let lastExposureCleanupAt = new Date(now()).getTime()

  async function recordDiscoveryDeliveries(viewerId, targetIds) {
    if (!targetIds.length) return
    const ts = new Date(now()).getTime()
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(ts))
    try {
      await q(
        `insert into ${tq('discovery_exposures')} (id, viewer_sid, target_sid, source, day, "at", created)
         select md5($1 || ':' || x.target_sid || ':explore:' || $2), $1, x.target_sid, 'explore', $2, $3, now()
         from unnest($4::text[]) as x(target_sid)
         on conflict (viewer_sid, target_sid, source, day)
         do update set "at" = greatest(${tq('discovery_exposures')}."at", excluded."at")`,
        [viewerId, day, ts, targetIds],
      )
      if (ts - lastExposureCleanupAt >= 6 * 3600_000) {
        lastExposureCleanupAt = ts
        await q(`delete from ${tq('discovery_exposures')} where created < now() - interval '35 days'`)
      }
    } catch {
      // 推荐曝光遥测属于非关键路径：缺表、瞬时数据库异常或清理失败都不能阻断核心人物发现。
      // 掌柜聚合指标与真实 E2E 会暴露遥测故障，避免把观测系统变成业务单点。
    }
  }

  /** 登录成员按明确 ID 补齐页面所需人物资料，避免启动时全量下发 profiles。 */
  async function handleProfileLookup(url, auth) {
    needAuth(auth)
    const ids = [...new Set(String(url.searchParams.get('ids') ?? '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean))]
      .slice(0, 80)
    if (!ids.length) return { items: [] }

    const r = await q(
      `select * from ${tq('profiles')} where sid = any($1::text[]) order by array_position($1::text[], sid), id asc`,
      [ids],
    )
    return {
      items: r.rows.map((row) => {
        const rec = toRecord('profiles', row)
        if (auth.role !== 'admin' && String(row.sid) !== auth.id) {
          delete rec.role
          delete rec.banned
        }
        return rec
      }),
    }
  }

  /** 本人访客/回访轨迹按需读取；首包不再携带 visits。 */
  async function handleMyVisits(url, auth) {
    needAuth(auth)
    const sinceRaw = Number(url.searchParams.get('since') ?? 0)
    const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 500) || 500))
    const r = await q(
      `select viewer_sid, viewed_sid, "at"
       from (
         select distinct on (viewer_sid, viewed_sid) viewer_sid, viewed_sid, "at", id
         from ${tq('visits')}
         where (viewer_sid = $1 or viewed_sid = $1) and "at" >= $2
         order by viewer_sid, viewed_sid, "at" desc, id desc
       ) latest
       order by "at" desc, id asc
       limit $3`,
      [auth.id, since, limit],
    )
    return {
      items: r.rows.map(row => ({
        viewerId: String(row.viewer_sid ?? ''),
        viewedId: String(row.viewed_sid ?? ''),
        at: Number(row.at ?? 0),
      })),
    }
  }

  /**
   * 人物发现专用分页查询：核心资格、双向条件与筛选下沉数据库；
   * 参考分仍由前端基于当前页资料计算。
   */
  async function handleDiscoveryProfiles(url, auth) {
    needAuth(auth)
    const meR = await q(`select * from ${tq('profiles')} where sid = $1 limit 1`, [auth.id])
    const me = meR.rows[0]

    const adultCutoff = new Date(now())
    adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - 18)
    const adultCutoffKey = adultCutoff.toISOString().slice(0, 10)

    if (
      !me ||
      !['male', 'female'].includes(String(me.gender ?? '')) ||
      !['male', 'female'].includes(String(me.seeking ?? '')) ||
      !me.birth_date ||
      String(me.birth_date) > adultCutoffKey ||
      !me.city
    ) {
      throw new HttpErr(400, '请先确认必要资料，再进入人物推荐')
    }

    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
    const perPage = Math.min(48, Math.max(1, Number(url.searchParams.get('perPage') ?? 24) || 24))
    const city = String(url.searchParams.get('city') ?? '').trim().slice(0, 30)
    const district = String(url.searchParams.get('district') ?? '').trim().slice(0, 30)
    const verifiedOnly = url.searchParams.get('verified') === '1'
    const ageParam = key => {
      const raw = url.searchParams.get(key)
      if (!raw) return null
      if (!/^[0-9]{2,3}$/.test(raw)) throw new HttpErr(400, '年龄筛选条件无效')
      const value = Number(raw)
      if (value < 18 || value > 100) throw new HttpErr(400, '年龄筛选仅支持 18 到 100 岁')
      return value
    }
    const ageMin = ageParam('ageMin')
    const ageMax = ageParam('ageMax')
    if (ageMin !== null && ageMax !== null && ageMin > ageMax) throw new HttpErr(400, '最小年龄不能大于最大年龄')
    const birthdayCutoff = age => {
      const date = new Date(now())
      date.setUTCFullYear(date.getUTCFullYear() - age)
      return date.toISOString().slice(0, 10)
    }
    const tags = String(url.searchParams.get('tags') ?? '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 17)
    const demoSids = ['u01','u02','u03','u04','u05','u06','u07','u08','u09','u10','u11','u12','adm']

    const params = [auth.id, String(me.seeking), String(me.gender), demoSids]
    const conditions = [
      'p.sid <> $1',
      'coalesce(p.banned, false) = false',
      "coalesce(p.role, '') <> 'admin'",
      'p.gender = $2',
      'p.seeking = $3',
      "coalesce(p.birth_date, '') <> ''",
      `p.birth_date <= '${adultCutoffKey}'`,
      "coalesce(p.city, '') <> ''",
      'not (p.sid = any($4::text[]))',
      `not exists (select 1 from ${tq('user_passes')} up where up.owner_sid = $1 and up.target_sid = p.sid)`,
      `not exists (select 1 from ${tq('blocks')} b where (b.owner_sid = $1 and b.target_sid = p.sid) or (b.owner_sid = p.sid and b.target_sid = $1))`,
    ]

    if (city) {
      params.push(city)
      conditions.push(`p.city = $${params.length}`)
    }
    if (district) {
      params.push(`%${district}%`)
      conditions.push(`coalesce(p.region, '') like $${params.length}`)
    }
    if (ageMin !== null) {
      params.push(birthdayCutoff(ageMin))
      conditions.push(`p.birth_date <= $${params.length}`)
    }
    if (ageMax !== null) {
      params.push(birthdayCutoff(ageMax + 1))
      conditions.push(`p.birth_date > $${params.length}`)
    }
    if (verifiedOnly) {
      conditions.push("coalesce((p.verification->>'phone')::boolean, false) = true")
      conditions.push("coalesce((p.verification->>'realname')::boolean, false) = true")
      conditions.push("coalesce((p.verification->>'photo')::boolean, false) = true")
    }
    if (tags.length) {
      params.push(tags)
      conditions.push(`coalesce(p.interests, '[]'::jsonb) ?| $${params.length}::text[]`)
    }

    const where = `where ${conditions.join(' and ')}`
    const cnt = await q(`select count(*)::int n from ${tq('profiles')} p ${where}`, params)
    const totalItems = Number(cnt.rows[0]?.n ?? 0)

    params.push(String(me.city), perPage, (page - 1) * perPage)
    const r = await q(
      `select p.* from ${tq('profiles')} p ${where}
       order by (p.city = $${params.length - 2}) desc, p.created desc, p.id asc
       limit $${params.length - 1} offset $${params.length}`,
      params,
    )

    await recordDiscoveryDeliveries(auth.id, r.rows.map(row => String(row.sid ?? '')).filter(Boolean))

    return {
      page,
      perPage,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
      items: r.rows.map(row => toRecord('profiles', row)),
    }
  }

  return { handleProfileLookup, handleDiscoveryProfiles, handleMyVisits }
}
