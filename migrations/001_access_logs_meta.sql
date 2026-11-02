-- 已有数据库升级:给 access_logs 增加扩展客户端信息列(JSON)
-- 新库直接执行 schema.sql 即可,无需本文件。
-- 执行(只需一次):
--   npx wrangler d1 execute short-url --remote --file=migrations/001_access_logs_meta.sql
-- 注意:先执行本迁移,再部署新版 Worker;否则新版写日志时会因缺列而静默失败。

ALTER TABLE access_logs ADD COLUMN meta TEXT;
