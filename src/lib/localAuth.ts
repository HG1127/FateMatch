// 独立版账号：自建 Node 网关 + Neon PostgreSQL，SDK 只是客户端兼容层。
// 注册、登录、注销均走同源 /api；会话由 SDK authStore 管理。
import { pb } from './pb'
import { authorizationHeaders } from './pb-auth'
export interface LocalAccount {
  id: string
  email: string
  name: string
  avatarUrl?: string
}

function toAccount(record: Record<string, unknown> | null): LocalAccount | null {
  if (!record || typeof record.id !== "string") return null
  return {
    id: record.id,
    email: typeof record.email === "string" ? record.email : "",
    name: typeof record.name === "string" && record.name ? record.name : String(record.email ?? ""),
    avatarUrl: typeof record.avatar === "string" && record.avatar
      ? pb.files.getURL(record as { [k: string]: unknown; id: string; collectionId?: string }, record.avatar as string)
      : undefined,
  }
}

export function getLocalAccount(): LocalAccount | null {
  return pb.authStore.isValid ? toAccount(pb.authStore.record as Record<string, unknown> | null) : null
}

// 订阅登录态变化（含跨标签页）；返回取消订阅函数。fireImmediately=true 会先回调当前态。
export function onLocalAccountChange(
  cb: (account: LocalAccount | null) => void,
  fireImmediately = true,
): () => void {
  return pb.authStore.onChange(() => cb(getLocalAccount()), fireImmediately)
}

// 注册并自动登录。PocketBase 默认密码 ≥8 位；email 重复等错误会 throw，
// 调用方须转成产品语提示（不要把原始报错抛给用户）。
export async function registerLocalAccount(
  email: string,
  password: string,
  name: string | undefined,
  adultConfirmed: boolean,
): Promise<LocalAccount> {
  await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
    adultConfirmed,
    ...(name ? { name } : {}),
  })
  return loginLocalAccount(email, password)
}

export async function loginLocalAccount(email: string, password: string): Promise<LocalAccount> {
  await pb.collection("users").authWithPassword(email, password)
  const account = getLocalAccount()
  if (!account) throw new Error("login succeeded but auth store is empty")
  return account
}

export function logoutLocalAccount(): void {
  pb.authStore.clear()
}

/** 永久注销当前账号。服务端会在同一事务中清理本人资料与本人拥有的业务数据。 */
export async function deleteLocalAccount(): Promise<void> {
  const account = getLocalAccount()
  if (!account) throw new Error('请先登录')
  await pb.collection('users').delete(account.id)
  pb.authStore.clear()
}

// 账号菜单即使处于 Router 外，仍能进入独立站点的登录页面。
export function redirectToLocalLogin(): void {
  window.location.assign('/auth')
}
// 非 SDK 裸 fetch 也使用同一标准 Authorization 头。
export function localAuthHeaders(): Record<string, string> {
  return pb.authStore.isValid ? authorizationHeaders(pb.authStore.token) : {}
}