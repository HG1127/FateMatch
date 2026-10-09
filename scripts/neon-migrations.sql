-- Neon 存量库的附加式、幂等迁移。
-- 新环境仍以 scripts/neon-schema.sql 为完整基线；已有环境每次发布前通过 pnpm db:migrate 执行本文件。
-- 这里只允许可重复执行的 ADD COLUMN / CREATE INDEX / CREATE TABLE 等迁移，不写业务数据。

-- 2026-09-27：举报处理结果与申诉闭环。
ALTER TABLE IF EXISTS reports ADD COLUMN IF NOT EXISTS "resolution" text;
ALTER TABLE IF EXISTS reports ADD COLUMN IF NOT EXISTS "resolved_at" double precision;
ALTER TABLE IF EXISTS reports ADD COLUMN IF NOT EXISTS "appeal_note" text;
ALTER TABLE IF EXISTS reports ADD COLUMN IF NOT EXISTS "appeal_at" double precision;
ALTER TABLE IF EXISTS reports ADD COLUMN IF NOT EXISTS "appeal_status" text;

-- 2026-09-28：真实试点最小化推荐曝光遥测；不经通用集合接口暴露。
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

-- 2026-09-28：试点关系结果反馈，只保留本人当前选择，无自由文本、无历史版本。
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

-- 2026-10-09：线下活动信息透明化。仅新增选填文本列，不改写旧活动。
ALTER TABLE IF EXISTS events ADD COLUMN IF NOT EXISTS "venue" text;
ALTER TABLE IF EXISTS events ADD COLUMN IF NOT EXISTS "cost_note" text;
ALTER TABLE IF EXISTS events ADD COLUMN IF NOT EXISTS "cancel_note" text;
