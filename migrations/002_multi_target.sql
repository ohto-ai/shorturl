-- 多级目标功能迁移(仅对旧版本数据库执行一次;新库直接执行 schema.sql 即可)
-- 执行(只需一次,且需先执行过 001_access_logs_meta.sql):
--   npx wrangler d1 execute short-url --remote --file=migrations/002_multi_target.sql
-- 注意:先执行本迁移,再部署新版 Worker。

CREATE TABLE IF NOT EXISTS link_targets (
  link_code TEXT NOT NULL,
  idx INTEGER NOT NULL,
  url TEXT NOT NULL,
  expires_at INTEGER,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (link_code, idx)
);

ALTER TABLE links ADD COLUMN mode TEXT NOT NULL DEFAULT 'sequence';
ALTER TABLE links ADD COLUMN rr_cursor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE access_logs ADD COLUMN target_idx INTEGER;

-- 为每条已有链接补一行第 0 级目标(继承原有效期/次数/计数)
INSERT OR IGNORE INTO link_targets (link_code, idx, url, expires_at, max_uses, used_count, weight)
  SELECT code, 0, url, expires_at, max_uses, used_count, 1 FROM links;
