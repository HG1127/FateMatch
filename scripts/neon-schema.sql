-- Neon(Postgres) 表结构：由现有数据服务 schema 自动生成
-- id 为主键(text)；created/updated 为时间戳；业务字段按原类型映射(text/number/bool/json)
-- 列名统一 snake_case 小写并加引号（desc 等保留字可用；emailVisibility -> email_visibility）

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  "password_hash" text,
  "email" text,
  "email_visibility" boolean,
  "verified" boolean,
  "name" text,
  "avatar" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users ("email");
-- 登录/查重走 lower(email) 等值匹配：唯一函数索引兜底大小写变体并发注册（v1.6）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower("email"));

CREATE TABLE IF NOT EXISTS profiles (
  id text PRIMARY KEY,
  "sid" text,
  "nickname" text,
  "gender" text,
  "seeking" text,
  "birth_date" text,
  "city" text,
  "region" text,
  "height" double precision,
  "job" text,
  "bio" text,
  "interests" jsonb,
  "photos" jsonb,
  "verification" jsonb,
  "stealth" boolean,
  "banned" boolean,
  "role" text,
  "created_at" double precision,
  "badge_dates" jsonb,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_sid ON profiles ("sid");

CREATE TABLE IF NOT EXISTS posts (
  id text PRIMARY KEY,
  "sid" text,
  "author_sid" text,
  "text" text,
  "images" jsonb,
  "topic" text,
  "featured" boolean,
  "likes" jsonb,
  "at" double precision,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_sid ON posts ("sid");
CREATE INDEX IF NOT EXISTS idx_posts_author_sid ON posts ("author_sid");

CREATE TABLE IF NOT EXISTS post_comments (
  id text PRIMARY KEY,
  "sid" text,
  "post_sid" text,
  "author_sid" text,
  "text" text,
  "likes" jsonb,
  "at" double precision,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_post_comments_sid ON post_comments ("sid");
CREATE INDEX IF NOT EXISTS idx_post_comments_post_sid ON post_comments ("post_sid");
CREATE INDEX IF NOT EXISTS idx_post_comments_author_sid ON post_comments ("author_sid");

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  "sid" text,
  "title" text,
  "city" text,
  "region" text,
  "cover" text,
  "date" text,
  "time" text,
  "capacity" double precision,
  "desc" text,
  "tags" jsonb,
  "attendees" jsonb,
  "host" text,
  "creator_sid" text,
  "requirements" text,
  "pinned" boolean,
  "venue" text,
  "cost_note" text,
  "cancel_note" text,
  "images" jsonb,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_sid ON events ("sid");
CREATE INDEX IF NOT EXISTS idx_events_creator_sid ON events ("creator_sid");

CREATE TABLE IF NOT EXISTS event_comments (
  id text PRIMARY KEY,
  "sid" text,
  "event_sid" text,
  "author_sid" text,
  "text" text,
  "likes" jsonb,
  "pinned" boolean,
  "at" double precision,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_comments_sid ON event_comments ("sid");
CREATE INDEX IF NOT EXISTS idx_event_comments_event_sid ON event_comments ("event_sid");
CREATE INDEX IF NOT EXISTS idx_event_comments_author_sid ON event_comments ("author_sid");

CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  "sid" text,
  "sid_a" text,
  "sid_b" text,
  "from_sid" text,
  "text" text,
  "images" jsonb,
  "recalled" boolean,
  "read_at" double precision,
  "at" double precision,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_sid ON chat_messages ("sid");
CREATE INDEX IF NOT EXISTS idx_chat_messages_from_sid ON chat_messages ("from_sid");
-- 会话列表按 (sid_a = me or sid_b = me) 过滤，两列各自需要索引
CREATE INDEX IF NOT EXISTS idx_chat_messages_sid_a ON chat_messages ("sid_a");
CREATE INDEX IF NOT EXISTS idx_chat_messages_sid_b ON chat_messages ("sid_b");

CREATE TABLE IF NOT EXISTS user_likes (
  id text PRIMARY KEY,
  "sid" text,
  "owner_sid" text,
  "target_sid" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_likes_sid ON user_likes ("sid");
CREATE INDEX IF NOT EXISTS idx_user_likes_owner_sid ON user_likes ("owner_sid");
CREATE INDEX IF NOT EXISTS idx_user_likes_target_sid ON user_likes ("target_sid");

CREATE TABLE IF NOT EXISTS user_passes (
  id text PRIMARY KEY,
  "sid" text,
  "owner_sid" text,
  "target_sid" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_passes_sid ON user_passes ("sid");
CREATE INDEX IF NOT EXISTS idx_user_passes_owner_sid ON user_passes ("owner_sid");
CREATE INDEX IF NOT EXISTS idx_user_passes_target_sid ON user_passes ("target_sid");

CREATE TABLE IF NOT EXISTS user_reads (
  id text PRIMARY KEY,
  "sid" text,
  "owner_sid" text,
  "other_sid" text,
  "at" double precision,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_reads_sid ON user_reads ("sid");
CREATE INDEX IF NOT EXISTS idx_user_reads_owner_sid ON user_reads ("owner_sid");
CREATE INDEX IF NOT EXISTS idx_user_reads_other_sid ON user_reads ("other_sid");

CREATE TABLE IF NOT EXISTS favorites (
  id text PRIMARY KEY,
  "sid" text,
  "owner_sid" text,
  "fav_type" text,
  "target_sid" text,
  "group_name" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_sid ON favorites ("sid");
CREATE INDEX IF NOT EXISTS idx_favorites_owner_sid ON favorites ("owner_sid");
CREATE INDEX IF NOT EXISTS idx_favorites_target_sid ON favorites ("target_sid");

CREATE TABLE IF NOT EXISTS fav_groups (
  id text PRIMARY KEY,
  "sid" text,
  "owner_sid" text,
  "name" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fav_groups_sid ON fav_groups ("sid");
CREATE INDEX IF NOT EXISTS idx_fav_groups_owner_sid ON fav_groups ("owner_sid");

CREATE TABLE IF NOT EXISTS visits (
  id text PRIMARY KEY,
  "sid" text,
  "viewer_sid" text,
  "viewed_sid" text,
  "at" double precision,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_sid ON visits ("sid");
CREATE INDEX IF NOT EXISTS idx_visits_viewer_sid ON visits ("viewer_sid");
CREATE INDEX IF NOT EXISTS idx_visits_viewed_sid ON visits ("viewed_sid");

CREATE TABLE IF NOT EXISTS blocks (
  id text PRIMARY KEY,
  "sid" text,
  "owner_sid" text,
  "target_sid" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_sid ON blocks ("sid");
CREATE INDEX IF NOT EXISTS idx_blocks_owner_sid ON blocks ("owner_sid");
CREATE INDEX IF NOT EXISTS idx_blocks_target_sid ON blocks ("target_sid");

CREATE TABLE IF NOT EXISTS reminders (
  id text PRIMARY KEY,
  "sid" text,
  "owner_sid" text,
  "event_sid" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_sid ON reminders ("sid");
CREATE INDEX IF NOT EXISTS idx_reminders_owner_sid ON reminders ("owner_sid");
CREATE INDEX IF NOT EXISTS idx_reminders_event_sid ON reminders ("event_sid");

CREATE TABLE IF NOT EXISTS checkins (
  id text PRIMARY KEY,
  "sid" text,
  "owner_sid" text,
  "event_sid" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_sid ON checkins ("sid");
CREATE INDEX IF NOT EXISTS idx_checkins_owner_sid ON checkins ("owner_sid");
CREATE INDEX IF NOT EXISTS idx_checkins_event_sid ON checkins ("event_sid");

CREATE TABLE IF NOT EXISTS contacts (
  id text PRIMARY KEY,
  "sid" text,
  "event_sid" text,
  "user_sid" text,
  "text" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_sid ON contacts ("sid");
CREATE INDEX IF NOT EXISTS idx_contacts_event_sid ON contacts ("event_sid");
CREATE INDEX IF NOT EXISTS idx_contacts_user_sid ON contacts ("user_sid");

CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY,
  "sid" text,
  "by_sid" text,
  "target_sid" text,
  "reason" text,
  "note" text,
  "status" text,
  "at" double precision,
  "resolution" text,
  "resolved_at" double precision,
  "appeal_note" text,
  "appeal_at" double precision,
  "appeal_status" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_sid ON reports ("sid");
CREATE INDEX IF NOT EXISTS idx_reports_by_sid ON reports ("by_sid");
CREATE INDEX IF NOT EXISTS idx_reports_target_sid ON reports ("target_sid");

CREATE TABLE IF NOT EXISTS digests (
  id text PRIMARY KEY,
  "sid" text,
  "title" text,
  "intro" text,
  "post_sids" jsonb,
  "cover" text,
  "issue" double precision,
  "views" double precision,
  "at" double precision,
  "covers" jsonb,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_digests_sid ON digests ("sid");

CREATE TABLE IF NOT EXISTS admin_logs (
  id text PRIMARY KEY,
  "sid" text,
  "text" text,
  "at" double precision,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_logs_sid ON admin_logs ("sid");

CREATE TABLE IF NOT EXISTS site_settings (
  id text PRIMARY KEY,
  "sid" text,
  "features" jsonb,
  "stories" jsonb,
  "announcement" text,
  "hidden_events" jsonb,
  "fest_templates" jsonb,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_settings_sid ON site_settings ("sid");

CREATE TABLE IF NOT EXISTS user_tour (
  id text PRIMARY KEY,
  "sid" text,
  "owner_sid" text,
  "data" jsonb,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tour_sid ON user_tour ("sid");
CREATE INDEX IF NOT EXISTS idx_user_tour_owner_sid ON user_tour ("owner_sid");

-- v1.1 计数拆分：内嵌名单列（posts.likes / post_comments.likes / event_comments.likes /
-- events.attendees）拆出为独立关系表，主表 update 权限随之收紧到「作者/发起人 + 掌柜」。
-- 旧列保留但网关已屏蔽读写（单一数据源为新表）。
CREATE TABLE IF NOT EXISTS content_likes (
  id text PRIMARY KEY,
  "sid" text,
  "kind" text,
  "target_sid" text,
  "owner_sid" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_likes_sid ON content_likes ("sid");
CREATE INDEX IF NOT EXISTS idx_content_likes_target ON content_likes ("kind", "target_sid");
CREATE INDEX IF NOT EXISTS idx_content_likes_owner ON content_likes ("owner_sid");

CREATE TABLE IF NOT EXISTS event_attendees (
  id text PRIMARY KEY,
  "sid" text,
  "event_sid" text,
  "owner_sid" text,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_attendees_sid ON event_attendees ("sid");
CREATE INDEX IF NOT EXISTS idx_event_attendees_event ON event_attendees ("event_sid");
CREATE INDEX IF NOT EXISTS idx_event_attendees_owner ON event_attendees ("owner_sid");

-- v1.12 安全事件持久化：登录成败 / 锁定 / 限流命中 / 敏感词拦截 / 停用恢复 / 密码重置 / 删除级联等留痕。
-- 仅掌柜经管理端点（/api/admin/security-events）可查，不经通用集合接口暴露（无权限规则即 404）；
-- 网关每 6 小时自动清理 90 天前的旧事件。identity 落库前已脱敏。
CREATE TABLE IF NOT EXISTS security_events (
  id text PRIMARY KEY,
  "type" text,
  "actor_sid" text,
  "identity" text,
  "ip" text,
  "detail" jsonb,
  "at" double precision,
  created timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_events_at ON security_events ("at" DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events ("type");

-- v1.13 真实试点最小遥测：只记录服务端实际下发的人物推荐，不记录点击、停留时长或正文。
-- viewer/target/source/day 唯一，避免刷新/重试放大曝光；原始明细最多保留 35 天，仅掌柜读聚合指标。
-- 本表不挂通用 collection 权限，任何身份都不能通过 /api/collections 直接枚举明细。
CREATE TABLE IF NOT EXISTS discovery_exposures (
  id text PRIMARY KEY,
  "viewer_sid" text NOT NULL,
  "target_sid" text NOT NULL,
  "source" text NOT NULL,
  "day" text NOT NULL,
  "at" double precision NOT NULL,
  created timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_exposures_daily
  ON discovery_exposures ("viewer_sid", "target_sid", "source", "day");
CREATE INDEX IF NOT EXISTS idx_discovery_exposures_created ON discovery_exposures (created DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_exposures_target_day ON discovery_exposures ("target_sid", "day");

-- v1.13 关系结果反馈：每人对每个互配对象只保留当前选择，不保留历史版本，也不收文字备注。
-- 原始行不挂通用 collection 权限；本人只能经 messaging 专用端点读取/修改自己的选择。
CREATE TABLE IF NOT EXISTS relationship_feedback (
  id text PRIMARY KEY,
  "owner_sid" text NOT NULL,
  "other_sid" text NOT NULL,
  "outcome" text NOT NULL CHECK ("outcome" IN ('continue', 'pause')),
  "at" double precision NOT NULL,
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_feedback_pair
  ON relationship_feedback ("owner_sid", "other_sid");
CREATE INDEX IF NOT EXISTS idx_relationship_feedback_updated ON relationship_feedback (updated DESC);
