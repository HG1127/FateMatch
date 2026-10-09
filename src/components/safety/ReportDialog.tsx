import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/lib/store-context'
import type { User } from '@/lib/store'
import { Modal } from '@/components/ui'
import { cn } from '@/lib/utils'
import { REPORT_REASONS } from '@/lib/store-model'

export function ReportDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { reportUser } = useStore()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!user) return null

  const submit = async () => {
    if (!reason) return toast.error('请先选择举报原因')
    if (submitting) return
    setSubmitting(true)
    try {
      const id = await reportUser(user.id, reason, note.trim())
      toast.success(`举报已受理 · 编号 ${id}`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '举报未提交成功,请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-5 md:p-6">
        <p className="flex items-center gap-2 font-xing text-2xl text-foreground">
          <ShieldCheck size={20} className="text-gold" />
          举报 {user.nickname}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">感谢你的反馈。提交成功后会生成受理编号；处理进度与结果以平台实际状态为准，举报内容不会作为公开资料展示给对方。</p>
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
          maxLength={1000}
        />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button className="btn-outline !py-2.5" onClick={onClose}>再想想</button>
          <button className="btn-primary !py-2.5 disabled:opacity-50" disabled={submitting} onClick={() => void submit()}>{submitting ? '提交中…' : '提交举报'}</button>
        </div>
      </div>
    </Modal>
  )
}
