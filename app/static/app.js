"use strict";

const RULE_LABEL = { stack: "per 9999 stack", unit: "per unit", equip: "per item" };
const DAY = 24 * 60 * 60 * 1000;
const ICON = {
  down: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2 V10 M2.5 6.5 L6 10 L9.5 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10 V2 M2.5 5.5 L6 2 L9.5 5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flat: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6 H10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3 V13 M3 8 H13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevron: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9 L12 15 L18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

let state = { favourites: [], history: {}, synced: false };
let expandedId = null;
let panelRange = 7;
let panelChart = null;
const sparkCharts = [];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "-" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hasGsap = () => typeof window.gsap !== "undefined";
const hasChart = () => typeof window.Chart !== "undefined";
const motionOK = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;


function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  if (hasGsap() && motionOK()) gsap.fromTo(el, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 5000);
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

// ---- data helpers ----------------------------------------------------------

function series(itemId, rule) {
  return (state.history[String(itemId)] || []).map((r) => ({ t: Date.parse(r.t), s: r[rule] || null }));
}

const latest = (points) => (points.length ? points[points.length - 1] : null);

/** % change of cheapest vs the closest record at least 24h older than the latest. */
function change24h(points) {
  const last = latest(points);
  if (!last || !last.s) return null;
  const cutoff = last.t - DAY;
  let base = null;
  for (const p of points) {
    if (p.t > cutoff) break;
    if (p.s) base = p;
  }
  if (!base || !base.s.cheapest) return null;
  return ((last.s.cheapest - base.s.cheapest) / base.s.cheapest) * 100;
}

function since(points, days) {
  if (!days) return points;
  const last = latest(points);
  const from = (last ? last.t : Date.now()) - days * DAY;
  return points.filter((p) => p.t >= from);
}

function ago(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

function itemView(fav) {
  const points = series(fav.itemId, fav.rule);
  return { fav, points, last: latest(points), change: change24h(points) };
}

function chip(change) {
  if (change == null) return "";
  const dir = change < -0.05 ? "down" : change > 0.05 ? "up" : "flat";
  return `<span class="chip ${dir === "flat" ? "" : dir}">${ICON[dir]}${Math.abs(change).toFixed(1)}%<span class="span">24h</span></span>`;
}

// ---- charts ----------------------------------------------------------------

/** Average points into at most `max` time buckets; a bucket with no listings stays a gap. */
function downsample(points, max) {
  if (points.length <= max) return points;
  const t0 = points[0].t;
  const width = (points[points.length - 1].t - t0) / max || 1;
  const buckets = [];
  for (const p of points) {
    const i = Math.min(max - 1, Math.floor((p.t - t0) / width));
    (buckets[i] ||= []).push(p);
  }
  return buckets.filter(Boolean).map((b) => {
    const live = b.filter((p) => p.s);
    if (!live.length) return { t: b[b.length - 1].t, s: null };
    const avg = (k) => live.reduce((sum, p) => sum + p.s[k], 0) / live.length;
    return { t: b[b.length - 1].t, s: { cheapest: avg("cheapest"), median: avg("median") } };
  });
}

function fillGradient(color) {
  return (ctx) => {
    const { chart } = ctx;
    const area = chart.chartArea;
    if (!area) return "transparent";
    const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, color + "38");
    g.addColorStop(1, color + "00");
    return g;
  };
}

function lineDatasets(points, { fill } = {}) {
  const toXY = (key) => points.map((p) => ({ x: p.t, y: p.s ? p.s[key] : null }));
  const cheap = css("--cheapest");
  const median = css("--median");
  return [
    { label: "Cheapest listing", data: toXY("cheapest"), borderColor: cheap, backgroundColor: fill ? fillGradient(cheap) : cheap, fill: fill ? "start" : false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBorderWidth: 2, pointHoverBackgroundColor: css("--surface-solid"), spanGaps: false, tension: 0.3 },
    { label: "Typical price", data: toXY("median"), borderColor: median, backgroundColor: median, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 4, pointHoverBorderWidth: 2, pointHoverBackgroundColor: css("--surface-solid"), spanGaps: false, tension: 0.3 },
  ];
}

function timeLabel(ms, spanDays) {
  const d = new Date(ms);
  if (spanDays <= 1.2) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Row sparkline: cheapest only, so its trend isn't flattened by the gap to the typical price. */
function sparkChart(canvas, points) {
  return new Chart(canvas, {
    type: "line",
    data: { datasets: lineDatasets(points, { fill: true }).slice(0, 1) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      events: [],
      layout: { padding: { top: 3, bottom: 3 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { type: "linear", display: false }, y: { display: false, grace: "12%" } },
    },
  });
}

function renderPanelChart(canvas, fav) {
  if (!hasChart()) return;
  const points = downsample(since(series(fav.itemId, fav.rule), panelRange), 168);
  const spanDays = points.length > 1 ? (points[points.length - 1].t - points[0].t) / DAY : 1;
  if (panelChart) panelChart.destroy();
  panelChart = new Chart(canvas, {
    type: "line",
    data: { datasets: lineDatasets(points, { fill: true }) },
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      animation: motionOK() ? { duration: 450, easing: "easeOutQuart" } : false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css("--surface-solid"), titleColor: css("--text"), bodyColor: css("--text-2"),
          borderColor: css("--border-strong"), borderWidth: 1, padding: 12, cornerRadius: 12, boxPadding: 4,
          titleFont: { family: "Outfit", weight: "600" }, bodyFont: { family: "Geist" },
          callbacks: {
            title: (items) => new Date(items[0].parsed.x).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
            label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          type: "linear", border: { display: false }, grid: { display: false },
          ticks: { color: css("--muted"), maxTicksLimit: 7, font: { family: "Outfit", size: 12 }, callback: (v) => timeLabel(v, spanDays) },
        },
        y: {
          position: "right", border: { display: false }, grid: { color: css("--grid") }, grace: "10%",
          ticks: { color: css("--muted"), maxTicksLimit: 5, font: { family: "Geist", size: 11 }, callback: (v) => fmt(v) },
        },
      },
    },
  });
}

// ---- rendering -------------------------------------------------------------

function renderSync() {
  const el = $("sync");
  el.className = "sync " + (state.synced ? "ok" : "off");
  el.querySelector(".sync-label").textContent = state.synced ? "Synced" : "Offline";
  el.title = state.synced ? "Latest prices pulled from GitHub" : "Couldn't reach GitHub. Showing the last prices on this PC.";
}

function renderSubtitle(views) {
  const lastT = Math.max(0, ...views.map((v) => (v.last ? v.last.t : 0)));
  const cheaper = views.filter((v) => v.change != null && v.change < -0.05).length;
  const parts = [`${views.length} item${views.length === 1 ? "" : "s"} tracked`];
  if (lastT) parts.push(`last check ${ago(lastT)}`);
  if (views.some((v) => v.change != null)) parts.push(`${cheaper} cheaper than a day ago`);
  $("subtitle").textContent = views.length ? parts.join("  ·  ") : "Search for an item to start tracking it.";
}

function renderTicker(views) {
  const live = views.filter((v) => v.last && v.last.s);
  const ticker = $("ticker");
  ticker.hidden = live.length < 2;
  if (ticker.hidden) return;
  const items = live.map((v) => `<span class="tick">${esc(v.fav.itemName)} <b>${fmt(v.last.s.cheapest)}</b>${chip(v.change)}</span>`).join("");
  $("ticker-track").innerHTML = items + items; // doubled so the loop is seamless
  const track = $("ticker-track");
  track.style.animationDuration = `${Math.max(30, live.length * 7)}s`;
}

function rowHtml(v) {
  const { fav, last } = v;
  const s = last && last.s;
  const name = `<span class="row-name"><strong title="${esc(fav.itemName)}">${esc(fav.itemName)}</strong><small>${RULE_LABEL[fav.rule]}</small></span>`;
  if (!s) {
    const note = last ? "No real listings right now" : "Waiting for the first check";
    return `${name}<span class="row-spark">${last ? "<canvas></canvas>" : ""}</span>
      <span class="r none" style="grid-column: span 4">${note}</span>${ICON.chevron}`;
  }
  return `${name}<span class="row-spark"><canvas></canvas></span>
    <span class="r price" data-value="${s.cheapest}">${fmt(s.cheapest)}</span>
    <span class="r typical">${fmt(s.median)}</span>
    <span class="r">${chip(v.change)}</span>
    <span class="r count">${fmt(s.listings)}</span>
    ${ICON.chevron}`;
}

function animateRows(container) {
  if (!hasGsap() || !motionOK()) return;
  const rows = container.querySelectorAll(".row-wrap");
  gsap.fromTo(rows, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.035, ease: "power2.out", clearProps: "transform,opacity" });
  container.querySelectorAll(".price[data-value]").forEach((el) => {
    const target = Number(el.dataset.value);
    const counter = { v: target * 0.85 };
    gsap.to(counter, { v: target, duration: 0.9, ease: "power2.out", onUpdate: () => (el.textContent = fmt(Math.round(counter.v))) });
  });
  // safety net: never leave a row invisible if an animation stalls
  setTimeout(() => rows.forEach((r) => {
    if (getComputedStyle(r).opacity < 0.99) gsap.set(r, { clearProps: "transform,opacity" });
  }), 2000);
}

function renderRows(views, { animate } = {}) {
  sparkCharts.splice(0).forEach((c) => c.destroy());
  if (panelChart) { panelChart.destroy(); panelChart = null; }
  const box = $("rows");
  box.innerHTML = "";
  if (!views.length) {
    box.innerHTML = '<p class="list-empty">No favourites yet. Search for an item above and add it.</p>';
    return;
  }
  for (const v of views) {
    const wrap = document.createElement("div");
    wrap.className = "row-wrap";
    wrap.dataset.id = v.fav.itemId;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "row";
    row.setAttribute("aria-expanded", "false");
    row.innerHTML = rowHtml(v);
    row.addEventListener("click", () => toggleRow(v.fav.itemId));
    wrap.appendChild(row);
    box.appendChild(wrap);
    const canvas = row.querySelector("canvas");
    if (canvas && hasChart()) sparkCharts.push(sparkChart(canvas, downsample(since(v.points, 7), 42)));
  }
  if (animate) animateRows(box);
  if (expandedId != null) {
    const fav = state.favourites.find((f) => f.itemId === expandedId);
    if (fav) expandRow(fav, { animate: false });
    else expandedId = null;
  }
}

function render({ animate } = {}) {
  const views = state.favourites.map(itemView);
  renderSync();
  renderSubtitle(views);
  renderTicker(views);
  renderRows(views, { animate });
}

/** Free Market rooms are maps 910000001-910000022; anything else has no room number. */
function room(mapId) {
  const n = Number(mapId) - 910000000;
  return n >= 1 && n <= 99 ? n : null;
}

function listingsTable(rows, rule) {
  if (!rows.length) return '<p class="empty-note">No listings match this rule right now.</p>';
  const unitHead = rule === "stack" ? "Stacks" : "In stock";
  const trs = rows.map((r) => `<tr><td>${esc(r.shopOwner)}</td><td>Ch ${esc(r.channel)}</td><td>${room(r.mapId) == null ? "-" : `Room ${room(r.mapId)}`}</td><td class="num">${fmt(r.pricePerBundle)}</td><td class="num">${fmt(r.bundles)}</td></tr>`).join("");
  return `<div class="table-scroll"><table><thead><tr><th>Seller</th><th>Channel</th><th>Room</th><th class="num">Price</th><th class="num">${unitHead}</th></tr></thead><tbody>${trs}</tbody></table></div>`;
}

// ---- expanded row ----------------------------------------------------------

function collapseRow({ animate = true } = {}) {
  const wrap = document.querySelector(".row-wrap.open");
  expandedId = null;
  if (panelChart) { panelChart.destroy(); panelChart = null; }
  if (!wrap) return;
  wrap.classList.remove("open");
  wrap.querySelector(".row").setAttribute("aria-expanded", "false");
  const panel = wrap.querySelector(".panel");
  if (!panel) return;
  if (animate && hasGsap() && motionOK()) {
    gsap.to(panel, { height: 0, opacity: 0, duration: 0.35, ease: "power2.inOut", onComplete: () => panel.remove() });
  } else {
    panel.remove();
  }
}

function toggleRow(itemId) {
  const wasOpen = expandedId === itemId;
  collapseRow();
  if (wasOpen) return;
  const fav = state.favourites.find((f) => f.itemId === itemId);
  if (fav) expandRow(fav, { animate: true });
}

async function expandRow(fav, { animate }) {
  const wrap = document.querySelector(`.row-wrap[data-id="${fav.itemId}"]`);
  if (!wrap) return;
  expandedId = fav.itemId;
  wrap.classList.add("open");
  wrap.querySelector(".row").setAttribute("aria-expanded", "true");
  const panel = $("panel-tpl").content.firstElementChild.cloneNode(true);
  wrap.appendChild(panel);

  const canvas = panel.querySelector("canvas");
  panel.querySelectorAll(".segmented button").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.range) === panelRange);
    btn.addEventListener("click", () => {
      panelRange = Number(btn.dataset.range);
      panel.querySelectorAll(".segmented button").forEach((b) => b.classList.toggle("active", b === btn));
      renderPanelChart(canvas, fav);
    });
  });
  const rule = panel.querySelector(".rule");
  rule.value = fav.rule;
  rule.addEventListener("change", () => changeFavourite({ action: "set_rule", itemId: fav.itemId, rule: rule.value }));
  panel.querySelector(".remove").addEventListener("click", async () => {
    if (!confirm(`Stop tracking ${fav.itemName}? Its price history is kept.`)) return;
    expandedId = null;
    await changeFavourite({ action: "remove", itemId: fav.itemId });
  });

  if (animate && hasGsap() && motionOK()) {
    gsap.fromTo(panel, { height: 0, opacity: 0 }, { height: "auto", opacity: 1, duration: 0.45, ease: "power3.out" });
  }
  renderPanelChart(canvas, fav);

  const listings = panel.querySelector(".listings");
  listings.innerHTML = '<p class="empty-note">Loading listings&hellip;</p>';
  try {
    const rows = await api(`/api/listings?itemId=${fav.itemId}&rule=${fav.rule}&q=${encodeURIComponent(fav.itemName)}`);
    if (expandedId === fav.itemId && panel.isConnected) listings.innerHTML = listingsTable(rows, fav.rule);
  } catch (e) {
    if (panel.isConnected) listings.innerHTML = `<p class="empty-note">Couldn't load listings: ${esc(e.message)}</p>`;
  }
}

async function changeFavourite(change) {
  try {
    const res = await api("/api/favourites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    state.favourites = res.favourites;
    if (!res.pushed) toast("Saved on this PC. It will sync to GitHub next time it can.");
    await refresh();
    return true;
  } catch (e) {
    toast(`Couldn't save: ${e.message}`);
    return false;
  }
}

// ---- search ----------------------------------------------------------------

async function runSearch(query) {
  const box = $("search-results");
  box.hidden = false;
  box.innerHTML = `<div class="results-head"><span>Searching for “${esc(query)}”&hellip;</span></div>`;
  let results;
  try {
    results = await api(`/api/search?q=${encodeURIComponent(query)}`);
  } catch (e) {
    box.innerHTML = `<p class="empty-note">Search failed: ${esc(e.message)}</p>`;
    return;
  }
  box.innerHTML = `<div class="results-head"><span>${results.length} result${results.length === 1 ? "" : "s"} for “${esc(query)}”</span>
    <button type="button" class="icon-btn" id="results-close" aria-label="Close results">${ICON.close}</button></div>`;
  $("results-close").addEventListener("click", () => { box.hidden = true; $("search-input").value = ""; });
  if (!results.length) {
    box.insertAdjacentHTML("beforeend", '<p class="empty-note">Nothing on the market matches that right now.</p>');
    return;
  }
  for (const r of results) {
    const s = r[r.defaultRule];
    const tracked = state.favourites.some((f) => f.itemId === r.itemId);
    const el = document.createElement("div");
    el.className = "result";
    el.innerHTML = `<div class="result-row">
        <span class="result-name">${esc(r.itemName)}<small>${RULE_LABEL[r.defaultRule]}</small></span>
        <span class="result-prices">${s ? `cheapest <b>${fmt(s.cheapest)}</b> · typical ${fmt(s.median)}` : "no listings match the rule"}</span>
        <button type="button" class="btn ${tracked ? "" : "btn-primary"}" ${tracked ? "disabled" : ""}>${tracked ? ICON.check + "Tracking" : ICON.plus + "Track"}</button>
      </div>
      <details><summary>${r.listings.length} listing${r.listings.length === 1 ? "" : "s"}</summary>${listingsTable(r.listings, r.defaultRule)}</details>`;
    const btn = el.querySelector("button");
    if (!tracked) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Adding…";
        const ok = await changeFavourite({ action: "add", itemId: r.itemId, itemName: r.itemName });
        btn.className = "btn";
        btn.innerHTML = ok ? ICON.check + "Tracking" : ICON.plus + "Track";
        btn.disabled = ok;
      });
    }
    box.appendChild(el);
  }
  if (hasGsap() && motionOK()) gsap.from(box.querySelectorAll(".result"), { opacity: 0, y: 10, duration: 0.45, stagger: 0.04, ease: "power2.out" });
}

// ---- wiring ----------------------------------------------------------------

async function refresh({ animate } = {}) {
  try {
    state = await api("/api/state");
  } catch (e) {
    toast(`Couldn't load data: ${e.message}`);
  }
  render({ animate });
}

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("search-input").value.trim();
  if (q) runSearch(q);
});

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement.tagName;
  if (e.key === "/" && tag !== "INPUT" && tag !== "SELECT") {
    e.preventDefault();
    $("search-input").focus();
  }
  if (e.key === "Escape" && expandedId != null && tag !== "INPUT") collapseRow();
});

refresh({ animate: true });
