import { useEffect, useState } from 'react'
import { RotateCcw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { Gender } from '@/lib/store'
import { Field, Tag } from '@/components/ui'
import { CityPicker } from '@/components/ui/CityPicker'
import { DateFields } from '@/components/ui/DateFields'
import { ageOf, hashStr, INTERESTS } from '@/lib/store-model'

export function EditForm() {
  const { me, saveProfile, dataReady, bootError, retryBoot } = useStore()
  const [nickname, setNickname] = useState(me?.nickname ?? '')
  const [gender, setGender] = useState<Gender>(me?.gender ?? 'unknown')
  const [seeking, setSeeking] = useState<Gender>(me?.seeking ?? 'unknown')
  const [birthDate, setBirthDate] = useState(me?.birthDate ?? '')
  const [city, setCity] = useState(me?.city ?? '')
  const [region, setRegion] = useState(me?.region ?? '')
  const [height, setHeight] = useState(me?.height ? String(me.height) : '')
  const [job, setJob] = useState(me?.job ?? '')
  const [bio, setBio] = useState(me?.bio ?? '')
  const [interests, setInterests] = useState<string[]>(me?.interests ?? [])
  const [saving, setSaving] = useState(false)
  const [bioSuggestion, setBioSuggestion] = useState('')
  const [dateFieldReset, setDateFieldReset] = useState(0)
  const adultCutoff = new Date()
  adultCutoff.setFullYear(adultCutoff.getFullYear() - 18)
  const oldestAllowedBirthDate = `${adultCutoff.getFullYear()}-${String(adultCutoff.getMonth() + 1).padStart(2, '0')}-${String(adultCutoff.getDate()).padStart(2, '0')}`


  const draftSnapshot = JSON.stringify({
    nickname: nickname.trim(),
    gender,
    seeking,
    birthDate,
    city,
    region: region || '',
    height: height.trim() ? Number(height) : 0,
    job: job.trim(),
    bio: bio.trim(),
    interests: [...interests].sort(),
  })
  const savedSnapshot = me
    ? JSON.stringify({
        nickname: me.nickname.trim(),
        gender: me.gender,
        seeking: me.seeking,
        birthDate: me.birthDate,
        city: me.city,
        region: me.region || '',
        height: me.height || 0,
        job: me.job.trim(),
        bio: me.bio.trim(),
        interests: [...me.interests].sort(),
      })
    : ''
  const dirty = !!me && draftSnapshot !== savedSnapshot

  // 登录后 Store 会先经历“账号已知、数据库资料尚未水合”的短暂阶段。
  // 表单本地 state 必须在可信资料到达后重置，否则会把上一账号/临时对象的值继续展示甚至写回数据库。
  useEffect(() => {
    if (!dataReady || !me) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部 Store 水合完成后一次性同步表单草稿
    setNickname(me.nickname ?? '')
    setGender(me.gender ?? 'unknown')
    setSeeking(me.seeking ?? 'unknown')
    setBirthDate(me.birthDate ?? '')
    setCity(me.city ?? '')
    setRegion(me.region ?? '')
    setHeight(me.height ? String(me.height) : '')
    setJob(me.job ?? '')
    setBio(me.bio ?? '')
    setInterests(me.interests ?? [])
    setBioSuggestion('')
    setDateFieldReset(key => key + 1)
  }, [dataReady, me])

  useEffect(() => {
    if (!dirty) return
    const message = '资料还有未保存修改，确定要离开吗？'
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const onDocumentClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target instanceof Element ? e.target.closest('a[href]') : null
      if (!(target instanceof HTMLAnchorElement) || target.target === '_blank' || target.hasAttribute('download')) return
      const href = target.getAttribute('href') ?? ''
      if (!href || href.startsWith('#')) return
      const next = new URL(target.href, window.location.href)
      if (next.href === window.location.href) return
      if (!window.confirm(message)) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onDocumentClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onDocumentClick, true)
    }
  }, [dirty])

  const saveErrorMessage = (e: unknown) => {
    const err = e as { status?: number; message?: string; response?: { message?: string; data?: Record<string, { message?: string }> } } | null
    const field = Object.values(err?.response?.data ?? {}).map(v => v?.message).find(Boolean)
    if (field) return field
    const msg = err?.response?.message || err?.message || ''
    if (err?.status === 0 || !msg || msg === 'Something went wrong.' || /fetch|network|failed to fetch/i.test(msg)) {
      return '网络连接暂时不可用，修改尚未保存。请检查网络后重试，表单内容会保留。'
    }
    if (err?.status === 401) return '登录状态已失效，请重新登录后再保存。'
    if (err?.status === 403) return '当前账号无权修改这份资料，请刷新页面确认登录账号。'
    return msg
  }

  const resetDraft = () => {
    if (!me || saving) return
    setNickname(me.nickname ?? '')
    setGender(me.gender ?? 'unknown')
    setSeeking(me.seeking ?? 'unknown')
    setBirthDate(me.birthDate ?? '')
    setCity(me.city ?? '')
    setRegion(me.region ?? '')
    setHeight(me.height ? String(me.height) : '')
    setJob(me.job ?? '')
    setBio(me.bio ?? '')
    setInterests(me.interests ?? [])
    setBioSuggestion('')
    setDateFieldReset(key => key + 1)
  }

  const save = async () => {
    if (saving) return
    if (!dataReady || !me) return toast.error(bootError ? '数据库尚未连接，请先恢复数据服务' : '正在加载真实资料，请稍候再保存')
    if (nickname.trim().length < 2) return toast.error('昵称至少 2 个字')
    if (gender === 'unknown') return toast.error('请选择你的性别')
    if (seeking === 'unknown') return toast.error('请选择希望认识的对象')
    if (!birthDate || ageOf(birthDate) < 18) return toast.error('随缘网仅面向 18 周岁以上成年人')
    if (!city) return toast.error('请选择所在城市')
    const h = height.trim() ? Number(height) : 0
    if (h && (h < 140 || h > 220)) return toast.error('身高请填写 140–220 cm')
    setSaving(true)
    try {
      await saveProfile({
        nickname: nickname.trim(),
        gender,
        seeking,
        birthDate,
        city,
        region: region || undefined,
        height: h,
        job: job.trim(),
        bio: bio.trim(),
        interests,
      })
      toast.success('资料已确认保存')
      setBioSuggestion('')
    } catch (e) {
      toast.error(saveErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const polishBio = () => {
    const raw = bio.trim()
    if (!raw) {
      toast('先写几句真实的自我介绍，再帮你润色')
      return
    }
    const [a, b] = interests.slice(0, 2)
    const topics = [a, b].filter(Boolean).join('、')
    const context = [city, job].filter(Boolean).join('、')
    const opts = [
      topics ? `${raw} 如果你也对${topics}感兴趣，可以从这些共同点慢慢认识。` : `${raw} 如果这些也恰好是你在意的事，欢迎慢慢认识。`,
      context ? `${raw} 也可以从${context}这些真实信息开始了解彼此。` : `${raw} 比起快速下结论，我更愿意从真实交流开始。`,
    ]
    setBioSuggestion(opts[hashStr(raw + nickname + city) % opts.length].slice(0, 120))
    toast('已生成润色预览，原文没有被修改')
  }

  if (!dataReady || !me) {
    return (
      <div className="rounded-lg border border-amber-300/60 bg-amber-50/70 p-4 text-sm text-amber-900">
        <p className="font-semibold">{bootError ? '数据库连接未就绪' : '正在加载你的真实资料…'}</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-800/80">
          {bootError ? '为避免把临时资料误写入数据库，连接恢复前已暂停编辑与保存。' : '资料加载完成后再编辑，避免使用临时状态。'}
        </p>
        {bootError && <button className="btn-outline mt-3 !py-2 text-xs" onClick={retryBoot}>重新连接数据库</button>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="昵称">
          <input className="input-cn" value={nickname} onChange={e => setNickname(e.target.value)} maxLength={30} />
        </Field>
        <Field label="我的性别">
          <select className="input-cn" value={gender} onChange={e => setGender(e.target.value as Gender)}>
            <option value="unknown">请选择</option>
            <option value="female">女</option>
            <option value="male">男</option>
          </select>
        </Field>
        <Field label="希望认识">
          <select className="input-cn" value={seeking} onChange={e => setSeeking(e.target.value as Gender)}>
            <option value="unknown">请选择</option>
            <option value="female">女性</option>
            <option value="male">男性</option>
          </select>
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-foreground/70">出生日期</p>
          <DateFields key={dateFieldReset} label="出生日期" value={birthDate} onChange={setBirthDate} min="1900-01-01" max={oldestAllowedBirthDate} />
        </div>
        <Field label="身高(cm，可不填)">
          <input className="input-cn" type="number" min={140} max={220} value={height} onChange={e => setHeight(e.target.value)} />
        </Field>
        <Field label="职业(可不填)">
          <input className="input-cn" value={job} onChange={e => setJob(e.target.value)} maxLength={50} />
        </Field>
      </div>
      <Field label="所在地区(省 / 市 / 区县)">
        <CityPicker city={city} region={region} onPick={(c, r) => { setCity(c); setRegion(r) }} />
      </Field>
      <Field label="自我介绍(120 字内)">
        <textarea className="input-cn min-h-20 resize-y" value={bio} onChange={e => { setBio(e.target.value); setBioSuggestion('') }} maxLength={120} />
      </Field>
      {bioSuggestion && (
        <div className="rounded-lg border border-gold/40 bg-gold/5 p-3">
          <p className="text-xs font-semibold text-foreground">润色预览</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{bioSuggestion}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">只基于你已经填写的内容调整表达，不新增经历或事实。采用前不会改动原文。</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => { setBio(bioSuggestion); setBioSuggestion('') }}>采用这版</button>
            <button className="btn-outline !px-3 !py-1.5 text-xs" onClick={() => setBioSuggestion('')}>保留原文</button>
          </div>
        </div>
      )}
      <Field label="兴趣爱好(选填，建议至少 3 项以便发现同好)">
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map(t => (
            <Tag key={t} active={interests.includes(t)} onClick={() => setInterests(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]))}>
              {t}
            </Tag>
          ))}
        </div>
      </Field>
      <div className="rounded-lg border border-border bg-secondary/30 p-3">
        <div className="mb-3 flex items-center justify-between gap-3 text-xs">
          <span className={dirty ? 'font-semibold text-primary' : 'text-muted-foreground'}>{dirty ? '有未保存修改' : '当前资料已保存'}</span>
          {dirty && <span className="text-muted-foreground">点击其他页面或关闭/刷新前会提醒你</span>}
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="btn-outline" onClick={polishBio} disabled={saving}>
            <Sparkles size={15} />
            润色预览
          </button>
          {dirty && (
            <button className="btn-outline" onClick={resetDraft} disabled={saving}>
              <RotateCcw size={15} />
              取消修改
            </button>
          )}
          <button className="btn-primary disabled:opacity-50" disabled={saving || !dirty} onClick={() => void save()}>{saving ? '保存中…' : dirty ? '保存资料' : '已保存'}</button>
        </div>
      </div>
    </div>
  )
}
