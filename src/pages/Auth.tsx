import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { loginLocalAccount, registerLocalAccount } from '@/lib/localAuth'
import { cn } from '@/lib/utils'

/** SDK 原始报错一律转产品语 */
const regMsg = (e: unknown) => {
  const raw = e instanceof Error ? e.message : String(e)
  if (/exists|already/i.test(raw)) return '该邮箱已注册,试试直接登录'
  if (/short/i.test(raw) || /at least 8/i.test(raw)) return '密码至少 8 位'
  return '注册未成功,请稍后再试'
}

export function AuthPage() {
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'register' ? 'register' : 'login'
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [adultConfirmed, setAdultConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const em = email.trim()
    if (!em || !pwd) {
      toast('邮箱和密码都要填写')
      return
    }
    if (busy) return
    setBusy(true)
    try {
      if (mode === 'register') {
        if (!adultConfirmed) {
          toast('请先确认已满 18 周岁')
          return
        }
        if (pwd !== pwd2) {
          toast('两次输入的密码不一致')
          return
        }
        await registerLocalAccount(em, pwd, name.trim() || undefined, adultConfirmed)
        toast.success('注册成功,欢迎来到随缘网')
        nav('/me')
      } else {
        await loginLocalAccount(em, pwd)
        toast.success('登录成功,别来无恙')
        const from = params.get('from') || '/'
        nav(from.startsWith('/') && !from.startsWith('//') && !from.includes('\\') ? from : '/')
      }
    } catch (e) {
      // 限流/锁定(429)与账号停用(403)透出服务端的具体提示，其余保持产品语兜底
      const err = e as { status?: number; message?: string }
      if ((err?.status === 429 || err?.status === 403) && err.message) toast.error(err.message)
      else toast.error(mode === 'register' ? regMsg(e) : '邮箱或密码不正确')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="clouds-paper mx-auto max-w-2xl px-4 py-7 sm:py-12 md:py-16">
      <div className="mb-6 text-center sm:mb-8">
        <span className="seal mx-auto mb-4 flex h-14 w-14 font-xing text-2xl">缘</span>
        <h1 className="font-xing text-4xl text-foreground">{mode === 'register' ? '加入随缘网' : '别来无恙'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === 'register' ? '用邮箱建一个账号,数据随身不丢' : '登录随缘网,继续你的缘分'}
        </p>
      </div>

      <div className="card-cn rounded-xl p-4 sm:p-6 md:p-8">
        <div className="mb-6 grid grid-cols-2 rounded-md border border-border p-1 text-center text-sm">
          {(['login', 'register'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setParams(m === 'register' ? { mode: 'register' } : {})}
              aria-pressed={mode === m}
              className={cn('min-h-11 rounded px-4 py-2 transition', mode === m ? 'bg-primary font-semibold text-primary-foreground shadow-card' : 'text-foreground/60 hover:text-foreground')}
            >
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>
        <form className="space-y-4 sm:space-y-3" onSubmit={e => { e.preventDefault(); void submit() }}>
          <label className="block text-left">
            <span className="mb-1.5 block text-xs font-semibold tracking-wider text-foreground/70">邮箱</span>
            <input className="input-cn" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} enterKeyHint="next" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          {mode === 'register' && (
            <label className="block text-left">
              <span className="mb-1.5 block text-xs font-semibold tracking-wider text-foreground/70">昵称（可稍后修改）</span>
              <input className="input-cn" autoComplete="nickname" placeholder="不填则使用邮箱前缀" value={name} onChange={e => setName(e.target.value)} maxLength={12} />
            </label>
          )}
          <label className="block text-left">
            <span className="mb-1.5 block text-xs font-semibold tracking-wider text-foreground/70">密码</span>
            <input
              className="input-cn"
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              placeholder={mode === 'register' ? '至少 8 位' : '输入密码'}
              value={pwd}
              onChange={e => setPwd(e.target.value)}
              enterKeyHint={mode === 'register' ? 'next' : 'go'}
            />
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground"><input type="checkbox" className="h-5 w-5 accent-primary" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} />显示密码</label>
          {mode === 'register' && (
            <label className="block text-left">
              <span className="mb-1.5 block text-xs font-semibold tracking-wider text-foreground/70">确认密码</span>
              <input
                className="input-cn"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="再次输入密码"
                value={pwd2}
                onChange={e => setPwd2(e.target.value)}
                enterKeyHint="go"
              />
            </label>
          )}
          {mode === 'register' && (
            <label className="flex min-h-14 items-start gap-3 rounded-md border border-border bg-secondary/40 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-primary" checked={adultConfirmed} onChange={e => setAdultConfirmed(e.target.checked)} />
              <span>我确认已满 18 周岁，并理解注册后仍需本人确认必要资料才会进入推荐池。</span>
            </label>
          )}
          <button type="submit" className="btn-primary min-h-12 w-full !py-2.5 text-base disabled:opacity-50" disabled={busy}>
            {busy ? '请稍候…' : mode === 'register' ? '注册并继续完善资料' : '登录'}
          </button>
        </form>
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">随缘网仅面向 18 周岁以上成年人 · 核验与隐私范围以实际功能和规则为准</p>
    </div>
  )
}
