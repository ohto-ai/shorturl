/**
 * 管理后台单页(内嵌 HTML,无需静态资源/自定义构建)
 * 令牌保存在浏览器 localStorage,所有管理操作通过 Bearer token 调用本 Worker 的 API。
 */
import { LOGO_SVG } from "./logo";

// 用 String.raw 保留内嵌脚本正则里的反斜杠(模板字符串会吞掉 \d、\s、\/ 等)
export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>短链管理 · s.ohtoai.top</title>
<style>
  :root { --bg:#0f1115; --card:#171a21; --line:#262b36; --text:#e8eaf0; --muted:#9aa3b2;
          --accent:#5b9dff; --ok:#3ecf8e; --warn:#f0a35e; --bad:#ff6b6b; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
  .wrap { max-width:880px; margin:0 auto; padding:32px 16px 64px; }
  h1 { font-size:22px; margin:0; }
  .brand { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
  .brand svg { width:30px; height:30px; border-radius:8px; flex:0 0 auto; }
  h2 { font-size:16px; margin:0; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:0; }
  .topbar { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; }
  .gh { color:var(--muted); padding:7px; border-radius:8px; border:1px solid var(--line);
        background:var(--card); transition:color .15s, transform .15s; }
  .gh:hover { color:var(--text); transform:translateY(-1px); }
  .gh svg { width:24px; height:24px; display:block; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:20px; }
  label { display:block; font-size:13px; color:var(--muted); margin:12px 0 6px; }
  input, select { width:100%; background:#0d0f14; border:1px solid var(--line); color:var(--text);
                  border-radius:8px; padding:10px 12px; font-size:14px; outline:none; }
  input:focus, select:focus { border-color:var(--accent); }
  .row { display:flex; gap:10px; flex-wrap:wrap; }
  .row > * { flex:1; min-width:150px; }
  button { background:var(--accent); border:none; color:#fff; border-radius:8px; padding:10px 18px;
           font-size:14px; cursor:pointer; }
  button.ghost { background:transparent; border:1px solid var(--line); color:var(--muted); }
  button:hover { filter:brightness(1.12); }
  button:disabled { opacity:.55; cursor:not-allowed; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--muted); font-weight:500; padding:8px 10px;
       border-bottom:1px solid var(--line); white-space:nowrap; }
  td { padding:10px; border-bottom:1px solid var(--line); vertical-align:top; word-break:break-all; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .hint { color:var(--muted); font-size:12px; margin-top:10px; line-height:1.6; }
  .msg { border-radius:8px; padding:12px 14px; font-size:14px; margin-top:14px;
         display:flex; align-items:center; gap:10px; word-break:break-all; }
  .msg.ok { background:rgba(62,207,142,.12); color:var(--ok); }
  .msg.err { background:rgba(255,107,107,.12); color:var(--bad); }
  .tag { display:inline-block; border-radius:6px; padding:2px 8px; font-size:12px; white-space:nowrap; }
  .tag.ok { color:var(--ok); background:rgba(62,207,142,.12); }
  .tag.warn { color:var(--warn); background:rgba(240,163,94,.12); }
  .tag.bad { color:var(--bad); background:rgba(255,107,107,.12); }
  .tag.info { color:var(--accent); background:rgba(91,157,255,.12); }
  .trow { align-items:flex-end; margin-bottom:8px; }
  .trow > div { min-width:110px; }
  .trow > .turl { flex:3; min-width:220px; }
  .trow .t-del { flex:0 0 auto; padding:8px 12px; }
  [data-weights="0"] .t-weight-wrap { display:none; }
  .del { background:transparent; border:1px solid var(--line); color:var(--bad);
         padding:4px 10px; font-size:12px; border-radius:6px; cursor:pointer; }
  .more { background:transparent; border:1px solid var(--line); color:var(--accent);
          padding:4px 10px; font-size:12px; border-radius:6px; cursor:pointer; margin-right:6px; }
  .edit { background:transparent; border:1px solid var(--line); color:var(--ok);
          padding:4px 10px; font-size:12px; border-radius:6px; cursor:pointer; margin-right:6px; }
  .inline { display:flex; align-items:center; gap:6px; color:var(--muted); font-size:13px; padding:10px 0; }
  .inline input[type="checkbox"] { width:auto; }
  .detailcell { background:#12151b; padding:12px 14px; }
  .dsummary { color:var(--muted); font-size:13px; margin-bottom:8px; line-height:1.6; }
  .dtable { font-size:12px; }
  .dtable th, .dtable td { padding:6px 8px; }
  .ellipsis { display:block; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .vmore { background:transparent; border:1px solid var(--line); color:var(--accent);
           padding:2px 8px; font-size:12px; border-radius:6px; cursor:pointer; white-space:nowrap; }
  .vdetail > td { background:#0d1015; padding:4px 10px 10px; }
  .kv th { width:132px; color:var(--muted); font-weight:500; white-space:nowrap; vertical-align:top; }
  .kv td { word-break:break-all; }
  .empty { color:var(--muted); text-align:center; padding:24px; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<div class="wrap">
  <header class="topbar">
    <div>
      <div class="brand">${LOGO_SVG}<h1>短链管理</h1></div>
      <div class="sub">s.ohtoai.top · Cloudflare Workers + D1</div>
    </div>
    <a class="gh" href="https://github.com/ohto-ai/shorturl" target="_blank" rel="noopener"
       title="GitHub 仓库" aria-label="GitHub 仓库"><svg viewBox="0 0 16 16" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg></a>
  </header>

  <div class="card" id="authCard">
    <label for="token">管理令牌(CREATE_TOKEN)</label>
    <div class="row">
      <input id="token" type="password" placeholder="输入部署时设置的管理令牌" autocomplete="off">
      <button id="saveToken" style="flex:0 0 auto;">保存并加载</button>
    </div>
    <div class="msg err" id="authErr" hidden></div>
    <div class="hint">令牌仅保存在当前浏览器的 localStorage 中,用于调用本服务的管理 API;不会发送到除本服务以外的任何地方。</div>
  </div>

  <div id="main" hidden>
    <div class="card">
      <h2>新建短链</h2>
      <label for="mode">跳转模式</label>
      <select id="mode">
        <option value="single">单目标(原有方式)</option>
        <option value="sequence">顺序故障转移 — 前面的失效自动切下一个</option>
        <option value="round_robin">列表循环 — 每次轮换一个有效目标</option>
        <option value="weighted">加权随机 — 按权重在有效目标中分流</option>
      </select>
      <div id="singleFields">
        <label for="url">目标链接</label>
        <input id="url" placeholder="https://example.com/very/long/path?with=query" autocomplete="off">
        <div class="row">
          <div>
            <label for="expiresIn">有效期(可选)</label>
            <select id="expiresIn">
              <option value="">永久有效</option>
              <option value="3600">1 小时</option>
              <option value="86400">1 天</option>
              <option value="604800">7 天</option>
              <option value="2592000">30 天</option>
              <option value="31536000">1 年</option>
            </select>
          </div>
          <div>
            <label for="maxUses">次数上限(可选)</label>
            <input id="maxUses" type="number" min="1" step="1" placeholder="不限" autocomplete="off">
          </div>
        </div>
      </div>
      <div id="multiFields" hidden>
        <label>目标列表(1~10 级,每级可独立设有效期与次数上限)</label>
        <div id="targetRows" data-weights="0"></div>
        <button type="button" class="ghost" id="addTarget" style="margin-top:6px;">+ 添加目标</button>
        <div class="hint">顺序:始终用第一个有效目标,失效自动顺延;循环:每次轮换到下一个有效目标;加权随机:按「权重」份数在有效目标中随机,失效目标自动退出;想按剩余次数分流,把各级次数上限设好即可(用完自动让位)。权重仅加权模式生效。</div>
      </div>
      <div class="row" style="margin-top:6px;">
        <div>
          <label for="code">自定义短码(可选)</label>
          <input id="code" placeholder="留空自动生成 6 位短码" autocomplete="off">
        </div>
      </div>
      <div class="row" style="margin-top:14px;">
        <button id="createBtn" style="flex:0 0 auto;">生成短链</button>
      </div>
      <div class="msg ok" id="result" hidden></div>
      <div class="msg err" id="createErr" hidden></div>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <h2>我的短链</h2>
        <button class="ghost" id="refresh">刷新</button>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr><th>短链</th><th>目标</th><th>点击</th><th>有效期至</th><th>状态</th><th></th></tr>
          </thead>
          <tbody id="linksBody"></tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<script>
(function () {
  "use strict";
  var TOKEN_KEY = "shorturl_token";
  var linksById = {};
  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      { Authorization: "Bearer " + (localStorage.getItem(TOKEN_KEY) || "") },
      opts.headers || {}
    );
    if (opts.body && !opts.headers["Content-Type"]) opts.headers["Content-Type"] = "application/json";
    return fetch(path, opts);
  }

  function fmtTime(unix) {
    if (!unix) return "永久";
    var d = new Date(unix * 1000);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function showAuth(message) {
    $("authCard").hidden = false;
    $("main").hidden = true;
    if (message) {
      var el = $("authErr");
      el.textContent = message;
      el.hidden = false;
    }
  }

  var MODE_LABELS = { sequence: "顺序", round_robin: "循环", weighted: "加权" };

  var EXP_OPTIONS = [["", "永久有效"], ["3600", "1 小时"], ["86400", "1 天"], ["604800", "7 天"], ["2592000", "30 天"], ["31536000", "1 年"]];

  /** 目标行的有效期下拉;keepLabel 用于编辑时「沿用旧过期时间」选项 */
  function expOptionsHtml(selected, keepLabel) {
    var html = "";
    if (keepLabel) {
      html += '<option value="keep"' + (selected === "keep" ? " selected" : "") + ">" + escapeHtml(keepLabel) + "</option>";
    }
    for (var i = 0; i < EXP_OPTIONS.length; i++) {
      html += '<option value="' + EXP_OPTIONS[i][0] + '"' + (selected === EXP_OPTIONS[i][0] ? " selected" : "") + ">" + EXP_OPTIONS[i][1] + "</option>";
    }
    return html;
  }

  /** 往容器追加一行目标编辑器;pre: { url, exp: ""|"keep"|秒数, keepLabel, max, weight } */
  function addTargetRow(container, pre) {
    pre = pre || {};
    if (container.children.length >= 10) {
      alert("最多 10 级目标");
      return;
    }
    var div = document.createElement("div");
    div.className = "row trow";
    div.innerHTML =
      '<div class="turl"><input class="t-url" placeholder="https://target-' + (container.children.length + 1) + '.example.com" value="' + escapeHtml(pre.url || "") + '"></div>' +
      '<div><select class="t-exp">' + expOptionsHtml(pre.exp || "", pre.keepLabel) + "</select></div>" +
      '<div><input class="t-max" type="number" min="1" step="1" placeholder="次数不限" value="' + (pre.max == null ? "" : escapeHtml(String(pre.max))) + '"></div>' +
      '<div class="t-weight-wrap"><input class="t-weight" type="number" min="1" step="1" placeholder="权重 1" value="' + (pre.weight == null ? "" : escapeHtml(String(pre.weight))) + '"></div>' +
      '<button type="button" class="ghost t-del" title="移除该级">×</button>';
    container.appendChild(div);
    div.querySelector(".t-del").addEventListener("click", function () {
      if (container.children.length <= 1) {
        alert("至少保留一个目标");
        return;
      }
      container.removeChild(div);
    });
  }

  /** 收集容器内的目标行;有 URL 为空返回 null */
  function collectTargetRows(container, weighted) {
    var rows = [];
    var bad = false;
    Array.prototype.forEach.call(container.querySelectorAll(".trow"), function (row) {
      var url = row.querySelector(".t-url").value.trim();
      if (!url) {
        bad = true;
        row.querySelector(".t-url").style.borderColor = "var(--bad)";
        return;
      }
      var item = { url: url };
      var exp = row.querySelector(".t-exp").value;
      if (exp === "keep") item.keepExpires = true;
      else if (exp) item.expiresIn = Number(exp);
      var max = row.querySelector(".t-max").value.trim();
      if (max) item.maxUses = Number(max);
      if (weighted) {
        var w = row.querySelector(".t-weight").value.trim();
        if (w) item.weight = Number(w);
      }
      rows.push(item);
    });
    return bad ? null : rows;
  }

  /** 按模式切换权重列显示 */
  function applyWeightsVisibility(container, mode) {
    container.setAttribute("data-weights", mode === "weighted" ? "1" : "0");
  }

  $("mode").addEventListener("change", function () {
    var v = $("mode").value;
    var multi = v !== "single";
    $("singleFields").hidden = multi;
    $("multiFields").hidden = !multi;
    applyWeightsVisibility($("targetRows"), v);
    if (multi && $("targetRows").children.length === 0) {
      addTargetRow($("targetRows"), {});
      addTargetRow($("targetRows"), {});
    }
  });
  $("addTarget").addEventListener("click", function () {
    addTargetRow($("targetRows"), {});
  });

  function render(links) {
    var tbody = $("linksBody");
    tbody.innerHTML = "";
    if (!links.length) {
      tbody.innerHTML = '<tr><td class="empty" colspan="6">还没有短链,先创建一条吧</td></tr>';
      $("main").hidden = false;
      $("authCard").hidden = true;
      return;
    }
    var now = Math.floor(Date.now() / 1000);
    linksById = {};
    links.forEach(function (l) {
      linksById[l.code] = l;
      var expired = l.expires_at && now > l.expires_at;
      var exhausted = l.max_uses && l.used_count >= l.max_uses;
      var status = expired
        ? '<span class="tag bad">已过期</span>'
        : exhausted
          ? '<span class="tag warn">已达上限</span>'
          : '<span class="tag ok">正常</span>';
      var clicks = l.used_count + (l.max_uses ? " / 剩 " + Math.max(0, l.max_uses - l.used_count) : "");
      var badge = l.targets && l.targets.length > 1
        ? ' <span class="tag info">' + l.targets.length + "级·" + escapeHtml(MODE_LABELS[l.mode] || l.mode || "顺序") + "</span>"
        : "";
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td><a href="/' + escapeHtml(l.code) + '" target="_blank" rel="noopener">/' + escapeHtml(l.code) + "</a>" + badge + "</td>" +
        '<td style="max-width:300px;color:var(--muted);">' + escapeHtml(l.url) + "</td>" +
        "<td>" + escapeHtml(clicks) + "</td>" +
        '<td style="white-space:nowrap;">' + fmtTime(l.expires_at) + "</td>" +
        "<td>" + status + "</td>" +
        '<td><button class="more" data-code="' + escapeHtml(l.code) + '">详情</button>' +
        '<button class="edit" data-code="' + escapeHtml(l.code) + '">编辑</button>' +
        '<button class="del" data-code="' + escapeHtml(l.code) + '">删除</button></td>';
      tbody.appendChild(tr);
    });
    $("main").hidden = false;
    $("authCard").hidden = true;
  }

  function loadLinks() {
    api("/api/links")
      .then(function (r) {
        if (r.status === 401) {
          showAuth("令牌无效或已过期,请重新输入");
          return null;
        }
        return r.json();
      })
      .then(function (data) {
        if (data) render(data.links || []);
      })
      .catch(function () {
        showAuth("无法连接服务,请稍后重试");
      });
  }

  $("saveToken").addEventListener("click", function () {
    var t = $("token").value.trim();
    if (!t) return;
    localStorage.setItem(TOKEN_KEY, t);
    $("authErr").hidden = true;
    loadLinks();
  });
  $("token").addEventListener("keydown", function (e) {
    if (e.key === "Enter") $("saveToken").click();
  });
  $("refresh").addEventListener("click", loadLinks);

  $("linksBody").addEventListener("click", function (ev) {
    var target = ev.target;
    var del = target.closest ? target.closest("button.del") : null;
    if (del) {
      var delCode = del.getAttribute("data-code");
      if (!confirm("确认删除 /" + delCode + " ?删除后立即失效,不可恢复。")) return;
      api("/api/links/" + encodeURIComponent(delCode), { method: "DELETE" })
        .then(function (r) {
          if (r.ok) {
            loadLinks();
          } else {
            r.json().then(function (d) { alert(d.error || "删除失败"); });
          }
        })
        .catch(function () { alert("删除失败,请稍后重试"); });
      return;
    }
    var more = target.closest ? target.closest("button.more") : null;
    if (more) toggleDetails(more.getAttribute("data-code"), more);
    var editBtn = target.closest ? target.closest("button.edit") : null;
    if (editBtn) toggleEdit(editBtn.getAttribute("data-code"), editBtn);
  });

  /** 收起所有展开的详情/编辑面板,并把按钮文字复位 */
  function closePanels() {
    Array.prototype.forEach.call(document.querySelectorAll("tr[id^='details-'], tr[id^='edit-']"), function (el) {
      el.parentNode.removeChild(el);
    });
    Array.prototype.forEach.call(document.querySelectorAll("button.more, button.edit"), function (b) {
      b.textContent = b.classList.contains("edit") ? "编辑" : "详情";
    });
  }

  function toggleDetails(code, btn) {
    var existing = document.getElementById("details-" + code);
    if (existing) {
      existing.parentNode.removeChild(existing);
      btn.textContent = "详情";
      return;
    }
    // 同一时间只保留一个展开的面板
    closePanels();
    var tr = btn.closest("tr");
    var dtr = document.createElement("tr");
    dtr.id = "details-" + code;
    dtr.innerHTML = '<td colspan="6" class="detailcell"><div class="dsummary">加载中…</div></td>';
    tr.parentNode.insertBefore(dtr, tr.nextSibling);
    btn.textContent = "收起";

    api("/api/links/" + encodeURIComponent(code) + "/stats")
      .then(function (r) {
        if (r.status === 401) {
          showAuth("令牌无效或已过期,请重新输入");
          return null;
        }
        return r.json().then(function (d) { return { ok: r.ok, d: d }; });
      })
      .then(function (res) {
        if (!res) return;
        var box = dtr.querySelector(".dsummary");
        if (!box) return;
        if (!res.ok) {
          box.textContent = (res.d && res.d.error) || "加载失败";
          return;
        }
        renderDetails(res.d, dtr.querySelector(".detailcell"));
      })
      .catch(function () {
        var box = dtr.querySelector(".dsummary");
        if (box) box.textContent = "网络错误,请稍后重试";
      });
  }

  /** meta 字段的中文名(未列出的键直接显示原键名) */
  var META_LABELS = {
    method: "请求方法",
    host: "访问域名",
    query: "URL 参数",
    accept: "Accept",
    accept_language: "语言",
    sec_ch_ua: "客户端提示 UA",
    sec_ch_ua_mobile: "移动端",
    sec_ch_ua_platform: "平台",
    sec_ch_ua_platform_version: "平台版本",
    sec_ch_ua_model: "设备型号",
    sec_ch_ua_full_version_list: "完整版本",
    sec_ch_ua_arch: "CPU 架构",
    sec_ch_ua_bitness: "位数",
    sec_fetch_site: "来源类型",
    sec_fetch_mode: "请求模式",
    sec_fetch_dest: "请求目标",
    sec_fetch_user: "用户触发",
    purpose: "预取/预渲染",
    dnt: "Do Not Track",
    gpc: "Global Privacy Control",
    priority: "请求优先级",
    upgrade_insecure_requests: "升级 HTTPS",
    continent: "洲",
    region: "省/州",
    region_code: "省/州代码",
    postal_code: "邮编",
    timezone: "时区",
    latitude: "纬度",
    longitude: "经度",
    metro_code: "都会区代码",
    is_eu_country: "EU 国家",
    as_organization: "运营商/机构",
    colo: "边缘节点",
    http_protocol: "HTTP 协议",
    tls_version: "TLS 版本",
    tls_cipher: "TLS 加密套件",
    client_tcp_rtt: "TCP RTT(ms)",
    client_accept_encoding: "Accept-Encoding",
    request_priority: "优先级详情",
    edge_keepalive: "边缘保活状态",
    verified_bot_category: "Bot 分类",
    bot_score: "Bot 评分",
    bot_verified: "已验证 Bot",
    bot_corporate_proxy: "企业代理",
    bot_static_resource: "静态资源",
    bot_detection_ids: "Bot 检测 ID",
    ja3_hash: "JA3 指纹",
    ja4: "JA4 指纹"
  };

  /** 详情面板里的展示顺序,其余字段追加在后面 */
  var META_ORDER = [
    "method", "host", "query", "accept", "accept_language",
    "sec_ch_ua", "sec_ch_ua_mobile", "sec_ch_ua_platform", "sec_ch_ua_platform_version",
    "sec_ch_ua_model", "sec_ch_ua_full_version_list", "sec_ch_ua_arch", "sec_ch_ua_bitness",
    "sec_fetch_site", "sec_fetch_mode", "sec_fetch_dest", "sec_fetch_user",
    "purpose", "dnt", "gpc", "priority", "upgrade_insecure_requests",
    "continent", "region", "region_code", "postal_code", "timezone", "latitude", "longitude",
    "metro_code", "is_eu_country", "as_organization", "colo", "http_protocol", "tls_version",
    "tls_cipher", "client_tcp_rtt", "client_accept_encoding", "request_priority", "edge_keepalive",
    "bot_score", "bot_verified", "bot_corporate_proxy", "bot_static_resource", "bot_detection_ids",
    "verified_bot_category", "ja3_hash", "ja4"
  ];

  /** 把长 UA 压缩成「App/浏览器 · 系统 · 设备」,完整 UA 保留在详情里 */
  function uaSummary(ua) {
    if (!ua) return "—";
    var s = String(ua);
    var m;
    var bits = [];
    var known = [
      [/MicroMessenger\/([\d.]+)/i, "微信"],
      [/MQQBrowser\/([\d.]+)/i, "QQ 浏览器"],
      [/QQ\/([\d.]+)/i, "QQ"],
      [/AlipayClient\/([\d.]+)/i, "支付宝"],
      [/DingTalk\/([\d.]+)/i, "钉钉"],
      [/Weibo\/([\d.]+)/i, "微博"],
      [/UCBrowser\/([\d.]+)/i, "UC 浏览器"],
      [/Quark\/([\d.]+)/i, "夸克"],
      [/baiduboxapp\/([\d.]+)/i, "百度 App"],
      [/MiuiBrowser\/([\d.]+)/i, "小米浏览器"],
      [/HuaweiBrowser\/([\d.]+)/i, "华为浏览器"],
      [/VivoBrowser\/([\d.]+)/i, "vivo 浏览器"],
      [/HeyTapBrowser\/([\d.]+)/i, "OPPO 浏览器"],
      [/EdgiOS\/([\d.]+)/i, "Edge"],
      [/EdgA?\/([\d.]+)/i, "Edge"],
      [/OPR\/([\d.]+)/i, "Opera"],
      [/SamsungBrowser\/([\d.]+)/i, "三星浏览器"],
      [/FxiOS\/([\d.]+)/i, "Firefox"],
      [/Firefox\/([\d.]+)/i, "Firefox"],
      [/CriOS\/([\d.]+)/i, "Chrome"],
      [/Chrome\/([\d.]+)/i, "Chrome"],
      [/Version\/([\d.]+)[^)]*Safari/i, "Safari"]
    ];
    for (var i = 0; i < known.length; i++) {
      m = known[i][0].exec(s);
      if (m) {
        bits.push(known[i][1] + " " + String(m[1]).split(".")[0]);
        break;
      }
    }

    var os = "";
    if ((m = /Android\s+([\d.]+)/i.exec(s))) os = "Android " + m[1];
    else if ((m = /(?:iPhone|iPod).*?OS ([\d_]+)/i.exec(s))) os = "iOS " + m[1].replace(/_/g, ".");
    else if ((m = /iPad.*?OS ([\d_]+)/i.exec(s))) os = "iPadOS " + m[1].replace(/_/g, ".");
    else if ((m = /Windows NT ([\d.]+)/i.exec(s))) {
      os = "Windows " + ({ "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" }[m[1]] || m[1]);
    } else if ((m = /Mac OS X ([\d_]+)/i.exec(s))) os = "macOS " + m[1].replace(/_/g, ".");
    else if (/CrOS/.test(s)) os = "ChromeOS";
    else if (/Linux/.test(s)) os = "Linux";
    if (os) bits.push(os);

    var model = "";
    if ((m = /Android\s+[\d.]+;\s*([^;)]+)/i.exec(s))) {
      model = m[1].replace(/\s+Build\/.*$/i, "").replace(/^K;\s*/i, "").trim();
      if (/^(wv|mobile|linux|u|tablet)$/i.test(model)) model = "";
    } else if (/iPhone/.test(s)) model = "iPhone";
    else if (/iPad/.test(s)) model = "iPad";
    if (model) bits.push(model);

    return bits.length ? bits.join(" · ") : s;
  }

  function metaText(value) {
    if (Array.isArray(value)) return value.join(", ");
    if (value !== null && typeof value === "object") return JSON.stringify(value);
    return value;
  }

  function kvRow(label, value) {
    return "<tr><th>" + escapeHtml(label) + "</th><td>" +
      escapeHtml(value === null || value === undefined || value === "" ? "—" : String(value)) + "</td></tr>";
  }

  /** 单次访问的完整信息:核心列 + meta JSON 全部展开 */
  function renderVisitDetails(v) {
    var meta = v.meta || {};
    var rows =
      kvRow("完整 User-Agent", v.ua) +
      kvRow("完整 Referer", v.referer || "直接访问") +
      kvRow("IP", v.ip) +
      kvRow("位置", [v.country, v.city].filter(Boolean).join(" / ")) +
      kvRow("ASN", v.asn);
    var seen = {};
    META_ORDER.forEach(function (k) {
      if (meta[k] === undefined || meta[k] === null) return;
      seen[k] = true;
      rows += kvRow(META_LABELS[k] || k, metaText(meta[k]));
    });
    Object.keys(meta).forEach(function (k) {
      if (seen[k] || meta[k] === undefined || meta[k] === null) return;
      rows += kvRow(META_LABELS[k] || k, metaText(meta[k]));
    });
    return '<table class="dtable kv">' + rows + "</table>";
  }

  function renderDetails(d, cell) {
    var countries = (d.countries || [])
      .map(function (c) { return escapeHtml(c.country || "?") + " ×" + c.n; })
      .join(" · ") || "暂无数据";
    var nowSec = Math.floor(Date.now() / 1000);
    var tgt = d.targets || [];
    var tblock = "";
    if (tgt.length > 1) {
      var trows = tgt.map(function (t) {
        var dead = (t.expires_at && nowSec > t.expires_at) || (t.max_uses != null && t.used_count >= t.max_uses);
        var st = dead ? '<span class="tag bad">已失效</span>' : '<span class="tag ok">有效</span>';
        var cap = t.used_count + (t.max_uses != null ? " / " + t.max_uses : "");
        return "<tr><td>#" + (t.idx + 1) + '</td><td><span class="ellipsis" style="max-width:320px;" title="' +
          escapeHtml(t.url) + '">' + escapeHtml(t.url) + "</span></td><td>" + escapeHtml(cap) +
          '</td><td style="white-space:nowrap;">' + fmtTime(t.expires_at) + "</td><td>" + st + "</td></tr>";
      }).join("");
      tblock =
        '<div class="dsummary" style="margin-top:12px;">目标分级(' + tgt.length + " 级 · " + escapeHtml(MODE_LABELS[d.mode] || d.mode || "顺序") + ")</div>" +
        '<div style="overflow-x:auto;"><table class="dtable"><thead><tr><th>级</th><th>目标</th><th>点击</th><th>有效期至</th><th>状态</th></tr></thead><tbody>' +
        trows + "</tbody></table></div>";
    }
    var visits = d.recent || [];
    var rows = visits.map(function (v, i) {
      var loc = [v.country, v.city].filter(Boolean).map(escapeHtml).join(" / ") || "—";
      var ref = v.referer || "直接访问";
      var lvl = v.target_idx == null ? "—" : v.target_idx + 1;
      return '<tr><td style="white-space:nowrap;">' + fmtTime(v.accessed_at) +
        "</td><td>" + escapeHtml(v.ip || "—") + "</td><td>" + loc +
        '</td><td style="text-align:center;">' + lvl +
        '</td><td><span class="ellipsis" title="' + escapeHtml(v.ua || "") + '">' + escapeHtml(uaSummary(v.ua)) + "</span>" +
        '</td><td><span class="ellipsis" title="' + escapeHtml(ref) + '">' + escapeHtml(ref) + "</span></td>" +
        '<td><button class="vmore" data-i="' + i + '">详情</button></td></tr>' +
        '<tr id="visit-' + escapeHtml(d.code) + "-" + i + '" class="vdetail" hidden>' +
        '<td colspan="7">' + renderVisitDetails(v) + "</td></tr>";
    }).join("");
    cell.innerHTML =
      '<div class="dsummary">总点击 ' + d.total + " · 国家/地区: " + countries +
      " · 点击每次访问的「详情」可查看完整 UA、Client Hints、网络/TLS 等信息</div>" +
      tblock +
      '<div style="overflow-x:auto;' + (tblock ? "margin-top:12px;" : "") + '"><table class="dtable"><thead><tr><th>时间</th><th>IP</th><th>位置</th><th>级</th><th>客户端</th><th>来源</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" class="empty">暂无访问记录</td></tr>') +
      "</tbody></table></div>";

    cell.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("button.vmore") : null;
      if (!btn) return;
      var i = btn.getAttribute("data-i");
      var row = document.getElementById("visit-" + d.code + "-" + i);
      if (!row) return;
      row.hidden = !row.hidden;
      btn.textContent = row.hidden ? "详情" : "收起";
    });
  }

  function showEditErr(code, msg) {
    var el = $("edit-err-" + code);
    if (el) {
      el.textContent = msg;
      el.hidden = false;
    }
  }

  function toggleEdit(code, btn) {
    var existing = document.getElementById("edit-" + code);
    if (existing) {
      existing.parentNode.removeChild(existing);
      btn.textContent = "编辑";
      return;
    }
    closePanels();
    var l = linksById[code];
    if (!l) return;
    var mode = l.mode || "sequence";
    var targets = l.targets && l.targets.length
      ? l.targets
      : [{ idx: 0, url: l.url, expires_at: l.expires_at, max_uses: l.max_uses, used_count: 0, weight: 1 }];
    var rowsId = "edit-rows-" + code;
    var tr = btn.closest("tr");
    var etr = document.createElement("tr");
    etr.id = "edit-" + code;
    etr.innerHTML =
      '<td colspan="6" class="detailcell"><div>' +
      '<div class="row">' +
      '<div><label>跳转模式</label><select id="edit-mode-' + code + '">' +
      '<option value="sequence"' + (mode === "sequence" ? " selected" : "") + ">顺序故障转移</option>" +
      '<option value="round_robin"' + (mode === "round_robin" ? " selected" : "") + ">列表循环</option>" +
      '<option value="weighted"' + (mode === "weighted" ? " selected" : "") + ">加权随机</option>" +
      "</select></div>" +
      '<div><label>&nbsp;</label><span class="inline"><input type="checkbox" id="edit-reset-' + code + '"> 次数清零(全局已用 ' + l.used_count + ')</span></div>' +
      "</div>" +
      "<label>目标列表(相同 URL 自动保留历史计数;「不变」沿用旧有效期)</label>" +
      '<div id="' + rowsId + '" data-weights="' + (mode === "weighted" ? "1" : "0") + '"></div>' +
      '<button type="button" class="ghost" id="edit-add-' + code + '" style="margin-top:6px;">+ 添加目标</button>' +
      '<div class="row" style="margin-top:12px;">' +
      '<button id="edit-save-' + code + '" style="flex:0 0 auto;">保存修改</button>' +
      '<button class="ghost" id="edit-cancel-' + code + '" style="flex:0 0 auto;">取消</button>' +
      "</div>" +
      '<div class="msg err" id="edit-err-' + code + '" hidden></div>' +
      "</div></td>";
    tr.parentNode.insertBefore(etr, tr.nextSibling);
    btn.textContent = "收起";

    var rowsEl = $(rowsId);
    targets.forEach(function (t) {
      addTargetRow(rowsEl, {
        url: t.url,
        exp: t.expires_at == null ? "" : "keep",
        keepLabel: t.expires_at == null ? "" : "不变(当前:" + fmtTime(t.expires_at) + ")",
        max: t.max_uses,
        weight: t.weight != null && t.weight > 1 ? t.weight : ""
      });
    });
    $("edit-add-" + code).addEventListener("click", function () {
      addTargetRow(rowsEl, {});
    });
    $("edit-mode-" + code).addEventListener("change", function () {
      applyWeightsVisibility(rowsEl, this.value);
    });
    $("edit-cancel-" + code).addEventListener("click", function () {
      toggleEdit(code, btn);
    });
    $("edit-save-" + code).addEventListener("click", function () {
      var modeSel = $("edit-mode-" + code);
      var rows = collectTargetRows(rowsEl, modeSel.value === "weighted");
      if (!rows) {
        showEditErr(code, "请填写每一级的目标链接");
        return;
      }
      var body = { mode: modeSel.value, targets: rows };
      if ($("edit-reset-" + code).checked) body.resetCount = true;

      var saveBtn = $("edit-save-" + code);
      $("edit-err-" + code).hidden = true;
      saveBtn.disabled = true;
      api("/api/links/" + encodeURIComponent(code), { method: "PATCH", body: JSON.stringify(body) })
        .then(function (r) {
          saveBtn.disabled = false;
          return r.json().then(function (d) { return { ok: r.ok, d: d }; });
        })
        .then(function (res) {
          if (!res) return;
          if (res.ok) {
            var row = document.getElementById("edit-" + code);
            if (row && row.parentNode) row.parentNode.removeChild(row);
            btn.textContent = "编辑";
            loadLinks();
          } else {
            showEditErr(code, (res.d && res.d.error) || "保存失败");
          }
        })
        .catch(function () {
          saveBtn.disabled = false;
          showEditErr(code, "网络错误,请稍后重试");
        });
    });
  }

  $("createBtn").addEventListener("click", function () {
    var mode = $("mode").value;
    var code = $("code").value.trim();
    var body;
    if (mode === "single") {
      var url = $("url").value.trim();
      var expiresIn = $("expiresIn").value;
      var maxUses = $("maxUses").value.trim();
      body = { url: url };
      if (code) body.code = code;
      if (expiresIn) body.expiresIn = Number(expiresIn);
      if (maxUses) body.maxUses = Number(maxUses);
    } else {
      var rows = collectTargetRows($("targetRows"), mode === "weighted");
      if (!rows) {
        $("createErr").textContent = "请填写每一级的目标链接";
        $("createErr").hidden = false;
        return;
      }
      body = { mode: mode, targets: rows };
      if (code) body.code = code;
    }

    $("result").hidden = true;
    $("createErr").hidden = true;
    $("createBtn").disabled = true;

    api("/api/create", { method: "POST", body: JSON.stringify(body) })
      .then(function (r) {
        $("createBtn").disabled = false;
        return r.json().then(function (d) { return { ok: r.ok, d: d }; });
      })
      .then(function (res) {
        if (!res) return;
        if (res.ok) {
          var box = $("result");
          box.innerHTML = "";
          var span = document.createElement("span");
          span.textContent = (res.d.reused ? "(已复用失效短码) " : "") + res.d.shortUrl;
          span.style.flex = "1";
          var btn = document.createElement("button");
          btn.textContent = "复制";
          btn.className = "ghost";
          btn.addEventListener("click", function () {
            navigator.clipboard.writeText(res.d.shortUrl).then(function () {
              btn.textContent = "已复制 ✓";
              setTimeout(function () { btn.textContent = "复制"; }, 1500);
            });
          });
          box.appendChild(span);
          box.appendChild(btn);
          box.hidden = false;
          $("url").value = "";
          $("code").value = "";
          $("maxUses").value = "";
          $("expiresIn").value = "";
          if (mode !== "single") {
            $("targetRows").innerHTML = "";
            addTargetRow($("targetRows"), {});
            addTargetRow($("targetRows"), {});
          }
          loadLinks();
        } else {
          $("createErr").textContent = res.d.error || "创建失败";
          $("createErr").hidden = false;
        }
      })
      .catch(function () {
        $("createBtn").disabled = false;
        $("createErr").textContent = "网络错误,请稍后重试";
        $("createErr").hidden = false;
      });
  });

  // 初始加载:已保存过令牌则直接拉取列表
  var saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    $("token").value = saved;
    loadLinks();
  }
})();
</script>
</body>
</html>
`;
