// 平台账号 / 登录抽象层（auth 槽位的前端稳定契约）。
//
// aigc / llm / pb 等平台 lib 一律从本文件取鉴权能力，**不要**直接 import 具体
// 登录实现 —— 更换登录提供方时只需替换本文件的绑定，其余平台 lib 零改动。
//
// 稳定契约（任何登录提供方都必须实现并在此绑定）：
//   getAuthHeaders(): Record<string, string>  请求鉴权头（未登录返回 {}，可安全展开）
//   redirectToLogin(): void                   触发登录流程
//   visitorPaysForAi: boolean                 访客是否为 AI 调用付费（决定计费确认弹窗）
//
// 页面顶部的账号入口组件（组件名约定以 AccountMenu 结尾）由登录能力自带，
// import 语句见对应登录写页技能 / 安装工具返回值，不经过本文件。
//
// 当前绑定：自建账号注册登录（localAuth.ts，PocketBase users 集合）。
export {
  localAuthHeaders as getAuthHeaders,
  redirectToLocalLogin as redirectToLogin,
} from "./localAuth"

// 自建账号：访客没有 RH 账号，AI 调用走 owner 计费（创作者买单），
// 访客侧不该看到"消耗 RH 币/钱包余额"的确认弹窗（useCostConfirm 会自动跳过）。
export const visitorPaysForAi = false
