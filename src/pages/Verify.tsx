import { Camera, PhoneCall, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { PhoneCard, PhotoCard, RealnameCard } from '@/components/verify/VerifyBlocks'

const ITEMS = [
  { key: 'phone' as const, icon: PhoneCall, title: '手机验证', desc: '绑定本人手机号,接收佳音与提醒。', Card: PhoneCard },
  { key: 'realname' as const, icon: ShieldCheck, title: '实名验证', desc: '姓名与证件核验,杜绝虚假身份。', Card: RealnameCard },
  { key: 'photo' as const, icon: Camera, title: '头像验证', desc: '本人与头像比对,让展示更可信。', Card: PhotoCard },
]

export function VerifyPage() {
  const { me } = useStore()
  if (!me) return null
  const done = ITEMS.filter(i => me.verification[i.key]).length

  return (
    <div className="clouds-paper mx-auto max-w-4xl px-4 py-10 md:py-14">
      <div className="mb-10 text-center">
        <p className="text-xs tracking-[.4em] text-gold">资料验证</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">三重验证,以诚待人</h1>
        <p className="mt-2 text-sm text-muted-foreground">验证通过的会员将点亮徽章,在随缘分配与兴趣匹配中优先展示</p>
      </div>

      <div className="card-cn mb-8 rounded-lg p-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-foreground">验证进度</span>
          <span className="text-gold">
            <span className="cjk-latin">{done}</span> / 3
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-700" style={{ width: `${(done / 3) * 100}%` }} />
        </div>
        {done === 3 && (
          <p className="mt-3 rounded-md bg-accent/15 px-3 py-2 text-center text-sm text-gold">三重验证全部完成,诚信之缘已备,静候佳音。</p>
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
                <p className="text-[11px] text-muted-foreground">{me.verification[key] ? '已完成' : '待验证'}</p>
              </div>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{desc}</p>
            <Card />
          </div>
        ))}
      </div>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        验证完成后,去收取今日缘分 · <Link className="text-primary underline underline-offset-4" to="/yuanfen">前往随缘分配</Link>
      </p>
    </div>
  )
}
