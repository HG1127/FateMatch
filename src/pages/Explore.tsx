import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import type { User } from '@/lib/store'
import { ProfileCard } from '@/components/ProfileCard'
import { FilterBar } from '@/components/explore/FilterBar'
import { DetailDialog } from '@/components/explore/DetailDialog'

export function ExplorePage() {
  const { matchScore, me, loadDiscoveryProfiles } = useStore()
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [ageMin, setAgeMin] = useState('')
  const [ageMax, setAgeMax] = useState('')
  const [detail, setDetail] = useState<User | null>(null)
  const [items, setItems] = useState<User[]>([])
  const [page, setPage] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const loadDiscoveryRef = useRef(loadDiscoveryProfiles)
  useEffect(() => { loadDiscoveryRef.current = loadDiscoveryProfiles }, [loadDiscoveryProfiles])

  useEffect(() => {
    let alive = true
    if (ageMin && (Number(ageMin) < 18 || Number(ageMin) > 100) || ageMax && (Number(ageMax) < 18 || Number(ageMax) > 100) || ageMin && ageMax && Number(ageMin) > Number(ageMax)) {
      void Promise.resolve().then(() => { if (alive) { setError('请选择有效的年龄范围（18–100 岁，最低年龄不大于最高年龄）'); setLoading(false) } })
      return () => { alive = false }
    }
    void loadDiscoveryRef.current({ page, perPage: 24, city, district, tags, verifiedOnly, ...(ageMin ? { ageMin: Number(ageMin) } : {}), ...(ageMax ? { ageMax: Number(ageMax) } : {}) })
      .then(res => {
        if (!alive) return
        setItems(prev => page === 1 ? res.items : [...prev, ...res.items.filter(x => !prev.some(p => p.id === x.id))])
        setTotalItems(res.totalItems)
        setTotalPages(res.totalPages)
      })
      .catch(e => {
        if (!alive) return
        setError(e instanceof Error ? e.message : '人物列表加载失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [page, city, district, tags, verifiedOnly, ageMin, ageMax, retryKey])

  const list = useMemo(() => {
    const sameCity = (u: User) => !!me?.city && u.city === me.city
    return [...items].sort((a, b) => Number(sameCity(b)) - Number(sameCity(a)) || matchScore(b) - matchScore(a))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, me?.city, me?.interests.length])

  const resetQuery = () => {
    setItems([])
    setLoading(true)
    setError('')
    setPage(1)
  }

  const retry = () => {
    setLoading(true)
    setError('')
    setRetryKey(v => v + 1)
  }

  const loadMore = () => {
    setLoading(true)
    setError('')
    setPage(p => p + 1)
  }

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">兴趣匹配</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">寻一位知音</h1>
        <p className="mt-2 text-sm text-muted-foreground">同好之人自然相近，同城之缘更近一步；先按真实资格筛选，再用规则参考辅助判断</p>
      </div>

      <FilterBar
        city={city}
        setCity={c => { resetQuery(); setCity(c); setDistrict('') }}
        district={district}
        setDistrict={d => { resetQuery(); setDistrict(d) }}
        tags={tags}
        toggleTag={t => { resetQuery(); setTags(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t])) }}
        verifiedOnly={verifiedOnly}
        toggleVerifiedOnly={() => { resetQuery(); setVerifiedOnly(v => !v) }}
        ageMin={ageMin}
        ageMax={ageMax}
        setAgeMin={v => { resetQuery(); setAgeMin(v) }}
        setAgeMax={v => { resetQuery(); setAgeMax(v) }}
      />

      {error && !list.length ? (
        <div className="card-cn mx-auto max-w-md rounded-lg p-8 text-center">
          <h3 className="font-xing text-2xl text-foreground">人物发现暂时没有加载成功</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
          <button className="btn-outline mt-5" onClick={retry}><RefreshCw size={14} />重新加载</button>
        </div>
      ) : loading && !list.length ? (
        <div className="card-cn mx-auto max-w-md rounded-lg p-10 text-center text-sm text-muted-foreground">
          <Loader2 size={20} className="mx-auto mb-3 animate-spin text-primary" />
          正在按当前条件寻找真实候选…
        </div>
      ) : list.length ? (
        <>
          <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>当前条件共 {totalItems} 位候选 · 每次最多加载 24 位</span>
            {error && <button className="text-primary" onClick={retry}>本页加载异常，重试</button>}
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map(u => <ProfileCard key={u.id} user={u} onOpen={setDetail} />)}
          </div>
          {page < totalPages && (
            <div className="mt-8 text-center">
              <button className="btn-outline min-w-40" disabled={loading} onClick={loadMore}>
                {loading ? <><Loader2 size={14} className="animate-spin" />加载中…</> : '加载更多'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="card-cn mx-auto max-w-md rounded-lg p-10 text-center">
          <h3 className="font-xing text-2xl text-foreground">暂无符合条件的有缘人</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {district ? '当前区县没有满足双方必要条件的真人候选。放宽到整座城市,或换个条件试试。' : '当前没有满足双方必要条件的真人候选，可以放宽筛选。'}
          </p>
          <button className="btn-outline mt-6" onClick={() => { resetQuery(); setCity(''); setDistrict(''); setTags([]); setVerifiedOnly(false); setAgeMin(''); setAgeMax('') }}>清空筛选</button>
        </div>
      )}

      <DetailDialog user={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
