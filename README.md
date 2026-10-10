# 随缘网｜独立前后端版本

面向 18 周岁以上用户的真人认识与活动平台。当前采用 **React + TypeScript + Vite / Node.js Neon Gateway / Neon PostgreSQL**，已按独立同源站点运行，前端与 API 均不依赖 VibeX 服务；历史 VibeX 导出与接口兼容信息另行归档。

**当前阶段：技术链路通过隔离测试，正式公网发布与真人试运营效果仍需单独验收。** 禁止模拟真人喜欢、回复、已读或核验成功。

## 业务链路与代码结构

用户注册 → 本人完善必要资料 → 符合双向条件的真人发现 → 主动有意 → 互相有意 → 私信 → 活动报名/签到 → 本人自愿关系反馈（可撤回）。举报、安全管理与永久注销均有服务端权限保护。

| 目录 | 内容 |
| --- | --- |
| `src/pages`、`src/components` | 前端页面、交互组件与移动端布局 |
| `src/lib/store.tsx`、`src/lib/repo.ts` | 用户状态、水合、后端持久化命令与按需查询 |
| `server/neon-gateway.mjs` | HTTP 路由、鉴权、数据层、就绪/存活探针、同源生产页面 |
| `server/domains` | auth / profiles / matching / messaging / events / safety / admin 七个领域模块 |
| `scripts/neon-schema.sql`、`scripts/neon-migrations.sql` | Neon/PostgreSQL 表结构与附加式迁移 |
| `e2e` | Playwright 临时 Neon schema 隔离端到端测试 |
| `docs` | 接口契约、隐私矩阵、发布/回退、验收清单 |

## 本地开发（Node 22，pnpm 10）

```bash
pnpm install --frozen-lockfile
pnpm dev:full
```

`dev:full` 会读取进程环境中的 `NEON_DSN`，或在本地交互式首次设置后写入已被 Git 忽略的 `dev-secrets.local`。不要将连接串粘贴进聊天、上传到源码库、写入前端变量或提交到 Git。开发环境仅在授权范围内使用真实数据库；开发调试优先隔离 schema。 独立版 `pnpm dev:full` 强制 `STAGING_MODE=1`、`NEON_SCHEMA=staging_*`，并校验连接目标必须是 `suiyuan_staging` 数据库及专用角色；不再复用 7000 端口上未知来源的现有网关。请依照 `local-config.example` 配置，本机开发勿使用正式数据库。

## 工程质量门槛

```bash
pnpm lint        # ESLint
pnpm test        # Vitest 全量回归，稳定的单 worker 模式
pnpm build       # TypeScript 类型检查 + 生产资源构建
pnpm e2e         # 先构建，再在一次性 Neon schema 上跑完整同源前后端 E2E
pnpm release:check       # 只读发布预检：源码、Git、Docker、持久化和备份
pnpm release:check:strict # 必要条件缺失时退出非零，阻止误发布
```

`pnpm e2e` 会读取本机已忽略的连接设置，创建一次性 `e2e_smoke_*` schema、在测试网关 7200 上提供正式构建的前端/API、运行浏览器用例，最后清除测试 schema 和临时图片。它不应该向 `public` 写测试用户。**不要在开发/生产主机手动并行启动多套 E2E。**

GitHub Actions 分为 `.github/workflows/quality.yml`（代码质量）与 `.github/workflows/ci.yml`（生产 Docker 镜像构建 + 运行时资产自检）。CI 必须在受控分支提交并推送后才能运行；本机没有 Docker Engine 时不能用 Compose 静态检查代替镜像运行验收。

## 移动端体验与主屏幕快捷方式

独立手机版在 `feat/mobile-ux-responsive` 分支优化了手机主导航、更多功能面板、全屏聊天、表单输入、底部安全区域、活动筛选、弹窗和首页主要操作。提供 `manifest.webmanifest` 与本地应用图标，可在 HTTPS 可访问时添加到手机主屏幕；**不使用 Service Worker 缓存聊天、照片或登录信息**，不代表支持离线使用。

```bash
pnpm build
pnpm mobile:check  # 无数据库凭据，合成浏览器模拟 320/375/390/430/768px
```

详见 `docs/24-随缘网移动端适配与验收.md`。移动端适配与中国大陆免 VPN 网络可达性是两个独立问题，不能混为一谈。

## 预发布与手机/真人试点（独立 staging）

预发布必须配置**独立 Neon 数据库及 staging_* schema**，并通过受限 HTTPS 入口访问；严禁让测试人员访问正式 public 数据。工程已提供：

```bash
pnpm staging:check                        # 只读检查，禁止 public
pnpm staging:migrate                      # 默认数据库 dry-run
# 经负责人确认 staging 数据库并备份后才运行：
# pnpm staging:migrate --apply --confirm=staging_rc1
# docker compose -f compose.staging.yml up -d --build
pnpm staging:smoke                        # 本地 127.0.0.1:8081 只读健康/资源检查
```

部署前通过受管进程环境提供 `STAGING_NEON_DSN`、`STAGING_SCHEMA`、可选 `STAGING_PORT`；不得写入 Git。本地 Docker Engine 不可用时可先借助一次性隔离 Neon schema 跑 `pnpm e2e`，但不等同于公网 staging 部署。手机触控模拟测试在 `e2e/mobile-acceptance.spec.ts`，真实 iPhone Safari / Android Chrome 仍需持有实体设备的志愿者验收。杭州真人试点须经同意且已具备安全举报/退出流程，不会由测试代码伪造真人行为。

交付与闸门：`docs/20-预发布部署与手机验收.md`、`docs/21-杭州真人试运营执行方案.md`。

## Vercel 前端 + 独立 Node 后端（方案 A）

已增加 `vercel.ts`、`render.yaml` 和专门测试：Vercel 承载 React 静态前端，`/api/*` 反向代理到独立 HTTPS Node Gateway，保留 `/__pb/*` 仅供旧客户端回退；Node 只读取隔离 Neon staging 数据库。Vercel 前端**不配置数据库密码**。

- Vercel Preview 环境变量需显式设置 `SUIYUAN_DEPLOY_MODE=staging`、`SUIYUAN_BACKEND_ORIGIN=https://<真实 Staging 后端>`；缺少配置时部署失败而不是静默连接正式站点。
- `node scripts/vercel-build.mjs` 为 Vercel 构建根路径资源，独立版默认 `/assets`，无需 VibeX 子路径。`pnpm vercel:check` 仅对已构建静态文件和转发配置进行只读自检。
- `render.yaml` 可选 Render Free 单实例，**仅用于合成测试数据**；其文件系统不持久，已显式禁止免费预览模式上传会员照片。真实受邀用户试点必须换成持久化图片存储并进行访问保护和隐私验收。
- 本次代码准备**不会自动创建 Vercel 或 Render 公网项目**，需要先连接对应云平台账户、创建独立 Staging 数据库与配置授权。

完整执行步骤：`docs/22-Vercel前端与独立Node预发布部署.md`。

## 生产：独立同源前后端

```bash
pnpm build
# 由受管进程环境提供 NEON_DSN，以及绝对路径的持久化 UPLOAD_DIR
pnpm start:prod
```

直接运行 `start:prod` 时默认只监听 `127.0.0.1:8080`，防止裸 HTTP 意外暴露；容器 Compose 显式配置 `HOST=0.0.0.0`，并只对宿主机 `127.0.0.1` 映射端口。`/api/health` 为进程存活探针，`/api/ready` 要求数据库和认证初始化完成。`/me`、`/matches/` 等深链接、签名媒体和 `/__pb/api/*` 兼容访问均由同源服务处理。

也可选择 `Dockerfile` + `compose.prod.yml`，以非 root、只读根目录、持久化图片卷及本机绑定端口运行。**HTTPS 必须由受控反向代理终止**。生产连接配置绝不能放入镜像或提交至仓库。

```bash
# 先从 Secret Manager 向当前受控部署进程注入 NEON_DSN
docker compose -f compose.prod.yml config --quiet
docker compose -f compose.prod.yml build
docker compose -f compose.prod.yml up -d
```

IP 限流默认仅信任真实 socket 对端。若确有反向代理，才可通过 `TRUSTED_PROXY_IPS` 显式列出**直接代理 IP**；代理必须覆盖 `X-Forwarded-For`，不能拼接用户自带值。多实例水平扩容前仍需集中化限流与共享运行状态。

## 独立版与历史 VibeX 代码隔离

本分支 `refactor/standalone-suiyuan` 不再调用 VibeX 编辑插件、子路径路由、平台认证或线上资源。原始平台工作流保留在此前的 Git 分支，未在此分支删除用户电脑上未追踪的 VibeX 导出工具。旧 `/__pb/api/*` 和 `X-Pb-Auth` 仅在服务端作为兼容入口；新客户端统一使用 `/api/*` 与 `Authorization`。旧 PocketBase → Neon 迁移脚本存档于 `scripts/legacy/`，默认不得用于日常部署。**这是代码独立化，不代表国内免 VPN 公网访问已自动解决。** 详见 `docs/23-随缘网独立版重构与验收.md`。

## 数据与隐私约束

- 未成年人不得进入真人推荐；必要资料未知时不得填充虚构事实。
- 图片落于持久化附件盘，使用有签名的 capability URL；数据库备份与图片归档必须同时考虑。
- 关系反馈是本人私有的当前选择，不通知对方，也不改变互配/聊天。
- `public` 迁移、数据清除/恢复、发布覆盖均须先备份并独立验收；日常测试只使用临时隔离 schema。
- 每次发布前均应检查 Git 工作区、代码保密规则与部署版本；禁止未经审查执行 `git add .`、整库强制覆盖或删除正式回归测试。

**继续阅读：** `docs/23-随缘网独立版重构与验收.md`、`docs/22-Vercel前端与独立Node预发布部署.md`、`docs/20-预发布部署与手机验收.md`、`docs/21-杭州真人试运营执行方案.md`、`docs/18-完整前后端发布候选与运维交接.md`、`docs/12-发布与回退手册.md`。
