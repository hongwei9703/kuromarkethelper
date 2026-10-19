"use strict";

const RULE_LABEL = { stack: "9999 stack", unit: "per unit" };
const DAY = 24 * 60 * 60 * 1000;

let state = { favourites: [], history: {}, synced: false };
let detailItem = null;
let detailRange = 7;
let detailChart = null;
const sparkCharts = [];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
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

function latest(points) {
  return points.length ? points[points.length - 1] : null;
}

/** % change of cheapest vs the closest record at least 24h older than the latest. */
function change24h(points) {
  const last = latest(points);
  if (!last || !last.s) return null;
  const cutoff = last.t - DAY;
  let base = null;
  for (const p of points) {
    if (p.t <= cutoff && p.s) base = p;
    if (p.t > cutoff) break;
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

// ---- charts ----------------------------------------------------------------

function lineDatasets(points) {
  const toXY = (key) => points.map((p) => ({ x: p.t, y: p.s ? p.s[key] : null }));
  return [
    { label: "Cheapest", data: toXY("cheapest"), borderColor: css("--cheapest"), backgroundColor: css("--cheapest"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, spanGaps: false, tension: 0.2 },
    { label: "Typical (median)", data: toXY("median"), borderColor: css("--median"), backgroundColor: css("--median"), borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 4, spanGaps: false, tension: 0.2 },
  ];
}

function timeLabel(ms, spanDays) {
  const d = new Date(ms);
  if (spanDays <= 1) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function sparkChart(canvas, points) {
  return new Chart(canvas, {
    type: "line",
    data: { datasets: lineDatasets(points) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      events: [],
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { type: "linear", display: false }, y: { display: false, grace: "10%" } },
    },
  });
}

function renderDetailChart() {
  if (!detailItem) return;
  const points = since(series(detailItem.itemId, detailItem.rule), detailRange);
  const spanDays = points.length > 1 ? (points[points.length - 1].t - points[0].t) / DAY : 1;
  if (detailChart) detailChart.destroy();
  detailChart = new Chart($("detail-chart"), {
    type: "line",
    data: { datasets: lineDatasets(points) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: css("--text-2"), usePointStyle: false, boxHeight: 2 } },
        tooltip: {
          callbacks: {
            title: (items) => new Date(items[0].parsed.x).toLocaleString(),
            label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          ticks: { color: css("--muted"), maxTicksLimit: 7, callback: (v) => timeLabel(v, spanDays) },
          grid: { color: css("--grid") },
        },
        y: {
          ticks: { color: css("--muted"), callback: (v) => fmt(v) },
          grid: { color: css("--grid") },
          grace: "10%",
        },
      },
    },
  });
}

// ---- rendering -------------------------------------------------------------

function renderSync() {
  const el = $("sync");
  el.textContent = state.synced ? "Synced" : "Not synced";
  el.className = "badge " + (state.synced ? "ok" : "off");
  el.title = state.synced ? "Latest prices pulled from GitHub" : "Couldn't reach GitHub — showing the last prices on this PC";
}

function renderGrid() {
  sparkCharts.splice(0).forEach((c) => c.destroy());
  const grid = $("grid");
  grid.innerHTML = "";
  if (!state.favourites.length) {
    grid.innerHTML = '<p class="muted">No favourites yet — search for an item above and add it.</p>';
    return;
  }
  for (const fav of state.favourites) {
    const points = series(fav.itemId, fav.rule);
    const last = latest(points);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    let body;
    if (!last) {
      body = '<div class="card-empty">No data yet — the first check runs within 30 minutes.</div>';
    } else if (!last.s) {
      body = '<div class="card-empty">No listings right now</div><div class="spark"><canvas></canvas></div>';
    } else {
      const ch = change24h(points);
      const chHtml = ch == null ? "" :
        `<span class="change ${ch < 0 ? "down" : ch > 0 ? "up" : ""}">${ch < 0 ? "▼" : ch > 0 ? "▲" : "—"} ${Math.abs(ch).toFixed(1)}% <span class="muted">24h</span></span>`;
      body = `<div class="card-price"><span class="big">${fmt(last.s.cheapest)}</span>${chHtml}</div>
        <div class="card-median">typical ${fmt(last.s.median)} · ${last.s.listings} listings</div>
        <div class="spark"><canvas></canvas></div>`;
    }
    card.innerHTML = `<div class="card-name">${esc(fav.itemName)}</div><div class="card-rule">${RULE_LABEL[fav.rule]}</div>${body}`;
    card.addEventListener("click", () => openDetail(fav));
    grid.appendChild(card);
    const canvas = card.querySelector("canvas");
    if (canvas) sparkCharts.push(sparkChart(canvas, since(points, 7)));
  }
}

function listingsTable(rows, rule) {
  if (!rows.length) return '<p class="muted">No listings match this rule right now.</p>';
  const unitHead = rule === "unit" ? "In stock" : "Stacks";
  const trs = rows.map((r) => `<tr><td>${esc(r.shopOwner)}</td><td>Ch ${esc(r.channel)}</td><td class="num">${fmt(r.pricePerBundle)}</td><td class="num">${fmt(r.bundles)}</td></tr>`).join("");
  return `<div class="table-scroll"><table><thead><tr><th>Seller</th><th>Channel</th><th class="num">Price</th><th class="num">${unitHead}</th></tr></thead><tbody>${trs}</tbody></table></div>`;
}

// ---- detail view -----------------------------------------------------------

async function openDetail(fav) {
  detailItem = fav;
  $("detail-title").textContent = fav.itemName;
  $("detail-sub").textContent = `${RULE_LABEL[fav.rule]} · prices in Perfect Pitch`;
  $("detail-rule").value = fav.rule;
  $("detail-listings").innerHTML = '<p class="muted">Loading…</p>';
  $("detail").showModal();
  renderDetailChart();
  try {
    const rows = await api(`/api/listings?itemId=${fav.itemId}&rule=${fav.rule}&q=${encodeURIComponent(fav.itemName)}`);
    if (detailItem !== fav) return;
    $("detail-listings").innerHTML = listingsTable(rows, fav.rule);
  } catch (e) {
    if (detailItem === fav) $("detail-listings").innerHTML = `<p class="muted">Couldn't load listings: ${esc(e.message)}</p>`;
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
    if (!res.pushed) toast("Saved locally — couldn't reach GitHub, will sync next time.");
    await refresh();
  } catch (e) {
    toast(`Couldn't save: ${e.message}`);
  }
}

// ---- search ----------------------------------------------------------------

async function runSearch(query) {
  const box = $("search-results");
  box.hidden = false;
  box.innerHTML = '<p class="muted">Searching…</p>';
  let results;
  try {
    results = await api(`/api/search?q=${encodeURIComponent(query)}`);
  } catch (e) {
    box.innerHTML = `<p class="muted">Search failed: ${esc(e.message)}</p>`;
    return;
  }
  if (!results.length) {
    box.innerHTML = `<p class="muted">Nothing on the market matches “${esc(query)}”.</p>`;
    return;
  }
  box.innerHTML = "";
  for (const r of results) {
    const s = r[r.defaultRule];
    const tracked = state.favourites.some((f) => f.itemId === r.itemId);
    const el = document.createElement("div");
    el.className = "result";
    el.innerHTML = `<div class="result-row">
        <span class="result-name">${esc(r.itemName)} <span class="card-rule">${RULE_LABEL[r.defaultRule]}</span></span>
        <span class="result-prices">${s ? `cheapest <b>${fmt(s.cheapest)}</b> · typical ${fmt(s.median)}` : "no listings match the rule"}</span>
        <button type="button" class="${tracked ? "" : "primary"}" ${tracked ? "disabled" : ""}>${tracked ? "★ Tracked" : "Add to favourites"}</button>
      </div>
      <details><summary>${r.listings.length} listings</summary>${listingsTable(r.listings, r.defaultRule)}</details>`;
    const btn = el.querySelector("button");
    if (!tracked) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Adding…";
        await changeFavourite({ action: "add", itemId: r.itemId, itemName: r.itemName });
        btn.textContent = "★ Tracked";
      });
    }
    box.appendChild(el);
  }
}

// ---- wiring ----------------------------------------------------------------

async function refresh() {
  try {
    state = await api("/api/state");
  } catch (e) {
    toast(`Couldn't load data: ${e.message}`);
  }
  renderSync();
  renderGrid();
}

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("search-input").value.trim();
  if (q) runSearch(q);
});

$("detail-close").addEventListener("click", () => $("detail").close());
$("detail").addEventListener("close", () => {
  detailItem = null;
  if (detailChart) { detailChart.destroy(); detailChart = null; }
});
$("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").close(); });

document.querySelectorAll(".ranges button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ranges button").forEach((b) => b.classList.toggle("active", b === btn));
    detailRange = Number(btn.dataset.range);
    renderDetailChart();
  });
});

$("detail-rule").addEventListener("change", async (e) => {
  const fav = detailItem;
  await changeFavourite({ action: "set_rule", itemId: fav.itemId, rule: e.target.value });
  const updated = state.favourites.find((f) => f.itemId === fav.itemId);
  if (updated) openDetail(updated);
});

$("detail-remove").addEventListener("click", async () => {
  const fav = detailItem;
  if (!confirm(`Stop tracking ${fav.itemName}? Its price history is kept.`)) return;
  $("detail").close();
  await changeFavourite({ action: "remove", itemId: fav.itemId });
});

refresh();
