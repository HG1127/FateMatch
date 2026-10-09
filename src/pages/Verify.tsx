import { Camera, PhoneCall, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore } from '@/lib/store-context'
import { PhoneCard, PhotoCard, RealnameCard } from '@/components/verify/VerifyBlocks'

const ITEMS = [
  { key: 'phone' as const, icon: PhoneCall, title: '手机核验', desc: '仅在真实短信核验服务完成后记录状态。', Card: PhoneCard },
  { key: 'realname' as const, icon: ShieldCheck, title: '身份核验', desc: '仅在真实人工或服务核验完成后记录状态。', Card: RealnameCard },
  { key: 'photo' as const, icon: Camera, title: '本人照片核验', desc: '仅在真实本人照片核验完成后记录状态。', Card: PhotoCard },
]

export function VerifyPage() {
  const { me } = useStore()
  if (!me) return null
  const done = ITEMS.filter(i => me.verification[i.key]).length

  return (
    <div className="clouds-paper mx-auto max-w-4xl px-4 py-10 md:py-14">
      <div className="mb-10 text-center">
        <p className="text-xs tracking-[.4em] text-gold">核验状态</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">如实记录,不模拟通过</h1>
        <p className="mt-2 text-sm text-muted-foreground">当前未接入的核验能力不会自动通过；已有状态仅按数据库记录展示，不代表平台对其他个人事实作保证。</p>
      </div>

      <div className="card-cn mb-8 rounded-lg p-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-foreground">已记录核验状态</span>
          <span className="text-gold">
            <span className="cjk-latin">{done}</span> / 3
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-700" style={{ width: `${(done / 3) * 100}%` }} />
        </div>
        {done > 0 && (
          <p className="mt-3 rounded-md bg-accent/15 px-3 py-2 text-center text-xs text-gold">核验状态只说明对应流程曾被记录，不等同于对单身状态、财产、品行或见面安全的保证。</p>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {ITEMS.map(({ key, icon: Icon, title, desc, Card }) => (
          <div key={key} className="card-cn rounded-lg p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full ring-1 ${me.verification[key] ? 'bg-accent/15 text-gold ring-accent/40' : 'bg-primary/10 text-primary ring-primary/30'}`}>
                <Icon size={18} />
              </span>
              <div>
                <p className="font-semibold text-foreground">{title}</p>
                <p className="text-[11px] text-muted-foreground">{me.verification[key] ? '已记录' : '未核验'}</p>
              </div>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{desc}</p>
            <Card />
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        推荐资格以本人确认的必要资料为准 · <Link className="text-primary underline underline-offset-4" to="/me">检查我的资料</Link>
      </p>
    </div>
  )
}
