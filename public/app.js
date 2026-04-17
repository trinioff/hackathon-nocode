const API = "/api";

const els = {};

const state = {
  products: [],
  history: [],
  stats: null,
  filter: "",
};

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erreur inconnue");
  return data;
}

function showError(msg) {
  const el = els.error;
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { el.style.display = "none"; }, 4000);
}

async function refresh() {
  try {
    const [products, history, stats] = await Promise.all([
      api("/products"),
      api("/history?limit=50"),
      api("/stats"),
    ]);
    state.products = products;
    state.history = history;
    state.stats = stats;
    render();
  } catch (err) {
    showError(err.message);
  }
}

function fmt(n) {
  return new Intl.NumberFormat("fr-FR").format(n);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function parseSqliteDate(s) {
  return new Date(s.replace(" ", "T") + "Z");
}

function relativeTime(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `il y a ${Math.floor(diff / 86400)} j`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/* ---------- KPIs ---------- */

function renderKpis() {
  const s = state.stats;
  if (!s) return;
  els.kpiProducts.textContent = fmt(s.totals.products);
  els.kpiUnits.textContent = fmt(s.totals.units);
  els.kpiLow.textContent = fmt(s.lowStock);
  els.kpiEmpty.textContent = fmt(s.outOfStock);
  els.kpiToday.textContent = fmt(s.movementsToday);
}

/* ---------- Flow chart ---------- */

function renderFlow() {
  const host = els.chartFlow;
  const s = state.stats;
  if (!s) return;

  const days = [];
  const map = new Map(s.byDay.map((d) => [d.day, d]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key);
    days.push({
      date: d,
      inflow: row ? row.inflow || 0 : 0,
      outflow: row ? row.outflow || 0 : 0,
    });
  }

  const max = Math.max(1, ...days.map((d) => Math.max(d.inflow, d.outflow)));

  const W = 760;
  const H = 220;
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const slot = innerW / days.length;
  const barW = Math.max(2, slot / 2.6);
  const gap = 1;

  const yTicks = 4;
  const ticks = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = Math.round((max / yTicks) * i);
    const y = padT + innerH - (v / max) * innerH;
    ticks.push({ v, y });
  }

  const bars = days
    .map((d, i) => {
      const x = padL + i * slot + slot / 2 - barW - gap / 2;
      const hIn = (d.inflow / max) * innerH;
      const hOut = (d.outflow / max) * innerH;
      const yIn = padT + innerH - hIn;
      const yOut = padT + innerH - hOut;
      return `
        <g>
          <rect class="flow-bar-in" x="${x}" y="${yIn}" width="${barW}" height="${hIn}" rx="1.5">
            <title>${d.date.toLocaleDateString("fr-FR")} · +${d.inflow}</title>
          </rect>
          <rect class="flow-bar-out" x="${x + barW + gap}" y="${yOut}" width="${barW}" height="${hOut}" rx="1.5">
            <title>${d.date.toLocaleDateString("fr-FR")} · −${d.outflow}</title>
          </rect>
        </g>
      `;
    })
    .join("");

  const xLabels = days
    .map((d, i) => {
      if (i % 5 !== 0 && i !== days.length - 1) return "";
      const x = padL + i * slot + slot / 2;
      const label = d.date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
      return `<text class="flow-label" x="${x}" y="${H - 8}" text-anchor="middle">${label}</text>`;
    })
    .join("");

  const gridLines = ticks
    .map(
      (t) =>
        `<line class="flow-axis" x1="${padL}" x2="${W - padR}" y1="${t.y}" y2="${t.y}" stroke-dasharray="${
          t.v === 0 ? "0" : "2 4"
        }" opacity="${t.v === 0 ? 0.8 : 0.35}" />
         <text class="flow-label" x="${padL - 6}" y="${t.y + 3}" text-anchor="end">${t.v}</text>`
    )
    .join("");

  host.innerHTML = `
    <svg class="flow-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${gridLines}
      ${bars}
      ${xLabels}
    </svg>
  `;
}

/* ---------- Donut ---------- */

function renderDonut() {
  const host = els.chartDonut;
  const s = state.stats;
  if (!s) return;

  const b = s.buckets || {};
  const segments = [
    { key: "healthy", label: "Saine (> 20)", value: b.healthy || 0, color: "var(--in)" },
    { key: "low", label: "Basse (6–20)", value: b.low || 0, color: "var(--accent)" },
    { key: "critical", label: "Critique (≤ 5)", value: b.critical || 0, color: "var(--warn)" },
    { key: "empty", label: "Rupture", value: b.empty || 0, color: "var(--out)" },
  ];

  const total = segments.reduce((acc, s2) => acc + s2.value, 0) || 1;
  const r = 62;
  const C = 2 * Math.PI * r;
  const stroke = 16;
  let offset = 0;

  const circles = segments
    .map((seg) => {
      if (seg.value === 0) return "";
      const len = (seg.value / total) * C;
      const dash = `${len - 2} ${C - len + 2}`;
      const circle = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${stroke}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" stroke-linecap="butt" />`;
      offset += len;
      return circle;
    })
    .join("");

  const legend = segments
    .map(
      (seg) => `
      <li>
        <span class="lg-label">
          <span class="lg-dot" style="background:${seg.color}"></span>
          ${seg.label}
        </span>
        <span class="lg-n">${seg.value}</span>
      </li>
    `
    )
    .join("");

  host.innerHTML = `
    <div class="donut-wrap">
      <div class="donut-center">
        <svg class="donut-svg" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}" />
          ${circles}
        </svg>
        <div class="donut-total">
          <strong>${s.totals.products}</strong>
          <span>produits</span>
        </div>
      </div>
      <ul class="donut-legend">${legend}</ul>
    </div>
  `;
}

/* ---------- Top products ---------- */

function renderTop() {
  const host = els.chartTop;
  const s = state.stats;
  if (!s) return;
  const top = s.topProducts || [];
  if (top.length === 0) {
    host.innerHTML = `<p class="empty" style="margin:auto">Aucune donnée.</p>`;
    return;
  }
  const max = Math.max(...top.map((p) => p.qty), 1);
  const rows = top
    .map((p) => {
      const pct = (p.qty / max) * 100;
      return `
        <li class="top-row">
          <span class="top-name">${escapeHtml(p.name)}</span>
          <span class="top-qty">${fmt(p.qty)}</span>
          <span class="top-bar"><span class="top-bar-fill" style="width:${pct}%"></span></span>
        </li>
      `;
    })
    .join("");
  host.innerHTML = `<ul class="top-list">${rows}</ul>`;
}

/* ---------- Products table ---------- */

function stateTag(qty) {
  if (qty === 0) return `<span class="state-tag state-empty"><i></i>Rupture</span>`;
  if (qty <= 5) return `<span class="state-tag state-low"><i></i>Critique</span>`;
  if (qty <= 20) return `<span class="state-tag state-low"><i></i>Bas</span>`;
  return `<span class="state-tag state-ok"><i></i>Saine</span>`;
}

function renderProducts() {
  const body = els.productsBody;
  const empty = els.emptyMsg;
  body.innerHTML = "";

  const filter = state.filter.trim().toLowerCase();
  const filtered = filter
    ? state.products.filter((p) => p.name.toLowerCase().includes(filter))
    : state.products;

  if (filtered.length === 0) {
    empty.style.display = "block";
    empty.textContent = filter
      ? `Aucun résultat pour "${state.filter}".`
      : "Aucun produit. Ajoute ton premier produit pour démarrer.";
    return;
  }
  empty.style.display = "none";

  for (const p of filtered) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="product-name">${escapeHtml(p.name)}</span></td>
      <td><span class="qty-cell">${fmt(p.qty)}</span></td>
      <td>${stateTag(p.qty)}</td>
      <td class="ta-right">
        <div class="actions">
          <button class="row-btn in-btn" data-id="${p.id}" data-action="in">+ Entrée</button>
          <button class="row-btn out-btn" data-id="${p.id}" data-action="out">− Sortie</button>
          <button class="row-btn del-btn" data-id="${p.id}" data-action="del">Supprimer</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  }
}

/* ---------- History ---------- */

function renderHistory() {
  const list = els.historyList;
  const empty = els.emptyHistory;
  list.innerHTML = "";

  if (state.history.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  for (const h of state.history) {
    const li = document.createElement("li");
    const d = parseSqliteDate(h.created_at);
    const rel = relativeTime(d);
    const name = escapeHtml(h.product_name);
    let iconClass = "hi-create";
    let iconTxt = "★";
    let title = "";
    let sub = "";
    if (h.type === "in") {
      iconClass = "hi-in"; iconTxt = "+";
      title = `<strong>${name}</strong>`;
      sub = `+${h.amount} en stock`;
    } else if (h.type === "out") {
      iconClass = "hi-out"; iconTxt = "−";
      title = `<strong>${name}</strong>`;
      sub = `−${h.amount} du stock`;
    } else if (h.type === "create") {
      iconClass = "hi-create"; iconTxt = "✦";
      title = `<strong>${name}</strong>`;
      sub = `Produit créé (qté initiale ${h.amount})`;
    } else if (h.type === "delete") {
      iconClass = "hi-delete"; iconTxt = "✕";
      title = `<strong>${name}</strong>`;
      sub = `Produit supprimé`;
    }
    li.innerHTML = `
      <span class="hist-icon ${iconClass}">${iconTxt}</span>
      <span class="hist-body">${title}<span>${sub}</span></span>
      <span class="hist-time" title="${d.toLocaleString("fr-FR")}">${rel}</span>
    `;
    list.appendChild(li);
  }
}

function render() {
  renderKpis();
  renderFlow();
  renderDonut();
  renderTop();
  renderProducts();
  renderHistory();
}

/* ---------- Actions ---------- */

async function addProduct(name, qty) {
  try {
    await api("/products", {
      method: "POST",
      body: JSON.stringify({ name, qty }),
    });
    await refresh();
  } catch (err) {
    showError(err.message);
    throw err;
  }
}

async function changeStock(id, delta) {
  try {
    await api(`/products/${id}/stock`, {
      method: "POST",
      body: JSON.stringify({ delta }),
    });
    await refresh();
  } catch (err) {
    showError(err.message);
    throw err;
  }
}

async function deleteProduct(id, name) {
  if (!confirm(`Supprimer "${name}" ? Cette action est irréversible.`)) return;
  try {
    await api(`/products/${id}`, { method: "DELETE" });
    await refresh();
  } catch (err) {
    showError(err.message);
  }
}

/* ---------- Modals ---------- */

function openModal(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}
function closeModal(dialog) {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function wireModals() {
  document.querySelectorAll("[data-close]").forEach((b) => {
    b.addEventListener("click", () => {
      const m = b.closest("dialog");
      if (m) closeModal(m);
    });
  });

  els.btnOpenAdd.addEventListener("click", () => {
    els.addForm.reset();
    document.getElementById("product-qty").value = 0;
    openModal(els.modalAdd);
    setTimeout(() => document.getElementById("product-name").focus(), 50);
  });

  els.addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("product-name").value.trim();
    const qty = parseInt(document.getElementById("product-qty").value, 10);
    if (!name || isNaN(qty) || qty < 0) return;
    try {
      await addProduct(name, qty);
      closeModal(els.modalAdd);
    } catch {}
  });

  els.stockForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = parseInt(els.stockForm.dataset.productId, 10);
    const dir = els.stockForm.dataset.dir;
    const amount = parseInt(document.getElementById("stock-amount").value, 10);
    if (isNaN(id) || isNaN(amount) || amount <= 0) return;
    try {
      await changeStock(id, dir === "in" ? amount : -amount);
      closeModal(els.modalStock);
    } catch {}
  });
}

function openStockModal(product, dir) {
  els.stockForm.dataset.productId = product.id;
  els.stockForm.dataset.dir = dir;
  document.getElementById("stock-title").textContent =
    dir === "in" ? "Ajouter au stock" : "Retirer du stock";
  document.getElementById("stock-sub").textContent =
    `${product.name} · stock actuel ${product.qty}`;
  document.getElementById("stock-confirm").textContent =
    dir === "in" ? "Ajouter" : "Retirer";
  document.getElementById("stock-amount").value = 1;
  openModal(els.modalStock);
  setTimeout(() => {
    const i = document.getElementById("stock-amount");
    i.focus();
    i.select();
  }, 50);
}

/* ---------- Wire ---------- */

function wireTable() {
  els.productsBody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    if (btn.dataset.action === "in") openStockModal(product, "in");
    else if (btn.dataset.action === "out") openStockModal(product, "out");
    else if (btn.dataset.action === "del") deleteProduct(id, product.name);
  });

  els.search.addEventListener("input", (e) => {
    state.filter = e.target.value;
    renderProducts();
  });
}

function initTodayLabel() {
  const d = new Date();
  els.todayDate.textContent = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function bindEls() {
  els.error = document.getElementById("error-banner");
  els.kpiProducts = document.getElementById("kpi-products");
  els.kpiUnits = document.getElementById("kpi-units");
  els.kpiLow = document.getElementById("kpi-low");
  els.kpiEmpty = document.getElementById("kpi-empty");
  els.kpiToday = document.getElementById("kpi-today");
  els.chartFlow = document.getElementById("chart-flow");
  els.chartDonut = document.getElementById("chart-donut");
  els.chartTop = document.getElementById("chart-top");
  els.productsBody = document.getElementById("products-body");
  els.emptyMsg = document.getElementById("empty-msg");
  els.historyList = document.getElementById("history-list");
  els.emptyHistory = document.getElementById("empty-history");
  els.search = document.getElementById("search");
  els.todayDate = document.getElementById("today-date");
  els.btnOpenAdd = document.getElementById("btn-open-add");
  els.modalAdd = document.getElementById("modal-add");
  els.modalStock = document.getElementById("modal-stock");
  els.addForm = document.getElementById("add-product-form");
  els.stockForm = document.getElementById("stock-form");
}

document.addEventListener("DOMContentLoaded", () => {
  bindEls();
  initTodayLabel();
  wireModals();
  wireTable();
  refresh();
  setInterval(refresh, 30000);
});
