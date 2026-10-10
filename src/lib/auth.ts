// 随缘网独立版会话适配：集中暴露 Node API 所需的认证头和登录跳转。
// 注册登录及授权状态由 localAuth.ts 维护，数据保存在本站 Neon 业务库。
export {
  localAuthHeaders as getAuthHeaders,
  redirectToLocalLogin as redirectToLogin,
} from './localAuth'

// 与历史 UI 契约兼容；独立站点不使用第三方钱包计费。
export const visitorPaysForAi = false
