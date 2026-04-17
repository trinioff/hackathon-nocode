const API = "/api";
const TOKEN_KEY = "ledger-token";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  currentUser: null,
  products: [],
  history: [],
  stats: null,
  users: [],
  view: "dashboard",
  productFilter: "",
  historyFilter: "",
  search: "",
};

/* ============== API ============== */

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(API + path, { ...options, headers });

  if (res.status === 401) {
    logout(false);
    throw new Error("Session expirée. Reconnectez-vous.");
  }
  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function showError(msg) {
  const el = $("#error-banner");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(showError._t);
  showError._t = setTimeout(() => (el.style.display = "none"), 4000);
}

/* ============== HELPERS ============== */

const fmt = (n) => new Intl.NumberFormat("fr-FR").format(n);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const parseDate = (s) => new Date(s.replace(" ", "T") + "Z");

function relativeTime(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `il y a ${Math.floor(diff / 86400)} j`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

const ROLE_META = {
  admin:  { label: "Administrateur", short: "Admin" },
  editor: { label: "Éditeur",        short: "Éditeur" },
  viewer: { label: "Lecteur",        short: "Lecteur" },
};

function can(action) {
  const role = state.currentUser?.role;
  if (!role) return false;
  if (action === "write") return role === "admin" || role === "editor";
  if (action === "manageUsers") return role === "admin";
  return true;
}

/* ============== AUTH ============== */

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Identifiants invalides.");
  state.token = data.token;
  state.currentUser = data.user;
  localStorage.setItem(TOKEN_KEY, data.token);
}

async function logout(callApi = true) {
  if (callApi && state.token) {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
  }
  state.token = null;
  state.currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
}

async function restoreSession() {
  if (!state.token) return false;
  try {
    state.currentUser = await api("/auth/me");
    return true;
  } catch {
    return false;
  }
}

/* ============== VIEW SWITCHER ============== */

const VIEW_META = {
  dashboard: { title: "Tableau de bord", sub: "Vue d'ensemble" },
  products:  { title: "Catalogue",       sub: "Gestion des produits" },
  activity:  { title: "Activité",        sub: "Historique des mouvements" },
  users:     { title: "Utilisateurs",    sub: "Comptes et rôles" },
};

function setView(name) {
  if (!VIEW_META[name]) name = "dashboard";
  if (name === "users" && !can("manageUsers")) name = "dashboard";
  state.view = name;

  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  $$(".nav-item").forEach((a) =>
    a.classList.toggle("active", a.dataset.view === name && !a.dataset.filter)
  );

  $("#page-title").textContent = VIEW_META[name].title;
  const dateStr = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  $("#page-sub").innerHTML = `${VIEW_META[name].sub} · ${dateStr}`;

  if (name === "users") renderUsersView();
}

/* ============== ROLE GATING UI ============== */

function applyRoleVisibility() {
  const role = state.currentUser?.role;
  $$("[data-requires-role]").forEach((el) => {
    const allowed = el.dataset.requiresRole.split(",").map((s) => s.trim());
    el.toggleAttribute("hidden-by-role", !allowed.includes(role));
  });
}

/* ============== DATA ============== */

async function refreshCore() {
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

async function refreshUsers() {
  if (!can("manageUsers")) return;
  try {
    state.users = await api("/users");
    $("#nav-count-users").textContent = fmt(state.users.length);
    if (state.view === "users") renderUsersView();
  } catch (err) {
    showError(err.message);
  }
}

/* ============== KPIS ============== */

function renderKpis() {
  const s = state.stats;
  if (!s) return;
  $("#kpi-products").textContent = fmt(s.totals.products);
  $("#kpi-units").textContent = fmt(s.totals.units);
  $("#kpi-low").textContent = fmt(s.lowStock);
  $("#kpi-empty").textContent = fmt(s.outOfStock);
  $("#kpi-today").textContent = fmt(s.movementsToday);
  $("#nav-count-products").textContent = fmt(s.totals.products);
  $("#nav-count-low").textContent = fmt(s.lowStock);

  const alert = $(".nav-item.nav-alert");
  if (alert) alert.style.display = s.lowStock > 0 ? "flex" : "none";
}

/* ============== CHARTS ============== */

function renderFlow() {
  const s = state.stats;
  if (!s) return;
  const host = $("#chart-flow");

  const map = new Map(s.byDay.map((d) => [d.day, d]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const row = map.get(d.toISOString().slice(0, 10));
    days.push({
      date: d,
      inflow: row?.inflow || 0,
      outflow: row?.outflow || 0,
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
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = Math.round((max / yTicks) * i);
    return { v, y: padT + innerH - (v / max) * innerH };
  });

  const gridLines = ticks
    .map(
      (t) => `
      <line class="flow-axis" x1="${padL}" x2="${W - padR}" y1="${t.y}" y2="${t.y}"
            stroke-dasharray="${t.v === 0 ? "0" : "2 4"}" opacity="${t.v === 0 ? 0.8 : 0.3}" />
      <text class="flow-label" x="${padL - 6}" y="${t.y + 3}" text-anchor="end">${t.v}</text>`
    )
    .join("");

  const bars = days
    .map((d, i) => {
      const x = padL + i * slot + slot / 2 - barW - gap / 2;
      const hIn = (d.inflow / max) * innerH;
      const hOut = (d.outflow / max) * innerH;
      return `
        <rect class="flow-bar-in"  x="${x}" y="${padT + innerH - hIn}"
              width="${barW}" height="${hIn}" rx="1.5">
          <title>${d.date.toLocaleDateString("fr-FR")} · +${d.inflow}</title>
        </rect>
        <rect class="flow-bar-out" x="${x + barW + gap}" y="${padT + innerH - hOut}"
              width="${barW}" height="${hOut}" rx="1.5">
          <title>${d.date.toLocaleDateString("fr-FR")} · −${d.outflow}</title>
        </rect>`;
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

  host.innerHTML = `<svg class="flow-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${gridLines}${bars}${xLabels}</svg>`;
}

function renderDonut() {
  const s = state.stats;
  if (!s) return;
  const b = s.buckets || {};
  const segments = [
    { label: "Saine (> 20)",   value: b.healthy  || 0, color: "var(--in)" },
    { label: "Basse (6–20)",   value: b.low      || 0, color: "var(--accent)" },
    { label: "Critique (≤ 5)", value: b.critical || 0, color: "var(--warn)" },
    { label: "Rupture",        value: b.empty    || 0, color: "var(--out)" },
  ];

  const total = segments.reduce((a, x) => a + x.value, 0) || 1;
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
          <span class="lg-dot" style="background:${seg.color}"></span>${seg.label}
        </span>
        <span class="lg-n">${seg.value}</span>
      </li>`
    )
    .join("");

  $("#chart-donut").innerHTML = `
    <div class="donut-wrap">
      <div class="donut-center">
        <svg class="donut-svg" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r="${r}" fill="none"
                  stroke="var(--surface-2)" stroke-width="${stroke}" />
          ${circles}
        </svg>
        <div class="donut-total">
          <strong>${s.totals.products}</strong><span>produits</span>
        </div>
      </div>
      <ul class="donut-legend">${legend}</ul>
    </div>`;
}

function renderTop() {
  const s = state.stats;
  if (!s) return;
  const top = s.topProducts || [];
  const host = $("#chart-top");
  if (top.length === 0) {
    host.innerHTML = `<p class="empty" style="margin:auto">Aucune donnée.</p>`;
    return;
  }
  const max = Math.max(...top.map((p) => p.qty), 1);
  host.innerHTML = `<ul class="top-list">${top
    .map(
      (p) => `
      <li class="top-row">
        <span class="top-name">${escapeHtml(p.name)}</span>
        <span class="top-qty">${fmt(p.qty)}</span>
        <span class="top-bar">
          <span class="top-bar-fill" style="width:${(p.qty / max) * 100}%"></span>
        </span>
      </li>`
    )
    .join("")}</ul>`;
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
  if (state.productFilter === "empty") list = list.filter((p) => p.qty === 0);
  return list;
}

function renderProductsView() {
  const list = filteredProducts();
  const writable = can("write");

  $("#table-meta").textContent = `${list.length} produit${list.length > 1 ? "s" : ""}`;
  $("#f-all").textContent = state.products.length;
  $("#f-low").textContent = state.products.filter((p) => p.qty > 0 && p.qty <= 5).length;
  $("#f-empty").textContent = state.products.filter((p) => p.qty === 0).length;

  $$(".chip[data-filter]").forEach((b) =>
    b.classList.toggle("active", (b.dataset.filter || "") === state.productFilter)
  );

  const body = $("#products-body");
  const empty = $("#empty-msg");
  body.innerHTML = "";

  if (list.length === 0) {
    empty.style.display = "block";
    empty.textContent = state.search
      ? `Aucun résultat pour "${state.search}".`
      : state.productFilter
      ? "Aucun produit dans cette catégorie."
      : "Aucun produit.";
    return;
  }
  empty.style.display = "none";

  const actions = writable
    ? (id) => `
      <div class="actions">
        <button class="row-btn in-btn"  data-id="${id}" data-action="in">Entrée</button>
        <button class="row-btn out-btn" data-id="${id}" data-action="out">Sortie</button>
        <button class="row-btn del-btn" data-id="${id}" data-action="del">✕</button>
      </div>`
    : () => `<span class="caption">Lecture seule</span>`;

  body.innerHTML = list
    .map(
      (p) => `
      <tr>
        <td><span class="product-name">${escapeHtml(p.name)}</span></td>
        <td><span class="qty-cell">${fmt(p.qty)}</span></td>
        <td>${stateTag(p.qty)}</td>
        <td class="ta-right">${actions(p.id)}</td>
      </tr>`
    )
    .join("");
}

/* ============== HISTORY ============== */

function renderHistoryItem(h) {
  const d = parseDate(h.created_at);
  const rel = relativeTime(d);
  const name = escapeHtml(h.product_name);
  const map = {
    in:     { cls: "hi-in",     t: "+", sub: `+${h.amount} en stock` },
    out:    { cls: "hi-out",    t: "−", sub: `−${h.amount} du stock` },
    create: { cls: "hi-create", t: "✦", sub: `Créé (qté initiale ${h.amount})` },
    delete: { cls: "hi-delete", t: "✕", sub: "Supprimé" },
  };
  const m = map[h.type] || map.create;
  return `
    <li>
      <span class="hist-icon ${m.cls}">${m.t}</span>
      <span class="hist-body"><strong>${name}</strong><span>${m.sub}</span></span>
      <span class="hist-time" title="${d.toLocaleString("fr-FR")}">${rel}</span>
    </li>`;
}

function renderRecent() {
  const list = $("#recent-activity");
  const slice = state.history.slice(0, 10);
  list.innerHTML = slice.length
    ? slice.map(renderHistoryItem).join("")
    : `<p class="empty">Aucun mouvement.</p>`;
}

function renderHistoryView() {
  const items = state.historyFilter
    ? state.history.filter((h) => h.type === state.historyFilter)
    : state.history;
  const list = $("#history-list");
  const empty = $("#empty-history");

  $("#activity-meta").textContent = `${items.length} mouvement${items.length > 1 ? "s" : ""}`;
  $$(".chip[data-hfilter]").forEach((b) =>
    b.classList.toggle("active", (b.dataset.hfilter || "") === state.historyFilter)
  );

  if (items.length === 0) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  list.innerHTML = items.map(renderHistoryItem).join("");
}

/* ============== USERS VIEW ============== */

function roleBadge(role) {
  const label = ROLE_META[role]?.short || role;
  return `<span class="role-badge role-${role}"><i></i>${label}</span>`;
}

function renderUsersView() {
  const body = $("#users-body");
  const empty = $("#empty-users");
  $("#users-meta").textContent =
    `${state.users.length} utilisateur${state.users.length > 1 ? "s" : ""}`;

  if (state.users.length === 0) {
    body.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  body.innerHTML = state.users
    .map((u) => {
      const isSelf = u.id === state.currentUser?.id;
      return `
        <tr>
          <td>
            <span class="product-name">${escapeHtml(u.name)}</span>
            ${isSelf ? '<span class="caption" style="margin-left:0.4rem">(vous)</span>' : ""}
          </td>
          <td><span class="caption">${escapeHtml(u.email)}</span></td>
          <td>${roleBadge(u.role)}</td>
          <td><span class="caption">${parseDate(u.created_at).toLocaleDateString("fr-FR")}</span></td>
          <td class="ta-right">
            <div class="actions">
              <button class="row-btn" data-user-id="${u.id}" data-action="edit">Modifier</button>
              <button class="row-btn del-btn" data-user-id="${u.id}" data-action="del" ${isSelf ? "disabled" : ""}>✕</button>
            </div>
          </td>
        </tr>`;
    })
    .join("");
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

/* ============== MUTATIONS ============== */

async function createProduct(name, qty) {
  await api("/products", { method: "POST", body: JSON.stringify({ name, qty }) });
  await refreshCore();
}

async function adjustStock(id, delta) {
  await api(`/products/${id}/stock`, { method: "POST", body: JSON.stringify({ delta }) });
  await refreshCore();
}

async function removeProduct(id, name) {
  if (!confirm(`Supprimer "${name}" ? Cette action est irréversible.`)) return;
  try {
    await api(`/products/${id}`, { method: "DELETE" });
    await refreshCore();
  } catch (err) {
    showError(err.message);
  }
}

async function createUser(payload) {
  await api("/users", { method: "POST", body: JSON.stringify(payload) });
  await refreshUsers();
}

async function updateUser(id, payload) {
  await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  await refreshUsers();
}

async function removeUser(id, name) {
  if (!confirm(`Supprimer l'utilisateur "${name}" ?`)) return;
  try {
    await api(`/users/${id}`, { method: "DELETE" });
    await refreshUsers();
  } catch (err) {
    showError(err.message);
  }
}

/* ============== MODALS ============== */

const openModal = (d) => d.showModal?.() ?? d.setAttribute("open", "");
const closeModal = (d) => d.close?.() ?? d.removeAttribute("open");

function openStockModal(product, dir) {
  const form = $("#stock-form");
  form.dataset.productId = product.id;
  form.dataset.dir = dir;
  $("#stock-title").textContent = dir === "in" ? "Ajouter au stock" : "Retirer du stock";
  $("#stock-sub").textContent = `${product.name} · stock actuel ${product.qty}`;
  $("#stock-confirm").textContent = dir === "in" ? "Ajouter" : "Retirer";
  $("#stock-amount").value = 1;
  openModal($("#modal-stock"));
  setTimeout(() => $("#stock-amount").select(), 50);
}

function openUserModal(user = null) {
  const form = $("#user-form");
  form.dataset.userId = user?.id || "";
  $("#user-title").textContent = user ? "Modifier l'utilisateur" : "Nouvel utilisateur";
  $("#user-confirm").textContent = user ? "Enregistrer" : "Créer";
  $("#user-name-input").value = user?.name || "";
  $("#user-email-input").value = user?.email || "";
  $("#user-email-input").disabled = !!user;
  $("#user-role-input").value = user?.role || "editor";
  $("#user-password-input").value = "";
  $("#user-password-input").required = !user;
  $("#user-password-label").textContent = user
    ? "Nouveau mot de passe (laisser vide pour conserver)"
    : "Mot de passe";
  openModal($("#modal-user"));
  setTimeout(() => $("#user-name-input").focus(), 50);
}

/* ============== WIRING ============== */

function wireLogin() {
  const form = $("#login-form");
  const err = $("#login-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const email = $("#login-email").value.trim();
    const password = $("#login-password").value;
    try {
      await login(email, password);
      form.reset();
      showApp();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $("#btn-logout").addEventListener("click", async () => {
    if (!confirm("Se déconnecter ?")) return;
    await logout();
  });
}

function wireModals() {
  $$("[data-close]").forEach((b) =>
    b.addEventListener("click", () => closeModal(b.closest("dialog")))
  );

  $("#btn-open-add").addEventListener("click", () => {
    $("#add-product-form").reset();
    $("#product-qty").value = 0;
    openModal($("#modal-add"));
    setTimeout(() => $("#product-name").focus(), 50);
  });

  $("#add-product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#product-name").value.trim();
    const qty = parseInt($("#product-qty").value, 10);
    if (!name || isNaN(qty) || qty < 0) return;
    try {
      await createProduct(name, qty);
      closeModal($("#modal-add"));
    } catch (err) { showError(err.message); }
  });

  $("#stock-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const id = parseInt(form.dataset.productId, 10);
    const dir = form.dataset.dir;
    const amount = parseInt($("#stock-amount").value, 10);
    if (isNaN(id) || isNaN(amount) || amount <= 0) return;
    try {
      await adjustStock(id, dir === "in" ? amount : -amount);
      closeModal($("#modal-stock"));
    } catch (err) { showError(err.message); }
  });

  $("#btn-open-user").addEventListener("click", () => openUserModal());

  $("#user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const id = form.dataset.userId ? parseInt(form.dataset.userId, 10) : null;
    const name = $("#user-name-input").value.trim();
    const email = $("#user-email-input").value.trim();
    const role = $("#user-role-input").value;
    const password = $("#user-password-input").value;

    try {
      if (id) {
        const payload = { name, role };
        if (password) payload.password = password;
        await updateUser(id, payload);
      } else {
        await createUser({ name, email, role, password });
      }
      closeModal($("#modal-user"));
    } catch (err) { showError(err.message); }
  });
}

function wireNav() {
  $$(".nav-item").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      state.productFilter = a.dataset.filter || "";
      setView(a.dataset.view);
      if (a.dataset.filter) renderProductsView();
    })
  );

  $$('a[data-view]:not(.nav-item)').forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      setView(a.dataset.view);
    })
  );
}

function wireFilters() {
  $$(".chip[data-filter]").forEach((c) =>
    c.addEventListener("click", () => {
      state.productFilter = c.dataset.filter || "";
      renderProductsView();
    })
  );

  $$(".chip[data-hfilter]").forEach((c) =>
    c.addEventListener("click", () => {
      state.historyFilter = c.dataset.hfilter || "";
      renderHistoryView();
    })
  );
}

function wireSearch() {
  $("#search").addEventListener("input", (e) => {
    state.search = e.target.value;
    if (state.view !== "products") setView("products");
    renderProductsView();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("#search").focus();
    }
  });
}

function wireTables() {
  $("#products-body").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);
    const product = state.products.find((p) => p.id === id);
    if (!product) return;
    const act = btn.dataset.action;
    if (act === "in") openStockModal(product, "in");
    else if (act === "out") openStockModal(product, "out");
    else if (act === "del") removeProduct(id, product.name);
  });

  $("#users-body").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-user-id]");
    if (!btn) return;
    const id = parseInt(btn.dataset.userId, 10);
    const user = state.users.find((u) => u.id === id);
    if (!user) return;
    if (btn.dataset.action === "edit") openUserModal(user);
    else if (btn.dataset.action === "del") removeUser(id, user.name);
  });
}

function wireRefresh() {
  $("#btn-refresh").addEventListener("click", () => {
    const svg = $("#btn-refresh svg");
    svg.style.transition = "transform 0.5s";
    svg.style.transform = "rotate(360deg)";
    setTimeout(() => (svg.style.transform = ""), 500);
    refreshCore();
    refreshUsers();
  });
}

/* ============== BOOT ============== */

function applyUserChip() {
  const u = state.currentUser;
  if (!u) return;
  const initial = (u.name || u.email)[0]?.toUpperCase() || "?";
  $("#user-avatar").textContent = initial;
  $("#user-name").textContent = u.name;
  $(".user-role").textContent = ROLE_META[u.role]?.label || u.role;
}

function showLogin() {
  document.body.classList.add("locked");
  setTimeout(() => $("#login-email").focus(), 50);
}

function showApp() {
  document.body.classList.remove("locked");
  applyUserChip();
  applyRoleVisibility();
  setView(state.view === "users" && !can("manageUsers") ? "dashboard" : state.view);
  refreshCore();
  refreshUsers();
}

async function boot() {
  wireLogin();
  wireModals();
  wireNav();
  wireFilters();
  wireSearch();
  wireTables();
  wireRefresh();

  const ok = await restoreSession();
  if (ok) {
    showApp();
  } else {
    state.token = null;
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  }

  setInterval(() => {
    if (state.currentUser) {
      refreshCore();
      refreshUsers();
    }
  }, 30000);
}

document.addEventListener("DOMContentLoaded", boot);
