const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("./db");

const SESSION_DAYS = 7;
const ROLES = ["admin", "editor", "viewer"];

const q = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE"),
  userById: db.prepare(
    "SELECT id, email, name, role, created_at FROM users WHERE id = ?"
  ),
  insertSession: db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
  ),
  findSession: db.prepare(
    "SELECT user_id FROM sessions WHERE token = ? AND datetime(expires_at) > datetime('now')"
  ),
  deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  deleteExpired: db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')"),
};

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  q.insertSession.run(token, userId, `+${SESSION_DAYS} days`);
  return token;
}

function destroySession(token) {
  q.deleteSession.run(token);
}

function requireAuth(req, res, next) {
  q.deleteExpired.run();
  const header = req.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non authentifié." });

  const session = q.findSession.get(token);
  if (!session) return res.status(401).json({ error: "Session expirée." });

  const user = q.userById.get(session.user_id);
  if (!user) return res.status(401).json({ error: "Utilisateur introuvable." });

  req.user = user;
  req.token = token;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Non authentifié." });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Accès refusé." });
    }
    next();
  };
}

module.exports = {
  ROLES,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  requireAuth,
  requireRole,
  q,
};
