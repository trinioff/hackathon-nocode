const API = "/api";

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

const state = { products: [], history: [] };

async function refresh() {
  try {
    const [products, history] = await Promise.all([
      api("/products"),
      api("/history?limit=50"),
    ]);
    state.products = products;
    state.history = history;
    render();
  } catch (err) {
    showError(err.message);
  }
}

function showError(msg) {
  const el = document.getElementById("error-banner");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { el.style.display = "none"; }, 4000);
}

async function addProduct(name, qty) {
  try {
    await api("/products", {
      method: "POST",
      body: JSON.stringify({ name, qty }),
    });
    await refresh();
  } catch (err) {
    showError(err.message);
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
  }
}

async function deleteProduct(id, name) {
  if (!confirm(`Supprimer "${name}" ?`)) return;
  try {
    await api(`/products/${id}`, { method: "DELETE" });
    await refresh();
  } catch (err) {
    showError(err.message);
  }
}

function promptAmount(label) {
  const raw = prompt(label);
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    showError("Quantité invalide.");
    return null;
  }
  return n;
}

function renderProducts() {
  const body = document.getElementById("products-body");
  const empty = document.getElementById("empty-msg");
  body.innerHTML = "";

  if (state.products.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  for (const p of state.products) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = p.name;

    const qtyTd = document.createElement("td");
    const qtySpan = document.createElement("span");
    qtySpan.className = "qty" + (p.qty <= 5 ? " low" : "");
    qtySpan.textContent = p.qty;
    qtyTd.appendChild(qtySpan);

    const actionsTd = document.createElement("td");
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "actions";

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Ajouter";
    addBtn.onclick = () => {
      const n = promptAmount(`Quantité à ajouter pour "${p.name}":`);
      if (n !== null) changeStock(p.id, n);
    };

    const subBtn = document.createElement("button");
    subBtn.className = "secondary";
    subBtn.textContent = "− Retirer";
    subBtn.onclick = () => {
      const n = promptAmount(`Quantité à retirer pour "${p.name}":`);
      if (n !== null) changeStock(p.id, -n);
    };

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Suppr";
    delBtn.onclick = () => deleteProduct(p.id, p.name);

    actionsDiv.append(addBtn, subBtn, delBtn);
    actionsTd.appendChild(actionsDiv);

    tr.append(nameTd, qtyTd, actionsTd);
    body.appendChild(tr);
  }
}

function renderHistory() {
  const list = document.getElementById("history-list");
  const empty = document.getElementById("empty-history");
  list.innerHTML = "";

  if (state.history.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  for (const h of state.history) {
    const li = document.createElement("li");
    const date = new Date(h.created_at.replace(" ", "T") + "Z").toLocaleString("fr-FR");
    const name = escapeHtml(h.product_name);
    let label = "";
    if (h.type === "in") label = `<span class="mov-in">+${h.amount}</span> ajouté à <strong>${name}</strong>`;
    else if (h.type === "out") label = `<span class="mov-out">−${h.amount}</span> retiré de <strong>${name}</strong>`;
    else if (h.type === "create") label = `Produit <strong>${name}</strong> créé (qté: ${h.amount})`;
    else if (h.type === "delete") label = `Produit <strong>${name}</strong> supprimé`;
    li.innerHTML = `${label}<span class="time">${date}</span>`;
    list.appendChild(li);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function render() {
  renderProducts();
  renderHistory();
}

document.getElementById("add-product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("product-name").value.trim();
  const qty = parseInt(document.getElementById("product-qty").value, 10);
  if (!name || isNaN(qty) || qty < 0) return;
  await addProduct(name, qty);
  e.target.reset();
  document.getElementById("product-qty").value = 0;
});

refresh();
