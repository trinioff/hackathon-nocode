const API = "/api";
const els = {};

const state = {
  products: [],
  history: [],
  stats: null,
  view: "dashboard",
  productFilter: "",
  historyFilter: "",
  search: "",
};

/* ============== API ============== */

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
      api("/history?limit=500"),
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

/* ============== HELPERS ============== */

function fmt(n) { return new Intl.NumberFormat("fr-FR").format(n); }

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

function productState(qty) {
  if (qty === 0) return "empty";
  if (qty <= 5) return "low";
  return "ok";
}

/* ============== VIEW SWITCHER ============== */

const VIEW_META = {
  dashboard: { title: "Tableau de bord", sub: "Vue d'ensemble" },
  products:  { title: "Catalogue",       sub: "Gestion des produits" },
  activity:  { title: "Activité",        sub: "Historique des mouvements" },
};

function setView(name, opts = {}) {
  if (!VIEW_META[name]) name = "dashboard";
  state.view = name;

  document.querySelectorAll(".view").forEach((v) => {
    v.hidden = v.id !== `view-${name}`;
  });

  document.querySelectorAll(".nav-item").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === name && !a.dataset.filter);
  });

  els.pageTitle.textContent = VIEW_META[name].title;
  const todayStr = els.todayDate.textContent;
  els.pageSub.innerHTML = `${VIEW_META[name].sub} · <span id="today-date">${todayStr}</span>`;
  els.todayDate = document.getElementById("today-date");

  if (opts.filter) {
    state.productFilter = opts.filter;
    renderProductsView();
  }
}

/* ============== KPIS ============== */

function renderKpis() {
  const s = state.stats;
  if (!s) return;
  els.kpiProducts.textContent = fmt(s.totals.products);
  els.kpiUnits.textContent = fmt(s.totals.units);
  els.kpiLow.textContent = fmt(s.lowStock);
  els.kpiEmpty.textContent = fmt(s.outOfStock);
  els.kpiToday.textContent = fmt(s.movementsToday);

  els.navCountProducts.textContent = fmt(s.totals.products);
  els.navCountLow.textContent = fmt(s.lowStock);

  const alertSection = document.querySelector(".nav-item.nav-alert");
  if (alertSection) alertSection.style.display = s.lowStock > 0 ? "flex" : "none";
}

/* ============== FLOW ============== */

function renderFlow() {
  const host = els.chartFlow;
  const s = state.stats;
  if (!s || !host) return;

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

  const W = 760, H = 240;
  const padL = 36, padR = 12, padT = 12, padB = 28;
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
        </g>`;
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
        `<line class="flow-axis" x1="${padL}" x2="${W - padR}" y1="${t.y}" y2="${t.y}"
           stroke-dasharray="${t.v === 0 ? "0" : "2 4"}"
           opacity="${t.v === 0 ? 0.8 : 0.3}" />
         <text class="flow-label" x="${padL - 6}" y="${t.y + 3}" text-anchor="end">${t.v}</text>`
    )
    .join("");

  host.innerHTML = `<svg class="flow-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${gridLines}${bars}${xLabels}
    </svg>`;
}

/* ============== DONUT ============== */

function renderDonut() {
  const host = els.chartDonut;
  const s = state.stats;
  if (!s || !host) return;

  const b = s.buckets || {};
  const segments = [
    { label: "Saine (> 20)",   value: b.healthy  || 0, color: "var(--in)" },
    { label: "Basse (6–20)",   value: b.low      || 0, color: "var(--accent)" },
    { label: "Critique (≤ 5)", value: b.critical || 0, color: "var(--warn)" },
    { label: "Rupture",        value: b.empty    || 0, color: "var(--out)" },
  ];

  const total = segments.reduce((acc, x) => acc + x.value, 0) || 1;
  const r = 58;
  const C = 2 * Math.PI * r;
  const stroke = 14;
  let offset = 0;

  const circles = segments
    .map((seg) => {
      if (seg.value === 0) return "";
      const len = (seg.value / total) * C;
      const dash = `${len - 2} ${C - len + 2}`;
      const el = `<circle cx="75" cy="75" r="${r}" fill="none" stroke="${seg.color}"
                   stroke-width="${stroke}" stroke-dasharray="${dash}"
                   stroke-dashoffset="${-offset}" />`;
      offset += len;
      return el;
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
      </li>`
    )
    .join("");

  host.innerHTML = `<div class="donut-wrap">
    <div class="donut-center">
      <svg class="donut-svg" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}" />
        ${circles}
      </svg>
      <div class="donut-total">
        <strong>${s.totals.products}</strong>
        <span>produits</span>
      </div>
    </div>
    <ul class="donut-legend">${legend}</ul>
  </div>`;
}

/* ============== TOP ============== */

function renderTop() {
  const host = els.chartTop;
  const s = state.stats;
  if (!s || !host) return;
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
        </li>`;
    })
    .join("");
  host.innerHTML = `<ul class="top-list">${rows}</ul>`;
}

/* ============== PRODUCTS TABLE ============== */

function stateTag(qty) {
  if (qty === 0) return `<span class="state-tag state-empty"><i></i>Rupture</span>`;
  if (qty <= 5) return `<span class="state-tag state-low"><i></i>Critique</span>`;
  if (qty <= 20) return `<span class="state-tag state-low"><i></i>Bas</span>`;
  return `<span class="state-tag state-ok"><i></i>Saine</span>`;
}

function filteredProducts() {
  const q = state.search.trim().toLowerCase();
  let list = state.products;
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
  if (state.productFilter === "low") list = list.filter((p) => p.qty > 0 && p.qty <= 5);
  else if (state.productFilter === "empty") list = list.filter((p) => p.qty === 0);
  return list;
}

function renderProductsView() {
  const list = filteredProducts();
  const body = els.productsBody;
  const empty = els.emptyMsg;
  body.innerHTML = "";

  els.tableMeta.textContent = `${list.length} produit${list.length > 1 ? "s" : ""}`;
  els.fAll.textContent = state.products.length;
  els.fLow.textContent = state.products.filter((p) => p.qty > 0 && p.qty <= 5).length;
  els.fEmpty.textContent = state.products.filter((p) => p.qty === 0).length;

  document.querySelectorAll("[data-filter]").forEach((b) => {
    if (b.classList.contains("chip")) {
      b.classList.toggle("active", (b.dataset.filter || "") === state.productFilter);
    }
  });

  if (list.length === 0) {
    empty.style.display = "block";
    empty.textContent = state.search
      ? `Aucun résultat pour "${state.search}".`
      : state.productFilter
      ? "Aucun produit dans cette catégorie."
      : "Aucun produit. Ajoute ton premier produit pour démarrer.";
    return;
  }
  empty.style.display = "none";

  const frag = document.createDocumentFragment();
  for (const p of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="product-name">${escapeHtml(p.name)}</span></td>
      <td><span class="qty-cell">${fmt(p.qty)}</span></td>
      <td>${stateTag(p.qty)}</td>
      <td class="ta-right">
        <div class="actions">
          <button class="row-btn in-btn" data-id="${p.id}" data-action="in">Entrée</button>
          <button class="row-btn out-btn" data-id="${p.id}" data-action="out">Sortie</button>
          <button class="row-btn del-btn" data-id="${p.id}" data-action="del">✕</button>
        </div>
      </td>`;
    frag.appendChild(tr);
  }
  body.appendChild(frag);
}

/* ============== HISTORY ============== */

function renderHistoryItem(h) {
  const d = parseSqliteDate(h.created_at);
  const rel = relativeTime(d);
  const name = escapeHtml(h.product_name);
  let iconClass = "hi-create", iconTxt = "✦", sub = "";
  if (h.type === "in")         { iconClass = "hi-in";     iconTxt = "+"; sub = `+${h.amount} en stock`; }
  else if (h.type === "out")   { iconClass = "hi-out";    iconTxt = "−"; sub = `−${h.amount} du stock`; }
  else if (h.type === "create"){ iconClass = "hi-create"; iconTxt = "✦"; sub = `Créé (qté initiale ${h.amount})`; }
  else if (h.type === "delete"){ iconClass = "hi-delete"; iconTxt = "✕"; sub = `Supprimé`; }
  return `<li>
    <span class="hist-icon ${iconClass}">${iconTxt}</span>
    <span class="hist-body"><strong>${name}</strong><span>${sub}</span></span>
    <span class="hist-time" title="${d.toLocaleString("fr-FR")}">${rel}</span>
  </li>`;
}

function renderRecent() {
  const list = els.recentActivity;
  if (!list) return;
  const slice = state.history.slice(0, 10);
  list.innerHTML = slice.map(renderHistoryItem).join("") ||
    `<p class="empty">Aucun mouvement.</p>`;
}

function renderHistoryView() {
  const list = els.historyList;
  const empty = els.emptyHistory;
  const filter = state.historyFilter;
  const items = filter ? state.history.filter((h) => h.type === filter) : state.history;

  els.activityMeta.textContent = `${items.length} mouvement${items.length > 1 ? "s" : ""}`;

  document.querySelectorAll("[data-hfilter]").forEach((b) => {
    b.classList.toggle("active", (b.dataset.hfilter || "") === filter);
  });

  if (items.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  list.innerHTML = items.map(renderHistoryItem).join("");
}

/* ============== RENDER ============== */

function render() {
  renderKpis();
  renderFlow();
  renderDonut();
  renderTop();
  renderProductsView();
  renderHistoryView();
  renderRecent();
}

/* ============== ACTIONS ============== */

async function addProduct(name, qty) {
  await api("/products", { method: "POST", body: JSON.stringify({ name, qty }) });
  await refresh();
}

async function changeStock(id, delta) {
  await api(`/products/${id}/stock`, { method: "POST", body: JSON.stringify({ delta }) });
  await refresh();
}

async function deleteProduct(id, name) {
  if (!confirm(`Supprimer "${name}" ? Cette action est irréversible.`)) return;
  try {
    await api(`/products/${id}`, { method: "DELETE" });
    await refresh();
  } catch (err) { showError(err.message); }
}

/* ============== MODALS ============== */

function openModal(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}
function closeModal(dialog) {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
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
    i.focus(); i.select();
  }, 50);
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
    } catch (err) { showError(err.message); }
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
    } catch (err) { showError(err.message); }
  });
}

/* ============== NAV + FILTERS ============== */

function wireNav() {
  document.querySelectorAll(".nav-item").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const view = a.dataset.view;
      const filter = a.dataset.filter || "";
      if (view === "products") state.productFilter = filter;
      setView(view);
    });
  });

  document.querySelectorAll("[data-view]").forEach((a) => {
    if (a.tagName === "A" && !a.classList.contains("nav-item")) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        setView(a.dataset.view);
      });
    }
  });

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

  document.querySelectorAll(".chip[data-filter]").forEach((c) => {
    c.addEventListener("click", () => {
      state.productFilter = c.dataset.filter || "";
      renderProductsView();
    });
  });

  document.querySelectorAll(".chip[data-hfilter]").forEach((c) => {
    c.addEventListener("click", () => {
      state.historyFilter = c.dataset.hfilter || "";
      renderHistoryView();
    });
  });

  els.search.addEventListener("input", (e) => {
    state.search = e.target.value;
    if (state.view !== "products") setView("products");
    renderProductsView();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      els.search.focus();
    }
  });

  els.btnRefresh.addEventListener("click", () => {
    els.btnRefresh.querySelector("svg").style.transition = "transform 0.5s";
    els.btnRefresh.querySelector("svg").style.transform = "rotate(360deg)";
    setTimeout(() => {
      els.btnRefresh.querySelector("svg").style.transform = "";
    }, 500);
    refresh();
  });
}

/* ============== INIT ============== */

function initTodayLabel() {
  const d = new Date();
  const str = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  els.todayDate.textContent = str;
}

function bindEls() {
  els.error = document.getElementById("error-banner");
  els.pageTitle = document.getElementById("page-title");
  els.pageSub = document.getElementById("page-sub");
  els.todayDate = document.getElementById("today-date");

  els.kpiProducts = document.getElementById("kpi-products");
  els.kpiUnits = document.getElementById("kpi-units");
  els.kpiLow = document.getElementById("kpi-low");
  els.kpiEmpty = document.getElementById("kpi-empty");
  els.kpiToday = document.getElementById("kpi-today");

  els.navCountProducts = document.getElementById("nav-count-products");
  els.navCountLow = document.getElementById("nav-count-low");

  els.chartFlow = document.getElementById("chart-flow");
  els.chartDonut = document.getElementById("chart-donut");
  els.chartTop = document.getElementById("chart-top");

  els.productsBody = document.getElementById("products-body");
  els.emptyMsg = document.getElementById("empty-msg");
  els.historyList = document.getElementById("history-list");
  els.emptyHistory = document.getElementById("empty-history");
  els.recentActivity = document.getElementById("recent-activity");

  els.tableMeta = document.getElementById("table-meta");
  els.activityMeta = document.getElementById("activity-meta");
  els.fAll = document.getElementById("f-all");
  els.fLow = document.getElementById("f-low");
  els.fEmpty = document.getElementById("f-empty");

  els.search = document.getElementById("search");
  els.btnOpenAdd = document.getElementById("btn-open-add");
  els.btnRefresh = document.getElementById("btn-refresh");
  els.modalAdd = document.getElementById("modal-add");
  els.modalStock = document.getElementById("modal-stock");
  els.addForm = document.getElementById("add-product-form");
  els.stockForm = document.getElementById("stock-form");
}

document.addEventListener("DOMContentLoaded", () => {
  bindEls();
  initTodayLabel();
  wireModals();
  wireNav();
  refresh();
  setInterval(refresh, 30000);
});
