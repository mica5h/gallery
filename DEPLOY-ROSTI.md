# Deploying to Rosti.cz

A practical guide for putting this app on [Rosti.cz](https://rosti.cz) — a Czech
Node.js host with a **30-day free trial (no credit card)**.

Unlike free PaaS tiers (Render/Fly), Rosti containers have a **persistent disk**,
so uploaded images in `uploads/` and the JSON store in `data/` survive restarts.
**You do NOT need Supabase here** — the default local storage backend just works.

---

## Connection details (this deployment)

| | |
|---|---|
| SSH | `ssh -p 14206 app@ssh.rosti.cz` |
| SSH URI | `ssh://app@ssh.rosti.cz:14206` |
| SFTP URI | `sftp://app@ssh.rosti.cz:14206` |
| App dir | `/srv/app` |
| Logs | `/srv/log/node.log` |

Throughout this guide, `<PORT>` is **14206** and the host is `ssh.rosti.cz` (user `app`).

### Reset the admin password to `admin` / `changeme`

Backs up the current users file, writes a fresh bcrypt hash, and restarts:

```bash
ssh -p 14206 app@ssh.rosti.cz 'cd /srv/app && cp -a data/users.json data/users.json.bak-$(date +%Y%m%d-%H%M%S) && node -e "const b=require(\"bcryptjs\"),fs=require(\"fs\");fs.writeFileSync(\"data/users.json\",JSON.stringify({users:[{username:\"admin\",passwordHash:b.hashSync(\"changeme\",10)}]},null,2)+\"\n\")" && supervisorctl restart app && supervisorctl status app'
```

Then log in at `/admin` and change it via **Change password**.

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

If you deployed by **cloning the repo** (step 3, primary path), updates are a
`git pull`:

```bash
ssh -p <PORT> app@ssh.rosti.cz
cd /srv/app
git pull
npm install --omit=dev          # only needed if package.json changed
supervisorctl restart app
```

Your `data/*.json` and `uploads/` are gitignored, so `git pull` never touches
the live content or images.

### Updating an scp-deployed app (no `.git` on the server)

If you uploaded with `scp` (the alternative in step 3), `/srv/app` is **not** a
git repository and `git pull` fails with `fatal: not a git repository`. Update by
copying only the source files that changed, straight from your laptop. **Never
copy `data/` or `uploads/`** — those hold the live content and images and are not
in git.

1. From your local repo, find what changed since the deployed version:

   ```bash
   git diff --stat <deployed-commit> HEAD     # or: git log --oneline
   ```

2. `scp` each changed file to the same path under `/srv/app` (the port is the
   per-app SSH port from the Rosti admin panel → app detail):

   ```bash
   scp -P <PORT> public/js/main.js     app@ssh.rosti.cz:/srv/app/public/js/main.js
   scp -P <PORT> public/css/styles.css app@ssh.rosti.cz:/srv/app/public/css/styles.css
   scp -P <PORT> public/index.html     app@ssh.rosti.cz:/srv/app/public/index.html
   scp -P <PORT> server.js             app@ssh.rosti.cz:/srv/app/server.js
   ```

   > Tip: back up the files you're about to overwrite first, e.g.
   > `ssh -p <PORT> app@ssh.rosti.cz 'cd /srv/app && cp -a --parents server.js public .deploy-backup/'`

3. If `package.json` / `package-lock.json` changed, reinstall deps on the server:

   ```bash
   ssh -p <PORT> app@ssh.rosti.cz 'cd /srv/app && npm install --omit=dev'
   ```

4. Restart and verify:

   ```bash
   ssh -p <PORT> app@ssh.rosti.cz 'supervisorctl restart app && supervisorctl status app'
   ```

   Optionally confirm an upload is byte-identical by comparing checksums —
   `md5sum <file>` on the server should match `md5 -q <file>` (macOS) /
   `md5sum <file>` (Linux) locally.

> **Want `git pull` updates instead?** Convert the directory to a real checkout
> once: on the server, `cd /srv/app && git init && git remote add origin
> https://<PAT>@github.com/mica5h/gallery.git && git fetch origin && git reset
> origin/main && git checkout -- .`. Untracked `data/` and `uploads/` are left
> untouched, and future updates become a plain `git pull`.

### Deliberately pushing content (`data/gallery.json` + images)

The rule above — *never copy `data/` or `uploads/`* — protects content edited
**on the server** via the admin panel. If instead you curated the content
**locally** and want to publish it, you can push it, but mind two things:

1. **It overwrites live content.** `scp`-ing `data/gallery.json` replaces whatever
   is live (including admin-panel edits). Back up the remote copy first:

   ```bash
   ssh -p <PORT> app@ssh.rosti.cz 'cd /srv/app && cp -a data/gallery.json data/gallery.json.bak-$(date +%Y%m%d-%H%M%S)'
   scp -P <PORT> data/gallery.json app@ssh.rosti.cz:/srv/app/data/gallery.json
   ssh -p <PORT> app@ssh.rosti.cz 'supervisorctl restart app'
   ```

2. **Ship the images it references, too.** `gallery.json` points at files in
   `uploads/`. Pushing the JSON without the new images leaves them **404** (broken
   thumbnails, blank work tiles). `scp` every newly-referenced file:

   ```bash
   scp -P <PORT> uploads/<new-image>.jpg app@ssh.rosti.cz:/srv/app/uploads/
   ```

   Verify each one serves before calling it done:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/uploads/<new-image>.jpg
   ```

   Static files need no restart — only `data/*.json` changes do.