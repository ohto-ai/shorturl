/**
 * 管理后台单页(内嵌 HTML,无需静态资源/自定义构建)
 * 令牌保存在浏览器 localStorage,所有管理操作通过 Bearer token 调用本 Worker 的 API。
 */
import { LOGO_SVG } from "./logo";

export const ADMIN_HTML = `<!doctype html>
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
  .sub { color:var(--muted); font-size:13px; margin-bottom:28px; }
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
  .empty { color:var(--muted); text-align:center; padding:24px; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">${LOGO_SVG}<h1>短链管理</h1></div>
  <div class="sub">s.ohtoai.top · Cloudflare Workers + D1</div>

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
      <label for="url">目标链接</label>
      <input id="url" placeholder="https://example.com/very/long/path?with=query" autocomplete="off">
      <div class="row">
        <div>
          <label for="code">自定义短码(可选)</label>
          <input id="code" placeholder="留空自动生成 6 位短码" autocomplete="off">
        </div>
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
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td><a href="/' + escapeHtml(l.code) + '" target="_blank" rel="noopener">/' + escapeHtml(l.code) + "</a></td>" +
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

  function renderDetails(d, cell) {
    var countries = (d.countries || [])
      .map(function (c) { return escapeHtml(c.country || "?") + " ×" + c.n; })
      .join(" · ") || "暂无数据";
    var rows = (d.recent || []).map(function (v) {
      var loc = [v.country, v.city].filter(Boolean).map(escapeHtml).join(" / ") || "—";
      var ua = v.ua ? escapeHtml(String(v.ua).slice(0, 70)) : "—";
      var ref = v.referer ? escapeHtml(String(v.referer).slice(0, 50)) : "直接访问";
      return "<tr><td>" + fmtTime(v.accessed_at) + "</td><td>" + escapeHtml(v.ip || "—") +
        '</td><td>' + loc + '</td><td title="' + escapeHtml(v.ua || "") + '">' + ua +
        "</td><td>" + ref + "</td></tr>";
    }).join("");
    cell.innerHTML =
      '<div class="dsummary">总点击 ' + d.total + " · 国家/地区: " + countries + "</div>" +
      '<table class="dtable"><thead><tr><th>时间</th><th>IP</th><th>位置</th><th>UA</th><th>来源</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="empty">暂无访问记录</td></tr>') +
      "</tbody></table>";
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
    var tr = btn.closest("tr");
    var etr = document.createElement("tr");
    etr.id = "edit-" + code;
    etr.innerHTML =
      '<td colspan="6" class="detailcell"><div>' +
      '<label>目标链接</label><input id="edit-url-' + code + '" value="' + escapeHtml(l.url) + '">' +
      '<div class="row" style="margin-top:10px;">' +
      '<div><label>有效期</label><select id="edit-exp-' + code + '">' +
      '<option value="">不变(当前:' + fmtTime(l.expires_at) + ')</option>' +
      '<option value="forever">改为永久</option>' +
      '<option value="3600">1 小时</option>' +
      '<option value="86400">1 天</option>' +
      '<option value="604800">7 天</option>' +
      '<option value="2592000">30 天</option>' +
      '<option value="31536000">1 年</option>' +
      "</select></div>" +
      '<div><label>次数上限</label><input type="number" min="1" step="1" id="edit-max-' + code + '" placeholder="' +
      (l.max_uses ? "当前:" + l.max_uses + "(留空不变)" : "当前:不限(留空不变)") + '"></div>' +
      '<div><label>计数</label><span class="inline"><input type="checkbox" id="edit-reset-' + code + '"> 次数清零(已用 ' + l.used_count + ')</span></div>' +
      "</div>" +
      '<div class="row" style="margin-top:12px;">' +
      '<button id="edit-save-' + code + '" style="flex:0 0 auto;">保存修改</button>' +
      '<button class="ghost" id="edit-cancel-' + code + '" style="flex:0 0 auto;">取消</button>' +
      "</div>" +
      '<div class="msg err" id="edit-err-' + code + '" hidden></div>' +
      "</div></td>";
    tr.parentNode.insertBefore(etr, tr.nextSibling);
    btn.textContent = "收起";

    $("edit-cancel-" + code).addEventListener("click", function () {
      toggleEdit(code, btn);
    });
    $("edit-save-" + code).addEventListener("click", function () {
      var body = {};
      var urlVal = $("edit-url-" + code).value.trim();
      if (!urlVal) {
        showEditErr(code, "目标链接不能为空");
        return;
      }
      body.url = urlVal;
      var expVal = $("edit-exp-" + code).value;
      if (expVal) body.expiresIn = expVal === "forever" ? null : Number(expVal);
      var maxVal = $("edit-max-" + code).value.trim();
      if (maxVal) body.maxUses = Number(maxVal);
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
    var url = $("url").value.trim();
    var code = $("code").value.trim();
    var expiresIn = $("expiresIn").value;
    var maxUses = $("maxUses").value.trim();
    var body = { url: url };
    if (code) body.code = code;
    if (expiresIn) body.expiresIn = Number(expiresIn);
    if (maxUses) body.maxUses = Number(maxUses);

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
