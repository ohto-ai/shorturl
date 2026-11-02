# s.ohtoai.top · 短链服务

基于 **Cloudflare Workers + D1** 的个人短链服务,完全跑在免费额度内。[GitHub](https://github.com/ohto-ai/shorturl)

**功能**:**多级目标链接**——一条短链挂最多 10 级目标,支持三种模式:`顺序故障转移`(前面的过期/用尽自动切下一个)、`列表循环`(每次轮换)、`加权随机`(按权重概率分流,失效自动退出);自定义/自动短码、每级独立的有效期与次数上限、计数清零复活、失效短码复用接管;点击统计(访问明细含 IP、UA、Referer、**国家/城市/ASN**,以及语言、Client Hints、Sec-Fetch、网络/TLS 等扩展信息,见[采集的客户端信息](#采集的客户端信息));管理页每条链接可展开「详情」面板(国家分布 + 分级点击统计 + 最近 50 次访问,单次访问可再展开全部字段);每日自动清理过期数据;D1 全球读副本就绪(一键开启后跳转读走最近副本,与 KV 边缘读同级延迟)。

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
├── schema.sql        # 建表语句(新库)
├── migrations/       # 已有库的增量迁移
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

# 已有本地库按顺序升级(只需一次):001 扩展客户端信息 → 002 多级目标
npx wrangler d1 execute short-url --local --file=migrations/001_access_logs_meta.sql
npm run db:migrate:local
```

## 多级目标

创建时选 `targets` 数组(1~10 级)与 `mode`;每级可独立设 `expiresIn`/`maxUses`,`weighted` 模式可设 `weight`(概率份数,1~1000)。三种模式:

| mode | 行为 |
|---|---|
| `sequence`(默认) | 始终服务第一个有效目标,失效自动顺延到下一个 |
| `round_robin` | 每次跳转轮换到下一个有效目标,到尾部回绕 |
| `weighted` | 在有效目标中按 weight 加权随机;目标失效后自动退出、剩余权重重新归一 |

跳转选择/失效判定/短码接管都以 `link_targets` 表为准;单目标链接也有一行 `idx=0` 的目标(旧数据由迁移自动补齐)。 PATCH 替换目标列表时,相同 URL 自动保留历史计数。

## 部署上线

前置:ohtoai.top 的 DNS 已托管在 Cloudflare(已满足),并登录 wrangler:

```bash
npx wrangler login
npx wrangler d1 create short-url --location apac   # 主库选亚太,离访客近
#   把输出的 database_id 填入 wrangler.toml
npm run db:init:remote                             # 建表(新库)
# 已有库按顺序升级(只需一次):001 扩展客户端信息 → 002 多级目标
npx wrangler d1 execute short-url --remote --file=migrations/001_access_logs_meta.sql
npm run db:migrate:remote
npx wrangler secret put CREATE_TOKEN               # 输入一个随机长字符串作为管理令牌
npx wrangler deploy                                # 自动创建 s.ohtoai.top 的精确 DNS 记录(覆盖泛解析)
```

部署完成后访问 **https://s.ohtoai.top/admin** ,输入 CREATE_TOKEN 即可开始使用。

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
    "url": "https://example.com/target",    // 单目标简写;多级目标用下面的 targets(二选一)
    "code": "my-link",      // 可选,2-32 位字母/数字/_/-
    "expiresIn": 86400,     // 可选,有效期(秒)
    "maxUses": 10,          // 可选,最大访问次数
    "mode": "sequence"      // 多级目标时的模式:sequence | round_robin | weighted
  }'
# → { "code": "my-link", "shortUrl": "https://s.ohtoai.top/my-link", ... }
```

**多级目标**(与 `url` 二选一):

```bash
curl -X POST https://s.ohtoai.top/api/create \
  -H "Authorization: Bearer <T>" -H "Content-Type: application/json" \
  -d '{
    "mode": "sequence",         // sequence 顺序故障转移 | round_robin 列表循环 | weighted 加权随机
    "code": "ha",               // 可选
    "targets": [                // 1~10 级,每级独立规则
      { "url": "https://main.example.com",   "maxUses": 1000 },
      { "url": "https://backup.example.com", "expiresIn": 86400 },
      { "url": "https://third.example.com",  "weight": 3 }
    ]
  }'
```

错误码:`400` 参数不合法;`401` 令牌错误;`409` 自定义短码已被占用。

### 列表 / 修改 / 删除 / 访问统计

```bash
curl -H "Authorization: Bearer <T>" https://s.ohtoai.top/api/links
curl -X DELETE -H "Authorization: Bearer <T>" https://s.ohtoai.top/api/links/my-link
curl -H "Authorization: Bearer <T>" https://s.ohtoai.top/api/links/my-link/stats
# → { "code":"my-link", "total":12,
#     "countries":[{"country":"CN","n":9},...],        // 国家分布 Top 10
#     "recent":[{ "ip","ua","referer","country","city","asn","accessed_at",
#                 "meta":{ ... } }, ...] }             // 最近 50 次,meta 为扩展信息对象

# 修改已有短链(部分更新,字段缺省保持不变;显式 null = 取消限制)
curl -X PATCH -H "Authorization: Bearer <T>" -H "Content-Type: application/json" \
  https://s.ohtoai.top/api/links/my-link \
  -d '{ "url": "https://new-target.com",  // 换单目标(作用于第 0 级)
        "expiresIn": 86400,               // 重新计有效期;null = 永久
        "maxUses": 100,                   // 调整次数上限;null = 不限
        "mode": "weighted",               // 切换跳转模式
        "resetCount": true }'             // 可选,把已用次数清零(复活链接)

# PATCH 也可整表替换目标列表(相同 URL 自动保留历史计数;
# 条目 keepExpires: true 表示沿用该 URL 旧的有效期)
curl -X PATCH -H "Authorization: Bearer <T>" -H "Content-Type: application/json" \
  https://s.ohtoai.top/api/links/my-link \
  -d '{ "targets": [ { "url": "https://new.example.com", "maxUses": 50 },
                     { "url": "https://spare.example.com" } ] }'
```

**短码复用**:创建时若自定义短码已被「已过期」或「次数用尽」的链接占用,会自动接管替换(旧访问日志同步清空);占用中的短码仍返回 409。

### 跳转

`GET /:code` → `302` 到目标链接(`Cache-Control: no-store` + `X-Robots-Tag: noindex`,附 `Server-Timing: db;dur=xx` 头可实测数据库耗时)。
不存在 → `404`;已过期或次数用尽 → `410`。

## 采集的客户端信息

纯 302 跳转下,服务端能拿到的就是「请求头 + Cloudflare 边缘注入的 `request.cf`」。核心列(时间、IP、UA、Referer、国家、城市、ASN)之外的字段统一存入 `access_logs.meta`(JSON),管理页「详情 → 单次访问详情」可查看。

| 分组 | 字段 | 说明 |
|---|---|---|
| 请求头 | `accept*`、`accept_language` | 接受的类型、语言偏好 |
| Client Hints | `sec_ch_ua*`、`sec_ch_ua_platform_version`、`sec_ch_ua_model`、`sec_ch_ua_arch`、`sec_ch_ua_bitness` | Chromium 系浏览器;高熵字段(系统版本/设备型号)需要浏览器先收到本域的 `Accept-CH`(跳转响应已声明),通常同一浏览器再次访问时才有 |
| 导航上下文 | `sec_fetch_site/mode/dest/user`、`purpose` | 判断是页面跳转、预取、预渲染,还是 App 内 WebView |
| 隐私信号 | `dnt`、`gpc` | Do Not Track / Global Privacy Control |
| 地理(cf) | `continent`、`region`、`region_code`、`postal_code`、`timezone`、`latitude`、`longitude`、`metro_code`、`is_eu_country` | 免费版通常只有国家/城市,更细字段视套餐而定 |
| 网络/TLS(cf) | `as_organization`、`colo`、`http_protocol`、`tls_version`、`tls_cipher`、`client_tcp_rtt`、`client_accept_encoding` | 运营商/机构、边缘节点、HTTP/TLS 版本、RTT |
| Bot(cf) | `bot_score`、`bot_verified`、`bot_corporate_proxy`、`ja3_hash`、`ja4` 等 | 需 Bot Management(通常企业版);免费版自动省略 |
| 请求本身 | `method`、`host`、`query` | HEAD 访问、访问域名、短链后的查询参数 |

**拿不到的**:屏幕分辨率、字体、Canvas/WebGL、CPU/内存、电池、插件等 —— 这些必须由客户端 JS 执行,而 302 跳转不会渲染任何页面。除非改成「中转页 + JS 上报后再跳转」,代价是多一跳、破坏链接预览且 302 语义丢失,本项目默认不做。

> 隐私提醒:IP、地理位置、设备信息属于个人数据。本项目日志保留 90 天(每日 cron 清理),请按所在地区法规自行评估是否需要在跳转页或站点上做告知。

## 免费额度账

| 资源 | 免费额度 | 本服务消耗 |
|---|---|---|
| Worker 请求 | 10 万/天 | 所有操作共享(总闸门) |
| D1 读 | 500 万行/天 | 每次跳转 1 + 目标级数 行(N 级约 2~11 行) |
| D1 写 | 10 万行/天 | 每次跳转 2~4 行(日志 + 全局计数 + 该级计数,循环模式含游标)→ 约 2.5~5 万跳转/天 |
| D1 读副本 | 无额外费用 | 控制台一键开启 |

个人使用余量极大。若某天流量暴涨,可在 `src/index.ts` 的 `handleRedirect` 中删掉 `INSERT INTO access_logs` 那条语句,写入即减半。

## 数据维护

- 跳转即时校验有效期/次数,不依赖清理任务
- Cron(每日 03:00 UTC)自动清理:90 天前的访问日志、过期超 30 天的链接
- 手动查询:`npx wrangler d1 execute short-url --remote --command "SELECT * FROM links LIMIT 20"`
- 误删恢复:D1 自带 Time Travel,可回溯 30 天内任意时刻

## License

[MIT](LICENSE)
