import PocketBase, { LocalAuthStore } from 'pocketbase'
import { authorizationHeaders } from './pb-auth'

/**
 * 独立版始终通过浏览器同源 /api 访问自建 Node 网关。
 * PocketBase SDK 只是 HTTP 与会话客户端，不需要 VibeX 或 PocketBase 服务端。
 */
export function getPocketBaseUrl(): string {
  return typeof window === 'undefined' ? 'http://127.0.0.1' : window.location.origin
}

// 延续已运行的独立版存储键，避免升级时丢失测试会话。
export const pb = new PocketBase(getPocketBaseUrl(), new LocalAuthStore('pb_auth_local'))

export const pbAuthHeader = authorizationHeaders
