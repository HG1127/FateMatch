# 08 数据 Schema 与迁移

## 表清单（22 张业务表）

profiles、users、posts、post_comments、events、event_comments、chat_messages、user_likes、user_passes、user_reads、favorites、fav_groups、visits、blocks、reminders、checkins、contacts、reports、digests、admin_logs、site_settings、user_tour。

中文对照与实时条数见掌柜后台「数据维护」页签；逐表字段以仓储层映射为唯一事实来源。

## 设计原则对照

| 流程原则 | 本项目落实 |
| --- | --- |
| 从领域模型推导 | 见 06；一实体一表，关系表两端存 sid |
| 统一 snake_case | 表名 / 字段名全 snake_case |
| 审计字段 | 业务表带 `created` + `at`；未采用 deleted_at 软删——以删除护栏代替（见 06 不变量 3），删错可凭备份恢复 |
| 约束 | 服务端权限规则（见 09）+ 账号邮箱唯一；名单类字段存 JSON 文本并由仓储层校验形状 |
| 一切 Schema 变更走 Migration | 见下方迁移流程 |

## 迁移流程（硬规则）

1. **先备份**：后台「数据维护」导出 JSON，或服务器侧全量导出脚本落盘。
2. 改集合结构（数据服务管理台或超管接口）。
3. 同步仓储层映射、后台盘点清单、06 领域模型。
4. 过三道闸（lint / build / test）+ 关键流程冒烟（登录、加载快照、同步写回）。
5. 在下方迁移记录登记一笔。

## 迁移记录

| 日期 | 变更 | 备份 |
| --- | --- | --- |
| 2026-09-07 | 全量基线备份（59 条记录） | backups/suiyuan-backup-2026-09-07.json |
| 2026-09-07 | 删除冒烟测试账号（删前已确认无关联资料 / 足迹 / 引导行） | 同上 |
| 2026-09-08 | 无结构变更；12 张表服务端权限规则收紧（详见 09），规则变更可逆、不触碰数据 | 后台可随时导出 |
