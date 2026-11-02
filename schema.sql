-- 短链服务表结构(Cloudflare D1)
-- 执行:npx wrangler d1 execute short-url --remote --file=schema.sql
-- 已有的旧版本库请按顺序执行 migrations/ 下的增量迁移

-- 链接元数据表
-- 注:expires_at / max_uses 是第 0 级目标的镜像(兼容展示用),
--     跳转选择/失效判定/短码接管一律以 link_targets 表为准
CREATE TABLE IF NOT EXISTS links (
  code TEXT PRIMARY KEY,          -- 短码
  url TEXT NOT NULL,              -- 主目标(第 0 级)URL 镜像
  created_at INTEGER NOT NULL,    -- 创建时间(unix 秒)
  expires_at INTEGER,             -- 镜像:第 0 级过期时间(unix 秒),NULL = 永不过期
  max_uses INTEGER,               -- 镜像:第 0 级最大访问次数,NULL = 不限
  used_count INTEGER NOT NULL DEFAULT 0,  -- 全局点击总数(所有级别合计)
  mode TEXT NOT NULL DEFAULT 'sequence',  -- sequence | round_robin | weighted
  rr_cursor INTEGER NOT NULL DEFAULT 0    -- 列表循环模式的游标
);

-- 目标列表表(多级目标;单目标链接也有一行 idx=0)
CREATE TABLE IF NOT EXISTS link_targets (
  link_code TEXT NOT NULL,
  idx INTEGER NOT NULL,           -- 顺序(0 起)
  url TEXT NOT NULL,
  expires_at INTEGER,             -- 该级自己的过期时间(unix 秒),NULL = 永不过期
  max_uses INTEGER,               -- 该级自己的次数上限,NULL = 不限
  used_count INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 1,  -- weighted 模式的权重(概率份数)
  PRIMARY KEY (link_code, idx)
);

-- 访问日志表(每次跳转一条)
CREATE TABLE IF NOT EXISTS access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  ip TEXT,                        -- CF-Connecting-IP
  ua TEXT,                        -- User-Agent
  referer TEXT,                   -- Referer
  country TEXT,                   -- 国家/地区(ISO 3166-1 alpha-2,来自 request.cf)
  city TEXT,                      -- 城市(来自 request.cf)
  asn INTEGER,                    -- 访客网络自治系统号(来自 request.cf)
  meta TEXT,                      -- 扩展客户端信息(JSON:请求头/Client Hints/cf 地理网络/TLS/Bot)
  target_idx INTEGER,             -- 命中的目标级别(多级目标用)
  accessed_at INTEGER NOT NULL    -- 访问时间(unix 秒)
);

CREATE INDEX IF NOT EXISTS idx_logs_code ON access_logs(code);

-- 旧库自愈:为缺少 idx=0 目标行的链接补一行(新库无行,不受影响)
INSERT OR IGNORE INTO link_targets (link_code, idx, url, expires_at, max_uses, used_count, weight)
  SELECT code, 0, url, expires_at, max_uses, used_count, 1 FROM links;
