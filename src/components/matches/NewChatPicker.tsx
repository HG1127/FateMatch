import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useStore } from '@/lib/store-context'
import type { User } from '@/lib/store'
import { regionOf } from '@/lib/region'
import { AvatarFrame, MatchRing, Modal } from '@/components/ui'

export function NewChatPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (u: User) => void }) {
  const { mutuals, matchScore, me } = useStore()
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    let arr = mutuals()
    const kw = q.trim()
    if (kw) arr = arr.filter(u => u.nickname.includes(kw) || regionOf(u).includes(kw) || u.job.includes(kw))
    return [...arr].sort((a, b) => matchScore(b) - matchScore(a))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutuals, q])

  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="p-5 md:p-6">
        <h3 className="font-xing text-2xl text-foreground">选择一段佳音</h3>
        <p className="mt-1 text-xs text-muted-foreground">只有双方真实互道「有意」后，才可在这里继续交流。</p>
        <div className="relative mt-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="input-cn !pl-8" placeholder="搜索昵称 / 城市 / 职业" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="mt-4 max-h-[46vh] space-y-2 overflow-y-auto pr-1">
          {list.map(u => {
            const shared = me ? u.interests.filter(t => me.interests.includes(t)).length : 0
            return (
              <div
                key={u.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-secondary/40 p-2.5 transition hover:border-primary/50 hover:shadow-card"
                onClick={() => onPick(u)}
              >
                <AvatarFrame user={u} className="h-10 w-10">
                  <img src={u.photos[0]} alt={u.nickname} className="h-full w-full rounded-full object-cover" />
                </AvatarFrame>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{u.nickname}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {regionOf(u)} · {u.job}
                    {shared > 0 && <span className="text-primary"> · 同好 {shared} 项</span>}
                  </p>
                </div>
                <MatchRing value={matchScore(u)} size={40} />
                <button className="btn-primary shrink-0 !px-3 !py-1.5 text-xs" onClick={e => { e.stopPropagation(); onPick(u) }}>
                  进入聊天
                </button>
              </div>
            )
          })}
          {!list.length && <p className="py-10 text-center text-sm text-muted-foreground">暂无符合搜索条件的互配对象</p>}
        </div>
      </div>
    </Modal>
  )
}
