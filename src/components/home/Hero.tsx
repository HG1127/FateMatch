import { Link } from 'react-router-dom'
import { HeartHandshake, Sparkles } from 'lucide-react'
import { ageOf, useStore } from '@/lib/store'

const PILLARS = ['每日少量推荐', '兴趣与城市参考', '双方有意后聊天', '线下活动延伸']

export function Hero() {
  const { users, me } = useStore()
  // 主视觉展示汉服/古装扮相的会员, 与古典气质呼应
  const picks = users.filter(u => !u.role).slice(0, 3)
  const joins = '/auth?mode=register'

  return (
    <section className="clouds-red relative overflow-hidden text-primary-foreground">
      <span className="pointer-events-none absolute -right-10 top-6 select-none font-xing text-[16rem] leading-none text-gold-soft/10">囍</span>
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 md:grid-cols-2 md:py-24">
        <div className="animate-fade-up">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-gold-soft/40 bg-red-ink/40 px-3 py-1 text-xs tracking-[.3em] text-gold-soft">
            古典 · 真诚 · 缘分
          </p>
          <h1 className="font-xing text-6xl leading-tight md:text-7xl">
            一切相遇
            <br />
            皆是<span className="text-gold-soft">缘</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-primary-foreground/80">
            随缘网,面向成年人的认真交往社区。资料由本人填写,核验状态按实际记录展示；用少量推荐、兴趣和同城场景帮助双方慢慢了解。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={me ? '/yuanfen' : joins} className="btn-gold !px-7 !py-3 !text-base transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[.97]">
              <Sparkles size={18} />
              开始随缘
            </Link>
            <Link to={me ? '/explore' : joins} className="btn-cn border border-gold-soft/50 px-7 py-3 text-base text-gold-soft transition hover:-translate-y-0.5 hover:bg-red-ink/40 active:scale-[.97]">
              <HeartHandshake size={18} />
              看看兴趣匹配
            </Link>
          </div>
          <p className="mt-6 text-xs text-primary-foreground/55">仅供 18 周岁以上成年人使用 · 进入真人推荐前需确认必要资料</p>
        </div>

        <div className="relative hidden h-[420px] md:block">
          {picks.map((u, i) => (
            <div
              key={u.id}
              className="card-cn absolute w-52 overflow-hidden rounded-lg animate-float-slow"
              style={{
                left: `${i * 90}px`,
                top: `${i === 1 ? 30 : 80}px`,
                transform: `rotate(${(i - 1) * 7}deg)`,
                animationDelay: `${i * 0.8}s`,
                zIndex: i === 1 ? 2 : 1,
              }}
            >
              <img src={u.photos[0]} alt={u.nickname} className="aspect-[3/4] w-full object-cover" />
              <div className="flex items-center justify-between bg-card px-3 py-2">
                <span className="font-xing text-lg text-foreground">
                  {u.nickname}
                  <span className="cjk-latin ml-1 text-xs text-muted-foreground">{ageOf(u.birthDate)}</span>
                </span>
                <span className="seal px-1.5 py-0.5 text-[10px]">缘</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative border-t border-gold-soft/25 bg-red-ink/50">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 md:grid-cols-4">
          {PILLARS.map((label, i) => (
            <div key={label} className="text-center">
              <p className="font-xing text-2xl text-gold-soft md:text-3xl">{String(i + 1).padStart(2, '0')}</p>
              <p className="mt-1 text-xs tracking-widest text-primary-foreground/70">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
