// Supabase 快照同步：把应用数据服务里的全量数据打成一份 JSON 快照，
// 上传到自建 Supabase 的存储桶里，作为可带走的备份。
//
// 用法（容器内）：
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON=<anon key> \
//   SUPABASE_BUCKET=suiyuan-backup \
//   PB_ADMIN=<管理邮箱> PB_PASS=<管理密码> \
//   node scripts/supabase-sync.mjs [--dry]
//
// --dry 只读本地数据并打印规模，不上传。密钥一律走环境变量，不落盘不进前端。
const PB = process.env.PB_URL ?? 'http://127.0.0.1:7000'
const DRY = process.argv.includes('--dry')

const STRIP_FIELDS = ['tokenKey'] // 会话签名相关字段不进备份

async function pbJson(path, token, init) {
  const res = await fetch(`${PB}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  const admin = process.env.PB_ADMIN
  const pass = process.env.PB_PASS
  if (!admin || !pass) throw new Error('缺少 PB_ADMIN / PB_PASS 环境变量')

  const auth = await pbJson('/api/collections/_superusers/auth-with-password', null, {
    method: 'POST',
    body: JSON.stringify({ identity: admin, password: pass }),
  })
  const token = auth.token

  const cols = await pbJson('/api/collections?perPage=200', token)
  const names = cols.items
    .map((c) => c.name)
    .filter((n) => !n.startsWith('_')) // 跳过头部系统表，users 与业务表全要

  const snapshot = { generatedAt: new Date().toISOString(), collections: {} }
  for (const name of names) {
    const rows = []
    for (let page = 1; ; page++) {
      const batch = await pbJson(
        `/api/collections/${name}/records?perPage=500&page=${page}`,
        token,
      )
      for (const r of batch.items) {
        for (const f of STRIP_FIELDS) delete r[f]
        rows.push(r)
      }
      if (page >= batch.totalPages) break
    }
    snapshot.collections[name] = rows
    console.log(`  ${name}: ${rows.length} 行`)
  }

  const body = JSON.stringify(snapshot)
  const kB = (Buffer.byteLength(body) / 1024).toFixed(1)
  console.log(`快照共 ${names.length} 张表 / ${kB} kB`)
  if (DRY) {
    console.log('--dry：未上传')
    return
  }

  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON
  const bucket = process.env.SUPABASE_BUCKET
  if (!url || !anon || !bucket) throw new Error('缺少 SUPABASE_URL / SUPABASE_ANON / SUPABASE_BUCKET')

  const key = `suiyuan/snapshot-${snapshot.generatedAt.replace(/[:.]/g, '-')}.json`
  const up = await fetch(`${url}/storage/v1/object/${bucket}/${key}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body,
  })
  if (!up.ok) throw new Error(`上传失败 ${up.status} ${await up.text()}`)
  console.log(`已上传：${bucket}/${key}`)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
