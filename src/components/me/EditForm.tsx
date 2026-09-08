import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { hashStr, INTERESTS, useStore } from '@/lib/store'
import { Field, Tag } from '@/components/ui'
import { CityPicker } from '@/components/ui/CityPicker'

export function EditForm() {
  const { me, update } = useStore()
  const [nickname, setNickname] = useState(me?.nickname ?? '')
  const [city, setCity] = useState(me?.city ?? '')
  const [region, setRegion] = useState(me?.region ?? '')
  const [height, setHeight] = useState(String(me?.height ?? 170))
  const [job, setJob] = useState(me?.job ?? '')
  const [bio, setBio] = useState(me?.bio ?? '')
  const [interests, setInterests] = useState<string[]>(me?.interests ?? [])

  const save = () => {
    if (nickname.trim().length < 2) return toast.error('昵称至少 2 个字')
    if (interests.length < 3) return toast.error('兴趣至少保留 3 项')
    update({
      nickname: nickname.trim(),
      city,
      region: region || undefined,
      height: Math.max(140, Math.min(220, Number(height) || 170)),
      job: job.trim() || '保密',
      bio: bio.trim() || '这个人很神秘,还没写自我介绍。',
      interests,
    })
    toast.success('资料已保存')
  }

  const polishBio = () => {
    const raw = bio.trim()
    const [a, b] = interests.slice(0, 2)
    const opts = raw
      ? [
          `${raw} 居于${city},把${a ?? '日常'}与${b ?? '四季'}都过成日子。`,
          `在${city},${a ?? '写字'}、${b ?? '散步'},外加一点认真——${raw}`,
          `${raw} 想遇一位同好,共${a ?? '一盏茶'}之乐。`,
        ]
      : [
          `居于${city},以${job}为业,把${a ?? '日常'}与${b ?? '四季'}都过成日子,想遇一位懂的人。`,
          `偏爱${a ?? '诗词'}与${b ?? '山海'},日子过得慢,心却真诚。`,
          `${city}的${job},白日忙碌,晚间归于${a ?? '一盏茶'};等一位有缘人,共赏悲欢。`,
        ]
    setBio(opts[hashStr(raw + nickname + city) % opts.length].slice(0, 120))
    toast.success('已润色,可再修改')
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="昵称">
          <input className="input-cn" value={nickname} onChange={e => setNickname(e.target.value)} />
        </Field>
        <Field label="身高(cm)">
          <input className="input-cn" type="number" value={height} onChange={e => setHeight(e.target.value)} />
        </Field>
        <Field label="职业">
          <input className="input-cn" value={job} onChange={e => setJob(e.target.value)} />
        </Field>
      </div>
      <Field label="所在地区(省 / 市 / 区县)">
        <CityPicker city={city} region={region} onPick={(c, r) => { setCity(c); setRegion(r) }} />
      </Field>
      <Field label="自我介绍(120 字内)">
        <textarea className="input-cn min-h-20 resize-y" value={bio} onChange={e => setBio(e.target.value)} />
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
