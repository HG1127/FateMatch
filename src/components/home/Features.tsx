import { CalendarHeart, Camera, HeartHandshake, MessagesSquare, ShieldCheck, Sparkles } from 'lucide-react'
import { SectionHead } from '@/components/ui'

const FEATURES = [
  { icon: ShieldCheck, title: '资料三重验证', desc: '手机、实名、头像三重审核,徽章外显,杜绝虚假资料,让每一次相识都建立在真实之上。' },
  { icon: Sparkles, title: '每日随缘分配', desc: '每日为你甄选三位有缘人,不刷屏、不海投,把相遇的节奏交给缘分,也交给认真。' },
  { icon: HeartHandshake, title: '兴趣爱好匹配', desc: '以兴趣标签与契合度算法寻得知音,诗茶书画、山海湖光,同好之人自然相近。' },
  { icon: CalendarHeart, title: '活动牵线', desc: '诗会、登高、桌游、汉服夜游,小组主题活动把匹配落到真实场景,同席自然同心。' },
  { icon: MessagesSquare, title: '社区分享', desc: '见字如面,先读其文再识其人;为心动递一句回帖,从共鸣走向相识。' },
  { icon: Camera, title: '照片资料展示', desc: '上传生活照展示真实自我,山水行迹、灯下日常,让对方看见立体而真诚的你。' },
]

export function Features() {
  return (
    <section className="clouds-paper mx-auto max-w-6xl px-4 py-16 md:py-24">
      <SectionHead kicker="六重用心" title="为何选择随缘网" desc="匹配、破冰、场景三层生态,覆盖每一种相遇的方式" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <div key={f.title} className="card-cn rounded-lg p-6 transition hover:-translate-y-1 hover:shadow-lift" style={{ animationDelay: `${i * 0.1}s` }}>
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/30">
              <f.icon size={22} />
            </div>
            <h3 className="font-xing text-2xl text-foreground">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-16 grid gap-6 md:grid-cols-3">
        {[
          { no: '壹', t: '注册并验证', d: '填写基础资料,完成三重验证,领取专属缘字徽章。' },
          { no: '贰', t: '收取今日缘分', d: '每日随缘分配三位有缘人,心动便道一声「有意」。' },
          { no: '叁', t: '结一段良缘', d: '双方有意即结佳音,从一句问候开始,慢慢相识。' },
        ].map(s => (
          <div key={s.no} className="flex gap-4 rounded-lg border border-border bg-card/60 p-5">
            <span className="seal h-11 w-11 shrink-0 font-xing text-xl">{s.no}</span>
            <div>
              <p className="font-semibold text-foreground">{s.t}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
