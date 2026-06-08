import express from "express";
import session from "express-session";
import multer from "multer";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "gallery.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");

const PORT = process.env.PORT || 3000;

// Runtime dirs are gitignored, so they're absent on a fresh deploy — create them.
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---- Storage helpers -------------------------------------------------------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Seed default gallery content on first run.
const DEFAULT_GALLERY = {
  title: "My Gallery",
  intro:
    "A small collection of pictures I love. Scroll down to explore the gallery, and find a few words and contact details at the end.",
  niceWords:
    "Thanks for stopping by. Every picture here is a moment worth keeping — I hope one of them stays with you too.",
  contact: {
    name: "mica5h",
    email: "",
    note: "Have a question or just want to say hi? Reach out anytime.",
  },
  items: [],
};

if (!fs.existsSync(DATA_FILE)) writeJson(DATA_FILE, DEFAULT_GALLERY);

// Seed a default admin user on first run.
// Default credentials: admin / changeme  (CHANGE THIS — see README)
if (!fs.existsSync(USERS_FILE)) {
  const defaultUser = {
    username: "admin",
    passwordHash: bcrypt.hashSync("changeme", 10),
  };
  writeJson(USERS_FILE, { users: [defaultUser] });
}

// ---- App -------------------------------------------------------------------

const app = express();
const isProd = process.env.NODE_ENV === "production";

// Behind Render's HTTPS proxy: trust it so secure cookies are set correctly.
if (isProd) app.set("trust proxy", 1);

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd, // require HTTPS for the session cookie in production
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  })
);

// Static: public site + uploaded images.
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

// ---- Auth ------------------------------------------------------------------

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const { users } = readJson(USERS_FILE, { users: [] });
  const user = users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  req.session.user = { username: user.username };
  res.json({ username: user.username });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session?.user || null });
});

// ---- Gallery info (public read, admin write) -------------------------------

app.get("/api/gallery", (req, res) => {
  res.json(readJson(DATA_FILE, DEFAULT_GALLERY));
});

app.put("/api/info", requireAuth, (req, res) => {
  const gallery = readJson(DATA_FILE, DEFAULT_GALLERY);
  const { title, intro, niceWords, contact } = req.body || {};
  if (typeof title === "string") gallery.title = title;
  if (typeof intro === "string") gallery.intro = intro;
  if (typeof niceWords === "string") gallery.niceWords = niceWords;
  if (contact && typeof contact === "object") {
    gallery.contact = { ...gallery.contact, ...contact };
  }
  writeJson(DATA_FILE, gallery);
  res.json(gallery);
});

// ---- Items: upload / edit / delete -----------------------------------------

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(12).toString("hex") + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, GIF, or WEBP images are allowed."));
  },
});

app.post("/api/items", requireAuth, (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });
    const gallery = readJson(DATA_FILE, DEFAULT_GALLERY);
    const item = {
      id: crypto.randomBytes(8).toString("hex"),
      filename: req.file.filename,
      title: (req.body.title || "").trim(),
      description: (req.body.description || "").trim(),
      createdAt: new Date().toISOString(),
    };
    gallery.items.push(item);
    writeJson(DATA_FILE, gallery);
    res.status(201).json(item);
  });
});

app.put("/api/items/:id", requireAuth, (req, res) => {
  const gallery = readJson(DATA_FILE, DEFAULT_GALLERY);
  const item = gallery.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found" });
  const { title, description } = req.body || {};
  if (typeof title === "string") item.title = title.trim();
  if (typeof description === "string") item.description = description.trim();
  writeJson(DATA_FILE, gallery);
  res.json(item);
});

app.delete("/api/items/:id", requireAuth, (req, res) => {
  const gallery = readJson(DATA_FILE, DEFAULT_GALLERY);
  const idx = gallery.items.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Item not found" });
  const [removed] = gallery.items.splice(idx, 1);
  writeJson(DATA_FILE, gallery);
  // Best-effort delete of the file on disk.
  fs.unlink(path.join(UPLOAD_DIR, removed.filename), () => {});
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Gallery running at http://localhost:${PORT}`);
  console.log(`Admin panel at      http://localhost:${PORT}/admin`);
});
