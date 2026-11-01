/**
 * s.ohtoai.top 短链服务
 * 架构:Cloudflare Workers + D1(纯 D1 单数据源,无 KV)
 *
 * 跳转读路径:D1 Sessions API 走近副本(开启读副本后生效),未命中回查主库兜底,
 * 未开副本时行为不变(全部落到主库)。
 */
import { ADMIN_HTML } from "./admin";
import { LOGO_SVG } from "./logo";

export interface Env {
  /** D1 数据库绑定 */
  DB: D1Database;
  /** 创建/管理接口的 Bearer 令牌,通过 `wrangler secret put CREATE_TOKEN` 设置 */
  CREATE_TOKEN: string;
}

/** links 表完整记录 */
interface LinkRecord {
  code: string;
  url: string;
  created_at: number;
  expires_at: number | null;
  max_uses: number | null;
  used_count: number;
}

/** 跳转时只取的元数据列 */
type LinkMeta = Omit<LinkRecord, "code" | "created_at">;

/** access_logs 表记录(不含自增 id) */
interface AccessLogRecord {
  ip: string | null;
  ua: string | null;
  referer: string | null;
  country: string | null;
  city: string | null;
  asn: number | null;
  accessed_at: number;
}

const DAY = 86400;
const CODE_RE = /^[a-zA-Z0-9_-]{2,32}$/;
const RESERVED_CODES = new Set(["api", "admin", "favicon.ico", "favicon.svg", "logo.svg", "robots.txt"]);
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MAX_AUTO_CODE_ATTEMPTS = 5;

// ---------- 通用工具 ----------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** 404/410 等简单提示页,内容全部是本文件内的常量,无注入面 */
function page(status: number, message: string): Response {
  const html =
    "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">' +
    "<title>" + status + " · s.ohtoai.top</title>" +
    "<style>body{background:#0f1115;color:#e8eaf0;font-family:system-ui,sans-serif;" +
    "display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}" +
    "div{text-align:center}svg{margin-bottom:12px}h1{font-size:64px;margin:0 0 8px;color:#5b9dff}p{color:#9aa3b2}</style>" +
    "</head><body><div>" + LOGO_SVG + "<h1>" + status + "</h1><p>" + message + "</p></div></body></html>";
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

function unauthorized(): Response {
  return json({ error: "未授权:请求头需携带 Authorization: Bearer <CREATE_TOKEN>" }, 401);
}

/** 恒定时间比较,避免令牌校验的时序侧信道 */
function isAuthorized(request: Request, env: Env): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const token = match?.[1] ?? "";
  const expected = env.CREATE_TOKEN;
  if (!expected || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** 短链是否已失效(已过期或次数用尽)——失效短码允许在创建时被复用 */
function isDead(row: { expires_at: number | null; max_uses: number | null; used_count: number }, now: number): boolean {
  return (
    (row.expires_at !== null && now > row.expires_at) ||
    (row.max_uses !== null && row.used_count >= row.max_uses)
  );
}

/** 6 位 base62 短码;拒绝采样(62 × 4 = 248)保证均匀 */
function randomCode(length = 6): string {
  const buf = new Uint8Array(length * 2);
  let out = "";
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte < 248) {
        out += BASE62[byte % 62];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

// ---------- 创建 ----------

async function handleCreate(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "请求体必须是 JSON" }, 400);
  }

  const rawUrl = body.url;
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 2048) {
    return json({ error: "url 必须是不超过 2048 字符的字符串" }, 400);
  }
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return json({ error: "url 格式不合法" }, 400);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return json({ error: "url 仅支持 http/https 协议" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  let expiresAt: number | null = null;
  if (body.expiresIn != null) {
    const v = body.expiresIn;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 10 * 366 * DAY) {
      return json({ error: "expiresIn 必须是 1 ~ " + 10 * 366 * DAY + " 的整数(秒)" }, 400);
    }
    expiresAt = now + v;
  }

  let maxUses: number | null = null;
  if (body.maxUses != null) {
    const v = body.maxUses;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      return json({ error: "maxUses 必须是正整数" }, 400);
    }
    maxUses = v;
  }

  const origin = new URL(request.url).origin;
  const insert =
    "INSERT INTO links (code, url, created_at, expires_at, max_uses) VALUES (?1, ?2, ?3, ?4, ?5)";

  const customCode = body.code;
  if (customCode != null) {
    if (typeof customCode !== "string" || !CODE_RE.test(customCode)) {
      return json({ error: "自定义短码需为 2-32 位字母/数字/下划线/连字符" }, 400);
    }
    if (RESERVED_CODES.has(customCode.toLowerCase())) {
      return json({ error: "该短码是系统保留路径,请换一个" }, 400);
    }
    const existing = await env.DB
      .prepare("SELECT expires_at, max_uses, used_count FROM links WHERE code = ?1")
      .bind(customCode)
      .first<{ expires_at: number | null; max_uses: number | null; used_count: number }>();
    if (existing && !isDead(existing, now)) {
      return json({ error: "该自定义短码已被占用" }, 409);
    }
    if (existing) {
      // 复用已失效的短码:清掉旧访问日志(避免污染新链接的统计),整行替换
      await env.DB.batch([
        env.DB.prepare("DELETE FROM access_logs WHERE code = ?1").bind(customCode),
        env.DB.prepare(
          "INSERT OR REPLACE INTO links (code, url, created_at, expires_at, max_uses, used_count) VALUES (?1, ?2, ?3, ?4, ?5, 0)"
        ).bind(customCode, target.href, now, expiresAt, maxUses),
      ]);
      return json({ code: customCode, shortUrl: origin + "/" + customCode, url: target.href, expiresAt, maxUses, reused: true });
    }
    try {
      await env.DB.prepare(insert).bind(customCode, target.href, now, expiresAt, maxUses).run();
    } catch {
      return json({ error: "该自定义短码已被占用" }, 409);
    }
    return json({ code: customCode, shortUrl: origin + "/" + customCode, url: target.href, expiresAt, maxUses });
  }

  for (let attempt = 0; attempt < MAX_AUTO_CODE_ATTEMPTS; attempt++) {
    const candidate = randomCode();
    try {
      await env.DB.prepare(insert).bind(candidate, target.href, now, expiresAt, maxUses).run();
      return json({ code: candidate, shortUrl: origin + "/" + candidate, url: target.href, expiresAt, maxUses });
    } catch {
      // 唯一键冲突(概率极低),换一个重试
    }
  }
  return json({ error: "短码生成冲突,请重试" }, 500);
}

// ---------- 列表 / 删除 ----------

async function handleList(_request: Request, env: Env): Promise<Response> {
  // first-primary:保证刚创建的链接立刻可见
  const session = env.DB.withSession("first-primary");
  const { results } = await session
    .prepare("SELECT code, url, created_at, expires_at, max_uses, used_count FROM links ORDER BY created_at DESC, code DESC LIMIT 500")
    .all<LinkRecord>();
  return json({ links: results ?? [] });
}

async function handleDelete(_request: Request, env: Env, code: string): Promise<Response> {
  if (!CODE_RE.test(code)) return json({ error: "短码格式不合法" }, 400);
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM links WHERE code = ?1").bind(code),
    env.DB.prepare("DELETE FROM access_logs WHERE code = ?1").bind(code),
  ]);
  if (results[0].meta.changes === 0) {
    return json({ error: "短链不存在" }, 404);
  }
  return json({ deleted: code });
}

// ---------- 跳转 ----------

async function handleRedirect(request: Request, env: Env, ctx: ExecutionContext, code: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const startedAt = Date.now();

  const lookup = "SELECT url, expires_at, max_uses, used_count FROM links WHERE code = ?1";
  let row = await env.DB.withSession().prepare(lookup).bind(code).first<LinkMeta>();
  if (!row) {
    // 副本可能滞后(刚创建的链接),回查主库;未开副本时这一步同样安全
    row = await env.DB.withSession("first-primary").prepare(lookup).bind(code).first<LinkMeta>();
  }
  const dbDur = Date.now() - startedAt;

  if (!row) return page(404, "短链不存在或已被删除");
  if (row.expires_at !== null && now > row.expires_at) {
    return page(410, "该短链已过期");
  }
  if (row.max_uses !== null && row.used_count >= row.max_uses) {
    return page(410, "该短链的访问次数已达上限");
  }

  // 日志与计数异步写入,不阻塞跳转;失败静默(跳转响应已发出)
  // request.cf 由 Cloudflare 边缘注入:国家/城市/ASN 等地理与网络信息
  const cf: Partial<IncomingRequestCfProperties> | undefined = request.cf;
  ctx.waitUntil(
    env.DB.batch([
      env.DB.prepare(
        "INSERT INTO access_logs (code, ip, ua, referer, country, city, asn, accessed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
      ).bind(
        code,
        request.headers.get("cf-connecting-ip"),
        request.headers.get("user-agent"),
        request.headers.get("referer"),
        cf?.country ?? null,
        cf?.city ?? null,
        cf?.asn ?? null,
        now
      ),
      // 带 max_uses 守卫,保证计数不会越过上限
      env.DB.prepare("UPDATE links SET used_count = used_count + 1 WHERE code = ?1 AND (max_uses IS NULL OR used_count < max_uses)").bind(code),
    ]).then(
      () => undefined,
      () => undefined
    )
  );

  return new Response(null, {
    status: 302,
    headers: {
      location: row.url,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "server-timing": "db;dur=" + dbDur,
    },
  });
}

// ---------- 修改 ----------

/**
 * 部分更新一条短链。字段缺省 = 保持不变;显式传 null = 清除该限制。
 * body: { url?, expiresIn?, maxUses?, resetCount? }
 */
async function handleUpdate(request: Request, env: Env, code: string): Promise<Response> {
  if (!CODE_RE.test(code)) return json({ error: "短码格式不合法" }, 400);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "请求体必须是 JSON" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return json({ error: "请求体必须是 JSON 对象" }, 400);
  }

  const current = await env.DB
    .prepare("SELECT url, expires_at, max_uses FROM links WHERE code = ?1")
    .bind(code)
    .first<{ url: string; expires_at: number | null; max_uses: number | null }>();
  if (!current) return json({ error: "短链不存在" }, 404);

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];

  if (body.url !== undefined) {
    const rawUrl = body.url;
    if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 2048) {
      return json({ error: "url 必须是不超过 2048 字符的字符串" }, 400);
    }
    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      return json({ error: "url 格式不合法" }, 400);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return json({ error: "url 仅支持 http/https 协议" }, 400);
    }
    sets.push("url = ?");
    binds.push(target.href);
  }

  if ("expiresIn" in body) {
    const v = body.expiresIn;
    if (v === null) {
      sets.push("expires_at = ?");
      binds.push(null);
    } else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 * 366 * DAY) {
      sets.push("expires_at = ?");
      binds.push(Math.floor(Date.now() / 1000) + v);
    } else {
      return json({ error: "expiresIn 必须是正整数(秒)或 null(永久)" }, 400);
    }
  }

  if ("maxUses" in body) {
    const v = body.maxUses;
    if (v === null) {
      sets.push("max_uses = ?");
      binds.push(null);
    } else if (typeof v === "number" && Number.isInteger(v) && v >= 1) {
      sets.push("max_uses = ?");
      binds.push(v);
    } else {
      return json({ error: "maxUses 必须是正整数或 null(不限)" }, 400);
    }
  }

  if (body.resetCount === true) {
    sets.push("used_count = 0");
  } else if (body.resetCount !== undefined && body.resetCount !== false) {
    return json({ error: "resetCount 必须是布尔值" }, 400);
  }

  if (sets.length === 0) {
    return json({ error: "没有需要修改的字段(可传 url / expiresIn / maxUses / resetCount)" }, 400);
  }

  const sql = "UPDATE links SET " + sets.join(", ") + " WHERE code = ?";
  binds.push(code);
  const result = await env.DB.prepare(sql).bind(...binds).run();
  if (result.meta.changes === 0) return json({ error: "短链不存在" }, 404);

  const updated = await env.DB
    .prepare("SELECT code, url, created_at, expires_at, max_uses, used_count FROM links WHERE code = ?1")
    .bind(code)
    .first<LinkRecord>();
  if (!updated) return json({ error: "短链不存在" }, 404);
  return json({ ...updated, shortUrl: new URL(request.url).origin + "/" + code });
}

// ---------- 访问统计 ----------

async function handleLinkStats(_request: Request, env: Env, code: string): Promise<Response> {
  if (!CODE_RE.test(code)) return json({ error: "短码格式不合法" }, 400);
  const session = env.DB.withSession("first-primary");
  const link = await session
    .prepare("SELECT used_count FROM links WHERE code = ?1")
    .bind(code)
    .first<{ used_count: number }>();
  if (!link) return json({ error: "短链不存在" }, 404);
  const countries = await session
    .prepare("SELECT country, COUNT(*) AS n FROM access_logs WHERE code = ?1 AND country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 10")
    .bind(code)
    .all<{ country: string; n: number }>();
  const recent = await session
    .prepare("SELECT ip, ua, referer, country, city, asn, accessed_at FROM access_logs WHERE code = ?1 ORDER BY accessed_at DESC, id DESC LIMIT 50")
    .bind(code)
    .all<AccessLogRecord>();
  return json({
    code,
    total: link.used_count,
    countries: countries.results ?? [],
    recent: recent.results ?? [],
  });
}

// ---------- 入口 ----------

export default {
  async fetch(request, env, ctx): Promise<Response> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return text("Bad Request", 400);
    }
    const method = request.method.toUpperCase();
    const path = url.pathname;

    if (path === "/") {
      if (method !== "GET" && method !== "HEAD") return text("Method Not Allowed", 405);
      return new Response(null, { status: 302, headers: { location: "/admin", "cache-control": "no-store" } });
    }

    if (path === "/admin") {
      if (method !== "GET" && method !== "HEAD") return text("Method Not Allowed", 405);
      return new Response(ADMIN_HTML, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-robots-tag": "noindex",
        },
      });
    }

    // 图标:SVG 对现代浏览器即 favicon(.ico 路径按内容嗅探同样生效)
    if (path === "/favicon.ico" || path === "/favicon.svg" || path === "/logo.svg") {
      return new Response(LOGO_SVG, {
        status: 200,
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
      });
    }

    // 管理 API(Bearer token 鉴权)
    if (path === "/api/create" && method === "POST") {
      if (!isAuthorized(request, env)) {
        return unauthorized();
      }
      return handleCreate(request, env);
    }
    if (path === "/api/links" && method === "GET") {
      if (!isAuthorized(request, env)) {
        return unauthorized();
      }
      return handleList(request, env);
    }
    const statsMatch = /^\/api\/links\/([^/]+)\/stats$/.exec(path);
    if (statsMatch && method === "GET") {
      if (!isAuthorized(request, env)) return unauthorized();
      let code: string;
      try {
        code = decodeURIComponent(statsMatch[1]);
      } catch {
        return json({ error: "短码格式不合法" }, 400);
      }
      return handleLinkStats(request, env, code);
    }
    const deleteMatch = /^\/api\/links\/([^/]+)$/.exec(path);
    if (deleteMatch && (method === "PATCH" || method === "PUT")) {
      if (!isAuthorized(request, env)) return unauthorized();
      let code: string;
      try {
        code = decodeURIComponent(deleteMatch[1]);
      } catch {
        return json({ error: "短码格式不合法" }, 400);
      }
      return handleUpdate(request, env, code);
    }
    if (deleteMatch && method === "DELETE") {
      if (!isAuthorized(request, env)) {
        return unauthorized();
      }
      let code: string;
      try {
        code = decodeURIComponent(deleteMatch[1]);
      } catch {
        return json({ error: "短码格式不合法" }, 400);
      }
      return handleDelete(request, env, code);
    }
    if (path.startsWith("/api/")) return json({ error: "接口不存在" }, 404);

    // 跳转:GET /:code
    if (method !== "GET" && method !== "HEAD") return text("Method Not Allowed", 405);
    let code: string;
    try {
      code = decodeURIComponent(path.slice(1));
    } catch {
      return page(404, "链接不合法");
    }
    // 非法格式直接 404,不查库(扫描器/探测流量在此被挡掉)
    if (!code || code.includes("/") || !CODE_RE.test(code)) {
      return page(404, "短链不存在或已被删除");
    }
    return handleRedirect(request, env, ctx, code);
  },

  // 每日清理:90 天前的访问日志、过期超 30 天的链接
  async scheduled(_controller, env, ctx): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    ctx.waitUntil(
      (async () => {
        await env.DB.prepare("DELETE FROM access_logs WHERE accessed_at < ?1").bind(now - 90 * DAY).run();
        await env.DB.prepare("DELETE FROM links WHERE expires_at IS NOT NULL AND expires_at < ?1").bind(now - 30 * DAY).run();
      })()
    );
  },
} satisfies ExportedHandler<Env>;
