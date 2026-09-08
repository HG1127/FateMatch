import { useState } from 'react'
import { Loader2, LocateFixed, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { buildRegion, cityToken, locateRegion, PROVINCES } from '@/lib/region'

interface Props {
  city: string
  region?: string
  onPick: (city: string, region: string) => void
}

/** 解析已有数据回填三级选择: 优先完整地区串, 否则按城市标识找回省市 */
function parseInit(city: string, region?: string): { prov: string; cty: string; dist: string } {
  if (region) {
    const parts = region.split('·')
    if (parts.length >= 3) return { prov: parts[0], cty: parts[1], dist: parts[2] }
    if (parts.length === 2) {
      // 直辖市存为 北京市·朝阳区
      if (parts[0].endsWith('市')) return { prov: parts[0], cty: '市辖区', dist: parts[1] }
      return { prov: parts[0], cty: parts[1], dist: '' }
    }
  }
  if (city) {
    for (const p of PROVINCES) {
      for (const c of p.cities) {
        if (cityToken(c.name, p.name) === city) return { prov: p.name, cty: c.name, dist: '' }
      }
    }
  }
  return { prov: '', cty: '', dist: '' }
}

export function CityPicker({ city, region, onPick }: Props) {
  const [init] = useState(() => parseInit(city, region))
  const [prov, setProv] = useState(init.prov)
  const [cty, setCty] = useState(init.cty)
  const [dist, setDist] = useState(init.dist)

  const province = PROVINCES.find(p => p.name === prov)
  const cityNode = province?.cities.find(c => c.name === cty)

  const emit = (p: string, c: string, d: string) => {
    onPick(c && p ? cityToken(c, p) : '', buildRegion(p, c, d))
  }

  const [locating, setLocating] = useState(false)
  const locate = async () => {
    setLocating(true)
    try {
      const r = await locateRegion()
      setProv(r.prov)
      setCty(r.cty)
      setDist(r.dist)
      emit(r.prov, r.cty, r.dist)
      toast.success('已定位到你的所在地,可随时调整')
    } catch {
      toast.error('定位失败,请手动选择省市县')
    } finally {
      setLocating(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        className="mb-1.5 inline-flex items-center gap-1 rounded-full border border-primary/40 px-2.5 py-1 text-[11px] text-primary transition hover:bg-primary hover:text-primary-foreground"
        onClick={() => void locate()}
        disabled={locating}
      >
        {locating ? <Loader2 size={11} className="animate-spin" /> : <LocateFixed size={11} />}
        {locating ? '定位中…' : '定位到我'}
      </button>
      <div className="grid gap-2 sm:grid-cols-3">
      <select
        className="input-cn"
        value={prov}
        onChange={e => {
          setProv(e.target.value)
          setCty('')
          setDist('')
          emit(e.target.value, '', '')
        }}
      >
        <option value="">省份</option>
        {PROVINCES.map(p => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
      </select>
      <select
        className="input-cn"
        value={cty}
        disabled={!province}
        onChange={e => {
          setCty(e.target.value)
          setDist('')
          emit(prov, e.target.value, '')
        }}
      >
        <option value="">城市</option>
        {province?.cities.map(c => (
          <option key={c.name} value={c.name}>{c.name}</option>
        ))}
      </select>
      <select
        className="input-cn"
        value={dist}
        disabled={!cityNode}
        onChange={e => {
          setDist(e.target.value)
          emit(prov, cty, e.target.value)
        }}
      >
        <option value="">区县(选填)</option>
        {cityNode?.areas.map(a => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
      {region && (
        <p className="col-span-full flex items-center gap-1 text-[11px] text-gold">
          <MapPin size={11} />
          {region}
        </p>
      )}
      </div>
    </div>
  )
}
