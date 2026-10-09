import { Link } from 'react-router-dom'
import { CircleHelp, EyeOff, HeartHandshake, ShieldCheck, UserRoundCheck } from 'lucide-react'

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="card-cn scroll-mt-24 rounded-lg p-5 md:p-7">
    <h2 className="font-xing text-2xl text-foreground md:text-3xl">{title}</h2>
    <div className="mt-3 space-y-3 text-sm leading-7 text-foreground/75">{children}</div>
  </section>
)

export function TrustPage() {
  return (
    <div className="clouds-paper mx-auto max-w-4xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">信任与边界</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">安全与隐私说明</h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          这里说明当前版本实际做到什么、尚未做到什么。产品文案不会替代真实的权限、核验和服务流程。
        </p>
      </div>

      <nav className="mb-6 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <a href="#privacy" className="btn-outline justify-center">隐私可见</a>
        <a href="#verification" className="btn-outline justify-center">核验说明</a>
        <a href="#safety" className="btn-outline justify-center">互动安全</a>
        <a href="#account" className="btn-outline justify-center">账号帮助</a>
      </nav>

      <div className="space-y-5">
        <Section id="privacy" title="谁能看到什么">
          <p className="flex items-start gap-2"><EyeOff className="mt-1 shrink-0 text-gold" size={17} />未登录游客只看到明确标注的本地演示人物、帖子和活动，不通过公开接口读取真人会员资料和报名关系。</p>
          <p>登录会员可在推荐、社区和活动中看到完成相应展示条件的会员资料。你的联系方式不会作为公开个人资料展示。</p>
          <p>活动报名时主动填写的联系方式，仅用于该活动沟通；当前服务端限制为本人、对应活动主办方和必要的管理员处置范围可读。取消报名时会同步撤销报名、提醒、联系方式和旧签到记录。</p>
          <p>私聊内容仅聊天双方可读；管理员权限用于必要的安全与运营处置，不应作为无目的浏览敏感信息的理由。</p>
        </Section>

        <Section id="verification" title="核验代表什么">
          <p className="flex items-start gap-2"><UserRoundCheck className="mt-1 shrink-0 text-gold" size={17} />手机、身份、本人照片等核验状态只表示对应流程已有记录，不代表平台对婚姻状态、财产、品行或线下见面安全作保证。</p>
          <p>当前未接入的核验能力会明确显示“尚未开通”，不会使用固定验证码、延时动画或其他模拟流程点亮徽章。</p>
          <p>未填写的性别、出生日期、城市、职业等个人事实保持未知；只有本人确认必要资料并符合成年人要求后，才进入真人推荐池。</p>
        </Section>

        <Section id="safety" title="喜欢、聊天与线下见面">
          <p className="flex items-start gap-2"><HeartHandshake className="mt-1 shrink-0 text-gold" size={17} />“有意”只来自会员本人真实操作；只有双方都表达有意后才能发送完整私聊消息，服务端也会再次校验 mutual 与拉黑状态。</p>
          <p>破冰文案只是可编辑草稿，最终内容由本人确认后发送。系统不会冒充另一位会员制造回复、输入中或已读。</p>
          <p>涉及转账、投资、验证码、借款等内容请提高警惕。遇到骚扰、诈骗或虚假资料可使用举报与拉黑；举报成功会生成受理编号，处理进度和结果以实际状态为准。</p>
          <p>线下活动请优先选择公开场所，并自行判断是否分享更多联系方式或行程信息。平台不会把“通过核验”等同于线下见面的绝对安全。</p>
        </Section>

        <Section id="account" title="账号、数据与帮助">
          <p className="flex items-start gap-2"><ShieldCheck className="mt-1 shrink-0 text-gold" size={17} />账号和业务数据会写入当前自托管的数据服务（Neon/Postgres），并非只保存在浏览器本机。运行时上传照片、备份和数据库运行数据不进入 Git 仓库。</p>
          <p>登录后可在“我的”中修改密码、资料和隐身状态，也可先导出本人资料备份，再通过“注销账号”执行永久删除。注销由服务端事务处理本人账号、资料及本人拥有的业务数据；双方共有的历史会话可能为对方侧必要记录而保留。</p>
          <p className="flex items-start gap-2"><CircleHelp className="mt-1 shrink-0 text-gold" size={17} />如果页面显示的状态与真实操作不一致，请停止重复提交并反馈具体操作与时间；关键写入现在以服务端确认成功后才显示成功为目标。</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link to="/auth" className="btn-outline">登录 / 注册</Link>
            <Link to="/" className="btn-primary">返回首页</Link>
          </div>
        </Section>

        <Section id="terms" title="服务边界">
          <p>随缘网面向 18 周岁以上成年人，目标是帮助用户认识、了解并在自愿前提下延伸到线下见面。</p>
          <p>规则推荐分数只是当前资料与兴趣等维度的排序参考，不是关系成功概率，也不用于给人的价值打分。</p>
          <p>当前版本不承诺“保证脱单”、绝对安全、固定人工处理时效或未实际接入的第三方核验能力。功能和运营规则变化时，应同步更新本页与实际服务端权限。</p>
        </Section>
      </div>
    </div>
  )
}
