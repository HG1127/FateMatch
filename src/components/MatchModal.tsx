import { Link } from 'react-router-dom'
import { MessageCircleHeart } from 'lucide-react'
import { Modal } from '@/components/ui'
import type { User } from '@/lib/store'

export function MatchModal({ user, open, onClose }: { user: User | null; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="clouds-red rounded-lg p-8 text-center text-primary-foreground">
        <span className="seal mx-auto flex h-16 w-16 font-xing text-3xl animate-seal-stamp">囍</span>
        <h3 className="mt-5 font-xing text-3xl">天作之合</h3>
        <p className="mt-3 text-sm text-primary-foreground/80">
          你与 <span className="font-xing text-lg text-gold-soft">{user?.nickname}</span> 彼此有意,
          <br />
          缘分已至,不妨道一声问候。
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/matches" className="btn-gold" onClick={onClose}>
            <MessageCircleHeart size={16} />
            前去问好
          </Link>
          <button className="btn-cn border border-gold-soft/50 px-5 py-2.5 text-gold-soft hover:bg-red-ink/40" onClick={onClose}>
            再看看
          </button>
        </div>
      </div>
    </Modal>
  )
}
