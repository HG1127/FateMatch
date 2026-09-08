// 管理后台「数据维护」用的只读盘点与备份导出。
// 逐表向 PocketBase 拉取, 当前账号读不到的表自动跳过, 不影响其余表。
import { pb } from './pb'

export interface DataStat {
  name: string
  label: string
  /** null = 该表当前账号无读取权限, 不计入合计 */
  count: number | null
}

export const DATA_TABLES: Array<{ name: string; label: string }> = [
  { name: 'profiles', label: '会员资料' },
  { name: 'users', label: '登录账号' },
  { name: 'posts', label: '社区帖子' },
  { name: 'post_comments', label: '帖子评论' },
  { name: 'events', label: '线下活动' },
  { name: 'event_comments', label: '活动留言' },
  { name: 'digests', label: '每周精选' },
  { name: 'chat_messages', label: '私聊消息' },
  { name: 'user_likes', label: '心动记录' },
  { name: 'user_passes', label: '跳过记录' },
  { name: 'user_reads', label: '走访足迹' },
  { name: 'visits', label: '主页走访' },
  { name: 'favorites', label: '收藏' },
  { name: 'fav_groups', label: '收藏分组' },
  { name: 'checkins', label: '活动签到' },
  { name: 'reminders', label: '活动提醒' },
  { name: 'contacts', label: '联系方式' },
  { name: 'blocks', label: '拉黑' },
  { name: 'reports', label: '举报' },
  { name: 'admin_logs', label: '运营日志' },
  { name: 'site_settings', label: '站点设置' },
  { name: 'user_tour', label: '新手引导' },
]

export async function countTables(): Promise<DataStat[]> {
  return Promise.all(
    DATA_TABLES.map(async t => {
      try {
        const res = await pb.collection(t.name).getList(1, 1)
        return { ...t, count: res.totalItems }
      } catch {
        return { ...t, count: null }
      }
    }),
  )
}

/** 导出全部可读表为 JSON 备份并触发下载; 返回导出的记录数与被跳过的表名 */
export async function exportBackup(): Promise<{ total: number; failed: string[] }> {
  const data: Record<string, unknown[]> = {}
  const failed: string[] = []
  for (const t of DATA_TABLES) {
    try {
      data[t.name] = await pb.collection(t.name).getFullList()
    } catch {
      failed.push(t.label)
    }
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    source: '随缘网·掌柜后台备份',
    tables: data,
  }
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `suiyuan-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  return { total: Object.values(data).reduce((s, r) => s + r.length, 0), failed }
}
