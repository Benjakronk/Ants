#!/bin/bash
# Nightly backup of MAUR's persistent worlds (the JSON saves in DATA_DIR).
# Modelled on VPS-deploy/templates/backup-service.sh. Runs as the user that
# runs pm2 (it owns the data dir). The server writes each save atomically
# (temp file + rename), so a copy taken at any moment holds whole files;
# the half-written *.tmp is left out.
#   sudo cp deploy/backup-maur.sh /usr/local/bin/backup-maur.sh && sudo chmod +x /usr/local/bin/backup-maur.sh
#   sudo mkdir -p /var/backups/maur && sudo chown admin:admin /var/backups/maur
#   /usr/local/bin/backup-maur.sh                 # test once by hand
#   crontab -e
#     50 2 * * * /usr/local/bin/backup-maur.sh >> /var/log/maur-backup.log 2>&1
# Restore: pm2 stop maur; tar -xzf /var/backups/maur/maur-<date>.tar.gz -C /srv/maur; pm2 start maur
set -euo pipefail
DATA="/srv/maur/data"
DIR="/var/backups/maur"
KEEP_DAYS=14
tar -czf "$DIR/maur-$(date +%F).tar.gz" -C "$(dirname "$DATA")" --exclude='*.tmp' "$(basename "$DATA")"
find "$DIR" -name "maur-*.tar.gz" -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok: maur ($(ls "$DATA"/*.json 2>/dev/null | wc -l) world(s))"
