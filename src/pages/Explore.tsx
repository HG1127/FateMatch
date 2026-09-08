import { useMemo, useState } from 'react'
import { useStore } from '@/lib/store'
import type { User } from '@/lib/store'
import { districtOf } from '@/lib/region'
import { ProfileCard } from '@/components/ProfileCard'
import { FilterBar } from '@/components/explore/FilterBar'
import { DetailDialog } from '@/components/explore/DetailDialog'

export function ExplorePage() {
  const { candidates, matchScore, me } = useStore()
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [detail, setDetail] = useState<User | null>(null)

  const list = useMemo(() => {
    let arr = candidates()
    if (city) arr = arr.filter(u => u.city === city)
    if (district) arr = arr.filter(u => districtOf(u) === district)
    if (tags.length) arr = arr.filter(u => tags.some(t => u.interests.includes(t)))
    if (verifiedOnly) arr = arr.filter(u => u.verification.phone && u.verification.realname && u.verification.photo)
    // 同城缘分优先: 与我同城的排前, 同城内再按契合度
    const sameCity = (u: User) => !!me?.city && u.city === me.city
    return [...arr].sort((a, b) => Number(sameCity(b)) - Number(sameCity(a)) || matchScore(b) - matchScore(a))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, city, district, tags, verifiedOnly, me?.interests.length, me?.city])

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">兴趣匹配</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">寻一位知音</h1>
        <p className="mt-2 text-sm text-muted-foreground">同好之人自然相近,同城之缘更近一步,以兴趣为媒,以契合度为尺</p>
      </div>

      <FilterBar
        city={city}
        setCity={c => { setCity(c); setDistrict('') }}
        district={district}
        setDistrict={setDistrict}
        tags={tags}
        toggleTag={t => setTags(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]))}
        verifiedOnly={verifiedOnly}
        toggleVerifiedOnly={() => setVerifiedOnly(v => !v)}
      />

      {list.length ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map(u => <ProfileCard key={u.id} user={u} onOpen={setDetail} />)}
        </div>
      ) : (
        <div className="card-cn mx-auto max-w-md rounded-lg p-10 text-center">
          <h3 className="font-xing text-2xl text-foreground">暂无符合条件的有缘人</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {district ? '选了区县后,只看填了该区县的有缘人。放宽到整座城市,或换个条件试试。' : '放宽些条件,缘分往往在不设限处。'}
          </p>
          <button className="btn-outline mt-6" onClick={() => { setCity(''); setDistrict(''); setTags([]); setVerifiedOnly(false) }}>清空筛选</button>
        </div>
      )}

      <DetailDialog user={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
