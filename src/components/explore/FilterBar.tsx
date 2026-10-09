import { useState } from 'react'
import { BadgeCheck, Loader2, LocateFixed } from 'lucide-react'
import { toast } from 'sonner'
import { INTERESTS } from '@/lib/store-model'
import { cityToken, locateRegion, provinceOfCity, PROVINCES, rawCityOf } from '@/lib/region'
import { Tag } from '@/components/ui'
import { cn } from '@/lib/utils'

export function FilterBar({ city, setCity, district, setDistrict, tags, toggleTag, verifiedOnly, toggleVerifiedOnly, ageMin, ageMax, setAgeMin, setAgeMax }: {
  city: string
  setCity: (c: string) => void
  district: string
  setDistrict: (d: string) => void
  tags: string[]
  toggleTag: (t: string) => void
  verifiedOnly: boolean
  toggleVerifiedOnly: () => void
  ageMin: string
  ageMax: string
  setAgeMin: (value: string) => void
  setAgeMax: (value: string) => void
}) {
  const [prov, setProv] = useState(() => provinceOfCity(city))
  const [cty, setCty] = useState(() => rawCityOf(city))
  const [locating, setLocating] = useState(false)
  const province = PROVINCES.find(p => p.name === prov)
  const cityNode = province?.cities.find(c => c.name === cty)
  const districts = cityNode?.areas ?? []

  const locate = async () => {
    setLocating(true)
    try {
      const r = await locateRegion()
      setProv(r.prov)
      setCty(r.cty)
      setCity(r.cty ? cityToken(r.cty, r.prov) : '')
      setDistrict('')
      toast.success('已定位到你的所在地,看看同城的缘分')
    } catch {
      toast.error('定位失败,请手动选择省市县')
    } finally {
      setLocating(false)
    }
  }

  return (
    <div className="card-cn mb-8 space-y-4 rounded-lg p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold tracking-widest text-muted-foreground">城市</span>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 px-2.5 py-1 text-[11px] text-primary transition hover:bg-primary hover:text-primary-foreground"
          onClick={() => void locate()}
          disabled={locating}
        >
          {locating ? <Loader2 size={11} className="animate-spin" /> : <LocateFixed size={11} />}
          {locating ? '定位中…' : '定位到我'}
        </button>
        <select
          className="input-cn !w-28"
          value={prov}
          onChange={e => {
            setProv(e.target.value)
            setCty('')
            setCity('')
            setDistrict('')
          }}
        >
          <option value="">全部省份</option>
          {PROVINCES.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <select
          className="input-cn !w-32 disabled:opacity-50"
          value={cty}
          disabled={!province}
          onChange={e => {
            setCty(e.target.value)
            setCity(e.target.value ? cityToken(e.target.value, prov) : '')
            setDistrict('')
          }}
          title={province ? '按城市筛选' : '先选择省份'}
        >
          <option value="">{province ? '全部城市' : '先选省份'}</option>
          {province?.cities.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <select
          className="input-cn !w-32 disabled:opacity-50"
          value={district}
          disabled={!cityNode}
          onChange={e => setDistrict(e.target.value)}
          title={cityNode ? '进一步按区县筛选' : '先选择城市,再按区县筛选'}
        >
          <option value="">{cityNode ? `${cityToken(cty, prov)} · 不限区县` : '先选城市'}</option>
          {districts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">同城优先 · 当前页按规则参考排序</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-xs">
        <span className="font-semibold text-muted-foreground">年龄偏好</span>
        <label className="flex items-center gap-2">从 <input aria-label="最低年龄" type="number" min="18" max="100" inputMode="numeric" className="input-cn !w-20 !py-1" placeholder="18" value={ageMin} onChange={e => setAgeMin(e.target.value)} /> 岁</label>
        <label className="flex items-center gap-2">到 <input aria-label="最高年龄" type="number" min="18" max="100" inputMode="numeric" className="input-cn !w-20 !py-1" placeholder="不限" value={ageMax} onChange={e => setAgeMax(e.target.value)} /> 岁</label>
        <span className="text-muted-foreground">可选；仅影响本次筛选</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-widest text-muted-foreground">兴趣</span>
        {INTERESTS.map(t => (
          <Tag key={t} active={tags.includes(t)} onClick={() => toggleTag(t)}>{t}</Tag>
        ))}
        <button
          onClick={toggleVerifiedOnly}
          disabled
          title="手机、实名和本人照片核验尚未接入，筛选暂不可用"
          className={cn(
            'ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs transition opacity-60 cursor-not-allowed',
            verifiedOnly ? 'border-gold bg-gold/15 text-gold' : 'border-border text-foreground/70 hover:border-gold/40',
          )}
        >
          <BadgeCheck size={12} />
          核验筛选（待开放）
        </button>
      </div>
    </div>
  )
}
