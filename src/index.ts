/**
 * s.ohtoai.top 短链服务
 * 架构:Cloudflare Workers + D1(纯 D1 单数据源,无 KV)
 *
 * 跳转读路径:D1 Sessions API 走近副本(开启读副本后生效),未命中回查主库兜底,
 * 未开副本时行为不变(全部落到主库)。
 *
 * 多级目标:一条短链可配置 1~10 级目标(link_targets 表,单目标也有 idx=0 一行),
 * 模式 mode:sequence(顺序故障转移)| round_robin(列表循环)| weighted(按权重随机)。
 * links.expires_at/max_uses 只是第 0 级的镜像(兼容展示),判定一律以 link_targets 为准。
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
  mode: string;
  rr_cursor: number;
}

/** link_targets 表记录 */
interface TargetRecord {
  idx: number;
  url: string;
  expires_at: number | null;
  max_uses: number | null;
  used_count: number;
  weight: number;
}

/** access_logs 表记录(不含自增 id) */
interface AccessLogRecord {
  ip: string | null;
  ua: string | null;
  referer: string | null;
  country: string | null;
  city: string | null;
  asn: number | null;
  target_idx: number | null;
  /** 扩展客户端信息(JSON 文本),见 collectClientMeta */
  meta: string | null;
  accessed_at: number;
}

const DAY = 86400;
const CODE_RE = /^[a-zA-Z0-9_-]{2,32}$/;
const RESERVED_CODES = new Set(["api", "admin", "favicon.ico", "favicon.svg", "logo.svg", "robots.txt"]);
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MAX_AUTO_CODE_ATTEMPTS = 5;
const MODES = new Set(["sequence", "round_robin", "weighted"]);
const MAX_TARGETS = 10;
/** 永不过期目标在“最晚过期时间”聚合里的哨兵值(2100-01-01) */
const NEVER_EXPIRES_SENTINEL = 4102444800;

/** 扩展信息单个值最长保留字符数,防止异常超长请求头撑大 D1 行 */
const CLIENT_VALUE_MAX = 1024;
/** UA / Referer 单独放宽,保证浏览器信息完整 */
const UA_MAX = 2048;

/**
 * 额外采集的请求头:meta 键 → 请求头名。
 * 其中 Sec-CH-UA-* 属于 Client Hints,高熵字段需要服务端先返回 Accept-CH
 * (已在跳转响应里声明),浏览器下次访问同域时才会带上。
 */
const EXTRA_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["accept", "accept"],
  ["accept_language", "accept-language"],
  ["sec_ch_ua", "sec-ch-ua"],
  ["sec_ch_ua_mobile", "sec-ch-ua-mobile"],
  ["sec_ch_ua_platform", "sec-ch-ua-platform"],
  ["sec_ch_ua_platform_version", "sec-ch-ua-platform-version"],
  ["sec_ch_ua_model", "sec-ch-ua-model"],
  ["sec_ch_ua_full_version_list", "sec-ch-ua-full-version-list"],
  ["sec_ch_ua_arch", "sec-ch-ua-arch"],
  ["sec_ch_ua_bitness", "sec-ch-ua-bitness"],
  ["sec_fetch_site", "sec-fetch-site"],
  ["sec_fetch_mode", "sec-fetch-mode"],
  ["sec_fetch_dest", "sec-fetch-dest"],
  ["sec_fetch_user", "sec-fetch-user"],
  ["dnt", "dnt"],
  ["gpc", "sec-gpc"],
  ["priority", "priority"],
  ["upgrade_insecure_requests", "upgrade-insecure-requests"],
];

/** 额外采集的 request.cf 字段:meta 键 → cf 字段(免费版没有的会自动省略) */
const EXTRA_CF_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["continent", "continent"],
  ["region", "region"],
  ["region_code", "regionCode"],
  ["postal_code", "postalCode"],
  ["timezone", "timezone"],
  ["latitude", "latitude"],
  ["longitude", "longitude"],
  ["metro_code", "metroCode"],
  ["as_organization", "asOrganization"],
  ["is_eu_country", "isEUCountry"],
  ["colo", "colo"],
  ["http_protocol", "httpProtocol"],
  ["tls_version", "tlsVersion"],
  ["tls_cipher", "tlsCipher"],
  ["client_tcp_rtt", "clientTcpRtt"],
  ["client_accept_encoding", "clientAcceptEncoding"],
  ["request_priority", "requestPriority"],
  ["edge_keepalive", "edgeRequestKeepAliveStatus"],
  ["verified_bot_category", "verifiedBotCategory"],
];

/** Cloudflare Bot Management 子字段(需开通 Bot Management,免费版不存在) */
const EXTRA_BOT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["bot_score", "score"],
  ["bot_verified", "verifiedBot"],
  ["bot_corporate_proxy", "corporateProxy"],
  ["bot_static_resource", "staticResource"],
  ["bot_detection_ids", "detectionIds"],
  ["ja3_hash", "ja3Hash"],
  ["ja4", "ja4"],
];

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

/** 目标是否仍然有效(未过期且未用尽)——失效目标在跳转时被跳过,失效短码可被复用 */
function isTargetAlive(
  t: { expires_at: number | null; max_uses: number | null; used_count: number },
  now: number
): boolean {
  return (
    (t.expires_at === null || now <= t.expires_at) &&
    (t.max_uses === null || t.used_count < t.max_uses)
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

/** 超长值截断,避免异常请求撑大日志行(UTF-16 长度,足够用) */
function clip(value: string | null, max = CLIENT_VALUE_MAX): string | null {
  return value !== null && value.length > max ? value.slice(0, max) : value;
}

/** 客户端 IP:生产环境 Cloudflare 必注入 cf-connecting-ip,其余为本地/代理场景兜底 */
function clientIp(request: Request): string | null {
  const direct = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  if (direct) return clip(direct);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
  return forwarded ? clip(forwarded) : null;
}

/**
 * 把「核心列以外」的客户端信息打包成 JSON:
 * 请求头白名单 + request.cf 地理/网络/TLS 字段 + Bot Management。
 * 未开通/不适用的字段自动省略,不占空间;单条 meta 通常 < 1 KB。
 */
function collectClientMeta(request: Request, url: URL): string {
  const cf = request.cf as unknown as Record<string, unknown> | undefined;
  const meta: Record<string, unknown> = {};

  for (const [key, header] of EXTRA_HEADERS) {
    const value = request.headers.get(header);
    if (value) meta[key] = clip(value);
  }

  // 预取/预渲染标记:不同浏览器用的头不同,合并成一个字段
  const purpose =
    request.headers.get("sec-purpose") ??
    request.headers.get("purpose") ??
    request.headers.get("x-purpose") ??
    request.headers.get("x-moz");
  if (purpose) meta.purpose = clip(purpose);

  meta.method = request.method;
  meta.host = url.host;
  if (url.search) meta.query = clip(url.search);

  for (const [key, field] of EXTRA_CF_FIELDS) {
    const value = cf?.[field];
    if (value !== undefined && value !== null && value !== "") meta[key] = value;
  }

  const bot = cf?.botManagement as Record<string, unknown> | undefined;
  if (bot && typeof bot === "object") {
    for (const [key, field] of EXTRA_BOT_FIELDS) {
      const value = bot[field];
      if (Array.isArray(value)) {
        if (value.length > 0) meta[key] = value;
      } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        meta[key] = value;
      }
    }
  }

  return JSON.stringify(meta);
}

/** 读取 meta JSON;旧数据(无 meta)或损坏数据返回 null */
function parseMeta(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ---------- 目标列表 ----------

/** 解析后的单个目标(创建/替换用);keepExpires 表示沿用同 URL 旧目标的过期时间 */
interface ParsedTarget {
  url: string;
  expiresAt: number | null;
  maxUses: number | null;
  weight: number;
  keepExpires?: boolean;
}

type ParsedTargets = { ok: true; targets: ParsedTarget[] } | { ok: false; error: string };

/**
 * 校验并规范化 targets 数组。
 * @param oldByUrl PATCH 替换场景下的旧目标表(URL → 记录),keepExpires 时沿用旧过期时间
 */
function parseTargets(
  raw: unknown,
  now: number,
  oldByUrl?: Map<string, Pick<TargetRecord, "expires_at" | "used_count">>
): ParsedTargets {
  if (!Array.isArray(raw)) return { ok: false, error: "targets 必须是数组" };
  if (raw.length < 1) return { ok: false, error: "targets 至少需要 1 个目标" };
  if (raw.length > MAX_TARGETS) return { ok: false, error: "targets 最多 " + MAX_TARGETS + " 个" };
  const out: ParsedTarget[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return { ok: false, error: "targets 元素必须是对象" };
    const t = item as Record<string, unknown>;

    const rawUrl = t.url;
    if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 2048) {
      return { ok: false, error: "targets[].url 必须是不超过 2048 字符的字符串" };
    }
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return { ok: false, error: "targets[].url 格式不合法" };
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "targets[].url 仅支持 http/https 协议" };
    }

    let expiresAt: number | null = null;
    if (t.keepExpires === true) {
      expiresAt = oldByUrl?.get(u.href)?.expires_at ?? null;
    } else if (t.expiresIn != null) {
      const v = t.expiresIn;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 10 * 366 * DAY) {
        return { ok: false, error: "targets[].expiresIn 必须是 1 ~ " + 10 * 366 * DAY + " 的整数(秒)" };
      }
      expiresAt = now + v;
    }

    let maxUses: number | null = null;
    if (t.maxUses != null) {
      const v = t.maxUses;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
        return { ok: false, error: "targets[].maxUses 必须是正整数" };
      }
      maxUses = v;
    }

    let weight = 1;
    if (t.weight != null) {
      const v = t.weight;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1000) {
        return { ok: false, error: "targets[].weight 必须是 1 ~ 1000 的整数" };
      }
      weight = v;
    }

    out.push({ url: u.href, expiresAt, maxUses, weight, keepExpires: t.keepExpires === true });
  }
  return { ok: true, targets: out };
}

/** 目标行插入语句(idx 由调用方给) */
function targetInsert(env: Env): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO link_targets (link_code, idx, url, expires_at, max_uses, used_count, weight) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
  );
}

// ---------- 创建 ----------

async function handleCreate(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "请求体必须是 JSON" }, 400);
  }

  const hasTargets = body.targets != null;
  const hasUrl = body.url != null;
  if (hasTargets && hasUrl) {
    return json({ error: "url 与 targets 只能二选一(targets 数组即多级目标)" }, 400);
  }

  let mode = "sequence";
  if (body.mode != null) {
    if (typeof body.mode !== "string" || !MODES.has(body.mode)) {
      return json({ error: "mode 必须是 sequence / round_robin / weighted" }, 400);
    }
    mode = body.mode;
  }

  const now = Math.floor(Date.now() / 1000);
  const origin = new URL(request.url).origin;

  // 单目标简写:构造等价的单元素 targets(兼容旧 API)
  if (!hasTargets) {
    body.targets = [{ url: body.url, expiresIn: body.expiresIn, maxUses: body.maxUses }];
  }
  const parsed = parseTargets(body.targets, now);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const targets = parsed.targets;
  const primary = targets[0];

  // 短码:自定义或自动生成
  let code = "";
  let takeover = false;
  const customCode = body.code;
  if (customCode != null) {
    if (typeof customCode !== "string" || !CODE_RE.test(customCode)) {
      return json({ error: "自定义短码需为 2-32 位字母/数字/下划线/连字符" }, 400);
    }
    if (RESERVED_CODES.has(customCode.toLowerCase())) {
      return json({ error: "该短码是系统保留路径,请换一个" }, 400);
    }
    code = customCode;
    const existing = await env.DB.prepare("SELECT code FROM links WHERE code = ?1").bind(code).first();
    if (existing) {
      const old = (
        await env.DB
          .prepare("SELECT expires_at, max_uses, used_count FROM link_targets WHERE link_code = ?1")
          .bind(code)
          .all<{ expires_at: number | null; max_uses: number | null; used_count: number }>()
      ).results ?? [];
      // 所有目标都失效(或没有目标行)才允许接管复用
      if (old.some((t) => isTargetAlive(t, now))) {
        return json({ error: "该自定义短码已被占用" }, 409);
      }
      takeover = true;
    }
  }

  /** 组装写入批次;takeover 时先清空旧日志与旧目标 */
  const buildOps = (withMetaIgnoredCode: string): D1PreparedStatement[] => {
    const ops: D1PreparedStatement[] = [];
    if (takeover) {
      ops.push(env.DB.prepare("DELETE FROM access_logs WHERE code = ?1").bind(withMetaIgnoredCode));
      ops.push(env.DB.prepare("DELETE FROM link_targets WHERE link_code = ?1").bind(withMetaIgnoredCode));
    }
    ops.push(
      (takeover
        ? env.DB.prepare(
            "INSERT OR REPLACE INTO links (code, url, created_at, expires_at, max_uses, used_count, mode, rr_cursor) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 0)"
          )
        : env.DB.prepare(
            "INSERT INTO links (code, url, created_at, expires_at, max_uses, used_count, mode, rr_cursor) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, 0)"
          )
      ).bind(withMetaIgnoredCode, primary.url, now, primary.expiresAt, primary.maxUses, mode)
    );
    targets.forEach((t, i) => {
      ops.push(targetInsert(env).bind(withMetaIgnoredCode, i, t.url, t.expiresAt, t.maxUses, 0, t.weight));
    });
    return ops;
  };

  if (customCode != null) {
    try {
      await env.DB.batch(buildOps(code));
    } catch {
      // 自定义码在检查后与他人并发冲突
      return json({ error: "该自定义短码已被占用" }, 409);
    }
    return json({
      code,
      shortUrl: origin + "/" + code,
      url: primary.url,
      expiresAt: primary.expiresAt,
      maxUses: primary.maxUses,
      mode,
      targets,
      ...(takeover ? { reused: true } : {}),
    });
  }

  for (let attempt = 0; attempt < MAX_AUTO_CODE_ATTEMPTS; attempt++) {
    const candidate = randomCode();
    try {
      await env.DB.batch(buildOps(candidate));
      return json({
        code: candidate,
        shortUrl: origin + "/" + candidate,
        url: primary.url,
        expiresAt: primary.expiresAt,
        maxUses: primary.maxUses,
        mode,
        targets,
      });
    } catch {
      // 唯一键冲突(概率极低),换一个重试
    }
  }
  return json({ error: "短码生成冲突,请重试" }, 500);
}

// ---------- 列表 / 删除 ----------

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function handleList(_request: Request, env: Env): Promise<Response> {
  // first-primary:保证刚创建的链接立刻可见
  const session = env.DB.withSession("first-primary");
  const { results } = await session
    .prepare("SELECT code, url, created_at, expires_at, max_uses, used_count, mode FROM links ORDER BY created_at DESC, code DESC LIMIT 500")
    .all<LinkRecord>();
  const links = results ?? [];

  const byCode = new Map<string, TargetRecord[]>();
  for (const group of chunk(
    links.map((l) => l.code),
    80
  )) {
    const placeholders = group.map(() => "?").join(", ");
    const { results: trows } = await session
      .prepare(
        "SELECT link_code, idx, url, expires_at, max_uses, used_count, weight FROM link_targets WHERE link_code IN (" +
          placeholders +
          ") ORDER BY link_code, idx"
      )
      .bind(...group)
      .all<TargetRecord & { link_code: string }>();
    for (const t of trows ?? []) {
      const list = byCode.get(t.link_code) ?? [];
      list.push({ idx: t.idx, url: t.url, expires_at: t.expires_at, max_uses: t.max_uses, used_count: t.used_count, weight: t.weight });
      byCode.set(t.link_code, list);
    }
  }

  return json({
    links: links.map((l) => ({ ...l, targets: byCode.get(l.code) ?? [] })),
  });
}

async function handleDelete(_request: Request, env: Env, code: string): Promise<Response> {
  if (!CODE_RE.test(code)) return json({ error: "短码格式不合法" }, 400);
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM links WHERE code = ?1").bind(code),
    env.DB.prepare("DELETE FROM link_targets WHERE link_code = ?1").bind(code),
    env.DB.prepare("DELETE FROM access_logs WHERE code = ?1").bind(code),
  ]);
  if (results[0].meta.changes === 0) {
    return json({ error: "短链不存在" }, 404);
  }
  return json({ deleted: code });
}

// ---------- 跳转 ----------

async function handleRedirect(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  code: string,
  url: URL
): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const startedAt = Date.now();

  const lookupLink = "SELECT mode, rr_cursor FROM links WHERE code = ?1";
  const lookupTargets =
    "SELECT idx, url, expires_at, max_uses, used_count, weight FROM link_targets WHERE link_code = ?1 ORDER BY idx";

  let link = await env.DB.withSession().prepare(lookupLink).bind(code).first<{ mode: string; rr_cursor: number }>();
  let targets: TargetRecord[] = link
    ? ((await env.DB.withSession().prepare(lookupTargets).bind(code).all<TargetRecord>()).results ?? [])
    : [];
  if (!link || targets.length === 0) {
    // 副本可能滞后(刚创建的链接),回查主库;未开副本时这一步同样安全
    const primary = env.DB.withSession("first-primary");
    link = await primary.prepare(lookupLink).bind(code).first<{ mode: string; rr_cursor: number }>();
    targets = link
      ? ((await primary.prepare(lookupTargets).bind(code).all<TargetRecord>()).results ?? [])
      : [];
  }
  const dbDur = Date.now() - startedAt;

  if (!link || targets.length === 0) return page(404, "短链不存在或已被删除");

  const alive = targets.filter((t) => isTargetAlive(t, now));
  if (alive.length === 0) {
    if (targets.length === 1) {
      const t0 = targets[0];
      if (t0.expires_at !== null && now > t0.expires_at) return page(410, "该短链已过期");
      return page(410, "该短链的访问次数已达上限");
    }
    return page(410, "该短链的所有目标均已过期或次数用尽");
  }

  // 按 mode 选择目标
  let chosen = alive[0];
  let nextCursor: number | null = null;
  if (link.mode === "round_robin") {
    const n = targets.length;
    let p = ((link.rr_cursor % n) + n) % n;
    for (let k = 0; k < n; k++) {
      if (isTargetAlive(targets[(p + k) % n], now)) {
        p = (p + k) % n;
        break;
      }
    }
    chosen = targets[p];
    nextCursor = (p + 1) % n;
  } else if (link.mode === "weighted") {
    const weights = alive.map((t) => (t.weight > 0 ? t.weight : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const pick = (crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * total;
    let acc = 0;
    for (let i = 0; i < alive.length; i++) {
      acc += weights[i];
      if (pick < acc) {
        chosen = alive[i];
        break;
      }
    }
  }
  // sequence(默认):alive 已按 idx 排序,取第一个即“当前目标失效自动顺延”

  // 日志与计数异步写入,不阻塞跳转;失败静默(跳转响应已发出)
  // request.cf 由 Cloudflare 边缘注入:国家/城市/ASN 等地理与网络信息
  const cf: Partial<IncomingRequestCfProperties> | undefined = request.cf;
  const buildOps = (withMeta: boolean): D1PreparedStatement[] => {
    const log = withMeta
      ? env.DB
          .prepare(
            "INSERT INTO access_logs (code, ip, ua, referer, country, city, asn, target_idx, meta, accessed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
          )
          .bind(
            code,
            clientIp(request),
            clip(request.headers.get("user-agent"), UA_MAX),
            clip(request.headers.get("referer"), UA_MAX),
            cf?.country ?? request.headers.get("cf-ipcountry") ?? null,
            cf?.city ?? null,
            cf?.asn ?? null,
            chosen.idx,
            collectClientMeta(request, url),
            now
          )
      : env.DB
          .prepare(
            "INSERT INTO access_logs (code, ip, ua, referer, country, city, asn, target_idx, accessed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
          )
          .bind(
            code,
            clientIp(request),
            clip(request.headers.get("user-agent"), UA_MAX),
            clip(request.headers.get("referer"), UA_MAX),
            cf?.country ?? request.headers.get("cf-ipcountry") ?? null,
            cf?.city ?? null,
            cf?.asn ?? null,
            chosen.idx,
            now
          );
    const ops = [
      log,
      env.DB.prepare("UPDATE links SET used_count = used_count + 1 WHERE code = ?1").bind(code),
      // 该级计数带 max_uses 守卫,保证不会越过上限
      env.DB
        .prepare(
          "UPDATE link_targets SET used_count = used_count + 1 WHERE link_code = ?1 AND idx = ?2 AND (max_uses IS NULL OR used_count < max_uses)"
        )
        .bind(code, chosen.idx),
    ];
    if (nextCursor !== null) {
      ops.push(env.DB.prepare("UPDATE links SET rr_cursor = ?1 WHERE code = ?2").bind(nextCursor, code));
    }
    return ops;
  };
  // 旧库若尚未执行迁移,新列不存在;退回只写核心列,保证计数与日志不中断
  ctx.waitUntil(
    env.DB.batch(buildOps(true)).catch(() => env.DB.batch(buildOps(false))).catch(() => undefined)
  );

  return new Response(null, {
    status: 302,
    headers: {
      location: chosen.url,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "server-timing": "db;dur=" + dbDur,
      // 让 Chromium 系浏览器下次访问本域时带上高熵 Client Hints(设备型号/系统版本等)
      "accept-ch":
        "Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model, Sec-CH-UA-Arch, Sec-CH-UA-Bitness",
    },
  });
}

// ---------- 修改 ----------

/**
 * 部分更新一条短链。
 * body: { url?, expiresIn?, maxUses?, resetCount?, mode?, targets? }
 * - targets 数组:整表替换该链接的目标列表(相同 URL 自动保留历史计数;
 *   条目里 keepExpires: true 表示沿用同 URL 旧目标的过期时间),links 镜像同步为第 0 级
 * - url/expiresIn/maxUses:传统单目标写法,等价作用于第 0 级目标
 * - 字段缺省 = 保持不变;显式传 null = 清除该限制
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
    .prepare("SELECT code FROM links WHERE code = ?1")
    .bind(code)
    .first();
  if (!current) return json({ error: "短链不存在" }, 404);

  let modeUpdate: string | null = null;
  if (body.mode != null) {
    if (typeof body.mode !== "string" || !MODES.has(body.mode)) {
      return json({ error: "mode 必须是 sequence / round_robin / weighted" }, 400);
    }
    modeUpdate = body.mode;
  }

  if (body.resetCount != null && typeof body.resetCount !== "boolean") {
    return json({ error: "resetCount 必须是布尔值" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  if (body.targets != null) {
    if (body.url != null) {
      return json({ error: "url 与 targets 只能二选一" }, 400);
    }
    const old = (
      await env.DB
        .prepare("SELECT url, used_count, expires_at FROM link_targets WHERE link_code = ?1")
        .bind(code)
        .all<{ url: string; used_count: number; expires_at: number | null }>()
    ).results ?? [];
    const oldByUrl = new Map(old.map((r) => [r.url, r]));
    const parsed = parseTargets(body.targets, now, oldByUrl);
    if (!parsed.ok) return json({ error: parsed.error }, 400);

    const ops: D1PreparedStatement[] = [
      env.DB.prepare("DELETE FROM link_targets WHERE link_code = ?1").bind(code),
    ];
    parsed.targets.forEach((t, i) => {
      ops.push(
        targetInsert(env).bind(
          code,
          i,
          t.url,
          t.expiresAt,
          t.maxUses,
          oldByUrl.get(t.url)?.used_count ?? 0, // 相同 URL 保留历史计数
          t.weight
        )
      );
    });
    ops.push(
      env.DB
        .prepare("UPDATE links SET url = ?1, expires_at = ?2, max_uses = ?3, mode = COALESCE(?4, mode) WHERE code = ?5")
        .bind(parsed.targets[0].url, parsed.targets[0].expiresAt, parsed.targets[0].maxUses, modeUpdate, code)
    );
    if (body.resetCount === true) {
      ops.push(env.DB.prepare("UPDATE links SET used_count = 0 WHERE code = ?1").bind(code));
      ops.push(env.DB.prepare("UPDATE link_targets SET used_count = 0 WHERE link_code = ?1").bind(code));
    }
    await env.DB.batch(ops);
  } else {
    // 传统单目标字段:同步写第 0 级目标 + links 镜像
    const setsL: string[] = [];
    const bindsL: (string | number | null)[] = [];
    const setsT: string[] = [];
    const bindsT: (string | number | null)[] = [];

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
      setsL.push("url = ?");
      bindsL.push(target.href);
      setsT.push("url = ?");
      bindsT.push(target.href);
    }

    if ("expiresIn" in body) {
      const v = body.expiresIn;
      if (v === null) {
        setsL.push("expires_at = ?");
        bindsL.push(null);
        setsT.push("expires_at = ?");
        bindsT.push(null);
      } else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 * 366 * DAY) {
        const exp = now + v;
        setsL.push("expires_at = ?");
        bindsL.push(exp);
        setsT.push("expires_at = ?");
        bindsT.push(exp);
      } else {
        return json({ error: "expiresIn 必须是正整数(秒)或 null(永久)" }, 400);
      }
    }

    if ("maxUses" in body) {
      const v = body.maxUses;
      if (v === null) {
        setsL.push("max_uses = ?");
        bindsL.push(null);
        setsT.push("max_uses = ?");
        bindsT.push(null);
      } else if (typeof v === "number" && Number.isInteger(v) && v >= 1) {
        setsL.push("max_uses = ?");
        bindsL.push(v);
        setsT.push("max_uses = ?");
        bindsT.push(v);
      } else {
        return json({ error: "maxUses 必须是正整数或 null(不限)" }, 400);
      }
    }

    if (modeUpdate !== null) {
      setsL.push("mode = ?");
      bindsL.push(modeUpdate);
    }

    if (body.resetCount === true) {
      setsL.push("used_count = 0");
      setsT.push("used_count = 0");
    }

    if (setsL.length === 0 && setsT.length === 0) {
      return json({ error: "没有需要修改的字段(可传 url / expiresIn / maxUses / resetCount / mode / targets)" }, 400);
    }

    // 自愈:极端情况下第 0 级目标行缺失时补一行(正常迁移后不会走到)
    await env.DB
      .prepare(
        "INSERT OR IGNORE INTO link_targets (link_code, idx, url, expires_at, max_uses, used_count, weight) SELECT code, 0, url, expires_at, max_uses, used_count, 1 FROM links WHERE code = ?1"
      )
      .bind(code)
      .run();

    if (setsT.length > 0) {
      const sqlT = "UPDATE link_targets SET " + setsT.join(", ") + " WHERE link_code = ? AND idx = 0";
      bindsT.push(code);
      await env.DB.prepare(sqlT).bind(...bindsT).run();
    }
    if (setsL.length > 0) {
      const sqlL = "UPDATE links SET " + setsL.join(", ") + " WHERE code = ?";
      bindsL.push(code);
      const result = await env.DB.prepare(sqlL).bind(...bindsL).run();
      if (result.meta.changes === 0) return json({ error: "短链不存在" }, 404);
    }
  }

  const session = env.DB.withSession("first-primary");
  const updated = await session
    .prepare("SELECT code, url, created_at, expires_at, max_uses, used_count, mode FROM links WHERE code = ?1")
    .bind(code)
    .first<LinkRecord>();
  if (!updated) return json({ error: "短链不存在" }, 404);
  const targets = (
    await session
      .prepare("SELECT idx, url, expires_at, max_uses, used_count, weight FROM link_targets WHERE link_code = ?1 ORDER BY idx")
      .bind(code)
      .all<TargetRecord>()
  ).results ?? [];
  return json({ ...updated, targets, shortUrl: new URL(request.url).origin + "/" + code });
}

// ---------- 访问统计 ----------

async function handleLinkStats(_request: Request, env: Env, code: string): Promise<Response> {
  if (!CODE_RE.test(code)) return json({ error: "短码格式不合法" }, 400);
  const session = env.DB.withSession("first-primary");
  const link = await session
    .prepare("SELECT used_count, mode FROM links WHERE code = ?1")
    .bind(code)
    .first<{ used_count: number; mode: string }>();
  if (!link) return json({ error: "短链不存在" }, 404);
  const countries = await session
    .prepare("SELECT country, COUNT(*) AS n FROM access_logs WHERE code = ?1 AND country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 10")
    .bind(code)
    .all<{ country: string; n: number }>();
  const targets = (
    await session
      .prepare("SELECT idx, url, expires_at, max_uses, used_count, weight FROM link_targets WHERE link_code = ?1 ORDER BY idx")
      .bind(code)
      .all<TargetRecord>()
  ).results ?? [];
  const recent = await session
    .prepare("SELECT ip, ua, referer, country, city, asn, target_idx, meta, accessed_at FROM access_logs WHERE code = ?1 ORDER BY accessed_at DESC, id DESC LIMIT 50")
    .bind(code)
    .all<AccessLogRecord>();
  return json({
    code,
    total: link.used_count,
    mode: link.mode,
    countries: countries.results ?? [],
    targets,
    recent: (recent.results ?? []).map((row) => ({ ...row, meta: parseMeta(row.meta) })),
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
    return handleRedirect(request, env, ctx, code, url);
  },

  // 每日清理:90 天前的访问日志;所有目标均已过期超 30 天的链接及其目标行
  async scheduled(_controller, env, ctx): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - 30 * DAY;
    ctx.waitUntil(
      (async () => {
        await env.DB.prepare("DELETE FROM access_logs WHERE accessed_at < ?1").bind(now - 90 * DAY).run();
        // 链接的全部目标都在 30 天前过期(永久目标视为 2100 年,不会被清)
        await env.DB
          .prepare(
            "DELETE FROM links WHERE code IN (SELECT l.code FROM links l JOIN link_targets t ON t.link_code = l.code GROUP BY l.code HAVING MAX(COALESCE(t.expires_at, " +
              NEVER_EXPIRES_SENTINEL +
              ")) < ?1)"
          )
          .bind(cutoff)
          .run();
        // 防御:无任何目标行且创建时间早于清理线的链接
        await env.DB
          .prepare("DELETE FROM links WHERE created_at < ?1 AND code NOT IN (SELECT link_code FROM link_targets)")
          .bind(cutoff)
          .run();
        // 目标行孤儿清理
        await env.DB.prepare("DELETE FROM link_targets WHERE link_code NOT IN (SELECT code FROM links)").run();
      })()
    );
  },
} satisfies ExportedHandler<Env>;
