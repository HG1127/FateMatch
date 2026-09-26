import { BadgeCheck } from 'lucide-react'
import { useStore } from '@/lib/store'

function DoneNote({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-gold">
      <BadgeCheck size={16} />
      {text}
    </p>
  )
}

function PendingNote({ text }: { text: string }) {
  return <p className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{text}</p>
}

export function PhoneCard() {
  const { me } = useStore()
  if (!me) return null
  if (me.verification.phone) return <DoneNote text="已记录 · 手机核验状态" />
  return <PendingNote text="短信核验服务尚未接入。本版本不会使用固定验证码或模拟流程点亮核验状态。" />
}

export function RealnameCard() {
  const { me } = useStore()
  if (!me) return null
  if (me.verification.realname) return <DoneNote text="已记录 · 身份核验状态" />
  return <PendingNote text="身份核验流程尚未开通。为避免无必要收集敏感证件信息，本版本暂不提交身份证号码。" />
}

export function PhotoCard() {
  const { me } = useStore()
  if (!me) return null
  if (me.verification.photo) return <DoneNote text="已记录 · 本人照片核验状态" />
  return <PendingNote text="本人照片核验服务尚未接入。本版本不会用延时动画模拟人脸比对，也不会为此额外收集核验照。" />
}
