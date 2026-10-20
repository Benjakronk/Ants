#!/bin/bash
# One-time root part of the MAUR install (README-add-service.md steps 3, 6, 7
# and the backup cron in one go). Safe to re-run: every step skips itself if
# already done. sudo asks for a password, so run it yourself in a real terminal:
#
#   ssh admin@159.195.215.124 'mkdir -p ~/maur-setup'
#   scp -r deploy admin@159.195.215.124:~/maur-setup/
#   ssh -t admin@159.195.215.124 "sudo bash ~/maur-setup/deploy/root-setup.sh"
#
# Afterwards, as admin (no sudo): deploy\upload.ps1 uploads, installs and
# starts the server under pm2.
set -euo pipefail

OWNER="${SUDO_USER:-admin}"
SRC="$(cd "$(dirname "$0")" && pwd)"
SITE=maur.lektorensrud.no
PORT=3006
VPS_IP=159.195.215.124

echo "== 1/6 port $PORT"
if ss -ltn | grep -q ":$PORT "; then
  if pgrep -f "/srv/maur/server/server.js" >/dev/null; then
    echo "$PORT is held by maur itself - fine"
  else
    echo "PORT $PORT IS TAKEN by something else - stop and pick another port"; exit 1
  fi
else
  echo "$PORT is free"
fi

echo "== 2/6 /srv/maur (+ data, owned by $OWNER)"
mkdir -p /srv/maur/server /srv/maur/public /srv/maur/deploy /srv/maur/data
chown -R "$OWNER:$OWNER" /srv/maur
chmod 700 /srv/maur/data

echo "== 3/6 rate-limit zone"
if grep -q 'zone=maur:' /etc/nginx/conf.d/ratelimit.conf; then
  echo "maur zone already there"
else
  cat >> /etc/nginx/conf.d/ratelimit.conf <<'EOF'
# MAUR. Its OWN zone (only /api/ is limited; the game itself is static + /ws).
limit_req_zone $binary_remote_addr zone=maur:10m rate=20r/s;
EOF
fi

echo "== 4/6 nginx site"
if [ -e "/etc/nginx/sites-available/$SITE" ]; then
  echo "site exists - NOT re-copied (certbot has edited it)"
else
  cp "$SRC/nginx-maur.conf" "/etc/nginx/sites-available/$SITE"
  ln -s "/etc/nginx/sites-available/$SITE" /etc/nginx/sites-enabled/
fi
nginx -t
systemctl reload nginx

echo "== 5/6 TLS"
if certbot certificates 2>/dev/null | grep -q "Domains: $SITE"; then
  echo "certificate exists"
elif [ "$(getent ahostsv4 "$SITE" | awk 'NR==1{print $1}')" != "$VPS_IP" ]; then
  echo "SKIPPED: $SITE does not resolve to $VPS_IP yet. Fix the A record, then re-run this script."
else
  certbot --nginx -d "$SITE" --non-interactive --redirect
fi

echo "== 6/6 backup (as $OWNER, nightly 02:50)"
install -m 755 "$SRC/backup-maur.sh" /usr/local/bin/backup-maur.sh
mkdir -p /var/backups/maur
chown "$OWNER:$OWNER" /var/backups/maur
touch /var/log/maur-backup.log
chown "$OWNER:$OWNER" /var/log/maur-backup.log
( crontab -u "$OWNER" -l 2>/dev/null | grep -v backup-maur || true
  echo "50 2 * * * /usr/local/bin/backup-maur.sh >> /var/log/maur-backup.log 2>&1"
) | crontab -u "$OWNER" -

echo
echo "Root part done. Tell Claude to continue."
