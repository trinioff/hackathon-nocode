const db = require("./db");
const bcrypt = require("bcryptjs");

const USERS = [
  { email: "admin@ledger.app",  name: "Alice Administratrice", role: "admin",  password: "admin" },
  { email: "editor@ledger.app", name: "Éva Éditrice",          role: "editor", password: "editor" },
  { email: "viewer@ledger.app", name: "Luc Lecteur",           role: "viewer", password: "viewer" },
];

const PRODUCTS = [
  { name: "Clavier mécanique K7", qty: 42 },
  { name: "Souris sans fil Logix", qty: 128 },
  { name: "Câble USB-C 2m", qty: 340 },
  { name: "Chargeur 65W", qty: 87 },
  { name: "Écran 27\" QHD", qty: 14 },
  { name: "Webcam 4K", qty: 23 },
  { name: "Casque ANC Pro", qty: 56 },
  { name: "Micro condensateur", qty: 9 },
  { name: "Support d'écran", qty: 31 },
  { name: "Hub USB 7 ports", qty: 72 },
  { name: "Dock Thunderbolt", qty: 18 },
  { name: "Clé USB 128Go", qty: 215 },
  { name: "Disque SSD 1To", qty: 44 },
  { name: "Tapis de souris XL", qty: 3 },
  { name: "Lampe de bureau LED", qty: 29 },
  { name: "Imprimante laser", qty: 7 },
  { name: "Toner noir", qty: 0 },
  { name: "Ramette A4 500f", qty: 480 },
  { name: "Stylo gel noir", qty: 620 },
  { name: "Carnet A5 pointillé", qty: 54 },
  { name: "Chaise ergonomique", qty: 11 },
  { name: "Onduleur 1000VA", qty: 5 },
  { name: "Routeur WiFi 6", qty: 16 },
  { name: "Switch 24 ports", qty: 4 },
  { name: "Batterie externe 20k", qty: 68 },
];

const DAYS = 30;
const MOVEMENTS_PER_DAY = [6, 18];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function iso(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear() +
    "-" + pad(date.getUTCMonth() + 1) +
    "-" + pad(date.getUTCDate()) +
    " " + pad(date.getUTCHours()) +
    ":" + pad(date.getUTCMinutes()) +
    ":" + pad(date.getUTCSeconds())
  );
}

function seedUsers() {
  db.exec("DELETE FROM sessions; DELETE FROM users;");
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'users';");
  const ins = db.prepare(
    "INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)"
  );
  for (const u of USERS) {
    ins.run(u.email, u.name, u.role, bcrypt.hashSync(u.password, 10));
  }
  console.log(`Seeded ${USERS.length} users (admin/editor/viewer — password = role).`);
}

function run() {
  console.log("Wiping existing data…");
  db.exec("DELETE FROM movements; DELETE FROM products;");
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('products','movements');");
  seedUsers();

  const insertProduct = db.prepare(
    "INSERT INTO products (name, qty, created_at) VALUES (?, ?, ?)"
  );
  const insertMovement = db.prepare(
    "INSERT INTO movements (product_id, product_name, type, amount, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const updateQty = db.prepare("UPDATE products SET qty = ? WHERE id = ?");

  const now = new Date();
  const startDate = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000);

  const seedTx = db.transaction(() => {
    const products = [];

    for (const p of PRODUCTS) {
      const initialQty = randInt(20, 200);
      const createdAt = new Date(
        startDate.getTime() + randInt(0, 3) * 24 * 60 * 60 * 1000
      );
      const info = insertProduct.run(p.name, initialQty, iso(createdAt));
      insertMovement.run(
        info.lastInsertRowid,
        p.name,
        "create",
        initialQty,
        iso(createdAt)
      );
      products.push({
        id: info.lastInsertRowid,
        name: p.name,
        qty: initialQty,
        targetQty: p.qty,
        createdAt,
      });
    }

    for (let d = 0; d < DAYS; d++) {
      const dayStart = new Date(startDate.getTime() + d * 24 * 60 * 60 * 1000);
      if (dayStart > now) break;

      const count = randInt(MOVEMENTS_PER_DAY[0], MOVEMENTS_PER_DAY[1]);
      for (let i = 0; i < count; i++) {
        const product = choice(products);
        if (product.createdAt > dayStart) continue;

        const when = new Date(
          dayStart.getTime() +
            randInt(8, 19) * 60 * 60 * 1000 +
            randInt(0, 59) * 60 * 1000 +
            randInt(0, 59) * 1000
        );
        if (when > now) continue;

        const drift = product.targetQty - product.qty;
        const bias = drift > 0 ? 0.65 : drift < 0 ? 0.35 : 0.5;
        const isIn = Math.random() < bias;

        let amount;
        if (isIn) {
          amount = randInt(1, Math.max(3, Math.round(Math.abs(drift) / 3) || 8));
        } else {
          amount = randInt(1, Math.max(1, Math.min(product.qty, 10)));
        }

        if (!isIn && product.qty - amount < 0) continue;

        product.qty += isIn ? amount : -amount;
        insertMovement.run(
          product.id,
          product.name,
          isIn ? "in" : "out",
          amount,
          iso(when)
        );
      }
    }

    const endOfRange = new Date(now.getTime() - randInt(30, 120) * 60 * 1000);
    for (const p of products) {
      const diff = p.targetQty - p.qty;
      if (diff !== 0) {
        const adjWhen = new Date(endOfRange.getTime() + randInt(0, 30) * 60 * 1000);
        if (diff > 0) {
          insertMovement.run(p.id, p.name, "in", diff, iso(adjWhen));
        } else if (p.qty + diff >= 0) {
          insertMovement.run(p.id, p.name, "out", -diff, iso(adjWhen));
        }
        p.qty = p.targetQty;
      }
      updateQty.run(p.qty, p.id);
    }

    return products.length;
  });

  const count = seedTx();
  const movementsCount = db
    .prepare("SELECT COUNT(*) AS n FROM movements")
    .get().n;

  console.log(`Seeded ${count} products, ${movementsCount} movements over ${DAYS} days.`);
}

run();
