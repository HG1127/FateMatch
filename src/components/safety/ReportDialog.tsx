import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { REPORT_REASONS, useStore } from '@/lib/store'
import type { User } from '@/lib/store'
import { Modal } from '@/components/ui'
import { cn } from '@/lib/utils'

export function ReportDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { reportUser } = useStore()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  if (!user) return null

  const submit = () => {
    if (!reason) return toast.error('请先选择举报原因')
    reportUser(user.id, reason, note.trim())
    toast.success('举报已提交,我们会在 24 小时内核查处理')
    onClose()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-5 md:p-6">
        <p className="flex items-center gap-2 font-xing text-2xl text-foreground">
          <ShieldCheck size={20} className="text-gold" />
          举报 {user.nickname}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">感谢你的认真。每一条举报都会被人工核查,你的隐私不会泄露给对方。</p>
        <div className="mt-4 space-y-2">
          {REPORT_REASONS.map(r => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={cn(
                'w-full rounded-md border px-3 py-2.5 text-left text-sm transition',
                reason === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground/80 hover:border-primary/40',
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          className="input-cn mt-3 min-h-16 resize-y"
          placeholder="补充说明(选填):发生了什么,让我们更快查清"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button className="btn-outline !py-2.5" onClick={onClose}>再想想</button>
          <button className="btn-primary !py-2.5" onClick={submit}>提交举报</button>
        </div>
      </div>
    </Modal>
  )
}
