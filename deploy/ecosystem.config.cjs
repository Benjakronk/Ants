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
    // a stop/restart sends SIGINT: the server saves every persistent world
    // (synchronously, ~50 ms each) before it exits -- give it time
    kill_timeout: 5000,
    env: { NODE_ENV: 'production', PORT: '3006', HOST: '127.0.0.1', DATA_DIR: '/srv/maur/data' },
  }],
};
