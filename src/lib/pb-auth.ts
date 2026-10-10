/** 自建同源 Node API 使用标准 Authorization，无需平台私有 X-Pb-Auth。 */
export function authorizationHeaders(token?: string | null): Record<string, string> {
  return token ? { Authorization: token } : {}
}
