import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { ageOf, hashStr, INTERESTS, useStore } from '@/lib/store'
import type { Gender } from '@/lib/store'
import { Field, Tag } from '@/components/ui'
import { CityPicker } from '@/components/ui/CityPicker'

export function EditForm() {
  const { me, update } = useStore()
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

  const save = () => {
    if (nickname.trim().length < 2) return toast.error('昵称至少 2 个字')
    if (gender === 'unknown') return toast.error('请选择你的性别')
    if (seeking === 'unknown') return toast.error('请选择希望认识的对象')
    if (!birthDate || ageOf(birthDate) < 18) return toast.error('随缘网仅面向 18 周岁以上成年人')
    if (!city) return toast.error('请选择所在城市')
    if (interests.length < 3) return toast.error('兴趣至少保留 3 项')
    const h = height.trim() ? Number(height) : 0
    if (h && (h < 140 || h > 220)) return toast.error('身高请填写 140–220 cm')
    update({
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
    toast.success('资料已保存')
  }

  const polishBio = () => {
    const raw = bio.trim()
    if (!raw) {
      toast('先写几句真实的自我介绍，再帮你润色')
      return
    }
    const [a, b] = interests.slice(0, 2)
    const context = [city, job, a, b].filter(Boolean).join('、')
    const opts = [
      raw,
      context ? `${raw}（我的日常也常与${context}有关。）` : raw,
      `${raw} 如果这些也恰好是你在意的事，欢迎慢慢认识。`,
    ]
    setBio(opts[hashStr(raw + nickname + city) % opts.length].slice(0, 120))
    toast.success('已基于原文润色,请确认后再保存')
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
        <Field label="出生日期">
          <input className="input-cn" type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setBirthDate(e.target.value)} />
        </Field>
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
        <textarea className="input-cn min-h-20 resize-y" value={bio} onChange={e => setBio(e.target.value)} maxLength={120} />
      </Field>
      <Field label="兴趣爱好(至少 3 项)">
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map(t => (
            <Tag key={t} active={interests.includes(t)} onClick={() => setInterests(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]))}>
              {t}
            </Tag>
          ))}
        </div>
      </Field>
      <div className="flex gap-3">
        <button className="btn-outline" onClick={polishBio}>
          <Sparkles size={15} />
          润色自我介绍
        </button>
        <button className="btn-primary" onClick={save}>保存资料</button>
      </div>
    </div>
  )
}
