const express = require("express");
const path = require("path");
const db = require("./db");
const {
  ROLES,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  requireAuth,
  requireRole,
  q: authQ,
} = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ============== PRODUCT QUERIES ============== */

const stmts = {
  listProducts: db.prepare("SELECT id, name, qty, created_at FROM products ORDER BY name ASC"),
  getProduct: db.prepare("SELECT id, name, qty FROM products WHERE id = ?"),
  insertProduct: db.prepare("INSERT INTO products (name, qty) VALUES (?, ?)"),
  updateQty: db.prepare("UPDATE products SET qty = ? WHERE id = ?"),
  deleteProduct: db.prepare("DELETE FROM products WHERE id = ?"),
  insertMovement: db.prepare(
    "INSERT INTO movements (product_id, product_name, type, amount) VALUES (?, ?, ?, ?)"
  ),
  listMovements: db.prepare(
    "SELECT id, product_id, product_name, type, amount, created_at FROM movements ORDER BY id DESC LIMIT ?"
  ),
};

/* ============== AUTH ROUTES ============== */

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email et mot de passe requis." });
  }
  const user = authQ.userByEmail.get(String(email).trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Identifiants invalides." });
  }
  const token = createSession(user.id);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  destroySession(req.token);
  res.status(204).end();
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});

/* ============== PRODUCTS ============== */

const canWrite = requireRole("admin", "editor");

app.get("/api/products", requireAuth, (_req, res) => {
  res.json(stmts.listProducts.all());
});

app.post("/api/products", requireAuth, canWrite, (req, res) => {
  const { name, qty } = req.body || {};
  const trimmed = typeof name === "string" ? name.trim() : "";
  const n = Number.isInteger(qty) ? qty : parseInt(qty, 10);

  if (!trimmed) return res.status(400).json({ error: "Nom requis." });
  if (isNaN(n) || n < 0) return res.status(400).json({ error: "Quantité invalide." });

  try {
    const tx = db.transaction(() => {
      const info = stmts.insertProduct.run(trimmed, n);
      stmts.insertMovement.run(info.lastInsertRowid, trimmed, "create", n);
      return info.lastInsertRowid;
    });
    const id = tx();
    res.status(201).json(stmts.getProduct.get(id));
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Produit avec ce nom existe déjà." });
    }
    throw err;
  }
});

app.post("/api/products/:id/stock", requireAuth, canWrite, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { delta } = req.body || {};
  const d = Number.isInteger(delta) ? delta : parseInt(delta, 10);

  if (isNaN(id)) return res.status(400).json({ error: "ID invalide." });
  if (isNaN(d) || d === 0) return res.status(400).json({ error: "Delta invalide." });

  const product = stmts.getProduct.get(id);
  if (!product) return res.status(404).json({ error: "Produit introuvable." });

  const newQty = product.qty + d;
  if (newQty < 0) return res.status(400).json({ error: "Stock insuffisant." });

  const tx = db.transaction(() => {
    stmts.updateQty.run(newQty, id);
    stmts.insertMovement.run(id, product.name, d > 0 ? "in" : "out", Math.abs(d));
  });
  tx();

  res.json(stmts.getProduct.get(id));
});

app.delete("/api/products/:id", requireAuth, canWrite, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalide." });

  const product = stmts.getProduct.get(id);
  if (!product) return res.status(404).json({ error: "Produit introuvable." });

  const tx = db.transaction(() => {
    stmts.insertMovement.run(id, product.name, "delete", product.qty);
    stmts.deleteProduct.run(id);
  });
  tx();

  res.status(204).end();
});

app.get("/api/history", requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  res.json(stmts.listMovements.all(limit));
});

app.get("/api/stats", requireAuth, (_req, res) => {
  const totals = db
    .prepare("SELECT COUNT(*) AS products, COALESCE(SUM(qty), 0) AS units FROM products")
    .get();
  const lowStock = db
    .prepare("SELECT COUNT(*) AS n FROM products WHERE qty <= 5")
    .get().n;
  const outOfStock = db
    .prepare("SELECT COUNT(*) AS n FROM products WHERE qty = 0")
    .get().n;
  const movementsToday = db
    .prepare(
      "SELECT COUNT(*) AS n FROM movements WHERE DATE(created_at) = DATE('now') AND type IN ('in','out')"
    )
    .get().n;
  const byDay = db
    .prepare(
      `SELECT DATE(created_at) AS day,
              SUM(CASE WHEN type = 'in'  THEN amount ELSE 0 END) AS inflow,
              SUM(CASE WHEN type = 'out' THEN amount ELSE 0 END) AS outflow
       FROM movements
       WHERE DATE(created_at) >= DATE('now', '-29 days')
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) ASC`
    )
    .all();
  const topProducts = db
    .prepare("SELECT id, name, qty FROM products ORDER BY qty DESC LIMIT 8")
    .all();
  const buckets = db
    .prepare(
      `SELECT
         SUM(CASE WHEN qty = 0 THEN 1 ELSE 0 END) AS empty,
         SUM(CASE WHEN qty > 0 AND qty <= 5 THEN 1 ELSE 0 END) AS critical,
         SUM(CASE WHEN qty > 5 AND qty <= 20 THEN 1 ELSE 0 END) AS low,
         SUM(CASE WHEN qty > 20 THEN 1 ELSE 0 END) AS healthy
       FROM products`
    )
    .get();

  res.json({ totals, lowStock, outOfStock, movementsToday, byDay, topProducts, buckets });
});

/* ============== USERS ============== */

const adminOnly = requireRole("admin");

function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}

app.get("/api/users", requireAuth, adminOnly, (_req, res) => {
  const users = db
    .prepare("SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC")
    .all();
  res.json(users);
});

app.post("/api/users", requireAuth, adminOnly, (req, res) => {
  const { email, name, password, role } = req.body || {};
  const emailT = typeof email === "string" ? email.trim() : "";
  const nameT = typeof name === "string" ? name.trim() : "";

  if (!emailT || !nameT || !password || !role) {
    return res.status(400).json({ error: "Tous les champs requis." });
  }
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: "Rôle invalide." });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: "Mot de passe trop court (min 4 caractères)." });
  }

  try {
    const info = db
      .prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)")
      .run(emailT, nameT, role, hashPassword(password));
    res.status(201).json(authQ.userById.get(info.lastInsertRowid));
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Email déjà utilisé." });
    }
    throw err;
  }
});

app.patch("/api/users/:id", requireAuth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalide." });

  const target = authQ.userById.get(id);
  if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });

  const { name, role, password } = req.body || {};

  if (role !== undefined && !ROLES.includes(role)) {
    return res.status(400).json({ error: "Rôle invalide." });
  }
  if (target.role === "admin" && role && role !== "admin" && countAdmins() <= 1) {
    return res.status(400).json({ error: "Impossible de retirer le dernier administrateur." });
  }
  if (password !== undefined && String(password).length < 4) {
    return res.status(400).json({ error: "Mot de passe trop court (min 4 caractères)." });
  }

  const updates = [];
  const values = [];
  if (typeof name === "string" && name.trim()) {
    updates.push("name = ?");
    values.push(name.trim());
  }
  if (role) {
    updates.push("role = ?");
    values.push(role);
  }
  if (password) {
    updates.push("password_hash = ?");
    values.push(hashPassword(password));
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: "Aucune modification." });
  }
  values.push(id);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  res.json(authQ.userById.get(id));
});

app.delete("/api/users/:id", requireAuth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID invalide." });

  const target = authQ.userById.get(id);
  if (!target) return res.status(404).json({ error: "Utilisateur introuvable." });

  if (target.id === req.user.id) {
    return res.status(400).json({ error: "Impossible de supprimer son propre compte." });
  }
  if (target.role === "admin" && countAdmins() <= 1) {
    return res.status(400).json({ error: "Impossible de supprimer le dernier administrateur." });
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.status(204).end();
});

/* ============== ERROR HANDLER ============== */

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur serveur." });
});

/* ============== BOOT ============== */

function ensureDefaultAdmin() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (n > 0) return;
  db.prepare(
    "INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)"
  ).run("admin@ledger.app", "Administrateur", "admin", hashPassword("admin"));
  console.log("[auth] Compte admin par défaut créé → admin@ledger.app / admin");
}

ensureDefaultAdmin();

app.listen(PORT, () => {
  console.log(`Stock app running on http://localhost:${PORT}`);
});
