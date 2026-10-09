# 随缘网｜前后端项目

面向 18 周岁以上用户的真人认识与活动平台。当前采用 **React + TypeScript + Vite / Node.js Neon Gateway / Neon PostgreSQL**，可在原 VibeX Source 模式下开发，也支持独立部署为“网站与 API 同源”的服务。

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

`dev:full` 会读取进程环境中的 `NEON_DSN`，或在本地交互式首次设置后写入已被 Git 忽略的 `dev-secrets.local`。不要将连接串粘贴进聊天、上传到源码库、写入前端变量或提交到 Git。开发环境仅在授权范围内使用真实数据库；开发调试优先隔离 schema。

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

## VibeX Source 发布（与独立部署分开）

本仓为 VibeX dev-source 导出项目，原 App ID 与平台集成必须保留。修改/回传前阅读 `.vibex/skills/vibex-app-source-roundtrip/SKILL.md`，ZIP 条目路径必须与 Source 编辑器所选目录匹配。**上传前端 Source 并不自动发布本地 Neon 网关**；需另行核对代理目标、后端部署与正式版本。

## 数据与隐私约束

- 未成年人不得进入真人推荐；必要资料未知时不得填充虚构事实。
- 图片落于持久化附件盘，使用有签名的 capability URL；数据库备份与图片归档必须同时考虑。
- 关系反馈是本人私有的当前选择，不通知对方，也不改变互配/聊天。
- `public` 迁移、数据清除/恢复、发布覆盖均须先备份并独立验收；日常测试只使用临时隔离 schema。
- 每次发布前均应检查 Git 工作区、代码保密规则与部署版本；禁止未经审查执行 `git add .`、整库强制覆盖或删除正式回归测试。

**继续阅读：** `docs/20-预发布部署与手机验收.md`、`docs/21-杭州真人试运营执行方案.md`、`docs/18-完整前后端发布候选与运维交接.md`、`docs/17-完整前后端生产部署与验收.md`、`docs/12-发布与回退手册.md`。
