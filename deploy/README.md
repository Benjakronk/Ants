# Deploying MAUR (Phase 5 -- not done yet)

Target: `https://maur.lektorensrud.no` (DNS pending), one pm2 process on
port 3006 serving `/api/*` and the WebSocket on `/ws`, nginx serving the
static game. Follow `../../VPS-deploy/README-add-service.md` (section
"WebSocket services"); check `ss -ltn | grep ':3006'` on the box first and
claim the port in the runbook's table.

## Layout on the box

```
/srv/maur/server/   server.js config.js room.js sim.js snapshot.js
                    package.json package-lock.json .env.example (.env made there)
/srv/maur/public/   index.html  js/          <- nginx root; the server loads
                                                the sim from public/js too
/srv/maur/deploy/   ecosystem.config.cjs nginx-maur.conf README.md
```

## Files to copy (PowerShell, from the repo root; never node_modules, .git, .env)

```powershell
ssh admin@<host> "mkdir -p /srv/maur/server /srv/maur/public /srv/maur/deploy"
scp server/server.js server/config.js server/room.js server/sim.js server/snapshot.js `
    server/package.json server/package-lock.json server/.env.example admin@<host>:/srv/maur/server/
scp -r index.html js admin@<host>:/srv/maur/public/
scp deploy/ecosystem.config.cjs deploy/nginx-maur.conf deploy/README.md admin@<host>:/srv/maur/deploy/
```

## On the box

```bash
cd /srv/maur/server && npm ci --omit=dev
cp .env.example .env                       # PORT=3006, HOST=127.0.0.1; never MAUR_DEV
chmod -R u+rwX,go+rX,go-w /srv/maur/public
cd /srv/maur && pm2 start deploy/ecosystem.config.cjs
pm2 logs maur --lines 20 --nostream        # "maur listening on 127.0.0.1:3006"
curl -s http://127.0.0.1:3006/api/health   # {"ok":true,"rooms":0,"players":0,"uptime":...}
pm2 save
```

Then nginx (`deploy/nginx-maur.conf`: add the `maur` rate-limit zone first),
certbot once DNS resolves, and an UptimeRobot keyword monitor on
`https://maur.lektorensrud.no/api/health` (keyword `"ok":true`). Test the
socket by leaving a match idle for more than 60 s (the proxy timeouts).

## Updating

Copy the changed files again (the server's `.env` is never in the list),
`npm ci --omit=dev` if package.json changed, `pm2 restart maur`. Running
matches are lost on a restart (persistent worlds come in Phase 4b).
