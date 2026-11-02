/* CFA Study Tracker — plain JS, data stored in the browser (localStorage). */
(function () {
  "use strict";

  const STORAGE_KEY = "cfa-tracker-v1";
  const CONSPECT = ["Not started", "In progress", "Done"];

  // ---------- state ----------
  // Two modes:
  //  * cloud — config.js has Supabase keys: people sign in, each user's tracker is stored in the
  //    `trackers` table (one JSON row per user) and syncs across devices.
  //  * local — no config: data lives in this browser's localStorage only (original behaviour).
  const CFG = window.CFA_CONFIG || {};
  const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
  let sb = null;          // Supabase client
  let user = null;        // signed-in user (cloud mode)
  let state = null;       // the tracker data
  let remoteUpdatedAt = null;
  const sync = { timer: null, inflight: false, again: false, status: "saved" };
  let recovering = false; // user opened a password-reset link

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function emptyState() {
    return { version: 1, settings: { examDate: "", startDate: "", hoursGoal: 300, level: "Level I" }, topics: [], passes: [{ id: "study", name: "First pass", results: {}, extras: [] }], hours: [] };
  }
  // Same curriculum as the Excel tracker, but without anybody's scores, hours or notes.
  function blankTemplate() {
    if (!window.CFA_SEED) return emptyState();
    const s = clone(window.CFA_SEED);
    s.settings.examDate = ""; s.settings.startDate = todayISO();
    s.topics.forEach((t) => (t.conspect = "Not started"));
    s.passes = s.passes.map((p) => ({ id: p.id, name: p.name, results: {}, extras: [] }));
    s.hours = [];
    return s;
  }
  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* storage unavailable or corrupt */ }
    return null;
  }
  function save() {
    if (CLOUD) { scheduleRemoteSave(); return; }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast("Could not save — browser storage is unavailable. Export a backup!"); }
  }

  // ---------- cloud sync ----------
  function setSyncStatus(s) { sync.status = s; renderAccountBar(); }
  function scheduleRemoteSave() {
    setSyncStatus("pending");
    clearTimeout(sync.timer);
    sync.timer = setTimeout(pushRemote, 700);
  }
  async function pushRemote() {
    sync.timer = null;
    if (!user || !state) return;
    if (sync.inflight) { sync.again = true; return; }
    sync.inflight = true; setSyncStatus("saving");
    const { data, error } = await sb.from("trackers")
      .upsert({ user_id: user.id, data: state, updated_at: new Date().toISOString() })
      .select("updated_at").single();
    sync.inflight = false;
    if (error) {
      setSyncStatus("error");
      clearTimeout(sync.timer); sync.timer = setTimeout(pushRemote, 5000); // retry
      return;
    }
    remoteUpdatedAt = data.updated_at;
    if (sync.again) { sync.again = false; pushRemote(); } else setSyncStatus("saved");
  }
  async function fetchRemote() {
    const { data, error } = await sb.from("trackers").select("data, updated_at").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  const syncBusy = () => !!(sync.timer || sync.inflight);

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const fmtPct = (p) => (p == null ? "–" : (p * 100).toFixed(1) + "%");
  const fmtNum = (n, d = 1) => (Number.isInteger(n) ? String(n) : n.toFixed(d));
  const fmtDate = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "–");
  const toNum = (v) => (v === "" || v == null || isNaN(+v) ? null : +v);
  function gradeClass(p) { return p == null ? "none" : p >= 0.8 ? "good" : p >= 0.7 ? "ok" : "bad"; }
  function pill(p) { return `<span class="pill ${gradeClass(p)}">${fmtPct(p)}</span>`; }
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2500);
  }

  // ---------- calculations ----------
  function topicItems(pass, topic) {
    // Top-level rows for a topic in a pass: curriculum readings + pass-specific extra items.
    const kids = (id) => pass.extras.filter((x) => x.parentId === id);
    const rows = topic.readings.map((r) => ({ id: r.id, name: r.name, extra: false, children: kids(r.id) }));
    pass.extras.filter((x) => x.topicId === topic.id && !x.parentId)
      .forEach((x) => rows.push({ id: x.id, name: x.name, extra: true, children: kids(x.id) }));
    return rows;
  }
  function itemScore(pass, item) {
    let c = 0, t = 0;
    const add = (r) => { if (r && r.correct != null && r.total) { c += r.correct; t += r.total; } };
    if (item.children && item.children.length) item.children.forEach((k) => add(pass.results[k.id]));
    else add(pass.results[item.id]);
    return { correct: c, total: t, pct: t ? c / t : null };
  }
  function isDone(pass, id) {
    const r = pass.results[id];
    return !!(r && (r.date || r.total));
  }
  function topicScore(pass, topic) {
    let c = 0, t = 0;
    topicItems(pass, topic).forEach((i) => { const s = itemScore(pass, i); c += s.correct; t += s.total; });
    const done = topic.readings.filter((r) => isDone(pass, r.id)).length;
    return { correct: c, total: t, pct: t ? c / t : null, done, count: topic.readings.length };
  }
  function passSummary(pass) {
    let c = 0, t = 0, wsum = 0, wp = 0, done = 0, count = 0;
    state.topics.forEach((tp) => {
      const s = topicScore(pass, tp);
      c += s.correct; t += s.total; done += s.done; count += s.count;
      if (s.pct != null && tp.weight) { wsum += tp.weight; wp += tp.weight * s.pct; }
    });
    return { correct: c, total: t, pct: t ? c / t : null, weighted: wsum ? wp / wsum : null, done, count };
  }
  function hoursByTopic() {
    const m = {};
    state.hours.forEach((h) => { m[h.topicId || ""] = (m[h.topicId || ""] || 0) + (+h.hours || 0); });
    return m;
  }
  const totalHours = () => state.hours.reduce((s, h) => s + (+h.hours || 0), 0);
  const topicName = (id) => (state.topics.find((t) => t.id === id) || {}).name || "Other";

  // ---------- routing ----------
  function routes() {
    return [{ id: "dashboard", label: "Dashboard" }, { id: "hours", label: "Study hours" }]
      .concat(state.passes.map((p) => ({ id: "pass-" + p.id, label: p.name })))
      .concat([{ id: "settings", label: "Settings" }]);
  }
  function current() {
    const h = location.hash.slice(1);
    return routes().some((r) => r.id === h) ? h : "dashboard";
  }
  function renderAccountBar() {
    const el = $("#account"); if (!el) return;
    if (!CLOUD || !user) { el.innerHTML = ""; return; }
    const label = { saved: "Saved", pending: "Saving…", saving: "Saving…", error: "Not saved — retrying" }[sync.status];
    el.innerHTML = `<span class="sync ${sync.status}">${label}</span><span class="muted small who">${esc(user.email)}</span>
      <button class="btn ghost sm" data-action="signOut">Sign out</button>`;
  }
  function render() {
    renderAccountBar();
    if (!state) return;
    const cur = current();
    $("#tabs").innerHTML = routes().map((r) => `<button data-route="${r.id}" class="${r.id === cur ? "active" : ""}">${esc(r.label)}</button>`).join("");
    const view = $("#view");
    if (cur === "dashboard") view.innerHTML = renderDashboard();
    else if (cur === "hours") view.innerHTML = renderHours();
    else if (cur === "settings") view.innerHTML = renderSettings();
    else view.innerHTML = renderPass(state.passes.find((p) => "pass-" + p.id === cur));
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-route]");
    if (b) { location.hash = b.dataset.route; }
  });
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

  // ---------- dashboard ----------
  function renderDashboard() {
    const s = state.settings, today = todayISO();
    const hrs = totalHours(), goal = +s.hoursGoal || 0;
    const daysLeft = s.examDate ? dayDiff(today, s.examDate) : null;
    const daysGone = s.startDate ? dayDiff(s.startDate, today) : null;
    const first = state.passes[0];
    const fs = passSummary(first);
    const sums = state.passes.map((p) => ({ p, s: passSummary(p) }));
    const hbt = hoursByTopic();

    let banner = "";
    if (daysLeft != null && daysLeft < 0) banner = `<div class="banner">The exam date (${fmtDate(s.examDate)}) has passed. Set your next exam date in <a href="#settings">Settings</a>.</div>`;
    else if (!s.examDate) banner = `<div class="banner">Set your exam date in <a href="#settings">Settings</a> to see the countdown.</div>`;

    const kpis = [
      { label: "Days left", value: daysLeft == null ? "–" : Math.max(daysLeft, 0), sub: s.examDate ? "Exam " + fmtDate(s.examDate) : "No exam date" },
      { label: "Days gone", value: daysGone == null ? "–" : daysGone, sub: s.startDate ? "Since " + fmtDate(s.startDate) : "" },
      { label: "Hours done", value: fmtNum(hrs), sub: goal ? `${fmtNum(Math.max(goal - hrs, 0))} of ${goal} left` : "", prog: goal ? hrs / goal : null },
      { label: "Readings done", value: `${fs.done}/${fs.count}`, sub: first.name, prog: fs.count ? fs.done / fs.count : null },
      { label: "Hours / reading", value: fs.done ? fmtNum(hrs / fs.done) : "–", sub: "Average" },
    ].concat(sums.map(({ p, s: ps }) => ({ label: p.name + " grade", value: fmtPct(ps.pct), sub: "Weighted " + fmtPct(ps.weighted) })));

    const kpiHtml = kpis.map((k) => `<div class="kpi"><div class="label">${esc(k.label)}</div><div class="value">${esc(k.value)}</div>
      <div class="sub">${esc(k.sub)}</div>${k.prog != null ? `<div class="progress"><div style="width:${Math.min(k.prog, 1) * 100}%"></div></div>` : ""}</div>`).join("");

    const passHeads = state.passes.map((p) => `<th class="num">${esc(p.name)}</th>`).join("");
    const rows = state.topics.map((t) => {
      const ts = topicScore(first, t);
      return `<tr><td>${esc(t.name)}</td><td class="muted">${esc(t.weightRange || "")}</td>
        <td class="num">${fmtNum(hbt[t.id] || 0)}</td><td class="num">${ts.done}/${ts.count}</td>
        <td><select data-conspect="${t.id}">${CONSPECT.map((c) => `<option ${c === (t.conspect || "Not started") ? "selected" : ""}>${c}</option>`).join("")}</select></td>
        ${state.passes.map((p) => `<td class="num">${pill(topicScore(p, t).pct)}</td>`).join("")}</tr>`;
    }).join("");
    const conspectDone = state.topics.filter((t) => t.conspect === "Done").length;
    const totalRow = `<tr class="total"><td>Total</td><td></td><td class="num">${fmtNum(hrs)}</td><td class="num">${fs.done}/${fs.count}</td>
      <td>${conspectDone}/${state.topics.length} done</td>${sums.map(({ s: ps }) => `<td class="num">${pill(ps.pct)}</td>`).join("")}</tr>`;

    // Grade bars per topic (first two passes)
    const colors = ["var(--accent)", "var(--good)"];
    const shown = state.passes.slice(0, 2);
    const bars = state.topics.map((t) => {
      const ps = shown.map((p) => topicScore(p, t).pct);
      const last = ps.filter((x) => x != null).pop();
      return `<div class="bar-row"><div class="name" title="${esc(t.name)}">${esc(t.name)}</div><div class="bar-track">
        ${ps.map((x, i) => (x == null ? "" : `<div class="${i ? "b2" : ""}" style="width:${x * 100}%;background:${colors[i]};${i === 0 && ps[1] != null ? "bottom:50%;" : ""}"></div>`)).join("")}
        </div><div class="num small">${fmtPct(last ?? null)}</div></div>`;
    }).join("");
    const legend = shown.map((p, i) => `<span><i style="background:${colors[i]}"></i>${esc(p.name)}</span>`).join("");

    // Weakest readings: latest available score per reading
    const latest = [];
    state.topics.forEach((t) => {
      const seen = {};
      state.passes.forEach((p) => topicItems(p, t).forEach((it) => {
        const sc = itemScore(p, it);
        if (sc.pct != null) seen[it.id] = { name: it.name, topic: t.name, pct: sc.pct, pass: p.name };
      }));
      Object.values(seen).forEach((v) => latest.push(v));
    });
    latest.sort((a, b) => a.pct - b.pct);
    const weak = latest.slice(0, 8).map((w) => `<tr><td>${esc(w.name)}<div class="small muted">${esc(w.topic)} · ${esc(w.pass)}</div></td><td class="num">${pill(w.pct)}</td></tr>`).join("")
      || `<tr><td class="muted">No scores yet.</td></tr>`;

    return `${banner}<div class="kpis">${kpiHtml}</div>
      <div class="card"><h3>Topics</h3><div class="table-wrap"><table>
        <thead><tr><th>Topic</th><th>Exam weight</th><th class="num">Hours</th><th class="num">Readings</th><th>Conspect</th>${passHeads}</tr></thead>
        <tbody>${rows}${totalRow}</tbody></table></div></div>
      <div class="grid2">
        <div class="card"><h3>Grades by topic</h3><div class="legend">${legend}</div>${bars}</div>
        <div class="card"><h3>Weakest readings</h3><table><tbody>${weak}</tbody></table></div>
      </div>
      <div class="card"><h3>Hours per week</h3>${weekChart()}</div>`;
  }

  function weekChart() {
    if (!state.hours.length) return `<p class="muted">No hours logged yet — add them on the <a href="#hours">Study hours</a> tab.</p>`;
    const monday = (iso) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
    const weeks = {};
    state.hours.forEach((h) => { if (h.date) { const k = monday(h.date).getTime(); weeks[k] = (weeks[k] || 0) + (+h.hours || 0); } });
    const end = monday(todayISO()).getTime();
    const keys = Object.keys(weeks).map(Number);
    let start = Math.max(Math.min(...keys), end - 25 * 7 * 86400000);
    const cols = [];
    for (let k = start; k <= Math.max(end, Math.max(...keys)); k += 7 * 86400000) cols.push({ k, h: weeks[k] || 0 });
    const max = Math.max(1, ...cols.map((c) => c.h));
    return `<div class="week-chart">${cols.map((c) => `<div class="col" title="${fmtNum(c.h)} h, week of ${new Date(c.k).toLocaleDateString()}">
      <div style="height:${(c.h / max) * 100}%"></div><span>${new Date(c.k).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span></div>`).join("")}</div>`;
  }

  // ---------- hours ----------
  function renderHours() {
    const hbt = hoursByTopic(), hrs = totalHours(), goal = +state.settings.hoursGoal || 0;
    const opts = state.topics.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("") + `<option value="">Other / general</option>`;
    const list = state.hours.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const rows = list.map((h) => `<tr><td>${fmtDate(h.date)}</td><td class="num">${fmtNum(+h.hours, 2)}</td><td>${esc(topicName(h.topicId))}</td>
      <td class="muted">${esc(h.note)}</td><td class="num"><button class="icon-btn" title="Delete" data-del-hour="${h.id}">×</button></td></tr>`).join("")
      || `<tr><td colspan="5" class="muted">Nothing logged yet.</td></tr>`;
    const summary = state.topics.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${fmtNum(hbt[t.id] || 0)}</td></tr>`).join("")
      + (hbt[""] ? `<tr><td>Other / general</td><td class="num">${fmtNum(hbt[""])}</td></tr>` : "")
      + `<tr class="total"><td>Total${goal ? ` <span class="muted small">(goal ${goal})</span>` : ""}</td><td class="num">${fmtNum(hrs)}</td></tr>`;
    return `<h2>Study hours</h2>
      <div class="card"><form id="hour-form" class="row">
        <input type="date" class="d" name="date" value="${todayISO()}" required>
        <input type="number" class="n" name="hours" step="0.25" min="0.25" placeholder="Hours" required>
        <select name="topicId">${opts}</select>
        <input type="text" name="note" placeholder="Note (optional)" style="flex:1;min-width:140px">
        <button class="btn" type="submit">Add</button></form></div>
      <div class="grid2">
        <div class="card"><h3>Log</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Hours</th><th>Topic</th><th>Note</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>
        <div class="card"><h3>By topic</h3><table><tbody>${summary}</tbody></table></div>
      </div>`;
  }
  document.addEventListener("submit", (e) => {
    if (e.target.id === "hour-form") {
      e.preventDefault();
      const f = new FormData(e.target);
      const hours = toNum(f.get("hours"));
      if (!hours) return;
      state.hours.push({ id: uid("h"), date: f.get("date"), hours, topicId: f.get("topicId"), note: f.get("note").trim() });
      save(); render(); toast("Hours added");
      const sel = $("#hour-form select"); if (sel) sel.value = f.get("topicId");
    }
    if (e.target.dataset.addItem) {
      e.preventDefault();
      const pass = state.passes.find((p) => p.id === e.target.dataset.pass);
      const f = new FormData(e.target), name = f.get("name").trim();
      if (!name) return;
      pass.extras.push({ id: uid("x-"), topicId: e.target.dataset.addItem, parentId: f.get("parentId") || null, name });
      save(); rerenderKeepOpen();
    }
  });

  // ---------- pass (first pass / revision / ...) ----------
  function renderPass(pass) {
    const s = passSummary(pass);
    const topics = state.topics.map((t) => {
      const ts = topicScore(pass, t);
      const items = topicItems(pass, t);
      const rowHtml = (it, cls) => {
        const r = pass.results[it.id] || {};
        const hasKids = it.children && it.children.length;
        const sc = itemScore(pass, it);
        const del = it.extra || cls === "child" ? `<button class="icon-btn" title="Remove item" data-del-extra="${it.id}">×</button>` : "";
        return `<tr class="${cls || ""}${hasKids ? " parent" : ""}">
          <td>${esc(it.name)}</td>
          <td><input type="date" class="d" data-f="date" data-id="${it.id}" value="${esc(r.date || "")}"></td>
          <td class="num">${hasKids ? sc.correct : `<input type="number" min="0" class="n" data-f="correct" data-id="${it.id}" value="${r.correct ?? ""}">`}</td>
          <td class="num">${hasKids ? sc.total : `<input type="number" min="0" class="n" data-f="total" data-id="${it.id}" value="${r.total ?? ""}">`}</td>
          <td class="num" data-pct-item="${it.id}">${pill(sc.pct)}</td>
          <td><input type="text" class="note" data-f="note" data-id="${it.id}" value="${esc(r.note || "")}"></td>
          <td>${del}</td></tr>`
          + (hasKids ? it.children.map((k) => rowHtml({ id: k.id, name: k.name, extra: true, children: [] }, "child")).join("") : "");
      };
      const parentOpts = items.map((i) => `<option value="${i.id}">Under: ${esc(i.name.length > 50 ? i.name.slice(0, 50) + "…" : i.name)}</option>`).join("");
      return `<details class="topic" data-topic="${t.id}"><summary><span class="t-name">${esc(t.name)}</span>
          <span class="muted small" data-done-topic="${t.id}">${ts.done}/${ts.count} readings</span><span class="spacer"></span>
          <span class="small muted" data-score-topic="${t.id}">${ts.total ? ts.correct + "/" + ts.total : ""}</span><span data-pct-topic="${t.id}">${pill(ts.pct)}</span></summary>
        <div class="body"><div class="table-wrap"><table>
          <thead><tr><th>Reading</th><th>Date</th><th class="num">Correct</th><th class="num">Total</th><th class="num">%</th><th>Note</th><th></th></tr></thead>
          <tbody>${items.map((i) => rowHtml(i)).join("")}</tbody></table></div>
          <form class="row" style="margin-top:10px" data-add-item="${t.id}" data-pass="${pass.id}">
            <input type="text" name="name" placeholder="Extra item (e.g. Mock exam, Schweser questions)" style="flex:1;min-width:180px">
            <select name="parentId"><option value="">Topic level</option>${parentOpts}</select>
            <button class="btn ghost sm" type="submit">+ Add item</button></form>
        </div></details>`;
    }).join("");
    return `<div class="row"><h2>${esc(pass.name)}</h2><span class="spacer"></span>
        <button class="btn ghost sm" data-expand="1">Expand all</button><button class="btn ghost sm" data-expand="0">Collapse all</button></div>
      <div class="kpis">
        <div class="kpi"><div class="label">Grade</div><div class="value" id="pass-pct">${fmtPct(s.pct)}</div><div class="sub" id="pass-score">${s.correct}/${s.total} questions</div></div>
        <div class="kpi"><div class="label">Weighted by exam</div><div class="value" id="pass-w">${fmtPct(s.weighted)}</div><div class="sub">Using topic weights</div></div>
        <div class="kpi"><div class="label">Readings done</div><div class="value" id="pass-done">${s.done}/${s.count}</div><div class="sub">Has a date or score</div></div>
      </div>${topics}`;
  }
  function refreshPassNumbers(pass) {
    state.topics.forEach((t) => {
      const ts = topicScore(pass, t);
      const set = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
      set(`[data-pct-topic="${t.id}"]`, pill(ts.pct));
      set(`[data-score-topic="${t.id}"]`, ts.total ? ts.correct + "/" + ts.total : "");
      set(`[data-done-topic="${t.id}"]`, `${ts.done}/${ts.count} readings`);
      topicItems(pass, t).forEach((it) => {
        set(`[data-pct-item="${it.id}"]`, pill(itemScore(pass, it).pct));
        it.children.forEach((k) => set(`[data-pct-item="${k.id}"]`, pill(itemScore(pass, { id: k.id, children: [] }).pct)));
      });
    });
    const s = passSummary(pass);
    $("#pass-pct").textContent = fmtPct(s.pct);
    $("#pass-score").textContent = `${s.correct}/${s.total} questions`;
    $("#pass-w").textContent = fmtPct(s.weighted);
    $("#pass-done").textContent = `${s.done}/${s.count}`;
  }
  function rerenderKeepOpen() {
    const open = [...document.querySelectorAll("details.topic[open]")].map((d) => d.dataset.topic);
    const y = window.scrollY;
    render();
    open.forEach((id) => { const d = $(`details.topic[data-topic="${id}"]`); if (d) d.open = true; });
    window.scrollTo(0, y);
  }
  function activePass() { return state.passes.find((p) => "pass-" + p.id === current()); }

  // ---------- generic input handling ----------
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.f && el.dataset.id) {
      const pass = activePass(); if (!pass) return;
      const r = pass.results[el.dataset.id] || (pass.results[el.dataset.id] = { date: null, correct: null, total: null, note: "" });
      const f = el.dataset.f;
      r[f] = f === "correct" || f === "total" ? toNum(el.value) : el.value || (f === "note" ? "" : null);
      if (r.correct != null && r.total != null && r.correct > r.total) toast("Correct is higher than total — double-check");
      if (f !== "note" && !r.date && (r.correct != null || r.total != null)) {
        r.date = todayISO();
        const d = $(`input[data-f="date"][data-id="${el.dataset.id}"]`); if (d) d.value = r.date;
      }
      save(); refreshPassNumbers(pass);
      return;
    }
    if (el.dataset.conspect) {
      const t = state.topics.find((x) => x.id === el.dataset.conspect); t.conspect = el.value; save(); render(); return;
    }
    if (el.dataset.setting) {
      state.settings[el.dataset.setting] = el.type === "number" ? toNum(el.value) : el.value; save(); toast("Saved"); return;
    }
    if (el.dataset.topicField) {
      const t = state.topics.find((x) => x.id === el.dataset.topicId);
      t[el.dataset.topicField] = el.dataset.topicField === "weight" ? (toNum(el.value) || 0) / 100 : el.value;
      save(); toast("Saved"); return;
    }
    if (el.dataset.readingName) {
      const t = state.topics.find((x) => x.id === el.dataset.topicId);
      const r = t.readings.find((x) => x.id === el.dataset.readingName); r.name = el.value; save(); toast("Saved"); return;
    }
    if (el.dataset.passName) {
      const p = state.passes.find((x) => x.id === el.dataset.passName); p.name = el.value.trim() || p.name; save(); render(); return;
    }
    if (el.id === "import-file" && el.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data.topics) || !Array.isArray(data.passes)) throw new Error("bad");
          state = data; save(); render(); toast("Backup imported");
        } catch (err) { toast("That file is not a valid tracker backup"); }
      };
      reader.readAsText(el.files[0]);
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.dataset.delHour) {
      state.hours = state.hours.filter((h) => h.id !== t.dataset.delHour); save(); render();
    } else if (t.dataset.delExtra) {
      if (!confirm("Remove this item and its score?")) return;
      const pass = activePass(), id = t.dataset.delExtra;
      const gone = new Set([id, ...pass.extras.filter((x) => x.parentId === id).map((x) => x.id)]);
      pass.extras = pass.extras.filter((x) => !gone.has(x.id));
      gone.forEach((g) => delete pass.results[g]);
      save(); rerenderKeepOpen();
    } else if (t.dataset.expand) {
      document.querySelectorAll("details.topic").forEach((d) => (d.open = t.dataset.expand === "1"));
    } else if (t.dataset.action) {
      actions[t.dataset.action](t);
    }
  });

  // ---------- settings ----------
  function renderSettings() {
    const s = state.settings;
    const wsum = state.topics.reduce((a, t) => a + (t.weight || 0), 0);
    const passes = state.passes.map((p) => `<div class="row" style="margin-bottom:8px">
        <input type="text" data-pass-name="${p.id}" value="${esc(p.name)}">
        ${state.passes.length > 1 ? `<button class="btn danger sm" data-action="deletePass" data-id="${p.id}">Delete</button>` : ""}</div>`).join("");
    const topics = state.topics.map((t) => `<details class="topic"><summary><span class="t-name">${esc(t.name)}</span><span class="spacer"></span>
        <span class="small muted">${t.readings.length} readings · ${((t.weight || 0) * 100).toFixed(1)}%</span></summary><div class="body">
        <div class="form-grid" style="margin-bottom:12px">
          <label>Topic name<input type="text" data-topic-field="name" data-topic-id="${t.id}" value="${esc(t.name)}"></label>
          <label>Exam weight range<input type="text" data-topic-field="weightRange" data-topic-id="${t.id}" value="${esc(t.weightRange || "")}"></label>
          <label>Weight used for weighted grade (%)<input type="number" step="0.1" data-topic-field="weight" data-topic-id="${t.id}" value="${+((t.weight || 0) * 100).toFixed(2)}"></label>
        </div>
        <table><tbody>${t.readings.map((r) => `<tr><td><input type="text" style="width:100%" data-reading-name="${r.id}" data-topic-id="${t.id}" value="${esc(r.name)}"></td>
          <td class="num"><button class="icon-btn" title="Delete reading" data-action="deleteReading" data-topic="${t.id}" data-id="${r.id}">×</button></td></tr>`).join("")}</tbody></table>
        <div class="row" style="margin-top:8px"><button class="btn ghost sm" data-action="addReading" data-topic="${t.id}">+ Add reading</button>
          <span class="spacer"></span><button class="btn danger sm" data-action="deleteTopic" data-topic="${t.id}">Delete topic</button></div>
      </div></details>`).join("");
    return `<h2>Settings</h2>
      <div class="card"><h3>Exam</h3><div class="form-grid">
        <label>Exam date<input type="date" data-setting="examDate" value="${esc(s.examDate)}"></label>
        <label>Study start date<input type="date" data-setting="startDate" value="${esc(s.startDate)}"></label>
        <label>Study hours goal<input type="number" min="0" data-setting="hoursGoal" value="${s.hoursGoal ?? ""}"></label>
        <label>Level<input type="text" data-setting="level" value="${esc(s.level || "")}"></label>
      </div></div>
      <div class="card"><h3>Practice passes</h3><p class="muted small">Each pass gets its own tab for scores (e.g. First pass, Revision, Mock exams).</p>
        ${passes}<button class="btn ghost sm" data-action="addPass">+ Add pass</button></div>
      <div class="card"><h3>Curriculum &amp; exam weights</h3>
        <p class="muted small">Weights total ${(wsum * 100).toFixed(1)}%. Change topics and readings here when the curriculum or level changes.</p>
        ${topics}<button class="btn ghost sm" data-action="addTopic">+ Add topic</button></div>
      ${CLOUD && user ? `<div class="card"><h3>Account</h3>
        <p class="muted small">Signed in as <b>${esc(user.email)}</b>. Your tracker is saved to your account and syncs across devices.</p>
        <form id="password-form" class="row"><input type="password" name="password" placeholder="New password" minlength="8" autocomplete="new-password" required>
          <button class="btn ghost sm" type="submit">Change password</button></form></div>` : ""}
      <div class="card"><h3>Backup</h3>
        <p class="muted small">${CLOUD ? "Download a copy of your data now and then, just in case." : "Data is saved in this browser only. Export a backup regularly — you can import it on another computer or phone."}</p>
        <div class="row"><button class="btn" data-action="exportJson">Export backup</button>
          <label class="btn ghost" style="cursor:pointer">Import backup<input type="file" id="import-file" accept="application/json,.json" hidden></label>
          <span class="spacer"></span>
          <button class="btn danger" data-action="startBlank">Start over (blank)</button>
          <button class="btn danger" data-action="resetSeed">Load Excel data</button></div></div>`;
  }

  // ---------- login (cloud mode) ----------
  function renderLogin(message) {
    $("#tabs").innerHTML = ""; renderAccountBar();
    $("#view").innerHTML = `<div class="login card">
      <h2>Sign in</h2>
      <p class="muted small">Use the email and password you were given.</p>
      <form id="login-form">
        <label>Email<input type="email" name="email" autocomplete="username" required></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <div class="form-msg" id="login-msg">${esc(message || "")}</div>
        <button class="btn" type="submit" style="width:100%">Sign in</button>
      </form>
      <button class="link-btn small" data-action="forgotPassword">Forgot password?</button></div>`;
    const f = $("#login-form input[name=email]"); if (f) f.focus();
  }
  function renderSetPassword() {
    $("#tabs").innerHTML = "";
    $("#view").innerHTML = `<div class="login card"><h2>Choose a new password</h2>
      <form id="password-form"><label>New password<input type="password" name="password" minlength="8" autocomplete="new-password" required></label>
      <div class="form-msg"></div><button class="btn" type="submit" style="width:100%">Save password</button></form></div>`;
  }
  function renderMessage(html) { $("#tabs").innerHTML = ""; $("#view").innerHTML = `<div class="login card">${html}</div>`; }

  async function startSession(u) {
    if (user && user.id === u.id && state) return; // already running (token refresh etc.)
    if (startSession.loading === u.id) return;      // INITIAL_SESSION and SIGNED_IN can both fire
    startSession.loading = u.id;
    user = u; state = null;
    renderMessage(`<p class="muted">Loading your tracker…</p>`);
    try {
      const row = await fetchRemote();
      if (row) { state = row.data; remoteUpdatedAt = row.updated_at; }
      else {
        // First sign-in: offer to move data saved in this browser (local mode) into the account.
        const local = loadLocal();
        if (local && confirm("This browser has tracker data saved from before. Upload it to your account?")) state = local;
        else state = blankTemplate();
        await pushRemote();
      }
      startSession.loading = null;
      render();
    } catch (err) {
      startSession.loading = null;
      renderMessage(`<h2>Could not load your data</h2><p class="muted">${esc(err.message || err)}</p>
        <div class="row"><button class="btn" data-action="retryLoad">Try again</button><button class="btn ghost" data-action="signOut">Sign out</button></div>`);
      user = null;
      startSession.pending = u;
    }
  }

  async function boot() {
    if (!CLOUD) {
      state = loadLocal() || (window.CFA_SEED ? clone(window.CFA_SEED) : emptyState());
      render(); return;
    }
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
    sb.auth.onAuthStateChange((event, session) => {
      // Defer: Supabase recommends not awaiting other calls inside this callback.
      setTimeout(() => {
        if (event === "PASSWORD_RECOVERY") { recovering = true; user = session.user; state = null; renderSetPassword(); return; }
        if (event === "SIGNED_OUT") { user = null; state = null; renderLogin(); return; }
        if (session && session.user && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
          if (recovering) return; // waiting for the new password first
          startSession(session.user);
        } else if (event === "INITIAL_SESSION" && !session) renderLogin();
      }, 0);
    });
    // Pick up changes made on another device when coming back to this tab.
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible" || !user || !state || syncBusy()) return;
      try {
        const row = await fetchRemote();
        if (row && row.updated_at !== remoteUpdatedAt && !syncBusy()) {
          state = row.data; remoteUpdatedAt = row.updated_at; rerenderKeepOpen(); toast("Updated from another device");
        }
      } catch (e) { /* offline — ignore */ }
    });
    window.addEventListener("beforeunload", (e) => { if (syncBusy()) { e.preventDefault(); e.returnValue = ""; } });
  }

  const actions = {
    addPass() {
      const name = prompt("Name of the new pass", "Revision " + state.passes.length);
      if (!name) return;
      const id = uid("p");
      state.passes.push({ id, name: name.trim(), results: {}, extras: [] });
      save(); location.hash = "pass-" + id;
    },
    deletePass(b) {
      const p = state.passes.find((x) => x.id === b.dataset.id);
      if (!confirm(`Delete "${p.name}" and all its scores?`)) return;
      state.passes = state.passes.filter((x) => x !== p); save(); render();
    },
    addReading(b) {
      const t = state.topics.find((x) => x.id === b.dataset.topic);
      const name = prompt("Reading name", "Reading ");
      if (!name) return;
      t.readings.push({ id: uid("r"), name: name.trim() }); save(); rerenderKeepOpen();
    },
    deleteReading(b) {
      const t = state.topics.find((x) => x.id === b.dataset.topic);
      if (!confirm("Delete this reading and its scores in every pass?")) return;
      t.readings = t.readings.filter((r) => r.id !== b.dataset.id);
      state.passes.forEach((p) => { delete p.results[b.dataset.id]; p.extras.forEach((x) => { if (x.parentId === b.dataset.id) x.parentId = null; }); });
      save(); rerenderKeepOpen();
    },
    addTopic() {
      const name = prompt("Topic name");
      if (!name) return;
      state.topics.push({ id: uid("t"), name: name.trim(), weightRange: "", weight: 0, conspect: "Not started", readings: [] }); save(); render();
    },
    deleteTopic(b) {
      const t = state.topics.find((x) => x.id === b.dataset.topic);
      if (!confirm(`Delete topic "${t.name}" with all its readings and scores?`)) return;
      state.topics = state.topics.filter((x) => x !== t);
      state.passes.forEach((p) => {
        t.readings.forEach((r) => delete p.results[r.id]);
        p.extras.filter((x) => x.topicId === t.id).forEach((x) => delete p.results[x.id]);
        p.extras = p.extras.filter((x) => x.topicId !== t.id);
      });
      save(); render();
    },
    exportJson() {
      const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `cfa-tracker-backup-${todayISO()}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    resetSeed() {
      if (!window.CFA_SEED) return;
      if (!confirm("Replace ALL current data with the data imported from the Excel file?")) return;
      state = clone(window.CFA_SEED); save(); render(); toast("Loaded Excel data");
    },
    startBlank() {
      if (!confirm("Erase ALL scores, hours and notes and start with an empty tracker?")) return;
      state = blankTemplate(); save(); render(); toast("Started over");
    },
    async signOut() {
      if (syncBusy() && !confirm("Some changes are still saving. Sign out anyway?")) return;
      clearTimeout(sync.timer); sync.timer = null;
      await sb.auth.signOut();
    },
    retryLoad() { const u = startSession.pending; if (u) startSession(u); },
    async forgotPassword() {
      const email = ($("#login-form input[name=email]") || {}).value || prompt("Your email");
      if (!email) return;
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      const msg = $("#login-msg");
      if (msg) msg.textContent = error ? error.message : "If that email has an account, a reset link is on its way.";
    },
  };

  // login + password forms
  document.addEventListener("submit", async (e) => {
    if (e.target.id === "login-form") {
      e.preventDefault();
      const f = new FormData(e.target), btn = e.target.querySelector("button[type=submit]"), msg = $("#login-msg");
      btn.disabled = true; msg.textContent = "";
      const { error } = await sb.auth.signInWithPassword({ email: f.get("email").trim(), password: f.get("password") });
      btn.disabled = false;
      if (error) msg.textContent = error.message === "Invalid login credentials" ? "Wrong email or password." : error.message;
    }
    if (e.target.id === "password-form") {
      e.preventDefault();
      const pw = new FormData(e.target).get("password");
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) { toast(error.message); return; }
      toast("Password updated"); e.target.reset();
      if (recovering && user) { recovering = false; history.replaceState(null, "", location.pathname); startSession(user); }
    }
  });

  boot();
})();
