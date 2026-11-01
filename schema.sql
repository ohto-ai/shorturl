-- 短链服务表结构(Cloudflare D1)
-- 执行:npx wrangler d1 execute short-url --remote --file=schema.sql

-- 链接元数据表
CREATE TABLE IF NOT EXISTS links (
  code TEXT PRIMARY KEY,          -- 短码
  url TEXT NOT NULL,              -- 目标链接
  created_at INTEGER NOT NULL,    -- 创建时间(unix 秒)
  expires_at INTEGER,             -- 过期时间(unix 秒),NULL = 永不过期
  max_uses INTEGER,               -- 最大访问次数,NULL = 不限
  used_count INTEGER NOT NULL DEFAULT 0
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
  accessed_at INTEGER NOT NULL    -- 访问时间(unix 秒)
);

CREATE INDEX IF NOT EXISTS idx_logs_code ON access_logs(code);
