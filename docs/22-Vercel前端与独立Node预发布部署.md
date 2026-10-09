# 随缘网｜方案 A：Vercel 前端 + 独立 Node 后端（Staging）

更新：2026-10-09
状态：源代码分离部署**适配方案与测试**。在未确认 Vercel 授权、独立后端 HTTPS 域名和专用 Neon 数据库之前，**没有正式公网部署**；不要将此目录中的假设域名冒充可访问链接。

## 一、分层拓扑

浏览器 `https://你的-vercel-preview.vercel.app`
→ Vercel 静态 React/Vite `dist/`
→ Vercel **同源 Rewrite**：`/__pb/api/*` 与 `/api/*` 转发到独立 HTTPS Node Gateway
→ 独立 Node Gateway `STAGING_MODE=1`、`NEON_SCHEMA=staging_*`
→ **独立 Neon Staging 数据库**（与 public / 正式账密不同）
→ 预发布专属附件持久化存储（真实志愿者使用前强制）。

该架构维持前端原有 `getPocketBaseUrl() -> /__pb` 路由、`X-Pb-Auth` 登录请求头、`/api/uploads/<filename>?sig=...` 签名图片链接，不允许把数据库连接串写入 Vercel 前端。浏览器同源代理避免跨域认证/附加 CORS 改造。注意：反向代理能保持原接口路径，但**不能替代后端认证、限流及图片持久化**。

## 二、Vercel 前端配置（本仓已落地）

- `vercel.mjs`：Vercel 2026 支持的动态构建配置，通过 `SUIYUAN_BACKEND_ORIGIN` 注入真实后端 HTTPS 地址（**不把地址硬编码到 Git**）。
- `scripts/vercel-split-config.mjs`：校验后端必须是 HTTPS 的公网域名且无凭据、路径或参数；按 `/__pb` → `/api` → React SPA 路由的先后顺序改写。
- `SUIYUAN_DEPLOY_MODE=staging` 是必填的部署意图闸门。若是 Vercel Production target，默认拒绝；必须在安全验收后明确设置 `SUIYUAN_ALLOW_PRODUCTION_TARGET=yes` 才可对独立 staging 项目使用 Production alias。**不要为了省步骤对正式服务设置此值**。
- `node scripts/vercel-build.mjs`：静态资源输出以根路径 `/assets/...` 引用，使 `/me`、`/matches` 等 SPA 深链接刷新后仍可加载 JS/CSS；原 VibeX 导出继续使用相对路径 `./assets/...`，不改动其 App ID / 平台路径。
- Vercel CDN 反向代理的私有 `/api/*` 和 `/__pb/*` 明确 `no-store` 并关闭 CDN Rewrite 缓存；全站添加 `X-Robots-Tag: noindex`。**这些 Header 不是访问控制**。
- `pnpm vercel:check`：只读本地配置检查。仅测试源码和资源，不会创建外部 Vercel 项目。

## 三、部署顺序（安全隔离）

1. 首先创建全新 **Neon Staging 数据库项目及专用数据库用户**，不要重用生产连接串，只向 Node 后端 Secret Manager 提供。`NEON_SCHEMA=staging_render_preview`（或另一个合规 staging_*），严禁 `public`。
2. **后端先部署并确认** `https://<真实 staging Node 后端>/api/ready`。已经准备好的可选模板为 `render.yaml`（Render Free，区域 Singapore，默认 **manual deploy**；需要用户在 Render Dashboard 连接并填写独立 staging `NEON_DSN`）。后端上线前执行受控 SQL schema 检查/幂等迁移，仅操作 staging 库；容器启动不会自动代表备份与迁移审批已完成。
3. Vercel 使用 GitHub 仓库 `HG1127/FateMatch`，根目录 `./`，Framework = Vite，Build Command 从 `vercel.mjs` 自动使用 `node scripts/vercel-build.mjs`，Output Directory = `dist`。**不要另建静态前端工程，也不要把 Vite 直接指向 Neon**。
4. Vercel 的 **Preview** 环境变量设置：
   - `SUIYUAN_DEPLOY_MODE=staging`
   - `SUIYUAN_BACKEND_ORIGIN=https://<你的真实 Node Staging 服务域名>`
   - `SUIYUAN_ALLOW_PRODUCTION_TARGET` 留空
   - **不要添加 `NEON_DSN`、数据库密码、管理员账号密钥或附件秘密到 Vercel。**
5. 部署到 Vercel Preview（例如通过 staging 分支触发）；若使用独立 Vercel 项目 main 触发 Production alias，必须先进行上线安全审核并确认准入控制，再决定是否使用显式许可开关。
6. 实测 Vercel Preview `/api/health`、`/api/ready`、`/__pb/api/collections/users/auth-with-password` 路由、`/me` 深链接、真实注册（**隔离测试账号**）、互配发信、活动页面、签名图片、登出与失效令牌。记录前后端 Git SHA / 健康检查 / 错误率。
7. 接入授权访问限制（Vercel Deployment Protection / 后端独立访问控制），并用真正的 iOS Safari 与 Android Chrome 验收后，才能邀请任何真人。

**注意**：Vercel Preview 的保护不自动保护另一个公开的 Node API 域名。必须分别审视后端的登录接口暴露、限流、域名访问控制，以及来自 Vercel 的真实客户端来源 IP。不要以 `X-Forwarded-For` 无条件信任外部请求。

## 四、关于 Render Free：仅限合成数据测试

`render.yaml` 提供免费公网站点的**技术预览可选项**，但 Render Free 实例闲置后会休眠，重新启动/重新部署会丢失本地上传文件。因此：

- 已通过 `STAGING_MODE=1`、`NEON_SCHEMA=staging_render_preview` 强制禁止使用 `public`。
- `SUIYUAN_EPHEMERAL_PREVIEW=1` 时，Node 服务**拒绝会员图片上传**，避免对真实个人照片制造“保存成功但随后丢失”的假承诺。
- Render 后台 `NEON_DSN` 必须为独立 staging 数据库，在 Blueprint 初始化时以 `sync:false` 输入；不可提交到 Git 或传入 Vercel。
- 不能向真实用户宣传它已具备持久化照片、完整资料或可随时访问。只使用隔离的假账户数据进行技术验证；即使配置了免费 URL 也不得直接转为真人试点。

**要开始真正的6–8人杭州邀请制试点**，Node 后端应迁往有持久盘/对象存储和可管控访问的宿主（例如已准备的 `compose.staging.yml`），并完成告知/自愿加入、隐私与举报流程。见 `docs/20-预发布部署与手机验收.md` 和 `docs/21-杭州真人试运营执行方案.md`。

## 五、验证（不需要真实云账户）

```bash
pnpm lint
pnpm test
pnpm build                       # 正常 VibeX/Standalone 资产
node scripts/vercel-build.mjs    # Vercel 根路径资产
# 给进程环境临时设置 SUIYUAN_DEPLOY_MODE=staging
# SUIYUAN_BACKEND_ORIGIN=https://<真实预发布后端>
# VERCEL_ENV=preview
pnpm vercel:check                # 只读验证 routes/cache/deep links
pnpm e2e                         # Neon 临时隔离 schema 完整测试，不接触 public
```

Vercel 和 Render 后端部署只有在连接用户自己的服务账户、设置目标环境后才能实际创建。未提供真实域名及授权之前，本仓库不能凭空生成可访问公网地址。
