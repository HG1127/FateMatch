import { Link } from 'react-router-dom'
import { useStore } from '@/lib/store'

export function CtaBand() {
  const { me } = useStore()
  return (
    <section className="clouds-red relative overflow-hidden text-center text-primary-foreground">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 select-none font-xing text-[10rem] leading-none text-gold-soft/10">缘</span>
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 select-none font-xing text-[10rem] leading-none text-gold-soft/10">囍</span>
      <div className="mx-auto max-w-3xl px-4 py-16 md:py-20">
        <h2 className="font-xing text-4xl md:text-5xl">今日,结一段缘</h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-primary-foreground/75">
          注册只需三分钟,验证通过即开启每日随缘分配。山有木兮木有枝,心悦君兮君不知——别再让缘分擦肩。
        </p>
        <div className="mt-8">
          <Link to={me ? '/yuanfen' : '/auth?mode=register'} className="btn-gold !px-8 !py-3 !text-base transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[.97]">
            {me ? '查看今日随缘' : '免费加入随缘网'}
          </Link>
        </div>
        <p className="mt-5 text-xs text-primary-foreground/55">随缘网仅面向 18 周岁以上成年人 · 注册即视为同意真诚交友公约</p>
      </div>
    </section>
  )
}
