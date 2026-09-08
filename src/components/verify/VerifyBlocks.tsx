import { useRef, useState } from 'react'
import { BadgeCheck, Camera, PhoneCall, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { readImageFile, useStore } from '@/lib/store'

const DEMO_CODE = '520131'

function DoneNote({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-gold">
      <BadgeCheck size={16} />
      {text}
    </p>
  )
}

export function PhoneCard() {
  const { me, setVerify } = useStore()
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  if (!me) return null
  if (me.verification.phone) return <DoneNote text={`已验证 · ${me.phone.slice(0, 3)}****${me.phone.slice(7)}`} />

  const verify = () => {
    if (code.trim() !== DEMO_CODE) {
      toast.error('验证码不正确')
      return
    }
    setVerify('phone')
    toast.success('手机验证完成')
  }

  return (
    <div className="space-y-3">
      {!sent ? (
        <button
          className="btn-outline"
          onClick={() => {
            setSent(true)
            toast.success(`验证码已发送(演示环境验证码 ${DEMO_CODE})`)
          }}
        >
          <PhoneCall size={15} />
          发送短信验证码
        </button>
      ) : (
        <div className="flex gap-2">
          <input
            className="input-cn"
            placeholder={`输入验证码(演示 ${DEMO_CODE})`}
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && verify()}
          />
          <button className="btn-primary shrink-0" onClick={verify}>
            验证
          </button>
        </div>
      )}
    </div>
  )
}

export function RealnameCard() {
  const { me, setVerify } = useStore()
  const [name, setName] = useState('')
  const [idNo, setIdNo] = useState('')
  const [checking, setChecking] = useState(false)
  if (!me) return null
  if (me.verification.realname) return <DoneNote text="已验证 · 真实姓名与证件一致" />

  return (
    <div className="space-y-3">
      <input className="input-cn" placeholder="真实姓名" value={name} onChange={e => setName(e.target.value)} />
      <input className="input-cn" placeholder="身份证号(仅用于验证,加密保存)" value={idNo} onChange={e => setIdNo(e.target.value)} />
      <button
        className="btn-primary"
        disabled={checking}
        onClick={() => {
          if (name.trim().length < 2) return toast.error('请填写真实姓名')
          if (!/^\d{17}[\dXx]$/.test(idNo.trim())) return toast.error('身份证号格式不正确')
          setChecking(true)
          setTimeout(() => {
            setVerify('realname')
            toast.success('实名验证完成')
          }, 900)
        }}
      >
        <ShieldCheck size={15} />
        {checking ? '核验中…' : '提交核验'}
      </button>
    </div>
  )
}

export function PhotoCard() {
  const { me, setVerify } = useStore()
  const [preview, setPreview] = useState('')
  const [checking, setChecking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  if (!me) return null
  if (me.verification.photo) return <DoneNote text="已验证 · 本人与头像一致" />

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async e => {
          const file = e.target.files?.[0]
          if (!file) return
          try {
            setPreview(await readImageFile(file, 500))
          } catch {
            toast.error('图片读取失败,请换一张')
          }
        }}
      />
      {preview && <img src={preview} alt="验证照预览" className="h-28 w-28 rounded-md border border-border object-cover" />}
      <div className="flex gap-2">
        <button className="btn-outline" onClick={() => inputRef.current?.click()}>
          <Camera size={15} />
          {preview ? '重拍一张' : '上传本人近照'}
        </button>
        {preview && (
          <button
            className="btn-primary"
            disabled={checking}
            onClick={() => {
              setChecking(true)
              setTimeout(() => {
                setVerify('photo')
                toast.success('头像验证完成,徽章已点亮')
              }, 1200)
            }}
          >
            {checking ? '人脸比对中…' : '提交比对'}
          </button>
        )}
      </div>
    </div>
  )
}
