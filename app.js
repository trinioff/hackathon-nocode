const STORAGE_KEY = "stock-app-data";

const state = {
  products: [],
  history: [],
};

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.products = parsed.products || [];
      state.history = parsed.history || [];
    } catch {
      state.products = [];
      state.history = [];
    }
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function addProduct(name, qty) {
  const existing = state.products.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    alert("Un produit avec ce nom existe déjà.");
    return;
  }
  state.products.push({ id: uid(), name, qty });
  state.history.unshift({
    id: uid(),
    productName: name,
    type: "create",
    amount: qty,
    date: new Date().toISOString(),
  });
  save();
  render();
}

function changeStock(id, delta) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  const newQty = product.qty + delta;
  if (newQty < 0) {
    alert("Stock insuffisant.");
    return;
  }
  product.qty = newQty;
  state.history.unshift({
    id: uid(),
    productName: product.name,
    type: delta > 0 ? "in" : "out",
    amount: Math.abs(delta),
    date: new Date().toISOString(),
  });
  save();
  render();
}

function deleteProduct(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  if (!confirm(`Supprimer "${product.name}" ?`)) return;
  state.products = state.products.filter(p => p.id !== id);
  state.history.unshift({
    id: uid(),
    productName: product.name,
    type: "delete",
    amount: product.qty,
    date: new Date().toISOString(),
  });
  save();
  render();
}

function promptAmount(label) {
  const raw = prompt(label);
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    alert("Quantité invalide.");
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
    delBtn.onclick = () => deleteProduct(p.id);

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

  for (const h of state.history.slice(0, 50)) {
    const li = document.createElement("li");
    const date = new Date(h.date).toLocaleString("fr-FR");
    let label = "";
    if (h.type === "in") label = `<span class="mov-in">+${h.amount}</span> ajouté à <strong>${h.productName}</strong>`;
    else if (h.type === "out") label = `<span class="mov-out">−${h.amount}</span> retiré de <strong>${h.productName}</strong>`;
    else if (h.type === "create") label = `Produit <strong>${h.productName}</strong> créé (qté: ${h.amount})`;
    else if (h.type === "delete") label = `Produit <strong>${h.productName}</strong> supprimé`;
    li.innerHTML = `${label}<span class="time">${date}</span>`;
    list.appendChild(li);
  }
}

function render() {
  renderProducts();
  renderHistory();
}

document.getElementById("add-product-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("product-name").value.trim();
  const qty = parseInt(document.getElementById("product-qty").value, 10);
  if (!name || isNaN(qty) || qty < 0) return;
  addProduct(name, qty);
  e.target.reset();
  document.getElementById("product-qty").value = 0;
});

load();
render();
