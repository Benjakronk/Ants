# Uploads MAUR to the VPS, installs it and (re)starts it under pm2. Run from anywhere:
#
#   powershell -ExecutionPolicy Bypass -File deploy\upload.ps1           # server + game
#   powershell -ExecutionPolicy Bypass -File deploy\upload.ps1 -Public   # only index.html + js/ (no restart)
#
# Needs deploy/root-setup.sh to have run once (it makes /srv/maur and the data dir).
# The raw IP is used on purpose: on the Windows laptop only 159.195.215.124 is
# in known_hosts (see VPS-deploy/README-add-service.md, "More gotchas").
# The school network drops port 22: use a phone hotspot.
#
# NEVER uploaded: server/.env, node_modules/, the worlds in /srv/maur/data.
# NB: the server loads the sim from public/js, so a -Public upload of sim files
# (worldgen/terrain/entities/colony/game/save/netproto) needs a full upload + restart.

param([switch]$Public)

$ErrorActionPreference = 'Stop'
$HostAddr = 'admin@159.195.215.124'
$Dest = '/srv/maur'

Set-Location (Split-Path $PSScriptRoot -Parent)

# scp/ssh are native programs: 'Stop' above does not catch their failures.
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)." } }

# Fail before uploading anything, so the box never gets half a release.
ssh -o ConnectTimeout=10 -o BatchMode=yes $HostAddr true
Check 'SSH to the VPS (switch to the phone hotspot) - nothing uploaded;'

if (-not $Public) {
    # the quick headless checks: the sim runs in Node, the server boots and plays
    node test/nodesim.js 1
    if ($LASTEXITCODE -ne 0) { throw 'nodesim failed - nothing uploaded.' }

    $files = 'server/server.js', 'server/config.js', 'server/room.js', 'server/sim.js',
             'server/snapshot.js', 'server/store.js', 'server/package.json',
             'server/package-lock.json', 'server/.env.example'
    scp $files "${HostAddr}:${Dest}/server/"; Check 'Upload of server files'
    scp deploy/ecosystem.config.cjs deploy/nginx-maur.conf deploy/backup-maur.sh deploy/root-setup.sh deploy/README.md `
        "${HostAddr}:${Dest}/deploy/"; Check 'Upload of deploy/'
}

scp index.html "${HostAddr}:${Dest}/public/"; Check 'Upload of index.html'
scp -r js "${HostAddr}:${Dest}/public/"; Check 'Upload of js/'
ssh $HostAddr "chmod -R u+rwX,go+rX,go-w $Dest/public"; Check 'chmod of public/'

if ($Public) {
    Write-Host 'index.html + js/ uploaded. No restart (but see the NB above for sim files).'
    exit 0
}

# install and (re)start, all as admin - no sudo needed. Single quotes: PowerShell
# must not expand the $ in the remote commands.
$remote = @'
set -e
cd /srv/maur/server
chmod -R u+rwX /srv/maur/server /srv/maur/deploy
npm ci --omit=dev --no-audit --no-fund
[ -f .env ] || { cp .env.example .env; sed -i 's|^#DATA_DIR=.*|DATA_DIR=/srv/maur/data|; s|^#STATIC_DIR=.*|STATIC_DIR=/srv/maur/public|' .env; chmod 600 .env; echo "made server/.env"; }
grep -q '^MAUR_DEV' .env && { echo "MAUR_DEV is set in .env - refusing to start"; exit 1; }
node --check server.js
cd /srv/maur
if pm2 describe maur >/dev/null 2>&1; then pm2 restart maur --update-env; else pm2 start deploy/ecosystem.config.cjs; fi
pm2 save
sleep 2
pm2 logs maur --lines 8 --nostream
curl -s http://127.0.0.1:3006/api/health; echo
'@
ssh $HostAddr ($remote -replace "`r", ''); Check 'Install/start on the box'

Write-Host ''
Write-Host 'Deployed. From outside:  curl -s https://maur.lektorensrud.no/api/health'
