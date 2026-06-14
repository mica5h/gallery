# Deploying to Rosti.cz

A practical guide for putting this app on [Rosti.cz](https://rosti.cz) — a Czech
Node.js host with a **30-day free trial (no credit card)**.

Unlike free PaaS tiers (Render/Fly), Rosti containers have a **persistent disk**,
so uploaded images in `uploads/` and the JSON store in `data/` survive restarts.
**You do NOT need Supabase here** — the default local storage backend just works.

---

## 1. Create the application

1. Sign up at <https://rosti.cz> and start the 30-day trial.
2. In the admin panel, create a new **Node.js** application.
3. Note the SSH connection details it gives you (host `ssh.rosti.cz`, a per-app
   **port**, user `app`).

## 2. Connect via SSH

```bash
ssh -p <YOUR_PORT> app@ssh.rosti.cz
```

(Optional) pick a Node version — this app needs **Node ≥ 20**:

```bash
rosti          # interactive tool; choose Node 22 (or 20)
```

## 3. Upload the code into /srv/app

The app lives in `/srv/app`. Easiest is to clone from GitHub. Because your repo
is **private**, use a GitHub Personal Access Token (PAT) with `repo` scope:

```bash
cd /srv
rm -rf app && mkdir app && cd app
git clone https://<YOUR_PAT>@github.com/mica5h/gallery.git .
git checkout feature/artist-presentation   # or main, once merged
```

> Alternative without a PAT: from your laptop, `scp -P <PORT> -r ./gallery/* app@ssh.rosti.cz:/srv/app/`
> (don't copy `node_modules/`).

## 4. Install dependencies

```bash
cd /srv/app
npm install --omit=dev
```

## 5. Configure environment variables

Rosti requires the app to listen on **port 8080**, and you want a stable session
secret. Create `/srv/app/.env`:

```bash
cat > /srv/app/.env <<'ENV'
PORT=8080
NODE_ENV=production
SESSION_SECRET=CHANGE_ME_to_a_long_random_string
ENV
```

Generate a good secret with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

> Leave `SUPABASE_*` unset — local persistent storage is used automatically.

## 6. Make supervisor load the .env and start the app

Rosti runs the app under **supervisord**. Edit its config so Node loads `.env`:

```bash
nano /srv/conf/supervisor.d/app.conf
```

Set the `command` line to:

```ini
[program:app]
command=/opt/node/bin/node --env-file=/srv/app/.env /srv/app/server.js
directory=/srv/app
autostart=true
autorestart=true
stdout_logfile=/srv/log/node.log
redirect_stderr=true
```

> `--env-file` needs Node ≥ 20.6 (use Node 22 from step 2 to be safe).
> Don't want to edit the command? Instead add the vars to an `environment=`
> line in the same file, e.g. `environment=PORT="8080",NODE_ENV="production",SESSION_SECRET="..."`.

Apply and (re)start:

```bash
supervisorctl reread
supervisorctl update
supervisorctl restart app
supervisorctl status app          # should show RUNNING
tail -f /srv/log/node.log         # watch startup logs
```

On first boot the server seeds the artist content and a default admin user.
You should see `Storage backend: local` and `Gallery running ...` in the log.

## 7. Point your domain

In the Rosti admin panel, attach your domain (or use the free `*.rostiapp.cz`
subdomain) and enable HTTPS. `NODE_ENV=production` already makes the app trust the
proxy and set secure cookies.

## 8. Secure the admin

Open `https://<your-domain>/admin` and log in with the seeded credentials:

- **Username:** `admin`
- **Password:** `changeme`

Immediately use **Change password** in the admin panel. Then update the site
info, the Google Drive link (for the menu QR), and upload the real artworks.

---

## Updating later

```bash
ssh -p <PORT> app@ssh.rosti.cz
cd /srv/app
git pull
npm install --omit=dev
supervisorctl restart app
```

Your `data/*.json` and `uploads/` are gitignored, so `git pull` never touches
the live content or images.
