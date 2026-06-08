// Storage abstraction with two interchangeable backends, chosen at runtime:
//
//   • local    — JSON files in data/ and images on disk under uploads/.
//                 Used when SUPABASE_URL / SUPABASE_SERVICE_KEY are not set,
//                 so local development needs no external setup.
//   • supabase — JSON blobs in a PRIVATE Storage bucket and images in a PUBLIC
//                 Storage bucket. Survives restarts/redeploys on hosts with an
//                 ephemeral filesystem (e.g. Render free tier).
//
// Both expose the same async API:
//   readGallery() / writeGallery(obj)
//   readUsers()   / writeUsers(obj)
//   saveImage(buffer, originalName, mimetype) -> { url, key }
//   deleteImage(key)

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

const DATA_BUCKET = process.env.SUPABASE_DATA_BUCKET || "gallery-data";
const IMAGE_BUCKET = process.env.SUPABASE_IMAGE_BUCKET || "gallery-images";

const GALLERY_KEY = "gallery.json";
const USERS_KEY = "users.json";

function randomImageName(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  return crypto.randomBytes(12).toString("hex") + ext;
}

// ---- Local (filesystem) backend -------------------------------------------

function localBackend() {
  const DATA_DIR = path.join(__dirname, "data");
  const UPLOAD_DIR = path.join(__dirname, "uploads");
  const GALLERY_FILE = path.join(DATA_DIR, GALLERY_KEY);
  const USERS_FILE = path.join(DATA_DIR, USERS_KEY);

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      return fallback;
    }
  }
  async function writeJson(file, data) {
    await fsp.writeFile(file, JSON.stringify(data, null, 2));
  }

  return {
    mode: "local",
    async init() {
      // Runtime dirs are gitignored, so they may be absent on a fresh checkout.
      await fsp.mkdir(DATA_DIR, { recursive: true });
      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    },
    readGallery: (fallback) => readJson(GALLERY_FILE, fallback),
    writeGallery: (data) => writeJson(GALLERY_FILE, data),
    readUsers: (fallback) => readJson(USERS_FILE, fallback),
    writeUsers: (data) => writeJson(USERS_FILE, data),
    async galleryExists() {
      return fs.existsSync(GALLERY_FILE);
    },
    async usersExists() {
      return fs.existsSync(USERS_FILE);
    },
    async saveImage(buffer, originalName) {
      const key = randomImageName(originalName);
      await fsp.writeFile(path.join(UPLOAD_DIR, key), buffer);
      return { url: `/uploads/${key}`, key };
    },
    async deleteImage(key) {
      if (!key) return;
      await fsp.rm(path.join(UPLOAD_DIR, key), { force: true });
    },
  };
}

// ---- Supabase backend ------------------------------------------------------

async function supabaseBackend() {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  async function ensureBucket(name, isPublic) {
    const { data, error } = await sb.storage.getBucket(name);
    if (data) return;
    if (error && !/not found|does not exist/i.test(error.message || "")) {
      // Some SDK versions return a 400 with a different message; try create anyway.
    }
    const { error: createErr } = await sb.storage.createBucket(name, {
      public: isPublic,
    });
    if (createErr && !/exists/i.test(createErr.message || "")) {
      throw new Error(`Could not create bucket "${name}": ${createErr.message}`);
    }
  }

  async function readJson(key, fallback) {
    const { data, error } = await sb.storage.from(DATA_BUCKET).download(key);
    if (error || !data) return fallback;
    try {
      return JSON.parse(await data.text());
    } catch {
      return fallback;
    }
  }
  async function writeJson(key, obj) {
    const body = Buffer.from(JSON.stringify(obj, null, 2));
    const { error } = await sb.storage.from(DATA_BUCKET).upload(key, body, {
      contentType: "application/json",
      upsert: true,
    });
    if (error) throw new Error(`Failed to write ${key}: ${error.message}`);
  }
  async function exists(key) {
    const { data } = await sb.storage.from(DATA_BUCKET).download(key);
    return Boolean(data);
  }

  return {
    mode: "supabase",
    async init() {
      await ensureBucket(DATA_BUCKET, false); // private: holds password hashes
      await ensureBucket(IMAGE_BUCKET, true); // public: served directly to browsers
    },
    readGallery: (fallback) => readJson(GALLERY_KEY, fallback),
    writeGallery: (data) => writeJson(GALLERY_KEY, data),
    readUsers: (fallback) => readJson(USERS_KEY, fallback),
    writeUsers: (data) => writeJson(USERS_KEY, data),
    galleryExists: () => exists(GALLERY_KEY),
    usersExists: () => exists(USERS_KEY),
    async saveImage(buffer, originalName, mimetype) {
      const key = randomImageName(originalName);
      const { error } = await sb.storage.from(IMAGE_BUCKET).upload(key, buffer, {
        contentType: mimetype,
        upsert: false,
      });
      if (error) throw new Error(`Image upload failed: ${error.message}`);
      const { data } = sb.storage.from(IMAGE_BUCKET).getPublicUrl(key);
      return { url: data.publicUrl, key };
    },
    async deleteImage(key) {
      if (!key) return;
      await sb.storage.from(IMAGE_BUCKET).remove([key]);
    },
  };
}

// ---- Factory ---------------------------------------------------------------

export async function createStorage() {
  const backend = USE_SUPABASE ? await supabaseBackend() : localBackend();
  await backend.init();
  return backend;
}
