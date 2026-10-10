# 11 Neon 直连（当前线上数据层）
> 本文记录 2026-09-22 的历史切换过程。独立版新增标准同源 `/api/*` 调用；当时的 VibeX 控制网关、`/__pb` 代理和恢复 PocketBase 流程仅作历史参考，**不代表当前部署操作建议**。


2026-09-22 切换：线上数据层由容器内 SQLite 数据服务整体切换为用户自建 Neon（Postgres 18，新加坡区）直连。前端与外部代理零改动。

## 架构

- `server/neon-gateway.mjs`：数据网关，监听容器 7000 端口（原数据服务端口，外部 `__pb` 代理指向不变）。对前端提供与原服务完全一致的 REST 接口（记录增删改查、注册、登录、会话刷新、健康检查）。
- 权限规则由网关服务端强制（快照见 09）：真人业务数据需登录；私有表按属主过滤；管理表仅管理员；`site_settings` 禁删。管理员角色最终取自 `profiles.role`，但授予入口不再由前端“首个账号”猜测，而由服务端显式白名单控制。
- 密码：迁移时连哈希一并搬迁（bcrypt `$2a$`，网关用 bcryptjs 校验），老账号原密码可登录；会话令牌由网关自签（HS256），密钥存 Neon `gateway_meta` 表，网关重启不掉登录态。切换时点的旧令牌失效，全员重新登录一次。
- 连接串只经环境变量 `NEON_DSN` 传入进程，不落盘、不进仓库、不进前端。
- 管理员白名单：使用 `SY_ADMIN_EMAILS`（兼容 `ADMIN_EMAILS`）配置一个或多个管理员邮箱，多个值可用逗号/分号/空格分隔。网关启动时会把已有白名单账号对应 profile 提升为 admin；白名单账号首次创建 profile 时也由服务端写入 admin。未配置白名单时不会自动把“第一个注册者”变成管理员。

## 运维

### 本地开发：一键启动（推荐）

本地开发无需每次手动启动数据库网关。直接运行：

```bash
pnpm dev:full
```

首次运行且本机尚未保存 `NEON_DSN` 时，启动器会在终端中以**不回显**方式提示粘贴一次 Neon 连接串，并自动写入 `dev-secrets.local`；该文件匹配已有 `*.local` 忽略规则，不进入 Git。之后再次运行无需重复输入。

在 Windows 经典 PowerShell / Console Host 中，隐藏输入模式已专门支持 `Ctrl+V`：启动器收到快捷键后会直接从系统剪贴板读取连接串，只显示“已粘贴”提示，不显示连接串本身。右键粘贴与 `Shift+Insert` 也仍可使用。

如果运行环境没有交互终端（例如某些自动化 Runner / WebCodex detached job），则需提前准备 `dev-secrets.local`，或把 `NEON_DSN` 保存为系统用户环境变量。

`dev:full` 会自动：

- 优先读取系统环境变量，再读取 `dev-secrets.local`（也兼容用户自行维护的 `.env.local / .env.development.local`）；
- 检查 7000 端口的数据网关是否已健康，已运行则直接复用；
- 未运行则自动启动 `server/neon-gateway.mjs` 并等待健康检查通过；
- 自动选择 8000 起的可用 Vite 端口；
- 本地独立版把 `/api` 代理到 `127.0.0.1:7000`，并在迁移期兼容 `/__pb`；
- 默认自动打开浏览器；
- 关闭启动器时同时清理它自己启动的前端和网关进程。

如连接串已保存在 Windows/macOS/Linux 的用户环境变量 `NEON_DSN` 中，则本地 secrets 文件也无需创建。

管理员同样建议以系统用户环境变量保存，例如 Windows PowerShell：`[Environment]::SetEnvironmentVariable('SY_ADMIN_EMAILS','admin@example.com','User')`。不要把管理员邮箱白名单写进前端代码或提交真实 secrets 文件。

> `pnpm dev` 现在是纯独立前端开发入口；本机完整同源功能请使用 `pnpm dev:full`。

### 已有数据库升级

- `scripts/neon-schema.sql` 是新环境完整基线，但 PostgreSQL 的 `CREATE TABLE IF NOT EXISTS` **不会为已存在的表自动增加新列**。
- 已有 Neon 环境升级统一运行 `pnpm db:migrate`：脚本先补齐缺失的新表/索引，再执行 `scripts/neon-migrations.sql` 中的附加式幂等迁移，并在同一事务内校验关键字段；失败自动回滚。
- 生产 `public` schema 必须显式设置 `MIGRATE_FORCE=yes`：`MIGRATE_FORCE=yes NEON_DSN='postgresql://…' pnpm db:migrate`。隔离 schema 可设置 `NEON_SCHEMA=<name>`，无需生产强制开关。
- 可先运行 `pnpm db:migrate -- --dry-run` 核对目标和迁移文件；dry-run 不连接数据库，也不会打印连接串。


- 线上/容器启动仍可使用：`NEON_DSN='postgresql://…' node server/neon-gateway.mjs`，或运行 `scripts/start-neon-gateway.sh`。本地 Windows/macOS/Linux 开发优先使用 `pnpm dev:full`。日志 `logs/neon-gateway.log`。
- **容器重启后网关不会自启**（连接串不落盘的代价）：需按上面方式重新拉起，拉起前应用会提示「数据库连接失败，展示临时数据」。原数据服务已在进程管理器里设为不自启，避免抢 7000 端口。
- 外网出口抖动：网关查询带 3 次自动重试；仍失败则前端按既有错误处理提示重试，不影响进程存活。
- 回退：停网关 → 进程管理器启动 `pocketbase-bin` → 应用回到切换时点的旧数据（切换后的新写入不在旧库）。回退会丢切换后数据，仅作故障兜底。

## 备份

- 线上库即 Neon，备份走 Neon 自带能力：控制台可开 PITR（时间点恢复）与分支；重要节点前建分支即为快照。
- 原 Supabase 快照线（10）停用：其数据源是已冻结的旧库，仅作历史工具保留。
- 已将破坏性全量镜像同步工具归档为 `scripts/legacy/pocketbase-to-neon-sync.mjs`。它会覆盖并删除目标表中的行，不属于独立版常规部署步骤；恢复前必须备份并书面确认目标数据库，在独立版只允许 `--dry`，写入已在代码中禁用。确需恢复迁移时必须独立审查历史分支及备份后另行审批。

## 发布冒烟（自动化）

- 入口：`NEON_DSN='postgresql://…' pnpm e2e`（Playwright，3 例）。
- 数据隔离：自动在 Neon 建一次性 schema（e2e_smoke）+ 拉起独立网关实例（7200 端口），全链路（注册/登录/发帖/属主隔离/权限拦截/改密/清理）跑完即销毁 schema，不碰生产数据。
- 页面服务启动检查只读跑 8000。
- 入参校验已 zod 化（注册 / 登录 / 改密），字段级错误消息与原服务风格一致。

## 迁移记录（2026-09-22）

- 表结构：`scripts/gen-neon-schema.py` 从原服务 schema 生成 `scripts/neon-schema.sql`（22 表；列名 snake_case 加引号，`desc` 等保留字可用；`users.password` → `password_hash`；剔除 `tokenKey`）。
- 数据：全量迁移 22 表 / 58 行，Neon 侧逐表核对一致（posts=11, profiles=14, admin_logs=11, events=5, digests=2, users=1 等）。
- 冒烟：公开读 / 匿名 403 / 注册 / 重复邮箱 400 / 登录 / 错密码 400 / 属主隔离 / 伪造属主 403 / 非管理员删除 403 / 管理员读运营日志与删除 200/204，全部通过；冒烟数据已清理。
- 三道闸：lint 0 error、测试 20/20、构建通过；页面 8000 正常，网关健康检查正常。
