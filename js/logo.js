// The opening logo, "Lektor Ensrud presenterer": the same sequence as
// Aasen-spelet's js/rpg/opning.js (Opning.logo), with its art. The gold
// footprint is pressed down in three frames, the name appears letter by
// letter from the top, a shine runs over the gold, a second of stillness,
// then a swarm of ants eats the logo away to uncover the title (below).
// Enter, Space, Z, X or Esc skips it. With prefers-reduced-motion it comes
// in with one fade, no shine, and fades out (16 steps, two frames each, like
// the Super Nintendo) instead of the ants.
//
// main.js plays it on page load before the title starts. Automated browsers
// (navigator.webdriver: the Playwright tests) skip it, so they still begin on
// the title. The images are inlined so the page needs no extra files.
const Logo = (function () {
  const FOOT = 'data:image/png;base64,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';
  const NAME = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAAAoCAYAAAB5LPGYAAADMUlEQVR4nO2bvW4UMRCA91BoUl0Rmki8Ac11SAiJB+A5qCnzBCglNRUPQRMpBVEEbZrUNFHSQEPBNhRGPm5OzmjHM7Nnr+3d+aSIrHc8M16Px3+k6wzDMJbKSiLk7j65rfDzdyJ5Lbn1TwW0g6P1dqbszyNWW9d1v++/b/89fnri+r+/kn+83PqnAtrB0Xo7U/anKABro/aMefr6S2kXmqHJAGwhY9bqV208Ke2AsWwsAI35TsHUrlC6dsNrPXiGKfjPjw/bYkqv1D5lR+tv6l3zirArrSdtF7empt5Tfkg3Y9kDkHJEunbDaz2sDz9jvVL7nJ3cu38Kyq60nrRd3Jqaeq8JtEkDMBwx3mn8HjKXZMSF9dcvP2+fH67fRnebY+2H5UP1pODMDFDtPSXagf3k2sX5c2i7AM4P6J9iASgYUW7MiPPsnveN1taP2U+1ux6T+XuBn2P9S31qINDnqpiCqUxAdVDqkVrq/C7XOeB6NwOkyrA1UGQNWPP5Xiq7ufzv/2dClyLDzj4AtSMP5Lk14tJZ7zIhLm/xu2W/CdGOvHCE13zTUZp+xNq6RopcxXHnTnit09KINhoIQMlazzLhMlAFILX7AiBTSXZrh+xyKf1T2U/1nbRIbkDGtIv7XngzqZVPFoCak/uxuzUpQ/qntJ/jhqOUXu57pZCnEDsrHVn4A1D1KDlpOaU/tX0t2u90LGwfluf0UvUP9V/6fSl5wzAMwzAMwzAMwzAMw5gLN7du8v/L2Cr2V3EZuLi8Eh9IL50m/zCdyzibF6sVlPvf4X1YjmU5PbEyXO4D8NvNT//oOB0boX+UrFEB5x+/Op9x4Ac6yZfD7/gdfsblnDxlM/buEP/OB2S7GTCLDIjvHS8ur/Yd9Grz7NElvX8XBgtMl2F2CTMMJU/ZDO8+OZudwr8h2TkwqwCkwB3mO3IIH3TQ2TDlxeQ1xHT0Qv+GZFtnEQEY68gw0KgsSsirp0CNjj6BvRaYTQDCoh9nMszZ+zcw1T6S3dXfA+WUfMyXsI6X1+g4G2HPKAxe9IcdRnUeJTtUHpPHMkN1NDrGyBqVBGBpPww9dhBtGCmwDNg1yT8pCvHxMc05pwAAAABJRU5ErkJggg==';
  // each letter's box [x0, y0, x1, y1] in NAME, in writing order
  const LETTERS = [[9,2,20,21],[19,2,32,21],[31,2,42,21],[41,2,52,21],[51,2,64,21],[63,2,74,21],[73,2,94,21],[93,2,106,21],[105,2,118,21],[117,2,128,21],[127,2,140,21],[139,2,152,21],[49,28,55,40],[54,28,60,40],[59,28,66,40],[65,28,72,40],[71,28,78,40],[77,28,84,40],[83,28,89,40],[88,28,95,40],[94,28,100,40],[99,28,106,40],[105,28,111,40]];
  const W = 320, H = 200, BG = '#0a0806';
  const FW = 68, FH = 98, FX = (W - FW) / 2, FY = 22, NX = (W - 160) / 2, NY = 128;
  const SKIP = ['Enter', 'Space', 'KeyZ', 'KeyX', 'Escape'];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

  async function play(canvas) {
    if (navigator.webdriver) return;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    const [foot, name] = await Promise.all([load(FOOT), load(NAME)]);
    let skipped = false;
    const onKey = e => { if (SKIP.includes(e.code)) { skipped = true; e.preventDefault(); } };
    window.addEventListener('keydown', onKey, true);
    let fr = -1, written = 0, part = 0;          // footprint frame, letter, how much of it (0-2)
    const draw = () => {
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      if (foot && fr >= 0) g.drawImage(foot, fr * FW, 0, FW, FH, FX, FY, FW, FH);
      if (name) LETTERS.forEach(([x0, y0, x1, y1], i) => {
        const h = i < written ? y1 - y0 : i === written ? Math.round((y1 - y0) * part / 2) : 0;
        if (h > 0) g.drawImage(name, x0, y0, x1 - x0, h, NX + x0, NY + y0, x1 - x0, h);
      });
    };
    const hold = async (frames, n = 1) => { for (let i = 0; i < n && !skipped; i++) { draw(); await wait(frames * 17); } };
    const fade = async fadeIn => {
      for (let k = 0; k <= 16; k++) {
        draw();
        const a = fadeIn ? (16 - k) / 16 : k / 16;
        if (a > 0) { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(0, 0, W, H); }
        await wait(33);
      }
    };
    const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    try {
      if (reduced) {
        fr = 3; written = LETTERS.length; await fade(true);
      } else {
        await hold(20);
        for (fr = 0; fr < 3 && !skipped; fr++) await hold(4);       // the foot coming down
        fr = 3; await hold(24);
        for (written = 0; written < LETTERS.length && !skipped; written++) {
          for (part = 1; part <= 2 && !skipped; part++) await hold(2);
        }
        written = LETTERS.length; await hold(16);
        for (fr = 4; fr < 8 && !skipped; fr++) await hold(4);       // the shine over the gold
        fr = 3;
      }
      await hold(60);                                                // a second of stillness
      if (!skipped && reduced) await fade(false);
      else if (!skipped) { startEating(canvas); return; }            // the ants take it from here
    } finally {
      window.removeEventListener('keydown', onKey, true);
    }
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  }

  // ---- the ants eat the logo away ----------------------------------------
  // The finished logo frame becomes a layer over the live title screen. A
  // swarm comes in from all four edges; each ant walks to a nearby uneaten
  // 8x8 cell, chews it out of the layer (a ragged round bite, gold crumbs)
  // and picks the next, so the menu shows through from the outside in. Once
  // every cell is gone the ants scurry off the nearest edge. main.js calls
  // step() each sim step and draw() after the screen; a key press while the
  // ants are still eating clears the rest at once.
  const CELL = 8, CW = W / CELL, CH = H / CELL, SWARM = 64;
  let layer = null, lg = null, cells = null, left = 0, ants = [], crumbs = [], t = 0;

  function startEating(canvas) {
    layer = document.createElement('canvas'); layer.width = W; layer.height = H;
    lg = layer.getContext('2d');
    lg.drawImage(canvas, 0, 0);
    lg.globalCompositeOperation = 'destination-out';
    cells = new Uint8Array(CW * CH).fill(1);
    left = cells.length; ants = []; crumbs = []; t = 0;
    for (let i = 0; i < SWARM; i++) {
      const side = i % 4, r = Math.random();
      const soldier = Math.random() < 0.2;
      ants.push({
        x: side === 0 ? -10 : side === 1 ? W + 10 : r * W,
        y: side === 2 ? -10 : side === 3 ? H + 10 : r * H,
        wait: Math.floor(Math.random() * 30),                         // they arrive in a ragged stream
        speed: (soldier ? 1.5 : 1.9) + Math.random() * 0.6,
        caste: soldier ? 'soldier' : 'worker',
        tx: -1, ty: -1, cell: -1, chew: 0, phase: Math.random() * 6, ang: 0, gone: false,
      });
    }
  }

  // the next bite: an uneaten cell in the nearest ring around the ant (so it
  // chews a growing edge), else the nearest of a random handful (so the swarm
  // spreads out when its patch is done)
  function pickCell(a) {
    const acx = Math.floor(a.x / CELL), acy = Math.floor(a.y / CELL);
    for (let r = 0; r <= 3; r++) {
      const ring = [];
      for (let y = acy - r; y <= acy + r; y++) for (let x = acx - r; x <= acx + r; x++) {
        if (Math.max(Math.abs(x - acx), Math.abs(y - acy)) !== r) continue;
        if (x >= 0 && x < CW && y >= 0 && y < CH && cells[y * CW + x]) ring.push(y * CW + x);
      }
      if (ring.length) return ring[Math.floor(Math.random() * ring.length)];
    }
    let best = -1, bd = Infinity;
    for (let k = 0; k < 40; k++) {
      const c = Math.floor(Math.random() * cells.length);
      if (!cells[c]) continue;
      const cx = (c % CW + 0.5) * CELL, cy = (Math.floor(c / CW) + 0.5) * CELL;
      const d = (cx - a.x) ** 2 + (cy - a.y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best < 0) for (let c = 0; c < cells.length; c++) if (cells[c]) { best = c; break; }
    return best;
  }

  function bite(c) {
    if (!cells[c]) return;
    cells[c] = 0; left--;
    const cx = (c % CW + 0.5) * CELL, cy = (Math.floor(c / CW) + 0.5) * CELL;
    lg.beginPath();
    lg.arc(cx + Math.random() * 2 - 1, cy + Math.random() * 2 - 1, 6 + Math.random() * 1.5, 0, Math.PI * 2);
    lg.fill();
    for (let i = 0; i < 2; i++) {
      crumbs.push({ x: cx, y: cy, vx: Math.random() * 1.6 - 0.8, vy: -Math.random() * 1.2, life: 14 + Math.random() * 10 });
    }
  }

  function step(pressed) {
    if (!layer) return;
    t++;
    if (left > 0 && pressed && Object.keys(pressed).some(k => pressed[k])) {
      for (const k in pressed) pressed[k] = false;                   // the skip key is used up
      finish(); return;
    }
    let onScreen = 0;
    for (const a of ants) {
      if (a.gone) continue;
      if (a.wait > 0) { a.wait--; onScreen++; continue; }
      if (a.chew > 0) {                                               // chewing a cell out
        if (--a.chew === 0) { bite(a.cell); a.cell = -1; }
        onScreen++; continue;
      }
      if (a.cell < 0 || !cells[a.cell]) {                             // pick the next bite, or leave
        a.cell = left > 0 ? pickCell(a) : -1;
        if (a.cell >= 0) { a.tx = (a.cell % CW + 0.5) * CELL; a.ty = (Math.floor(a.cell / CW) + 0.5) * CELL; }
        else {
          const ex = a.x < W / 2 ? -20 : W + 20, ey = a.y < H / 2 ? -20 : H + 20;
          if (Math.abs(ex - a.x) < Math.abs(ey - a.y)) { a.tx = ex; a.ty = a.y; } else { a.tx = a.x; a.ty = ey; }
        }
      }
      const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      if (a.cell >= 0 && d < 3) { a.chew = 2; onScreen++; continue; }
      const sp = a.cell < 0 ? a.speed * 1.4 : a.speed;
      a.ang = Math.atan2(dy, dx);
      a.x += Math.cos(a.ang) * sp + (Math.random() - 0.5) * 0.6;    // a little ant wobble
      a.y += Math.sin(a.ang) * sp + (Math.random() - 0.5) * 0.6;
      a.phase += 0.5;
      if (a.cell < 0 && (a.x < -16 || a.x > W + 16 || a.y < -16 || a.y > H + 16)) { a.gone = true; continue; }
      onScreen++;
    }
    for (const c of crumbs) { c.x += c.vx; c.y += c.vy; c.vy += 0.15; c.life--; }
    crumbs = crumbs.filter(c => c.life > 0);
    if (left === 0 && !onScreen && !crumbs.length) finish();
  }

  function draw(ctx) {
    if (!layer) return;
    ctx.drawImage(layer, 0, 0);
    ctx.fillStyle = '#d8a848';
    for (const c of crumbs) ctx.fillRect(Math.round(c.x), Math.round(c.y), 1, 1);
    for (const a of ants) {
      if (a.gone || a.wait > 0) continue;
      const fake = {
        x: 0, y: 0, dir: 1, phase: a.phase, def: CASTE[a.caste], caste: a.caste,
        flash: 0, biteAnim: a.chew > 0 ? 6 : 0, climbing: false, carry: null, playerIdx: -1,
      };
      ctx.save();
      ctx.translate(Math.round(a.x), Math.round(a.y));
      ctx.rotate(a.ang);
      if (Math.abs(a.ang) > Math.PI / 2) ctx.scale(1, -1);           // keep the legs on the near side
      Ant.prototype.draw.call(fake, ctx, 0, 0);
      ctx.restore();
    }
  }

  function finish() { layer = null; lg = null; cells = null; ants = []; crumbs = []; }

  return {
    play, step, draw, finish,
    active: () => !!layer,                 // the layer (or departing ants) is still up
    blocking: () => !!layer && left > 0,   // the menu is still being uncovered: no menu input
  };
})();
