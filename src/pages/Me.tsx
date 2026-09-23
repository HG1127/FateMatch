import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Ban, Download, Eye, EyeOff, KeyRound, MapPin, MessageCircleHeart, Sparkles, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { ageOf, completeness, useStore } from '@/lib/store'
import type { User } from '@/lib/store'
import { regionOf } from '@/lib/region'
import { changeAccountPassword } from '@/lib/repo'
import { logoutLocalAccount } from '@/lib/localAuth'
import { yuanLevel } from '@/lib/badges'
import { VerifyBadges, LevelSeal, AvatarFrame, NickName } from '@/components/ui'
import { PhotoManager } from '@/components/me/PhotoManager'
import { EditForm } from '@/components/me/EditForm'
import { TaskBoard } from '@/components/me/TaskBoard'
import { DetailDialog } from '@/components/explore/DetailDialog'
import { fmtTime, cn } from '@/lib/utils'

export function MePage() {
  const store = useStore()
  const { me, account, likesOf, mutuals, visitorsOf, sendChat, update, favs, favGroups, users, blocks, toggleBlock, visits } = store
  const [profile, setProfile] = useState<User | null>(null)
  const [allVisitors, setAllVisitors] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  const [pwdBusy, setPwdBusy] = useState(false)
  if (!me) return null
  const lv = yuanLevel(store, me)
  const done = Object.values(me.verification).filter(Boolean).length
  const visitors = visitorsOf(me.id)
  const stealth = !!me.stealth
  const visitedByMe = new Set(Object.entries(visits).filter(([, l]) => l.some(v => v.id === me.id)).map(([k]) => k))

  return (
    <div className="clouds-paper mx-auto max-w-6xl px-4 py-10 md:py-14">
      <div className="mb-8 text-center">
        <p className="text-xs tracking-[.4em] text-gold">我的主页</p>
        <h1 className="mt-2 font-xing text-4xl text-foreground md:text-5xl">打理自己的缘</h1>
      </div>

      <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
        <div className="space-y-6">
          <div className="card-cn overflow-hidden rounded-lg">
            <img src={me.photos[0]} alt={me.nickname} className="aspect-[3/4] w-full object-cover" />
            <div className="space-y-2 p-4">
              <p className="font-xing text-2xl text-foreground">
                <NickName user={me} />
                <span className="cjk-latin ml-2 text-sm text-gold">{ageOf(me.birthDate)}</span>
                <LevelSeal user={me} className="ml-2 align-middle" />
              </p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin size={11} />{regionOf(me)} · {me.job}
              </p>
              <VerifyBadges v={me.verification} />
              <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-center text-xs text-muted-foreground">
                <span>有意 <span className="cjk-latin font-xing text-lg text-primary">{likesOf(me.id).length}</span></span>
                <span>佳音 <span className="cjk-latin font-xing text-lg text-primary">{mutuals().length}</span></span>
                <span>访客 <span className="cjk-latin font-xing text-lg text-primary">{stealth ? '隐' : visitors.length}</span></span>
              </div>
              <button
                className="btn-outline w-full !py-2 text-xs transition active:scale-[.98]"
                onClick={() => {
                  const data = {
                    exportedAt: new Date().toISOString(),
                    profile: me,
                    favorites: favs,
                    favGroups,
                  }
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = '随缘网-我的资料备份.json'
                  a.click()
                  URL.revokeObjectURL(url)
                  toast.success('备份已下载,妥善保存')
                }}
              >
                <Download size={13} />
                导出我的资料备份
              </button>
            </div>
          </div>
          {(() => {
            const c = completeness(me)
            return (
              <div className="card-cn rounded-lg p-4 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Sparkles size={15} className="text-gold" />
                  资料与验证
                  <span className="cjk-latin ml-auto font-xing text-lg text-gold">{c.pct}%</span>
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-gradient-to-r from-gold to-primary transition-all duration-500" style={{ width: `${c.pct}%` }} />
                </div>
                {c.pct >= 100 ? (
                  <p className="mt-2 text-xs text-gold">资料已圆满,缘自会循着光来找你。</p>
                ) : (
                  <ul className="mt-2.5 space-y-1.5">
                    {c.tips.slice(0, 3).map(t => (
                      <li key={t.text}>
                        {t.to ? (
                          <Link to={t.to} className="flex items-start gap-1.5 text-xs text-muted-foreground transition hover:text-primary">
                            <span className="mt-0.5 shrink-0 rounded-sm bg-primary/10 px-1 text-[10px] text-primary">+{t.pts}</span>
                            {t.text}
                          </Link>
                        ) : (
                          <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <span className="mt-0.5 shrink-0 rounded-sm bg-primary/10 px-1 text-[10px] text-primary">+{t.pts}</span>
                            {t.text}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                  <span className="flex items-center gap-1.5 text-xs text-foreground/80">
                    <BadgeCheck size={13} className="text-gold" />
                    三重验证 <span className="cjk-latin text-gold">{done}/3</span>
                  </span>
                  {done < 3 ? (
                    <Link to="/verify" className="text-xs text-primary transition hover:text-primary/80">去完成 →</Link>
                  ) : (
                    <span className="text-xs text-gold">已完备</span>
                  )}
                </div>
              </div>
            )
          })()}
          <div className="card-cn rounded-lg p-4 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-foreground">
              <Trophy size={15} className="text-gold" />
              缘阶与成就
              <Link to="/badges" className="ml-auto text-xs font-normal text-primary transition hover:text-primary/80">去点亮 →</Link>
            </p>
            <div className="mt-3 flex items-center gap-2.5">
              <LevelSeal user={me} />
              <p className="text-xs text-muted-foreground">
                已点亮 <span className="cjk-latin text-gold">{lv.lit}</span> 枚成就
                {lv.next ? <> · 再 <span className="cjk-latin">{lv.next.min - lv.lit}</span> 枚至「{lv.next.name}」</> : ' · 已至最高阶'}
              </p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">上传照片、完成验证、报名活动……每一步真诚的靠近,都会化作一枚勋章。</p>
          </div>
          <div className="card-cn rounded-lg p-4 text-sm">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <EyeOff size={15} className="text-gold" />
              访客隐身
              <button
                role="switch"
                aria-checked={stealth}
                onClick={() => {
                  update({ stealth: !stealth })
                  toast(stealth ? '已关闭隐身,来访将留下足迹' : '已开启隐身,来去不留痕')
                }}
                className={cn(
                  'ml-auto flex h-5 w-9 items-center rounded-full border p-0.5 transition',
                  stealth ? 'justify-end border-gold bg-gold/30' : 'justify-start border-border bg-secondary',
                )}
              >
                <span className={cn('h-3.5 w-3.5 rounded-full transition', stealth ? 'bg-gold' : 'bg-muted-foreground/40')} />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {stealth
                ? '隐身中:浏览他人资料不留足迹;作为交换,你也看不到谁看过你。'
                : '开启后浏览他人资料不留足迹。作为交换,你也将看不到谁看过你。'}
            </p>
            <div className="mt-3 border-t border-border pt-3">
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                <KeyRound size={15} className="text-gold" />
                账号安全
                <span className="cjk-latin ml-auto max-w-36 truncate text-xs font-normal text-muted-foreground">{account?.email}</span>
              </p>
              {pwdOpen ? (
                <div className="mt-3 space-y-2">
                  <input type="password" className="input-cn" placeholder="旧密码" value={oldPwd} onChange={e => setOldPwd(e.target.value)} />
                  <input type="password" className="input-cn" placeholder="新密码(至少 8 位)" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
                  <input type="password" className="input-cn" placeholder="再输一次新密码" value={newPwd2} onChange={e => setNewPwd2(e.target.value)} />
                  <div className="flex gap-2">
                    <button
                      className="btn-primary flex-1 !py-2 text-xs disabled:opacity-50"
                      disabled={pwdBusy}
                      onClick={() => {
                        if (newPwd !== newPwd2) {
                          toast('两次输入的新密码不一致')
                          return
                        }
                        setPwdBusy(true)
                        changeAccountPassword(oldPwd, newPwd)
                          .then(() => {
                            toast.success('密码已修改,请用新密码重新登录')
                            setPwdOpen(false)
                            setOldPwd('')
                            setNewPwd('')
                            setNewPwd2('')
                            // v1.8: 改密后旧令牌即时失效, 留出提示时间后登出引导重新登录
                            setTimeout(() => logoutLocalAccount(), 1200)
                          })
                          .catch((e: unknown) => {
                            const raw = e instanceof Error ? e.message : String(e)
                            toast.error(/old/i.test(raw) ? '旧密码不正确' : /short/i.test(raw) ? '密码至少 8 位' : '修改未成功,请稍后再试')
                          })
                          .finally(() => setPwdBusy(false))
                      }}
                    >
                      {pwdBusy ? '请稍候…' : '确认修改'}
                    </button>
                    <button className="btn-outline !py-2 text-xs" onClick={() => setPwdOpen(false)}>取消</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">登录邮箱即你的账号;定期换密码更安心。</p>
                  <button className="btn-outline mt-3 w-full !py-2" onClick={() => setPwdOpen(true)}>修改密码</button>
                </>
              )}
            </div>
          </div>
          <div className="card-cn rounded-lg p-4 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-foreground">
              <Ban size={15} className="text-gold" />
              黑名单
              <span className="ml-auto text-xs font-normal text-muted-foreground">{blocks.length ? `${blocks.length} 人` : '空着'}</span>
            </p>
            {blocks.length ? (
              <div className="mt-3 space-y-2">
                {blocks.map(id => {
                  const u = users.find(x => x.id === id)
                  if (!u) return null
                  return (
                    <div key={id} className="flex items-center gap-2.5 rounded-md border border-border bg-secondary/40 p-2">
                      <img src={u.photos[0]} alt={u.nickname} className="h-9 w-9 shrink-0 rounded-full object-cover opacity-80" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{u.nickname}</p>
                        <p className="text-[11px] text-muted-foreground">{regionOf(u)} · {u.job}</p>
                      </div>
                      <button
                        className="btn-outline shrink-0 !px-2.5 !py-1 text-[11px]"
                        onClick={() => {
                          toggleBlock(id)
                          toast('已解除拉黑,缘或可重来')
                        }}
                      >
                        解除
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">黑名单空着,世界和你都温柔。</p>
            )}
          </div>
        </div>

        <div className="space-y-8">
          <TaskBoard />
          <section className="card-cn rounded-lg p-5 md:p-6">
            <h2 className="mb-1 flex items-center gap-2 font-xing text-2xl text-foreground">
              <Eye size={18} className="text-gold" />
              谁看过我
              <Link to="/report" className="ml-auto text-xs font-normal text-primary transition hover:text-primary/80">缘分周报 →</Link>
            </h2>
            <p className="mb-4 text-xs text-muted-foreground">留意你的眼光,也许正藏着一份心意 · 点头像看资料,顺手回个招呼</p>
            {stealth ? (
              <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">
                隐身模式已开启——你悄悄看世界,世界也不知你来看过。关闭隐身即可查看访客。
              </p>
            ) : visitors.length ? (
              <div className="space-y-2">
                {(allVisitors ? visitors : visitors.slice(0, 8)).map(({ user, at }) => (
                  <div key={user.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/40 p-2.5 transition hover:border-gold/50">
                    <button className="shrink-0 transition hover:opacity-80" onClick={() => setProfile(user)} aria-label="查看资料">
                      <AvatarFrame user={user} className="h-10 w-10">
                        <img src={user.photos[0]} alt={user.nickname} className="h-full w-full rounded-full object-cover" />
                      </AvatarFrame>
                    </button>
                    <div className="min-w-0 flex-1">
                      <button className="block truncate text-sm font-semibold text-foreground transition hover:text-primary" onClick={() => setProfile(user)}>
                        <NickName user={user} className="block truncate" />
                      </button>
                      {visitedByMe.has(user.id) && (
                        <span className="mt-0.5 inline-block rounded-sm bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold">互访 · 你也去过 TA 的主页</span>
                      )}
                      <p className="text-[11px] text-muted-foreground">{regionOf(user)} · {user.job} · {fmtTime(at)}来过</p>
                    </div>
                    <button
                      className="btn-outline shrink-0 !px-3 !py-1.5 text-xs"
                      onClick={() => {
                        sendChat(user.id, `你好,看到你来过我的主页,也算一种缘分 ☺`)
                        toast.success('招呼已送达')
                      }}
                    >
                      <MessageCircleHeart size={13} />
                      回个招呼
                    </button>
                  </div>
                ))}
                {visitors.length > 8 && (
                  <button
                    className="mt-1 w-full text-center text-[11px] text-primary transition hover:text-primary/80"
                    onClick={() => setAllVisitors(v => !v)}
                  >
                    {allVisitors ? '收起,只看最近 8 位' : `查看全部 ${visitors.length} 位访客`}
                  </button>
                )}
              </div>
            ) : (
              <p className="rounded-md bg-secondary/40 p-6 text-center text-sm text-muted-foreground">
                还没有访客。完善资料、点亮验证徽章,会让更多人想点进来看你。
              </p>
            )}
          </section>
          <section className="card-cn rounded-lg p-5 md:p-6">
            <h2 className="mb-4 font-xing text-2xl text-foreground">我的照片</h2>
            <PhotoManager />
          </section>
          <section className="card-cn rounded-lg p-5 md:p-6">
            <h2 className="mb-4 font-xing text-2xl text-foreground">基础资料</h2>
            <EditForm />
          </section>
        </div>
      </div>

      <DetailDialog user={profile} onClose={() => setProfile(null)} />
    </div>
  )
}
