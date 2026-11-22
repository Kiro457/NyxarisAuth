require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DB_PATH = process.env.DB_PATH || "./data/nyxaris.sqlite";

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set JWT_SECRET in .env to a random value at least 32 characters long.");
  process.exit(1);
}
if (!ADMIN_USERNAME || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error("Set ADMIN_USERNAME and an ADMIN_PASSWORD of at least 12 characters in .env.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hwid_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  UNIQUE(username, project_id)
);
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unused',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  redeemed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_licenses_project ON licenses(project_id);
CREATE INDEX IF NOT EXISTS idx_users_project ON users(project_id);
`);

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const makeKey = () => "NYX-" + crypto.randomBytes(4).toString("hex").toUpperCase() +
  "-" + crypto.randomBytes(4).toString("hex").toUpperCase() +
  "-" + crypto.randomBytes(4).toString("hex").toUpperCase();

const projectCount = db.prepare("SELECT COUNT(*) AS n FROM projects").get().n;
if (!projectCount) {
  db.prepare("INSERT INTO projects (id,name,description,created_at) VALUES (?,?,?,?)")
    .run("nyxaris-main", "NYXARIS Hub", "Default project", now());
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
app.use("/api", apiLimiter);

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") throw new Error("wrong role");
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
function cleanString(value, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function validProject(projectId) {
  return db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
}
function expiryFromDays(days) {
  if (days === null || days === undefined || days === "" || Number(days) === 0) return null;
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > 3650) throw new Error("Duration must be 1–3650 days, or 0 for lifetime.");
  return new Date(Date.now() + n * 86400000).toISOString();
}

app.post("/api/admin/login", async (req, res) => {
  const username = cleanString(req.body.username, 100);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const okUser = username === ADMIN_USERNAME;
  // Hash the configured password at startup-comparable cost; never store it in SQLite.
  const okPass = okUser && await bcrypt.compare(password, await bcrypt.hash(ADMIN_PASSWORD, 10));
  if (!okPass) return res.status(401).json({ error: "Invalid username or password" });
  const token = jwt.sign({ role: "admin", sub: username }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, expiresIn: 28800 });
});

app.get("/api/admin/overview", requireAdmin, (req, res) => {
  res.json({
    projects: db.prepare("SELECT COUNT(*) n FROM projects").get().n,
    users: db.prepare("SELECT COUNT(*) n FROM users").get().n,
    activeUsers: db.prepare("SELECT COUNT(*) n FROM users WHERE status='active'").get().n,
    activeLicenses: db.prepare("SELECT COUNT(*) n FROM licenses WHERE status='active'").get().n,
    unusedKeys: db.prepare("SELECT COUNT(*) n FROM licenses WHERE status='unused'").get().n
  });
});

app.get("/api/admin/projects", requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all());
});
app.post("/api/admin/projects", requireAdmin, (req, res) => {
  const name = cleanString(req.body.name, 80);
  const description = cleanString(req.body.description, 300);
  if (!name) return res.status(400).json({ error: "Project name is required" });
  const project = { id: "prj_" + crypto.randomBytes(6).toString("hex"), name, description, created_at: now() };
  db.prepare("INSERT INTO projects (id,name,description,created_at) VALUES (@id,@name,@description,@created_at)").run(project);
  res.status(201).json(project);
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id,u.username,u.project_id,u.status,u.created_at,u.hwid_hash,
      p.name AS project_name, l.status AS license_status,l.expires_at
    FROM users u JOIN projects p ON p.id=u.project_id
    LEFT JOIN licenses l ON l.user_id=u.id
    ORDER BY u.created_at DESC LIMIT 500
  `).all().map(u => ({ ...u, hwid_hash: u.hwid_hash ? "bound" : "not bound" }));
  res.json(rows);
});

app.get("/api/admin/keys", requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT l.id,l.project_id,l.status,l.expires_at,l.created_at,l.redeemed_at,
      p.name AS project_name,u.username
    FROM licenses l JOIN projects p ON p.id=l.project_id
    LEFT JOIN users u ON u.id=l.user_id
    ORDER BY l.created_at DESC LIMIT 500
  `).all());
});

app.post("/api/admin/keys", requireAdmin, (req, res) => {
  const projectId = cleanString(req.body.projectId, 100);
  const count = Math.min(50, Math.max(1, Number(req.body.count) || 1));
  if (!validProject(projectId)) return res.status(400).json({ error: "Unknown project" });
  let expiresAt;
  try { expiresAt = expiryFromDays(req.body.days); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const created = [];
  const insert = db.prepare(`INSERT INTO licenses (id,key_hash,project_id,status,expires_at,created_at)
    VALUES (?,?,?,'unused',?,?)`);
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const key = makeKey();
      const licenseId = id();
      insert.run(licenseId, hash(key), projectId, expiresAt, now());
      created.push({ id: licenseId, key });
    }
  });
  tx();
  // Plaintext keys are returned only once. Only SHA-256 hashes are stored.
  res.status(201).json({ keys: created, expiresAt });
});

app.post("/api/admin/users/:id/revoke", requireAdmin, (req, res) => {
  const userId = cleanString(req.params.id, 100);
  const result = db.prepare("UPDATE users SET status='revoked' WHERE id=?").run(userId);
  db.prepare("UPDATE licenses SET status='revoked' WHERE user_id=?").run(userId);
  if (!result.changes) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});
app.post("/api/admin/users/:id/unrevoke", requireAdmin, (req, res) => {
  const userId = cleanString(req.params.id, 100);
  const result = db.prepare("UPDATE users SET status='active' WHERE id=?").run(userId);
  db.prepare("UPDATE licenses SET status='active' WHERE user_id=? AND status='revoked'").run(userId);
  if (!result.changes) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});
app.post("/api/admin/users/:id/reset-hwid", requireAdmin, (req, res) => {
  const result = db.prepare("UPDATE users SET hwid_hash=NULL WHERE id=?").run(cleanString(req.params.id, 100));
  if (!result.changes) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});
app.post("/api/admin/keys/:id/revoke", requireAdmin, (req, res) => {
  const result = db.prepare("UPDATE licenses SET status='revoked' WHERE id=?").run(cleanString(req.params.id, 100));
  if (!result.changes) return res.status(404).json({ error: "Key not found" });
  res.json({ ok: true });
});

// Redeem a key once to create a project-scoped account and bind its first device/game identity.
app.post("/api/auth/redeem", (req, res) => {
  const key = cleanString(req.body.key, 100).toUpperCase();
  const username = cleanString(req.body.username, 40);
  const projectId = cleanString(req.body.projectId, 100);
  const hwid = cleanString(req.body.hwid, 200);
  if (!key || !username || !projectId || !hwid) {
    return res.status(400).json({ error: "key, username, projectId and hwid are required" });
  }
  const license = db.prepare("SELECT * FROM licenses WHERE key_hash=? AND project_id=?").get(hash(key), projectId);
  if (!license || license.status !== "unused") return res.status(400).json({ error: "Key is invalid, used, or revoked" });
  if (license.expires_at && Date.now() > Date.parse(license.expires_at)) {
    db.prepare("UPDATE licenses SET status='expired' WHERE id=?").run(license.id);
    return res.status(400).json({ error: "Key has expired" });
  }
  const userId = id();
  try {
    const tx = db.transaction(() => {
      db.prepare("INSERT INTO users (id,username,project_id,hwid_hash,status,created_at) VALUES (?,?,?,?, 'active',?)")
        .run(userId, username, projectId, hash(hwid), now());
      db.prepare("UPDATE licenses SET user_id=?,status='active',redeemed_at=? WHERE id=? AND status='unused'")
        .run(userId, now(), license.id);
    });
    tx();
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "Username already exists in this project" });
    throw e;
  }
  res.status(201).json({ ok: true, userId, message: "Key redeemed" });
});

// Validate a previously redeemed license. The caller must send the same HWID/game identity.
app.post("/api/auth/validate", (req, res) => {
  const key = cleanString(req.body.key, 100).toUpperCase();
  const projectId = cleanString(req.body.projectId, 100);
  const hwid = cleanString(req.body.hwid, 200);
  if (!key || !projectId || !hwid) return res.status(400).json({ valid: false, error: "Missing fields" });

  const license = db.prepare(`
    SELECT l.*,u.status AS user_status,u.hwid_hash,u.username
    FROM licenses l LEFT JOIN users u ON u.id=l.user_id
    WHERE l.key_hash=? AND l.project_id=?
  `).get(hash(key), projectId);

  if (!license || license.status !== "active" || license.user_status !== "active") {
    return res.status(403).json({ valid: false, error: "License inactive or not found" });
  }
  if (license.expires_at && Date.now() > Date.parse(license.expires_at)) {
    db.prepare("UPDATE licenses SET status='expired' WHERE id=?").run(license.id);
    return res.status(403).json({ valid: false, error: "License expired" });
  }
  if (!license.hwid_hash || license.hwid_hash !== hash(hwid)) {
    return res.status(403).json({ valid: false, error: "Device/game identity mismatch" });
  }
  res.json({ valid: true, username: license.username, projectId, expiresAt: license.expires_at });
});

app.get("/health", (req, res) => res.json({ ok: true, service: "NYXARIS AUTH" }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NYXARIS AUTH listening on port ${PORT}`);
});
