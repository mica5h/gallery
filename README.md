# Gallery

A photo gallery with a single long public page (gallery info → pictures → a few words → contact footer) and a password-protected admin panel for uploading pictures and editing info.

- **Backend:** Node + Express
- **Auth:** username + password (session cookie)
- **Storage:** uploaded images in `uploads/`, all content/metadata in `data/gallery.json`

## Setup

```bash
cd ~/Projects/gallery
npm install
npm start          # http://localhost:3000   (admin at /admin)
# or: npm run dev  # auto-restart on file changes
```

## First login

On first run the server seeds a default admin user and gallery content:

- **Username:** `admin`
- **Password:** `changeme`

> ⚠️ **Change this immediately.** Stop the server, delete `data/users.json`, set
> the new password, and let it reseed — or generate a hash yourself. The simplest
> way to set a custom password:
>
> ```bash
> node -e "import('bcryptjs').then(b => console.log(b.default.hashSync('YOUR_PASSWORD', 10)))"
> ```
>
> Then put it in `data/users.json`:
>
> ```json
> { "users": [{ "username": "admin", "passwordHash": "<paste hash>" }] }
> ```

Set a stable session secret in production so sessions survive restarts:

```bash
SESSION_SECRET="some-long-random-string" npm start
```

## How it works

| Area | URL | Notes |
|------|-----|-------|
| Public page | `/` | Reads `/api/gallery`, renders sections + lightbox |
| Admin panel | `/admin` | Login, edit gallery info, upload / edit / delete pictures |

### Admin can:
- Edit the **title**, **intro**, **"a few words"** text, and **contact** (name / email / note)
- **Upload** pictures (JPEG/PNG/GIF/WEBP, up to 10 MB) with a title and description
- **Edit** a picture's title/description inline
- **Delete** a picture (also removes the file from disk)

## Project structure

```
gallery/
├── server.js              # Express server + API
├── package.json
├── data/                  # gallery.json + users.json (gitignored, seeded on first run)
├── uploads/               # uploaded images (gitignored)
└── public/
    ├── index.html         # public single-page site
    ├── css/styles.css
    ├── js/main.js
    └── admin/             # admin panel (html / css / js)
```

## Notes / next steps

- `data/` and `uploads/` are gitignored — they hold runtime data and the seeded
  credentials, so they're never committed.
- For real deployment, put this behind HTTPS and set `cookie.secure = true` in
  `server.js`, plus a persistent `SESSION_SECRET`.
