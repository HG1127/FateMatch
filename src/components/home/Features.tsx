import { CalendarHeart, Camera, HeartHandshake, MessagesSquare, ShieldCheck, Sparkles } from 'lucide-react'
import { SectionHead } from '@/components/ui'

const FEATURES = [
  { icon: ShieldCheck, title: '核验状态如实展示', desc: '已完成的核验按实际记录展示；未接入能力不会模拟通过，未核验信息也不作平台背书。' },
  { icon: Sparkles, title: '每日少量推荐', desc: '从当前满足双方必要条件的候选中给出少量推荐；供给不足时如实说明，不用演示账号凑数。' },
  { icon: HeartHandshake, title: '兴趣与城市参考', desc: '用共同兴趣、城市等本人确认的信息作为推荐参考，不把规则分数包装成关系成功概率。' },
  { icon: CalendarHeart, title: '活动牵线', desc: '诗会、登高、桌游、汉服夜游等小组活动，把线上了解延伸到真实、可选择的见面场景。' },
  { icon: MessagesSquare, title: '双方有意后交流', desc: '只有双方真实表达「有意」后才开启佳音，不由系统冒充会员制造回复、已读或互动。' },
  { icon: Camera, title: '本人资料展示', desc: '资料由本人填写并可持续修改；未填写的个人事实保持未知，不由系统代填成既定事实。' },
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
          { no: '壹', t: '确认必要资料', d: '本人确认性别、希望认识对象、出生日期与城市后，才进入真人推荐池。' },
          { no: '贰', t: '查看今日推荐', d: '从满足当前双方必要条件的真人候选中，查看少量推荐与共同点。' },
          { no: '叁', t: '双方有意再交流', d: '双方真实表达「有意」后才开启佳音，从本人确认的一句话开始慢慢认识。' },
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
