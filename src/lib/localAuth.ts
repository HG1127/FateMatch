// 自建账号登录实现（auth 槽位提供方）。账号存应用自己的 PocketBase `users`
// 认证集合，注册/登录/会话全部走 `./pb` 的 __pb 代理，无外部账号体系依赖。
//
// 会话由 PocketBase SDK 的 authStore 管理（localStorage 持久化 + 自动携带
// Authorization），业务代码禁止自己存取 token。
//
// 注意：只在函数体内使用 pb（pb.ts ← auth.ts ← 本文件 存在模块环，模块顶层
// 取 pb 会拿到未初始化的绑定）。

import { pb, getBasename } from "./pb"

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
  name?: string,
): Promise<LocalAccount> {
  await pb.collection("users").create({
    email,
    password,
    passwordConfirm: password,
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

// 跳应用自己的登录页（/login 路由由写页技能负责创建）。
// 用 getBasename 拼前缀：AccountMenu 在 Router 外也能安全调用。
export function redirectToLocalLogin(): void {
  const base = getBasename()
  window.location.assign(`${base === "/" ? "" : base}/login`)
}

// auth.ts 稳定契约的绑定来源：未登录返回 {}，可安全展开进任意 headers。
// PocketBase SDK 自身请求会自动带 authStore token，这里主要供平台 lib 的
// 裸 fetch（/api/aigc、/api/llm 等服务端路由按此识别当前用户）。
//
// 线上网关(VcAuthFilter)会把 Authorization 头一律当 RH 令牌校验，PB token 走
// Authorization 会被网关 401 (TOKEN_INVALID) 拒掉。因此经 control 代理的部署
// 形态一律改走 X-Pb-Auth，由 control 转发 PB 前还原成 Authorization（与
// scaffold pb.ts 的 beforeSend 同一套约定；此处刻意不 import pb.ts 的新导出，
// 保证本能力文件单独同步进老 app 也能编译）。本地直连 PB 时保持原样。
export function localAuthHeaders(): Record<string, string> {
  if (!pb.authStore.isValid || !pb.authStore.token) return {}
  const host = typeof window === "undefined" ? "" : window.location.hostname
  const directPb = host === "localhost" || host === "[::1]" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
  return directPb
    ? { Authorization: pb.authStore.token }
    : { "X-Pb-Auth": pb.authStore.token }
}
