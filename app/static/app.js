"use strict";

const RULE_LABEL = { stack: "per 9999 stack", unit: "per unit" };
const DAY = 24 * 60 * 60 * 1000;
const ICON = {
  down: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2 V10 M2.5 6.5 L6 10 L9.5 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10 V2 M2.5 5.5 L6 2 L9.5 5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flat: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6 H10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3 V13 M3 8 H13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

let state = { favourites: [], history: {}, synced: false };
let detailItem = null;
let detailRange = 7;
let detailChart = null;
const sparkCharts = [];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "-" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }));
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const hasGsap = () => typeof window.gsap !== "undefined";
const hasChart = () => typeof window.Chart !== "undefined";
const motionOK = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (hasGsap() && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

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

function sparkChart(canvas, points, feature) {
  return new Chart(canvas, {
    type: "line",
    data: { datasets: lineDatasets(points, { fill: true }) },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      events: [],
      layout: { padding: { top: 4, bottom: 2, right: feature ? 8 : 0 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { type: "linear", display: false },
        y: feature
          ? { position: "right", grace: "12%", border: { display: false }, grid: { color: css("--grid") }, ticks: { color: css("--muted"), maxTicksLimit: 4, font: { family: "Geist", size: 11 }, callback: (v) => fmt(v) } }
          : { display: false, grace: "12%" },
      },
    },
  });
}

function renderDetailChart() {
  if (!detailItem || !hasChart()) return;
  const points = downsample(since(series(detailItem.itemId, detailItem.rule), detailRange), 168);
  const spanDays = points.length > 1 ? (points[points.length - 1].t - points[0].t) / DAY : 1;
  if (detailChart) detailChart.destroy();
  detailChart = new Chart($("detail-chart"), {
    type: "line",
    data: { datasets: lineDatasets(points, { fill: true }) },
    options: {
      responsive: true, maintainAspectRatio: false, parsing: false,
      animation: motionOK() ? { duration: 500, easing: "easeOutQuart" } : false,
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
          ticks: { color: css("--muted"), maxTicksLimit: 6, font: { family: "Geist", size: 11 }, callback: (v) => fmt(v) },
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

function pickFeature(views) {
  const moving = views.filter((v) => v.change != null);
  if (moving.length) return moving.reduce((a, b) => (Math.abs(b.change) > Math.abs(a.change) ? b : a));
  return views.find((v) => v.last && v.last.s) || null;
}

function cardHtml(v, feature) {
  const { fav, last } = v;
  const head = `<div class="card-top"><div><div class="card-name">${esc(fav.itemName)}</div>
      <div class="eyebrow">${feature ? `Biggest mover today · ${RULE_LABEL[fav.rule]}` : RULE_LABEL[fav.rule]}</div></div>
      ${last && last.s ? chip(v.change) : ""}</div>`;
  if (!last) return head + '<div class="card-empty">No data yet. The first check lands within 30 minutes.</div>';
  if (!last.s) return head + '<div class="card-empty">No real listings right now</div><div class="spark"><canvas></canvas></div>';
  return `${head}
    <div class="card-price"><span class="big" data-value="${last.s.cheapest}">${fmt(last.s.cheapest)}</span></div>
    <div class="card-median">typical <span class="num">${fmt(last.s.median)}</span> · ${last.s.listings} listings</div>
    <div class="spark"><canvas></canvas></div>`;
}

/** Widen the last card so the final grid row never ends in an empty cell. */
function closeGridGaps(grid) {
  const cards = [...grid.querySelectorAll(".card")];
  cards.forEach((c) => (c.style.gridColumn = ""));
  const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
  if (cols < 2 || !cards.length) return;
  const feature = grid.querySelector(".card.feature");
  const featureCells = feature ? (cols >= 2 ? 4 : 1) : 0;
  const cells = featureCells + cards.length - (feature ? 1 : 0);
  const rem = cells % cols;
  if (!rem) return;
  const last = cards[cards.length - 1];
  if (last === feature) return;
  last.style.gridColumn = `span ${cols - rem + 1}`;
}

function animateGrid(grid) {
  if (!hasGsap() || !motionOK()) return;
  if (window.ScrollTrigger) ScrollTrigger.getAll().forEach((t) => t.kill());
  const cards = [...grid.querySelectorAll(".card")];
  const from = { opacity: 0, y: 26, scale: 0.96 };
  const to = { opacity: 1, y: 0, scale: 1, duration: 0.8, stagger: 0.06, ease: "power3.out", overwrite: true, clearProps: "transform,opacity" };
  // cards already on screen animate straight away; only cards below the fold wait for scroll
  const below = window.ScrollTrigger ? cards.filter((c) => c.getBoundingClientRect().top > window.innerHeight) : [];
  const visible = cards.filter((c) => !below.includes(c));
  gsap.fromTo(visible, from, to);
  if (below.length) {
    gsap.set(below, from);
    ScrollTrigger.batch(below, { start: "top 95%", onEnter: (batch) => gsap.to(batch, to) });
  }
  // safety net: never leave a card invisible if an animation stalls
  setTimeout(() => cards.forEach((c) => {
    if (getComputedStyle(c).opacity < 0.99 && c.getBoundingClientRect().top < window.innerHeight) gsap.set(c, { clearProps: "transform,opacity" });
  }), 2500);
  grid.querySelectorAll(".big[data-value]").forEach((el) => {
    const target = Number(el.dataset.value);
    const counter = { v: target * 0.82 };
    gsap.to(counter, { v: target, duration: 1.1, ease: "power2.out", onUpdate: () => (el.textContent = fmt(Math.round(counter.v))) });
  });
}

function renderGrid(views) {
  sparkCharts.splice(0).forEach((c) => c.destroy());
  const grid = $("grid");
  grid.innerHTML = "";
  if (!views.length) {
    grid.innerHTML = '<p class="grid-empty">No favourites yet. Search for an item above and add it.</p>';
    return;
  }
  const feature = views.length >= 5 ? pickFeature(views) : null;
  const ordered = feature ? [feature, ...views.filter((v) => v !== feature)] : views;
  for (const v of ordered) {
    const isFeature = v === feature;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card" + (isFeature ? " feature" : "");
    card.innerHTML = cardHtml(v, isFeature);
    card.addEventListener("click", () => openDetail(v.fav));
    grid.appendChild(card);
    const canvas = card.querySelector("canvas");
    if (canvas && hasChart()) sparkCharts.push(sparkChart(canvas, downsample(since(v.points, 7), isFeature ? 84 : 42), isFeature));
  }
  closeGridGaps(grid);
  animateGrid(grid);
}

function render() {
  const views = state.favourites.map(itemView);
  renderSync();
  renderSubtitle(views);
  renderTicker(views);
  renderGrid(views);
}

/** Free Market rooms are maps 910000001-910000022; anything else has no room number. */
function room(mapId) {
  const n = Number(mapId) - 910000000;
  return n >= 1 && n <= 99 ? n : null;
}

function listingsTable(rows, rule) {
  if (!rows.length) return '<p class="empty-note">No listings match this rule right now.</p>';
  const unitHead = rule === "unit" ? "In stock" : "Stacks";
  const trs = rows.map((r) => `<tr><td>${esc(r.shopOwner)}</td><td>Ch ${esc(r.channel)}</td><td>${room(r.mapId) == null ? "-" : `Room ${room(r.mapId)}`}</td><td class="num">${fmt(r.pricePerBundle)}</td><td class="num">${fmt(r.bundles)}</td></tr>`).join("");
  return `<div class="table-scroll"><table><thead><tr><th>Seller</th><th>Channel</th><th>Room</th><th class="num">Price</th><th class="num">${unitHead}</th></tr></thead><tbody>${trs}</tbody></table></div>`;
}

// ---- detail view -----------------------------------------------------------

function renderDetailStats(fav) {
  const v = itemView(fav);
  const s = v.last && v.last.s;
  const stat = (label, value) => `<div><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
  $("detail-stats").innerHTML = s
    ? stat("Cheapest", fmt(s.cheapest)) + stat("Typical", fmt(s.median)) + stat("Listings", fmt(s.listings)) +
      (v.change != null ? `<div><div class="stat-label">Since yesterday</div><div class="stat-value">${chip(v.change)}</div></div>` : "")
    : '<p class="empty-note">No real listings recorded yet.</p>';
}

async function openDetail(fav) {
  detailItem = fav;
  $("detail-title").textContent = fav.itemName;
  $("detail-rule-label").textContent = `${RULE_LABEL[fav.rule]} · Perfect Pitch`;
  $("detail-rule").value = fav.rule;
  $("detail-listings").innerHTML = '<p class="empty-note">Loading listings&hellip;</p>';
  renderDetailStats(fav);
  const dlg = $("detail");
  if (!dlg.open) {
    dlg.showModal();
    if (hasGsap() && motionOK()) gsap.fromTo(".detail-inner", { opacity: 0, y: 18, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: "power3.out" });
  }
  renderDetailChart();
  try {
    const rows = await api(`/api/listings?itemId=${fav.itemId}&rule=${fav.rule}&q=${encodeURIComponent(fav.itemName)}`);
    if (detailItem !== fav) return;
    $("detail-listings").innerHTML = listingsTable(rows, fav.rule);
  } catch (e) {
    if (detailItem === fav) $("detail-listings").innerHTML = `<p class="empty-note">Couldn't load listings: ${esc(e.message)}</p>`;
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

async function refresh() {
  try {
    state = await api("/api/state");
  } catch (e) {
    toast(`Couldn't load data: ${e.message}`);
  }
  render();
}

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("search-input").value.trim();
  if (q) runSearch(q);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement.tagName !== "INPUT" && !$("detail").open) {
    e.preventDefault();
    $("search-input").focus();
  }
});

$("detail-close").addEventListener("click", () => $("detail").close());
$("detail").addEventListener("close", () => {
  detailItem = null;
  if (detailChart) { detailChart.destroy(); detailChart = null; }
});
$("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").close(); });

document.querySelectorAll(".segmented button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".segmented button").forEach((b) => b.classList.toggle("active", b === btn));
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

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => closeGridGaps($("grid")), 120);
});

refresh();
