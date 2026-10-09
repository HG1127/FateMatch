export const PB_USER_AUTH_HEADER = 'X-Pb-Auth'

export function isDirectPbHostName(host: string): boolean {
  return host === 'localhost' || host === '[::1]' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

export function pbAuthHeaderForHost(
  token: string | null | undefined,
  host: string,
): Record<string, string> {
  if (!token) return {}
  return isDirectPbHostName(host)
    ? { Authorization: token }
    : { [PB_USER_AUTH_HEADER]: token }
}
