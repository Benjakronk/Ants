# Deploying MAUR (Phase 5 -- not done yet)

Target: `https://maur.lektorensrud.no` (DNS pending), one pm2 process on
port 3006 serving `/api/*` and the WebSocket on `/ws`, nginx serving the
static game. Follow `../../VPS-deploy/README-add-service.md` (section
"WebSocket services"); check `ss -ltn | grep ':3006'` on the box first and
claim the port in the runbook's table.

## Layout on the box

```
/srv/maur/server/   server.js config.js room.js sim.js snapshot.js store.js
                    package.json package-lock.json .env.example (.env made there)
/srv/maur/public/   index.html  js/          <- nginx root; the server loads
                                                the sim from public/js too
/srv/maur/data/     the persistent worlds' saves (maurtua.json + .bak):
                    writable by the pm2 user, NOT served, backed up nightly
/srv/maur/deploy/   ecosystem.config.cjs nginx-maur.conf backup-maur.sh README.md
```

One small box, shared with other services: assume MAUR may use about one
core. A busy 80-ant room costs ~2-3 ms per tick (~20% of a core), a sleeping
persistent world nothing. `MAX_ROOMS=4` and `CPU_BUDGET_MS=10` (ms of CPU
per 16.7 ms frame over all rooms, ~60% of a core) keep it there: past
either, new matches and joins get SERVER FULL. `/api/health` shows `load`.

## Files to copy (PowerShell, from the repo root; never node_modules, .git, .env)

```powershell
ssh admin@<host> "mkdir -p /srv/maur/server /srv/maur/public /srv/maur/deploy"
scp server/server.js server/config.js server/room.js server/sim.js server/snapshot.js server/store.js `
    server/package.json server/package-lock.json server/.env.example admin@<host>:/srv/maur/server/
scp -r index.html js admin@<host>:/srv/maur/public/
scp deploy/ecosystem.config.cjs deploy/nginx-maur.conf deploy/backup-maur.sh deploy/README.md admin@<host>:/srv/maur/deploy/
```

## On the box

```bash
cd /srv/maur/server && npm ci --omit=dev
cp .env.example .env                       # PORT=3006, HOST=127.0.0.1; never MAUR_DEV
                                           # DATA_DIR=/srv/maur/data, PERSIST_WORLDS=1 (or MAURTUA,ENGA)
mkdir -p /srv/maur/data && chmod 700 /srv/maur/data   # the pm2 user's, writable
chmod -R u+rwX,go+rX,go-w /srv/maur/public
cd /srv/maur && pm2 start deploy/ecosystem.config.cjs
pm2 logs maur --lines 20 --nostream        # "maur listening on 127.0.0.1:3006",
                                           # "world MAURTUA: new (...)", "saved (new, ...)"
curl -s http://127.0.0.1:3006/api/health   # {"ok":true,"rooms":0,"players":0,"uptime":...,"load":0,
                                           #  "budget":10,"full":false,"worlds":[{"name":"MAURTUA",...}]}
pm2 save
```

### The worlds' backups

The saves in `/srv/maur/data` are the only state worth keeping. Each is
written atomically (a temp file, then a rename; the previous save stays as
`.bak`), and a graceful stop -- `pm2 restart`/`stop` sends SIGINT -- saves
every world before the process exits (`kill_timeout` in the ecosystem file
gives it 5 s). Back the folder up nightly (`deploy/backup-maur.sh`, from
`VPS-deploy/templates/backup-service.sh`: a dated tar.gz kept 14 days):

```bash
sudo cp /srv/maur/deploy/backup-maur.sh /usr/local/bin/backup-maur.sh && sudo chmod +x /usr/local/bin/backup-maur.sh
sudo mkdir -p /var/backups/maur && sudo chown admin:admin /var/backups/maur
/usr/local/bin/backup-maur.sh             # test once: "backup ok: maur (1 world(s))"
crontab -e                                # 50 2 * * * /usr/local/bin/backup-maur.sh >> /var/log/maur-backup.log 2>&1
```

Restore: `pm2 stop maur`, untar the night's archive over `/srv/maur`
(`tar -xzf /var/backups/maur/maur-<date>.tar.gz -C /srv/maur`), `pm2 start
maur`. A save that won't parse or restore makes the server load its `.bak`
by itself; if neither loads, both are moved aside as `*.bad-<time>` (never
overwritten) and the world starts anew.

Then nginx (`deploy/nginx-maur.conf`: add the `maur` rate-limit zone first),
certbot once DNS resolves, and an UptimeRobot keyword monitor on
`https://maur.lektorensrud.no/api/health` (keyword `"ok":true`). Test the
socket by leaving a match idle for more than 60 s (the proxy timeouts).

## Updating

Copy the changed files again (the server's `.env` is never in the list,
nor `/srv/maur/data`), `npm ci --omit=dev` if package.json changed, `pm2
restart maur`. Running matches are lost on a restart; the persistent worlds
are saved on the way down and loaded on the way up (players in them
reconnect into the reloaded world: their old place is gone, they pick a
new ant). Saves from older builds load (the save format is versioned).
