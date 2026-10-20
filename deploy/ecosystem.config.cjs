// pm2: MAUR's server (rooms, lobby, the authoritative sim over WebSocket).
// instances: 1 + fork is REQUIRED: every match lives in this process's memory.
// Layout on the box: /srv/maur/server (this repo's server/), /srv/maur/public
// (index.html + js/, served by nginx; the server loads the sim from public/js).
module.exports = {
  apps: [{
    name: 'maur',
    script: 'server/server.js',
    cwd: '/srv/maur',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    env: { NODE_ENV: 'production', PORT: '3006', HOST: '127.0.0.1' },
  }],
};
