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
        if (pwd !== pwd2) {
          toast('两次输入的密码不一致')
          return
        }
        await registerLocalAccount(em, pwd, name.trim() || undefined)
        toast.success('注册成功,欢迎来到随缘网')
        nav('/')
      } else {
        await loginLocalAccount(em, pwd)
        toast.success('登录成功,别来无恙')
        nav(params.get('from') || '/')
      }
    } catch (e) {
      toast.error(mode === 'register' ? regMsg(e) : '邮箱或密码不正确')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="clouds-paper mx-auto max-w-2xl px-4 py-12 md:py-16">
      <div className="mb-8 text-center">
        <span className="seal mx-auto mb-4 flex h-14 w-14 font-xing text-2xl">缘</span>
        <h1 className="font-xing text-4xl text-foreground">{mode === 'register' ? '加入随缘网' : '别来无恙'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === 'register' ? '用邮箱建一个账号,数据随身不丢' : '登录随缘网,继续你的缘分'}
        </p>
      </div>

      <div className="card-cn rounded-lg p-6 md:p-8">
        <div className="mb-6 grid grid-cols-2 rounded-md border border-border p-1 text-center text-sm">
          {(['login', 'register'] as const).map(m => (
            <button
              key={m}
              onClick={() => setParams(m === 'register' ? { mode: 'register' } : {})}
              className={cn('rounded px-4 py-2 transition', mode === m ? 'bg-primary font-semibold text-primary-foreground shadow-card' : 'text-foreground/60 hover:text-foreground')}
            >
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <input className="input-cn" type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} />
          {mode === 'register' && (
            <input className="input-cn" placeholder="昵称(可不填,默认为邮箱前缀)" value={name} onChange={e => setName(e.target.value)} maxLength={12} />
          )}
          <input
            className="input-cn"
            type="password"
            placeholder={mode === 'register' ? '密码(至少 8 位)' : '密码'}
            value={pwd}
            onChange={e => setPwd(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void submit()}
          />
          {mode === 'register' && (
            <input
              className="input-cn"
              type="password"
              placeholder="再输一次密码"
              value={pwd2}
              onChange={e => setPwd2(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void submit()}
            />
          )}
          {mode === 'register' && (
            <p className="text-[11px] text-muted-foreground">首个注册的账号将成为掌柜,可进入后台打理全站。</p>
          )}
          <button className="btn-primary w-full !py-2.5 disabled:opacity-50" disabled={busy} onClick={() => void submit()}>
            {busy ? '请稍候…' : mode === 'register' ? '注册并登录' : '登录'}
          </button>
        </div>
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">随缘网仅面向 18 周岁以上成年人 · 资料隐私全程保护</p>
    </div>
  )
}
