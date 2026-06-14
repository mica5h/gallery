import express from "express";
import session from "express-session";
import multer from "multer";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import path from "path";
import crypto from "crypto";
import { createStorage } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "uploads");
const PORT = process.env.PORT || 3000;

// Seed default gallery content on first run. Text fields may be bilingual
// objects { en, cz } or plain strings.
const DEFAULT_GALLERY = {
  title: "Mgr. Nicol Rubá Vošmíková RUBART",
  intro: {
    en: "Emotion is not the subject. Emotion is the form.",
    cz: "Emoce není téma. Emoce je forma.",
  },
  niceWords: {
    en: "Sculptural wall works and object installations — non-reproducible morphologies produced under psychological necessity.",
    cz: "Sochařské nástěnné objekty a objektové instalace — neopakovatelné morfologie vzniklé pod tlakem psychologické nutnosti.",
  },
  contact: {
    name: "Mgr. Nicol Rubá Vošmíková RUBART",
    email: "nicol@rubart.vip",
    note: { en: "", cz: "" },
  },
  // Public Google Drive folder shown as a QR code in the menu (placeholder until set).
  driveUrl: "",
  items: [],
};

// A text field is acceptable if it's a string or a plain { en, cz }-style object.
const isText = (v) =>
  typeof v === "string" || (v && typeof v === "object" && !Array.isArray(v));

// Backend is chosen by storage.js (local files, or Supabase if its env vars are set).
const store = await createStorage();

// Seed gallery + default admin on first run.
if (!(await store.galleryExists())) await store.writeGallery(DEFAULT_GALLERY);
if (!(await store.usersExists())) {
  // Default credentials: admin / changeme  (CHANGE THIS — use the admin panel)
  await store.writeUsers({
    users: [{ username: "admin", passwordHash: bcrypt.hashSync("changeme", 10) }],
  });
}

console.log(`Storage backend: ${store.mode}`);

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

// Static: public site + (local-mode) uploaded images. In Supabase mode images
// are served from the public bucket URL, so /uploads is simply unused.
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));

// ---- Auth ------------------------------------------------------------------

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

app.post("/api/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const { users } = await store.readUsers({ users: [] });
    const user = users.find((u) => u.username === username);
    if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    req.session.user = { username: user.username };
    res.json({ username: user.username });
  } catch (err) {
    next(err);
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session?.user || null });
});

app.post("/api/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res
        .status(400)
        .json({ error: "New password must be at least 8 characters." });
    }
    const data = await store.readUsers({ users: [] });
    const user = data.users.find((u) => u.username === req.session.user.username);
    if (!user || !bcrypt.compareSync(currentPassword || "", user.passwordHash)) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    await store.writeUsers(data);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Gallery info (public read, admin write) -------------------------------

app.get("/api/gallery", async (req, res, next) => {
  try {
    res.json(await store.readGallery(DEFAULT_GALLERY));
  } catch (err) {
    next(err);
  }
});

app.put("/api/info", requireAuth, async (req, res, next) => {
  try {
    const gallery = await store.readGallery(DEFAULT_GALLERY);
    const { title, intro, niceWords, contact, driveUrl } = req.body || {};
    if (typeof title === "string") gallery.title = title;
    if (isText(intro)) gallery.intro = intro;
    if (isText(niceWords)) gallery.niceWords = niceWords;
    if (typeof driveUrl === "string") gallery.driveUrl = driveUrl.trim();
    if (contact && typeof contact === "object") {
      gallery.contact = { ...gallery.contact, ...contact };
    }
    await store.writeGallery(gallery);
    res.json(gallery);
  } catch (err) {
    next(err);
  }
});

// ---- Items: upload / edit / delete -----------------------------------------

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(), // buffer in memory; storage.js decides where it lands
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, GIF, or WEBP images are allowed."));
  },
});

app.post("/api/items", requireAuth, (req, res, next) => {
  upload.single("image")(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: "No image uploaded" });
      const { url, key } = await store.saveImage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      const gallery = await store.readGallery(DEFAULT_GALLERY);
      const b = req.body || {};
      const item = {
        id: crypto.randomBytes(8).toString("hex"),
        url,
        key,
        title: {
          en: (b.titleEn ?? b.title ?? "").trim(),
          cz: (b.titleCz ?? b.title ?? "").trim(),
        },
        description: {
          en: (b.descEn ?? b.description ?? "").trim(),
          cz: (b.descCz ?? b.description ?? "").trim(),
        },
        createdAt: new Date().toISOString(),
      };
      gallery.items.push(item);
      await store.writeGallery(gallery);
      res.status(201).json(item);
    } catch (e) {
      next(e);
    }
  });
});

app.put("/api/items/:id", requireAuth, async (req, res, next) => {
  try {
    const gallery = await store.readGallery(DEFAULT_GALLERY);
    const item = gallery.items.find((i) => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found" });
    const { title, description } = req.body || {};
    if (isText(title)) item.title = title;
    if (isText(description)) item.description = description;
    await store.writeGallery(gallery);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/items/:id", requireAuth, async (req, res, next) => {
  try {
    const gallery = await store.readGallery(DEFAULT_GALLERY);
    const idx = gallery.items.findIndex((i) => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Item not found" });
    const [removed] = gallery.items.splice(idx, 1);
    await store.writeGallery(gallery);
    // Best-effort delete of the stored image (key, or legacy filename).
    await store.deleteImage(removed.key || removed.filename).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.listen(PORT, () => {
  console.log(`Gallery running at http://localhost:${PORT}`);
  console.log(`Admin panel at      http://localhost:${PORT}/admin`);
});
