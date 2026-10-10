// Fail closed before opening a local development API listener.
// Validate the dedicated staging database identity, not only an arbitrary staging_* schema.
export function assertIsolatedLocalDev(env) {
  if (env.STAGING_MODE !== '1') {
    throw new Error('独立版本地开发必须设置 STAGING_MODE=1')
  }
  const schema = String(env.NEON_SCHEMA ?? '')
  if (!/^staging_[a-z0-9_]{3,48}$/.test(schema) || schema === 'staging_public') {
    throw new Error('NEON_SCHEMA 必须使用独立的 staging_* schema，不能指向 public')
  }
  let uri
  try { uri = new URL(String(env.NEON_DSN ?? '')) } catch {
    throw new Error('需配置合法的 Staging Neon 数据库连接串')
  }
  if (!['postgresql:', 'postgres:'].includes(uri.protocol) ||
      !uri.hostname.toLowerCase().endsWith('.neon.tech') ||
      decodeURIComponent(uri.pathname) !== '/suiyuan_staging' ||
      decodeURIComponent(uri.username) !== 'suiyuan_staging_owner') {
    throw new Error('本地开发只能使用独立 suiyuan_staging 数据库和其专用账号，禁止生产数据库')
  }
}
