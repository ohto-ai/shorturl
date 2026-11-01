# s.ohtoai.top · 短链服务

基于 **Cloudflare Workers + D1** 的个人短链服务,完全跑在免费额度内。[GitHub](https://github.com/ohto-ai/shorturl)

**功能**:自定义/自动短码、有效期、次数上限、点击统计(访问明细含 IP、UA、Referer、**国家/城市/ASN**,来自 Cloudflare 边缘注入的 `request.cf`)、管理页每条链接可展开「详情」面板(国家分布 + 最近 50 次访问)、每日自动清理过期数据、D1 全球读副本就绪(一键开启后跳转读走最近副本,与 KV 边缘读同级延迟)。

## 架构说明

```
访客 ──GET /:code──▶ Worker ──Sessions API──▶ D1(links 表,读)
                      │
                      └─waitUntil──▶ D1(access_logs 写 + used_count+1,异步不阻塞跳转)
管理员 ──/admin 网页 或 Bearer token──▶ /api/* ──▶ D1(links 写)
```

**为什么纯 D1 而不是 KV+D1 混合**:Worker 免费额度 10 万请求/天是总闸门;D1 读额度 500 万行/天,一次跳转只读 1 行,容量远大于 KV 读额度(10 万/天),而 KV 写额度仅 1 千/天。混合架构不能扩容,反而引入双写一致性负担。若需极致读延迟,在 Dashboard 开启 D1 读副本即可(见下文),代码无需改动。

## 目录结构

```
├── wrangler.toml     # D1 绑定、自定义域名、cron、observability
├── schema.sql        # 建表语句
├── src/index.ts      # Worker:路由、创建/跳转/删除、定时清理
├── src/admin.ts      # 管理后台单页(内嵌 HTML)
├── .dev.vars         # 本地开发密钥(已 gitignore)
└── tsconfig.json
```

## 本地开发

```bash
npm install
npm run db:init:local        # 初始化本地 D1(.dev.vars 里已有本地测试令牌)
npm run dev                  # http://127.0.0.1:8787/admin
```

## 部署上线

前置:ohtoai.top 的 DNS 已托管在 Cloudflare(已满足),并登录 wrangler:

```bash
npx wrangler login
npx wrangler d1 create short-url --location apac   # 主库选亚太,离访客近
#   把输出的 database_id 填入 wrangler.toml
npm run db:init:remote                             # 建表
npx wrangler secret put CREATE_TOKEN               # 输入一个随机长字符串作为管理令牌
npx wrangler deploy                                # 自动创建 s.ohtoai.top 的精确 DNS 记录(覆盖泛解析)
```

部署完成后访问 **https://s.ohtoai.top/admin**,输入 CREATE_TOKEN 即可开始使用。

> 若部署时报 custom domain 冲突,改在 Dashboard → Workers → short-url → Settings → Domains & Routes 手动添加 `s.ohtoai.top` 即可,`wrangler.toml` 中的 `routes` 可删除。

**开启读副本(可选,推荐)**:Dashboard → Storage & Databases → D1 → short-url → Settings → **Enable Read Replication**。开启后跳转读自动路由到离访客最近的副本(代码已用 Sessions API 兼容,无需重新部署);关闭同样随时可操作。

## API 文档

所有管理接口需要请求头 `Authorization: Bearer <CREATE_TOKEN>`。

### 创建短链

```bash
curl -X POST https://s.ohtoai.top/api/create \
  -H "Authorization: Bearer <CREATE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/target",
    "code": "my-link",      // 可选,2-32 位字母/数字/_/-
    "expiresIn": 86400,     // 可选,有效期(秒)
    "maxUses": 10           // 可选,最大访问次数
  }'
# → { "code": "my-link", "shortUrl": "https://s.ohtoai.top/my-link", ... }
```

错误码:`400` 参数不合法;`401` 令牌错误;`409` 自定义短码已被占用。

### 列表 / 修改 / 删除 / 访问统计

```bash
curl -H "Authorization: Bearer <T>" https://s.ohtoai.top/api/links
curl -X DELETE -H "Authorization: Bearer <T>" https://s.ohtoai.top/api/links/my-link
curl -H "Authorization: Bearer <T>" https://s.ohtoai.top/api/links/my-link/stats
# → { "code":"my-link", "total":12,
#     "countries":[{"country":"CN","n":9},...],        // 国家分布 Top 10
#     "recent":[{ "ip","ua","referer","country","city","asn","accessed_at" }, ...] }  // 最近 50 次

# 修改已有短链(部分更新,字段缺省保持不变;显式 null = 取消限制)
curl -X PATCH -H "Authorization: Bearer <T>" -H "Content-Type: application/json" \
  https://s.ohtoai.top/api/links/my-link \
  -d '{ "url": "https://new-target.com",  // 换目标
        "expiresIn": 86400,               // 重新计有效期;null = 永久
        "maxUses": 100,                   // 调整次数上限;null = 不限
        "resetCount": true }'             // 可选,把已用次数清零(复活链接)
```

**短码复用**:创建时若自定义短码已被「已过期」或「次数用尽」的链接占用,会自动接管替换(旧访问日志同步清空);占用中的短码仍返回 409。

### 跳转

`GET /:code` → `302` 到目标链接(`Cache-Control: no-store` + `X-Robots-Tag: noindex`,附 `Server-Timing: db;dur=xx` 头可实测数据库耗时)。
不存在 → `404`;已过期或次数用尽 → `410`。

## 免费额度账

| 资源 | 免费额度 | 本服务消耗 |
|---|---|---|
| Worker 请求 | 10 万/天 | 所有操作共享(总闸门) |
| D1 读 | 500 万行/天 | 每次跳转 1 行 |
| D1 写 | 10 万行/天 | 每次跳转 2 行(日志 + 计数)→ 上限约 5 万跳转/天 |
| D1 读副本 | 无额外费用 | 控制台一键开启 |

个人使用余量极大。若某天流量暴涨,可在 `src/index.ts` 的 `handleRedirect` 中删掉 `INSERT INTO access_logs` 那条语句,写入即减半。

## 数据维护

- 跳转即时校验有效期/次数,不依赖清理任务
- Cron(每日 03:00 UTC)自动清理:90 天前的访问日志、过期超 30 天的链接
- 手动查询:`npx wrangler d1 execute short-url --remote --command "SELECT * FROM links LIMIT 20"`
- 误删恢复:D1 自带 Time Travel,可回溯 30 天内任意时刻

## License

[MIT](LICENSE)
