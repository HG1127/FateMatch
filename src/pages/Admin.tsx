import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, BarChart3, BookMarked, Check, Database, Download, Feather, ImagePlus, Pencil, RotateCcw, Settings2, ShieldAlert, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_SETTINGS, FEATURE_META, readImageFile, useStore } from '@/lib/store'
import type { PostComment, Settings, Story } from '@/lib/store'
import { countTables, exportBackup } from '@/lib/dataExport'
import type { DataStat } from '@/lib/dataExport'
import { FESTS, FEST_TEMPLATE } from '@/lib/festivals'
import type { FestTemplate } from '@/lib/festivals'
import { cn } from '@/lib/utils'

const FEST_NAMES = [...new Set(Object.values(FESTS))]

// 「最近七日注册」的时间基准: 模块加载时取一次, 避免在渲染期间调用 Date.now
const NOW = Date.now()

/* 合集草稿暂存: 自动存本机, 回来还在, 发布后自动清空 */
const DIGEST_DRAFT_KEY = 'sy_digest_draft'
interface DigestDraft {
  title: string
  intro: string
  covers: string[]
  picks: string[]
}
function loadDigestDraft(): DigestDraft | null {
  try {
    const raw = localStorage.getItem(DIGEST_DRAFT_KEY)
    return raw ? (JSON.parse(raw) as DigestDraft) : null
  } catch {
    return null
  }
}

export function AdminPage() {
  const { me, settings, saveSettings, events, posts, users, togglePostFeatured, removePost, reports, resolveReport, match, unbanUser, banUser, adminLogs, digests, publishDigest, removeDigest, adminSetUserPhoto, adminSetEventCover, adminSetPostImages, deleteEventComment, removeComment, adminEditPostText, purgeChatImages } = useStore()
  const [draft, setDraft] = useState<Settings>(() => structuredClone(settings))
  const [confirmBan, setConfirmBan] = useState('')
  const [digestTitle, setDigestTitle] = useState(() => loadDigestDraft()?.title ?? '')
  const [digestIntro, setDigestIntro] = useState(() => loadDigestDraft()?.intro ?? '')
  const [digestCovers, setDigestCovers] = useState<string[]>(() => loadDigestDraft()?.covers ?? [])
  const [covDrag, setCovDrag] = useState<number | null>(null)
  const [covOver, setCovOver] = useState<number | null>(null)
  const moveCovers = (from: number, to: number) => {
    setDigestCovers(p => {
      if (from === to || from < 0 || to < 0 || from >= p.length || to >= p.length) return p
      const next = [...p]
      const [m] = next.splice(from, 1)
      next.splice(to, 0, m)
      return next
    })
  }
  const [digestPicks, setDigestPicks] = useState<string[]>(() => {
    const saved = loadDigestDraft()
    if (saved?.picks?.length) return saved.picks.filter(id => posts.some(p => p.id === id))
    return posts.filter(p => p.featured).map(p => p.id)
  })
  const [festName, setFestName] = useState('中秋')
  const ftCur = draft.festTemplates[festName] ?? FEST_TEMPLATE[festName]
  const ftCustom = !!draft.festTemplates[festName]
  const setFt = (patch: Partial<FestTemplate>) =>
    setDraft(d => ({
      ...d,
      festTemplates: { ...d.festTemplates, [festName]: { ...(d.festTemplates[festName] ?? FEST_TEMPLATE[festName]), ...patch } },
    }))
  const resetFt = () =>
    setDraft(d => {
      const m = { ...d.festTemplates }
      delete m[festName]
      return { ...d, festTemplates: m }
    })

  // 草稿暂存: 500ms 防抖写本机; 封面太大超容量时退而只存文字
  useEffect(() => {
    const t = setTimeout(() => {
      const draft: DigestDraft = { title: digestTitle, intro: digestIntro, covers: digestCovers, picks: digestPicks }
      const empty = !draft.title && !draft.intro && !draft.covers.length && !digestPicks.length
      try {
        if (empty) localStorage.removeItem(DIGEST_DRAFT_KEY)
        else localStorage.setItem(DIGEST_DRAFT_KEY, JSON.stringify(draft))
      } catch {
        try {
          if (!empty) localStorage.setItem(DIGEST_DRAFT_KEY, JSON.stringify({ ...draft, covers: [] }))
        } catch {
          /* 仍写不下则放弃暂存 */
        }
      }
    }, 500)
    return () => clearTimeout(t)
  }, [digestTitle, digestIntro, digestCovers, digestPicks])
  const movePick = (i: number, dir: number) => {
    setDigestPicks(prev => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  const [tab, setTab] = useState<'overview' | 'content' | 'safety' | 'site' | 'data'>(() => {
    const t = sessionStorage.getItem('sy_admin_tab')
    return t === 'content' || t === 'safety' || t === 'site' || t === 'data' ? t : 'overview'
  })
  const [qMember, setQMember] = useState('')
  const [confirmMemberBan, setConfirmMemberBan] = useState('')
  const [confirmPostDel, setConfirmPostDel] = useState('')
  const [confirmCommentDel, setConfirmCommentDel] = useState('')
  const [commentView, setCommentView] = useState<'event' | 'post'>('event')
  const [commentEventId, setCommentEventId] = useState('')
  const [editPostId, setEditPostId] = useState('')
  const [editPostText, setEditPostText] = useState('')
  const [confirmPurge, setConfirmPurge] = useState(false)
  // 数据维护: 各表条数盘点 + JSON 备份导出
  const [dataStats, setDataStats] = useState<DataStat[] | null>(null)
  const [dataBusy, setDataBusy] = useState(false)
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({})
  // 通用图片上传: 头像 / 活动封面 / 帖子配图共用一个文件入口
  const imgTarget = useRef<{ kind: 'user' | 'event' | 'post'; id: string } | null>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const pickFor = (kind: 'user' | 'event' | 'post', id: string) => {
    imgTarget.current = { kind, id }
    imgInputRef.current?.click()
  }
  const pickTargetImage = async (file: File | undefined) => {
    const t = imgTarget.current
    imgTarget.current = null
    if (!file || !t) return
    if (file.size > 4 * 1024 * 1024) {
      toast.error('图片太大,请选 4MB 以内的图')
      return
    }
    try {
      const max = t.kind === 'user' ? 250 : t.kind === 'post' ? 500 : 700
      const url = await readImageFile(file, max)
      if (t.kind === 'user') {
        if (adminSetUserPhoto(t.id, url)) toast.success('头像已更换,全站即时生效')
      } else if (t.kind === 'event') {
        if (adminSetEventCover(t.id, url)) toast.success('封面已更换,即时展示')
      } else {
        const p = posts.find(x => x.id === t.id)
        if (!p) return
        if (p.images.length >= 9) {
          toast('一条帖子至多 9 张图')
          return
        }
        if (adminSetPostImages(t.id, [...p.images, url])) toast.success('图片已添加,社区即时展示')
      }
    } catch {
      toast.error('图片读取失败,换一张试试')
    }
  }

  // 留言/回帖行渲染: 带二次确认的删除
  const commentRow = (name: string | undefined, c: PostComment, onDelete: () => boolean, delMsg: string) => (
    <div key={c.id} className="flex items-start gap-2 rounded bg-card px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="cjk-latin text-[11px] text-muted-foreground">{name ?? '已注销会员'} · {new Date(c.at).toLocaleString()}</p>
        <p className="mt-0.5 break-all text-xs text-foreground">{c.text}</p>
      </div>
      {confirmCommentDel === c.id ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            className="btn-primary !px-2.5 !py-1 text-[11px]"
            onClick={() => {
              if (onDelete()) {
                toast.success(delMsg)
                setConfirmCommentDel('')
              }
            }}
          >
            确认删除
          </button>
          <button className="btn-outline !px-2.5 !py-1 text-[11px]" onClick={() => setConfirmCommentDel('')}>再想想</button>
        </span>
      ) : (
        <button
          title="删除这条留言"
          className="btn-ghost shrink-0 !px-2 text-muted-foreground transition hover:text-primary active:scale-95"
          onClick={() => setConfirmCommentDel(c.id)}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )

  const switchTab = (t: 'overview' | 'content' | 'safety' | 'site' | 'data') => {
    setTab(t)
    sessionStorage.setItem('sy_admin_tab', t)
  }

  // 自动保存: 停止编辑 0.8 秒即提交, 无需手动点保存
  useEffect(() => {
    if (JSON.stringify(draft) === JSON.stringify(settings)) return
    const t = setTimeout(() => {
      saveSettings(draft)
    }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // 走进「数据维护」页签时盘点一次各表条数
  useEffect(() => {
    if (tab !== 'data' || dataStats) return
    countTables()
      .then(setDataStats)
      .catch(() => setDataStats([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  if (!me) return null
  if (me.role !== 'admin') {
    return (
      <div className="clouds-paper mx-auto max-w-md px-4 py-24 text-center">
        <span className="seal mx-auto flex h-14 w-14 font-xing text-2xl"><ShieldAlert size={22} /></span>
        <h1 className="mt-4 font-xing text-3xl text-foreground">此处为掌柜重地</h1>
        <p className="mt-2 text-sm text-muted-foreground">系统设置仅管理员账号可见,请用管理员身份登录。</p>
      </div>
    )
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  // 平台数据一页纸
  const memberCount = users.filter(u => !u.role).length
  const weekNew = users.filter(u => !u.role && NOW - u.createdAt < 7 * 86400_000).length
  const joinCount = events.reduce((s, e) => s + e.attendees.length, 0)
  const hostedCount = events.filter(e => e.creatorId).length
  const commentCount = posts.reduce((s, p) => s + p.comments.length, 0)
  const mutualPairs = (() => {
    const seen = new Set<string>()
    for (const a of Object.keys(match.likes)) {
      for (const b of match.likes[a] ?? []) {
        if ((match.likes[b] ?? []).includes(a)) seen.add([a, b].sort().join(':'))
      }
    }
    return seen.size
  })()
  const STATS = [
    { num: memberCount, label: '注册会员', sub: `本周新增 ${weekNew}` },
    { num: joinCount, label: '活动报名人次', sub: `会员发起 ${hostedCount} 场` },
    { num: posts.length, label: '社区帖子', sub: `评论 ${commentCount} 条` },
    { num: mutualPairs, label: '互配佳音', sub: '双方有意即计入' },
  ]

  // 七日趋势: 新注册 与 社区发帖
  const days7 = Array.from({ length: 7 }, (_, i) => {
    const d0 = new Date()
    d0.setHours(0, 0, 0, 0)
    const start = d0.getTime() - (6 - i) * 86400_000
    const dd = new Date(start)
    return { start, label: `${dd.getMonth() + 1}/${dd.getDate()}`, reg: 0, post: 0 }
  })
  users.forEach(u => {
    const i = Math.floor((u.createdAt - days7[0].start) / 86400_000)
    if (i >= 0 && i < 7) days7[i].reg++
  })
  posts.forEach(p => {
    const i = Math.floor((p.at - days7[0].start) / 86400_000)
    if (i >= 0 && i < 7) days7[i].post++
  })
  const max7 = Math.max(1, ...days7.map(d => d.reg + d.post))

  const patchStory = (i: number, patch: Partial<Story>) => {
    setDraft(d => ({ ...d, stories: d.stories.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }))
  }

  const pickImage = async (i: number, file: File | undefined) => {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      toast.error('图片太大,请选 4MB 以内的图')
      return
    }
    try {
      const url = await readImageFile(file)
      patchStory(i, { img: url })
      toast.success('图片已就绪,记得保存')
    } catch {
      toast.error('图片读取失败,换一张试试')
    }
  }

  const pickDigestCovers = async (files: FileList | null) => {
    if (!files?.length) return
    const room = 4 - digestCovers.length
    const list = [...files].slice(0, room)
    if (list.length < files.length) toast.error('封面至多 4 张,多余的已忽略')
    for (const f of list) {
      if (f.size > 4 * 1024 * 1024) {
        toast.error('有图片超过 4MB,已跳过')
        continue
      }
      try {
        const url = await readImageFile(f)
        setDigestCovers(p => (p.length >= 4 ? p : [...p, url]))
      } catch {
        toast.error('有图片读取失败,已跳过')
      }
    }
  }

  const TABS = [
    { key: 'overview' as const, label: '数据总览', desc: '会员 · 报名 · 帖文 · 佳音', icon: BarChart3 },
    { key: 'content' as const, label: '内容运营', desc: '策展 · 活动 · 佳音墙', icon: Feather },
    { key: 'safety' as const, label: '会员与安全', desc: '举报 · 停用账号', icon: ShieldAlert },
    { key: 'site' as const, label: '站点设置', desc: '功能开关 · 公告', icon: Settings2 },
    { key: 'data' as const, label: '数据维护', desc: '备份导出 · 表格盘点', icon: Database },
  ]

  return (
    <div className="clouds-paper mx-auto max-w-4xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">系统设置</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">掌柜后台</h1>
        <p className="mt-2 text-sm text-muted-foreground">所有修改稍停即自动保存并存入本地,全站即时生效;无需手动保存</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        {TABS.map(t => {
          const Icon = t.icon
          const openReports = t.key === 'safety' ? reports.filter(r => r.status !== 'done').length : 0
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-left transition',
                tab === t.key ? 'border-primary bg-primary text-primary-foreground shadow-card' : 'border-border bg-card text-foreground/75 hover:border-primary/40',
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Icon size={14} />
                {t.label}
                {openReports > 0 && (
                  <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] text-accent-foreground">
                    {openReports}
                  </span>
                )}
              </span>
              <span className={cn('mt-0.5 block text-[10px]', tab === t.key ? 'text-primary-foreground/75' : 'text-muted-foreground')}>{t.desc}</span>
            </button>
          )
        })}
      </div>

      <div className="space-y-6">
        {tab === 'overview' && (
        <>
        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-4 font-xing text-2xl text-foreground">平台数据</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {STATS.map(s => (
              <div key={s.label} className="rounded-md border border-border bg-secondary/40 p-3 text-center">
                <p className="cjk-latin font-xing text-3xl text-primary">{s.num}</p>
                <p className="mt-1 text-xs text-foreground/80">{s.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 font-xing text-2xl text-foreground">七日趋势</h2>
          <p className="mb-4 text-xs text-muted-foreground">金为新注册,红为社区发帖;柱子越高,当日越热闹</p>
          <div className="flex h-36 items-end gap-2 md:gap-3">
            {days7.map(d => (
              <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                  <div className="w-3 rounded-t-sm bg-gold/70 transition-all" style={{ height: `${(d.reg / max7) * 100}%` }} title={`新注册 ${d.reg}`} />
                  <div className="w-3 rounded-t-sm bg-primary transition-all" style={{ height: `${(d.post / max7) * 100}%` }} title={`发帖 ${d.post}`} />
                </div>
                <span className="cjk-latin text-[10px] text-muted-foreground">{d.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 font-xing text-2xl text-foreground">运营日志</h2>
          <p className="mb-3 text-xs text-muted-foreground">掌柜的设置、策展、举报处理与账号操作自动留痕,本地留存最近 100 条。</p>
          <div className="space-y-1.5">
            {adminLogs.slice(0, 20).map(l => (
              <p key={l.id} className="flex items-baseline gap-2 rounded-md bg-secondary/40 px-3 py-1.5 text-xs text-foreground/80">
                <span className="cjk-latin shrink-0 text-muted-foreground">{new Date(l.at).toLocaleString()}</span>
                {l.text}
              </p>
            ))}
            {!adminLogs.length && (
              <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">暂无操作日志,掌柜的每一次动作都会记在这里。</p>
            )}
          </div>
        </section>

        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 font-xing text-2xl text-foreground">数据存储</h2>
          <p className="mb-3 text-xs text-muted-foreground">全站数据已存入站点数据库,刷新、换设备都不丢。聊天图片若堆积过多,可一键清理释放容量,文字记录不受影响。</p>
          {confirmPurge ? (
            <span className="flex items-center gap-1.5">
              <button
                className="btn-primary !px-2.5 !py-1 text-[11px]"
                onClick={() => {
                  const n = purgeChatImages()
                  toast(n ? `已清理 ${n} 张聊天图片,容量已释放` : '暂无聊天图片可清理')
                  setConfirmPurge(false)
                }}
              >
                确认清理
              </button>
              <button className="btn-outline !px-2.5 !py-1 text-[11px]" onClick={() => setConfirmPurge(false)}>再想想</button>
            </span>
          ) : (
            <button className="btn-outline !px-3 !py-1.5 text-xs transition active:scale-95" onClick={() => setConfirmPurge(true)}>
              清理聊天图片
            </button>
          )}
        </section>
        </>
        )}

        {tab === 'data' && (
        <>
        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 flex items-center gap-2 font-xing text-2xl text-foreground">
            <Database size={18} className="text-gold" />
            数据盘点
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">站点数据库里每张表现有的记录数,数字即家底;读不到的表会标为受限。</p>
          {!dataStats ? (
            <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">正在盘点…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {dataStats.map(s => (
                  <div key={s.name} className="rounded-md border border-border bg-secondary/40 p-2.5 text-center">
                    <p className="cjk-latin font-xing text-2xl text-primary">{s.count ?? '—'}</p>
                    <p className="mt-0.5 text-[11px] text-foreground/80">{s.label}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                合计 {dataStats.reduce((n, s) => n + (s.count ?? 0), 0)} 条记录,刷新、换设备都不丢。
              </p>
            </>
          )}
        </section>

        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 flex items-center gap-2 font-xing text-2xl text-foreground">
            <Download size={18} className="text-gold" />
            备份导出
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">把全站数据打包成一个 JSON 文件下载保存,换环境或误删都能靠它找回。登录密码不包含在内,文件请妥善保管。</p>
          <button
            className="btn-primary !px-4 !py-2 text-xs transition active:scale-95"
            disabled={dataBusy}
            onClick={async () => {
              if (dataBusy) return
              setDataBusy(true)
              try {
                const { total, failed } = await exportBackup()
                toast.success(
                  failed.length
                    ? `备份已下载,共 ${total} 条记录;${failed.join('、')}暂不可读,已跳过`
                    : `备份已下载,共 ${total} 条记录`,
                )
              } catch {
                toast.error('导出失败,稍后再试')
              } finally {
                setDataBusy(false)
              }
            }}
          >
            {dataBusy ? '正在打包…' : '导出 JSON 备份'}
          </button>
        </section>
        </>
        )}

        {tab === 'site' && (
        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-4 flex items-center gap-2 font-xing text-2xl text-foreground">
            <Settings2 size={18} className="text-gold" />
            功能开关
          </h2>
          <div className="space-y-3">
            {FEATURE_META.map(f => {
              const on = draft.features[f.key]
              return (
                <div key={f.key} className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{f.label}</p>
                    <p className="text-[11px] text-muted-foreground">{f.desc} · 关闭后入口隐藏,页面提示暂不开放</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={on}
                    onClick={() => setDraft(d => ({ ...d, features: { ...d.features, [f.key]: !on } }))}
                    className={cn(
                      'flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition',
                      on ? 'justify-end border-gold bg-gold/30' : 'justify-start border-border bg-secondary',
                    )}
                  >
                    <span className={cn('h-3.5 w-3.5 rounded-full transition', on ? 'bg-gold' : 'bg-muted-foreground/40')} />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
        )}

        {tab === 'content' && (
        <>
        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 font-xing text-2xl text-foreground">活动展示</h2>
          <p className="mb-3 text-xs text-muted-foreground">隐藏的活动不再出现在首页与活动页;发起人本人与你仍能看到,并带「已隐藏」标记。</p>
          <div className="space-y-2">
            {[...events].sort((a, b) => a.date.localeCompare(b.date)).map(e => {
              const visible = !draft.hiddenEvents.includes(e.id)
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 p-2.5">
                  <img src={e.cover} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{e.title}</p>
                    <p className="text-[11px] text-muted-foreground">{e.city} · {e.date} · {e.creatorId ? '会员发起' : '官方活动'}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{visible ? '展示中' : '已隐藏'}</span>
                  <button
                    className="btn-outline shrink-0 !px-2.5 !py-1 text-[11px] transition active:scale-95"
                    title="上传新封面替换现封面"
                    onClick={() => pickFor('event', e.id)}
                  >
                    <ImagePlus size={12} />
                    换封面
                  </button>
                  <button
                    role="switch"
                    aria-checked={visible}
                    onClick={() =>
                      setDraft(d => ({
                        ...d,
                        hiddenEvents: visible ? [...d.hiddenEvents, e.id] : d.hiddenEvents.filter(x => x !== e.id),
                      }))
                    }
                    className={cn(
                      'flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition',
                      visible ? 'justify-end border-gold bg-gold/30' : 'justify-start border-border bg-secondary',
                    )}
                  >
                    <span className={cn('h-3.5 w-3.5 rounded-full transition', visible ? 'bg-gold' : 'bg-muted-foreground/40')} />
                  </button>
                </div>
              )
            })}
            {!events.length && <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">暂无活动。</p>}
          </div>
        </section>

        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 font-xing text-2xl text-foreground">留言与回帖</h2>
          <p className="mb-3 text-xs text-muted-foreground">切换查看活动留言或帖子回帖;违规内容点垃圾桶删除,删前会再确认一次。</p>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {([
              { key: 'event' as const, label: '活动留言' },
              { key: 'post' as const, label: '帖子回帖' },
            ]).map(v => (
              <button
                key={v.key}
                onClick={() => setCommentView(v.key)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition',
                  commentView === v.key
                    ? 'border-primary bg-primary/10 font-semibold text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/40',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          {commentView === 'event' ? (
            <>
              {events.filter(e => (e.comments ?? []).length > 0).length > 1 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setCommentEventId('')}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] transition',
                      !commentEventId ? 'border-gold/60 bg-gold/10 font-semibold text-gold' : 'border-border bg-card text-muted-foreground hover:border-gold/40',
                    )}
                  >
                    全部场次
                  </button>
                  {events
                    .filter(e => (e.comments ?? []).length > 0)
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map(e => (
                      <button
                        key={e.id}
                        onClick={() => setCommentEventId(prev => (prev === e.id ? '' : e.id))}
                        className={cn(
                          'max-w-40 truncate rounded-full border px-2.5 py-1 text-[11px] transition',
                          commentEventId === e.id ? 'border-gold/60 bg-gold/10 font-semibold text-gold' : 'border-border bg-card text-muted-foreground hover:border-gold/40',
                        )}
                        title={e.title}
                      >
                        {e.title} · {(e.comments ?? []).length}
                      </button>
                    ))}
                </div>
              )}
              <div className="space-y-3">
                {events
                  .filter(e => (e.comments ?? []).length > 0)
                  .filter(e => !commentEventId || e.id === commentEventId)
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map(e => (
                    <div key={e.id} className="rounded-md border border-border bg-secondary/40 p-3">
                      <p className="mb-2 text-sm font-semibold text-foreground">
                        {e.title}
                        <span className="cjk-latin ml-1.5 text-[10px] font-normal text-muted-foreground">{(e.comments ?? []).length} 条留言</span>
                      </p>
                      <div className="space-y-1.5">
                        {(e.comments ?? []).map(c => commentRow(users.find(u => u.id === c.authorId)?.nickname, c, () => deleteEventComment(e.id, c.id), '留言已删除,活动页即时更新'))}
                      </div>
                    </div>
                  ))}
                {!events.some(e => (e.comments ?? []).length > 0 && (!commentEventId || e.id === commentEventId)) && (
                  <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">这里暂无留言。</p>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {posts
                .filter(p => p.comments.length > 0)
                .sort((a, b) => b.at - a.at)
                .map(p => {
                  const author = users.find(u => u.id === p.authorId)
                  return (
                    <div key={p.id} className="rounded-md border border-border bg-secondary/40 p-3">
                      <p className="mb-2 text-sm font-semibold text-foreground">
                        {author?.nickname ?? '佚名'} · {p.topic}
                        <span className="cjk-latin ml-1.5 text-[10px] font-normal text-muted-foreground">{p.comments.length} 条回帖</span>
                      </p>
                      <p className="mb-2 truncate rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">原帖:{p.text}</p>
                      <div className="space-y-1.5">
                        {p.comments.map(c => commentRow(users.find(u => u.id === c.authorId)?.nickname, c, () => removeComment(p.id, c.id), '回帖已删除,社区即时更新'))}
                      </div>
                    </div>
                  )
                })}
              {!posts.some(p => p.comments.length > 0) && (
                <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">帖子下暂无回帖。</p>
              )}
            </div>
          )}
        </section>

        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 font-xing text-2xl text-foreground">社区策展</h2>
          <p className="mb-3 text-xs text-muted-foreground">为优质帖子设「精选」,社区与首页即刻展示金标;铅笔可编辑正文,垃圾桶可删违规帖,都会再确认一次。</p>
          <div className="space-y-2">
            {[...posts].sort((a, b) => b.at - a.at).slice(0, 12).map(p => {
              const author = users.find(u => u.id === p.authorId)
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 p-2.5">
                  <div className="flex shrink-0 items-center gap-1">
                    {p.images.slice(0, 3).map((src, i) => (
                      <span key={i} className="relative">
                        <img src={src} alt="" className="h-10 w-10 rounded object-cover" />
                        <button
                          title="删除这张图"
                          className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-ink text-primary-foreground shadow-card transition hover:opacity-80"
                          onClick={() => {
                            if (adminSetPostImages(p.id, p.images.filter((_, x) => x !== i))) toast('已删除该图')
                          }}
                        >
                          <X size={8} />
                        </button>
                      </span>
                    ))}
                    {p.images.length > 3 && <span className="cjk-latin text-[10px] text-muted-foreground">+{p.images.length - 3}</span>}
                    {p.images.length === 0 && (
                      <span className="flex h-10 w-10 items-center justify-center rounded bg-muted font-xing text-muted-foreground">帖</span>
                    )}
                    <button
                      title="添加图片"
                      className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-border text-muted-foreground transition hover:border-primary/50 hover:text-primary active:scale-95"
                      onClick={() => pickFor('post', p.id)}
                    >
                      <ImagePlus size={14} />
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{author?.nickname ?? '佚名'} · {p.topic}</p>
                    {editPostId === p.id ? (
                      <div className="mt-1 space-y-1.5">
                        <textarea
                          className="input-cn min-h-14 resize-y text-xs"
                          value={editPostText}
                          maxLength={200}
                          onChange={e => setEditPostText(e.target.value)}
                        />
                        <div className="flex gap-1.5">
                          <button
                            className="btn-primary !px-2.5 !py-1 text-[11px]"
                            onClick={() => {
                              if (adminEditPostText(p.id, editPostText)) {
                                toast.success('文字已更新,社区即时展示')
                                setEditPostId('')
                              } else {
                                toast.error('正文不能为空')
                              }
                            }}
                          >
                            保存
                          </button>
                          <button className="btn-outline !px-2.5 !py-1 text-[11px]" onClick={() => setEditPostId('')}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <p className="truncate text-[11px] text-muted-foreground">{p.text}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{p.featured ? '精选中' : '未精选'}</span>
                  <button
                    role="switch"
                    aria-checked={!!p.featured}
                    onClick={() => {
                      if (togglePostFeatured(p.id)) toast(p.featured ? '已取消精选' : '已设为精选,全站可见金标')
                    }}
                    className={cn(
                      'flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition',
                      p.featured ? 'justify-end border-gold bg-gold/30' : 'justify-start border-border bg-secondary',
                    )}
                  >
                    <span className={cn('h-3.5 w-3.5 rounded-full transition', p.featured ? 'bg-gold' : 'bg-muted-foreground/40')} />
                  </button>
                  {editPostId !== p.id && (
                    <button
                      title="编辑帖子文字"
                      className="btn-ghost shrink-0 !px-2 text-muted-foreground transition hover:text-primary active:scale-95"
                      onClick={() => {
                        setEditPostId(p.id)
                        setEditPostText(p.text)
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {confirmPostDel === p.id ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <button
                        className="btn-primary !px-2.5 !py-1 text-[11px]"
                        onClick={() => {
                          if (removePost(p.id)) {
                            toast.success('违规帖已删除,全站不再展示')
                            setConfirmPostDel('')
                          }
                        }}
                      >
                        确认删除
                      </button>
                      <button className="btn-outline !px-2.5 !py-1 text-[11px]" onClick={() => setConfirmPostDel('')}>再想想</button>
                    </span>
                  ) : (
                    <button
                      title="删除违规帖"
                      className="btn-ghost shrink-0 !px-2 text-muted-foreground transition hover:text-primary active:scale-95"
                      onClick={() => setConfirmPostDel(p.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )
            })}
            {!posts.length && <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">社区暂无帖子。</p>}
          </div>
        </section>

        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 flex items-center gap-2 font-xing text-2xl text-foreground">
            <BookMarked size={18} className="text-gold" />
            每周精选合集
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">每周把优质帖文打包成一期,置顶在社区门口;选帖、题名、写按语,发布即时生效。草稿自动暂存本机,回来还在,发布后自动清空。</p>
          <div className="space-y-2.5">
            <input
              className="input-cn"
              placeholder="本期标题,如「罗裙与故人」"
              value={digestTitle}
              onChange={e => setDigestTitle(e.target.value)}
              maxLength={12}
            />
            <textarea
              className="input-cn min-h-16 resize-y text-sm"
              placeholder="主编按语:这一期想对读者说的一句话(可不填)"
              value={digestIntro}
              onChange={e => setDigestIntro(e.target.value)}
              maxLength={120}
            />
            <div className="flex flex-wrap items-center gap-2">
              {digestCovers.map((c, i) => (
                <div
                  key={i}
                  onDragOver={e => { e.preventDefault(); setCovOver(i) }}
                  onDragLeave={() => setCovOver(o => (o === i ? null : o))}
                  onDrop={e => { e.preventDefault(); if (covDrag !== null) moveCovers(covDrag, i); setCovDrag(null); setCovOver(null) }}
                  className={cn(
                    'relative shrink-0 rounded-md',
                    covOver === i && covDrag !== null && 'ring-2 ring-primary/50',
                    covDrag === i && 'opacity-40',
                  )}
                >
                  <img
                    src={c}
                    alt=""
                    draggable
                    onDragStart={() => setCovDrag(i)}
                    onDragEnd={() => { setCovDrag(null); setCovOver(null) }}
                    className="h-16 w-28 cursor-grab rounded-md border border-gold/40 object-cover active:cursor-grabbing"
                  />
                  {i === 0 ? (
                    <span className="absolute left-1 top-1 rounded-sm bg-gold px-1 py-0.5 text-[9px] text-accent-foreground">主</span>
                  ) : (
                    <button
                      title="设为主封面"
                      onClick={() => setDigestCovers(p => [p[i], ...p.filter((_, x) => x !== i)])}
                      className="absolute bottom-1 right-1 rounded-full bg-card/90 px-1.5 py-0.5 text-[9px] text-muted-foreground transition hover:text-gold"
                    >
                      设主
                    </button>
                  )}
                  <button
                    title="移除封面"
                    onClick={() => setDigestCovers(p => p.filter((_, x) => x !== i))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-ink text-primary-foreground shadow-card"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {digestCovers.length < 4 && (
                <label className="btn-outline shrink-0 cursor-pointer !px-3 !py-1.5 text-xs">
                  <ImagePlus size={13} />
                  上传封面
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => {
                      void pickDigestCovers(e.target.files)
                      e.target.value = ''
                    }}
                  />
                </label>
              )}
              <span className="text-[11px] text-muted-foreground">本期封面(至多 4 张,可不传):首张为主封面;拖动缩略图可调轮播顺序。</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn-ghost !px-3 !py-1.5 text-xs"
                onClick={() => setDigestPicks(posts.filter(p => p.featured).map(p => p.id))}
              >
                一键勾选全部精选帖
              </button>
              <span className="text-[11px] text-muted-foreground">已选 {digestPicks.length} 篇</span>
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
              {[...posts]
                .sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || b.at - a.at)
                .slice(0, 20)
                .map(p => {
                  const author = users.find(u => u.id === p.authorId)
                  const on = digestPicks.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => setDigestPicks(prev => (on ? prev.filter(x => x !== p.id) : [...prev, p.id]))}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md border p-2 text-left transition',
                        on ? 'border-gold/60 bg-gold/10' : 'border-transparent bg-secondary/40 hover:border-border',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                          on ? 'border-gold bg-gold text-accent-foreground' : 'border-border bg-card',
                        )}
                      >
                        {on && <Check size={11} />}
                      </span>
                      {p.images[0] ? (
                        <img src={p.images[0]} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted font-xing text-muted-foreground">帖</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-foreground">
                          {author?.nickname ?? '佚名'} · {p.topic}
                          {p.featured && <span className="ml-1.5 rounded-sm bg-gold px-1 py-0.5 text-[9px] text-accent-foreground">精选</span>}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">{p.text}</span>
                      </span>
                    </button>
                  )
                })}
              {!posts.length && <p className="p-4 text-center text-xs text-muted-foreground">社区暂无帖子。</p>}
            </div>
            {digestPicks.length > 0 && (
              <div className="rounded-md border border-gold/40 bg-gold/5 p-2.5">
                <p className="mb-1.5 text-[11px] text-muted-foreground">本期篇目(读者将按此顺序翻阅,可上下调整)</p>
                <div className="space-y-1">
                  {digestPicks.map((id, i) => {
                    const p = posts.find(x => x.id === id)
                    if (!p) return null
                    return (
                      <div key={id} className="flex items-center gap-1.5 rounded bg-card px-2 py-1.5">
                        <span className="cjk-latin w-4 shrink-0 text-center font-xing text-xs text-gold">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{p.text}</span>
                        <button
                          title="上移"
                          disabled={i === 0}
                          onClick={() => movePick(i, -1)}
                          className="btn-ghost shrink-0 !px-1.5 disabled:opacity-30"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          title="下移"
                          disabled={i === digestPicks.length - 1}
                          onClick={() => movePick(i, 1)}
                          className="btn-ghost shrink-0 !px-1.5 disabled:opacity-30"
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          title="移出本期"
                          onClick={() => setDigestPicks(prev => prev.filter(x => x !== id))}
                          className="btn-ghost shrink-0 !px-1.5 text-muted-foreground hover:text-primary"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <button
              className="btn-primary w-full !py-2.5 disabled:opacity-50"
              disabled={!digestTitle.trim() || !digestPicks.length}
              onClick={() => {
                if (publishDigest({ title: digestTitle, intro: digestIntro, postIds: digestPicks, cover: digestCovers[0] || undefined, covers: digestCovers })) {
                  toast.success('本期合集已发布,社区门口即刻展示')
                  setDigestTitle('')
                  setDigestIntro('')
                  setDigestCovers([])
                  setDigestPicks([])
                } else {
                  toast.error('标题和选帖都要备齐才能发布')
                }
              }}
            >
              <BookMarked size={15} />
              发布本期合集
            </button>
          </div>
          {digests.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 text-[11px] text-muted-foreground">已发布 {digests.length} 期,最新一期展示在社区门口。</p>
              <div className="space-y-1.5">
                {digests.map((d, i) => {
                  const alive = d.postIds.filter(id => posts.some(p => p.id === id)).length
                  return (
                    <div key={d.id} className="flex items-center gap-2.5 rounded-md bg-secondary/40 px-3 py-2">
                      <span className="seal flex h-6 w-6 shrink-0 items-center justify-center font-xing text-xs">{d.issue}</span>
                      {d.cover && <img src={d.cover} alt="" className="h-8 w-12 shrink-0 rounded object-cover" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-foreground">
                          {d.title}
                          {i === 0 && <span className="ml-1.5 rounded-sm bg-primary/10 px-1 py-0.5 text-[9px] text-primary">展示中</span>}
                        </span>
                        <span className="cjk-latin block text-[10px] text-muted-foreground">
                          收录 {alive}/{d.postIds.length} 篇 · 翻阅 {d.views} 次 · {new Date(d.at).toLocaleDateString()}
                        </span>
                      </span>
                      <button
                        title="撤下这期合集"
                        className="btn-ghost shrink-0 !px-2 text-muted-foreground hover:text-primary"
                        onClick={() => {
                          if (removeDigest(d.id)) toast('已撤下这期合集')
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>
        </>
        )}

        {tab === 'safety' && (
        <>
        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 font-xing text-2xl text-foreground">举报处理</h2>
          <p className="mb-3 text-xs text-muted-foreground">会员提交的举报会进入待办队列;核实后「停用账号」或「忽略」,处理完转入已办。</p>
          <div className="space-y-2">
            {reports.filter(r => r.status !== 'done').map(r => {
              const reporter = users.find(u => u.id === r.by)
              const target = users.find(u => u.id === r.target)
              return (
                <div key={r.id} className="rounded-md border border-border bg-secondary/40 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-foreground">{target?.nickname ?? '已注销会员'}</span>
                    <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{r.reason}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">{reporter?.nickname ?? '佚名'} 举报 · {new Date(r.at).toLocaleDateString()}</span>
                  </div>
                  {r.note && <p className="mt-1.5 rounded bg-muted/50 px-2 py-1 text-xs text-foreground/75">「{r.note}」</p>}
                  {target?.banned && <p className="mt-1.5 text-[11px] text-gold">该账号已处于停用状态。</p>}
                  <div className="mt-2 flex gap-2">
                    {confirmBan === r.id ? (
                      <>
                        <button
                          className="btn-primary !px-3 !py-1.5 text-xs"
                          onClick={() => {
                            if (resolveReport(r.id, 'ban')) {
                              toast.success(`已停用「${target?.nickname ?? ''}」并归档举报`)
                              setConfirmBan('')
                            }
                          }}
                        >
                          确认停用账号
                        </button>
                        <button className="btn-outline !px-3 !py-1.5 text-xs" onClick={() => setConfirmBan('')}>再想想</button>
                      </>
                    ) : (
                      <>
                        <button className="btn-outline !px-3 !py-1.5 text-xs text-primary" onClick={() => setConfirmBan(r.id)}>
                          停用账号
                        </button>
                        <button
                          className="btn-ghost !px-3 !py-1.5 text-xs text-muted-foreground"
                          onClick={() => {
                            if (resolveReport(r.id, 'dismiss')) toast('已忽略该举报')
                          }}
                        >
                          忽略
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            {!reports.some(r => r.status !== 'done') && (
              <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">暂无待处理举报,社区风清气正。</p>
            )}
          </div>
          {reports.some(r => r.status === 'done') && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              已处理 {reports.filter(r => r.status === 'done').length} 条举报。
            </p>
          )}
        </section>

        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 font-xing text-2xl text-foreground">停用账号</h2>
          <p className="mb-3 text-xs text-muted-foreground">因违规被停用的账号无法登录、不再出现在匹配池;核实有误可恢复。</p>
          <div className="space-y-2">
            {users.filter(u => u.banned).map(u => (
              <div key={u.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 p-2.5">
                <img src={u.photos[0]} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{u.nickname}</p>
                  <p className="text-[11px] text-muted-foreground">{u.phone} · {u.job}</p>
                </div>
                <button
                  className="btn-outline !px-3 !py-1.5 text-xs"
                  onClick={() => {
                    if (unbanUser(u.id)) toast.success(`已恢复「${u.nickname}」的账号`)
                  }}
                >
                  恢复账号
                </button>
              </div>
            ))}
            {!users.some(u => u.banned) && (
              <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">当前没有停用账号。</p>
            )}
          </div>
        </section>

        <section className="card-cn rounded-lg p-5 md:p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-xing text-2xl text-foreground">会员管理</h2>
            <button
              className="btn-outline !px-3 !py-1.5 text-xs"
              onClick={() => {
                const rows = users
                  .filter(u => !u.role)
                  .map(u => [u.nickname, u.phone, u.city, u.job, u.banned ? '已停用' : '正常'].join(','))
                const csv = '\uFEFF' + ['昵称,手机号,城市,职业,状态', ...rows].join('\n')
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = '随缘网-会员表.csv'
                a.click()
                URL.revokeObjectURL(url)
                toast.success('会员表已导出')
              }}
            >
              <Download size={13} />
              导出会员表
            </button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">按昵称或手机号检索会员,查看状态;必要时停用或恢复账号。</p>
          <input
            className="input-cn mb-3"
            placeholder="搜昵称 / 手机号…"
            value={qMember}
            onChange={e => setQMember(e.target.value)}
          />
          <div className="space-y-2">
            {users
              .filter(u => !u.role)
              .filter(u => !qMember.trim() || u.nickname.includes(qMember.trim()) || u.phone.includes(qMember.trim()))
              .slice(0, 20)
              .map(u => (
                <div key={u.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 p-2.5">
                  <img src={u.photos[0]} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
                      {u.nickname}
                      {u.banned && <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">已停用</span>}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{u.phone} · {u.job} · {u.city}</p>
                  </div>
                  <button
                    className="btn-outline shrink-0 !px-2.5 !py-1.5 text-xs transition active:scale-95"
                    title="上传新头像替换现头像"
                    onClick={() => pickFor('user', u.id)}
                  >
                    <ImagePlus size={12} />
                    换头像
                  </button>
                  {u.banned ? (
                    <button
                      className="btn-outline shrink-0 !px-3 !py-1.5 text-xs"
                      onClick={() => {
                        if (unbanUser(u.id)) toast.success(`已恢复「${u.nickname}」的账号`)
                      }}
                    >
                      恢复账号
                    </button>
                  ) : confirmMemberBan === u.id ? (
                    <>
                      <button
                        className="btn-primary shrink-0 !px-3 !py-1.5 text-xs"
                        onClick={() => {
                          if (banUser(u.id)) {
                            toast.success(`已停用「${u.nickname}」`)
                            setConfirmMemberBan('')
                          }
                        }}
                      >
                        确认停用
                      </button>
                      <button className="btn-outline shrink-0 !px-3 !py-1.5 text-xs" onClick={() => setConfirmMemberBan('')}>再想想</button>
                    </>
                  ) : (
                    <button className="btn-outline shrink-0 !px-3 !py-1.5 text-xs text-primary" onClick={() => setConfirmMemberBan(u.id)}>
                      停用账号
                    </button>
                  )}
                </div>
              ))}
            {!users.some(u => !u.role && (!qMember.trim() || u.nickname.includes(qMember.trim()) || u.phone.includes(qMember.trim()))) && (
              <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">没有匹配的会员。</p>
            )}
          </div>
        </section>
        </>
        )}

        {tab === 'site' && (
        <>
        <section className="card-cn rounded-lg p-5 md:p-6">
          <h2 className="mb-1 font-xing text-2xl text-foreground">首页公告</h2>
          <p className="mb-3 text-xs text-muted-foreground">填写后会在首页顶部以红笺形式展示,留空则不展示。</p>
          <textarea
            className="input-cn min-h-20 resize-y"
            placeholder="例如:中秋诗会报名开启,佳音墙征集新人回执……"
            value={draft.announcement}
            onChange={e => setDraft(d => ({ ...d, announcement: e.target.value }))}
          />
        </section>
        <section className="card-cn mt-4 rounded-lg p-5 md:p-6">
          <h2 className="mb-1 font-xing text-2xl text-foreground">佳节模板</h2>
          <p className="mb-3 text-xs text-muted-foreground">发起活动选到佳节日时会弹出模板;这里定制的文案优先,未定制的用内置文案。修改后自动保存。</p>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {FEST_NAMES.map(n => (
              <button
                key={n}
                onClick={() => setFestName(n)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition',
                  festName === n ? 'border-gold bg-gold/15 text-gold' : 'border-border text-foreground/70 hover:border-gold/50',
                )}
              >
                {n}
                {draft.festTemplates[n] && <span className="ml-1 text-[9px]">已定制</span>}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs tracking-widest text-muted-foreground">活动名称</label>
              <input className="input-cn" value={ftCur.title} onChange={e => setFt({ title: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs tracking-widest text-muted-foreground">主题标签(逗号分隔,至多 3 个)</label>
              <input
                className="input-cn"
                value={ftCur.tags.join(',')}
                onChange={e => setFt({ tags: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean).slice(0, 3) })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs tracking-widest text-muted-foreground">活动介绍</label>
              <textarea className="input-cn min-h-20 resize-y" value={ftCur.desc} onChange={e => setFt({ desc: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs tracking-widest text-muted-foreground">活动要求(可选)</label>
              <input className="input-cn" value={ftCur.requirements ?? ''} onChange={e => setFt({ requirements: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">{ftCustom ? '此佳节已定制。' : '当前为内置文案,修改即成定制。'}</span>
              <button className="btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-40" disabled={!ftCustom} onClick={resetFt}>
                <RotateCcw size={13} />
                恢复内置
              </button>
            </div>
          </div>
        </section>
        </>
        )}

        {tab === 'content' && (
        <section className="card-cn rounded-lg p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-xing text-2xl text-foreground">佳音墙内容</h2>
            <div className="flex gap-2">
              <button
                className="btn-ghost !px-3 !py-1.5 text-xs"
                onClick={() => setDraft(d => ({ ...d, stories: structuredClone(DEFAULT_SETTINGS.stories) }))}
              >
                <RotateCcw size={13} />
                恢复默认
              </button>
              <button
                className="btn-outline !px-3 !py-1.5 text-xs disabled:opacity-50"
                disabled={draft.stories.length >= 6}
                onClick={() => setDraft(d => ({ ...d, stories: [...d.stories, { img: '', quote: '', names: '', city: '' }] }))}
              >
                <ImagePlus size={13} />
                添加卡片
              </button>
            </div>
          </div>
          <div className="space-y-4">
            {draft.stories.map((s, i) => (
              <div key={i} className="rounded-md border border-border bg-secondary/40 p-4">
                <div className="flex flex-col gap-4 sm:flex-row">
                  <div className="shrink-0">
                    <div className="relative h-28 w-36 overflow-hidden rounded-md border border-border bg-muted">
                      {s.img ? (
                        <img src={s.img} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center text-xs text-muted-foreground">暂无图片</span>
                      )}
                    </div>
                    <label className="btn-outline mt-2 w-full cursor-pointer !px-3 !py-1.5 text-xs">
                      <ImagePlus size={13} />
                      上传图片
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={el => { fileRefs.current[i] = el }}
                        onChange={e => {
                          void pickImage(i, e.target.files?.[0])
                          e.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <textarea
                      className="input-cn min-h-16 resize-y text-sm"
                      placeholder="佳音回执(会员感言)"
                      value={s.quote}
                      onChange={e => patchStory(i, { quote: e.target.value })}
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input className="input-cn text-sm" placeholder="称呼,如 陈先生 & 林小姐" value={s.names} onChange={e => patchStory(i, { names: e.target.value })} />
                      <input className="input-cn text-sm" placeholder="城市与天数,如 杭州 · 相识 412 天" value={s.city} onChange={e => patchStory(i, { city: e.target.value })} />
                    </div>
                  </div>
                  <button
                    title="删除这张卡片"
                    className="btn-ghost self-start !px-2 text-muted-foreground hover:text-primary"
                    onClick={() => setDraft(d => ({ ...d, stories: d.stories.filter((_, idx) => idx !== i) }))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
            {!draft.stories.length && (
              <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">佳音墙暂无卡片,首页将不展示这一栏。</p>
            )}
          </div>
        </section>
        )}

        {(tab === 'content' || tab === 'site') && (
        <div className="sticky bottom-4 flex justify-center">
          <p className={cn(
            'flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs shadow-card transition',
            dirty ? 'border-gold/50 bg-card text-gold' : 'border-border bg-card text-muted-foreground',
          )}>
            {dirty ? '编辑中,稍停片刻即自动保存…' : '所有修改已自动保存到本地'}
          </p>
        </div>
        )}
      </div>

      <input
        ref={imgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          void pickTargetImage(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
