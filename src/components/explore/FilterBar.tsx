import { useState } from 'react'
import { BadgeCheck, Loader2, LocateFixed } from 'lucide-react'
import { toast } from 'sonner'
import { INTERESTS } from '@/lib/store-model'
import { cityToken, locateRegion, provinceOfCity, PROVINCES, rawCityOf } from '@/lib/region'
import { Tag } from '@/components/ui'
import { cn } from '@/lib/utils'

export function FilterBar({ city, setCity, district, setDistrict, tags, toggleTag, verifiedOnly, toggleVerifiedOnly, ageMin, ageMax, setAgeMin, setAgeMax, onReset }: {
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
  onReset: () => void
}) {
  const [prov, setProv] = useState(() => provinceOfCity(city))
  const [cty, setCty] = useState(() => rawCityOf(city))
  const [locating, setLocating] = useState(false)
  const province = PROVINCES.find(p => p.name === prov)
  const cityNode = province?.cities.find(c => c.name === cty)
  const districts = cityNode?.areas ?? []
  const hasFilters = !!(prov || cty || city || district || tags.length || verifiedOnly || ageMin || ageMax)

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
    <div className="card-cn mb-6 space-y-4 rounded-xl p-3.5 sm:mb-8 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">筛选条件</p>
        <button type="button" onClick={onReset} disabled={!hasFilters}
          className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-primary underline-offset-2 transition hover:underline disabled:cursor-default disabled:text-muted-foreground/60">
          清空筛选
        </button>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">所在地区</span>
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-primary/40 bg-card px-4 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
            onClick={() => void locate()}
            disabled={locating}
          >
            {locating ? <Loader2 size={17} className="animate-spin" /> : <LocateFixed size={17} />}
            {locating ? '定位中…' : '定位到我'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <select
          aria-label="筛选省份"
          className="input-cn min-w-0"
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
          aria-label="筛选城市"
          className="input-cn min-w-0 disabled:opacity-50"
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
          aria-label="筛选区县"
          className="input-cn col-span-2 min-w-0 disabled:opacity-50 sm:col-span-1"
          value={district}
          disabled={!cityNode}
          onChange={e => setDistrict(e.target.value)}
          title={cityNode ? '进一步按区县筛选' : '先选择城市,再按区县筛选'}
        >
          <option value="">{cityNode ? `${cityToken(cty, prov)} · 不限区县` : '先选城市'}</option>
          {districts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        </div>
        <p className="text-xs text-muted-foreground">同城优先 · 当前页按规则参考排序</p>
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">年龄偏好</span>
          <span className="text-xs text-muted-foreground">选填 · 18–100 岁</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted-foreground">最低年龄
            <input aria-label="最低年龄" type="number" min="18" max="100" inputMode="numeric" className="input-cn mt-1" placeholder="18 岁" value={ageMin} onChange={e => setAgeMin(e.target.value)} />
          </label>
          <label className="block text-xs text-muted-foreground">最高年龄
            <input aria-label="最高年龄" type="number" min="18" max="100" inputMode="numeric" className="input-cn mt-1" placeholder="不限" value={ageMax} onChange={e => setAgeMax(e.target.value)} />
          </label>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="w-full text-sm font-semibold text-foreground">兴趣偏好</span>
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
