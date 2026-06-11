// MAUR -- WebAudio bleeps and crunches. PC-speaker spirit, AdLib budget.
'use strict';

const Sfx = {
  ctx: null,
  master: null,
  muted: false,
  _last: {},

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.22;
    return this.muted;
  },

  // square/saw blip helper
  _tone(freq, dur, type, vol, slide, delay) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },

  // short noise burst (digging, crunching)
  _noise(dur, vol, lp, delay) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp || 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  },

  // named effects, throttled so spam doesn't clip
  play(name) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const minGap = { dig: 70, bite: 90, step: 120, hurt: 80 }[name] || 30;
    if (this._last[name] && now - this._last[name] < minGap) return;
    this._last[name] = now;

    switch (name) {
      case 'dig':     this._noise(0.08, 0.5, 700); break;
      case 'clank':   this._tone(220, 0.06, 'square', 0.25, -80); this._noise(0.04, 0.3, 2500); break;
      case 'bite':    this._tone(160, 0.07, 'square', 0.4, -90); break;
      case 'hurt':    this._tone(300, 0.18, 'sawtooth', 0.45, -220); break;
      case 'kill':    this._tone(140, 0.25, 'sawtooth', 0.5, -110); this._noise(0.18, 0.4, 500); break;
      case 'die':     this._tone(440, 0.5, 'sawtooth', 0.5, -400); this._noise(0.4, 0.3, 400, 0.1); break;
      case 'pickup':  this._tone(523, 0.06, 'square', 0.35); this._tone(784, 0.08, 'square', 0.35, 0, 0.06); break;
      case 'drop':    this._tone(392, 0.06, 'square', 0.3, -100); break;
      case 'deposit': this._tone(523, 0.07, 'square', 0.35); this._tone(659, 0.07, 'square', 0.35, 0, 0.07);
                      this._tone(784, 0.12, 'square', 0.35, 0, 0.14); break;
      case 'task':    this._tone(523, 0.09, 'square', 0.4); this._tone(659, 0.09, 'square', 0.4, 0, 0.09);
                      this._tone(784, 0.09, 'square', 0.4, 0, 0.18); this._tone(1047, 0.2, 'square', 0.4, 0, 0.27); break;
      case 'hatch':   this._tone(660, 0.08, 'triangle', 0.4); this._tone(880, 0.14, 'triangle', 0.4, 0, 0.09); break;
      case 'lay':     this._tone(330, 0.1, 'triangle', 0.35); this._tone(415, 0.12, 'triangle', 0.35, 0, 0.1); break;
      case 'menu':    this._tone(700, 0.04, 'square', 0.3); break;
      case 'select':  this._tone(880, 0.05, 'square', 0.35); this._tone(1175, 0.08, 'square', 0.35, 0, 0.05); break;
      case 'danger':  this._tone(196, 0.22, 'sawtooth', 0.4, -40); this._tone(185, 0.22, 'sawtooth', 0.4, -40, 0.24); break;
      case 'milk':    this._tone(988, 0.05, 'sine', 0.4); this._tone(1319, 0.1, 'sine', 0.4, 0, 0.06); break;
      case 'save':    this._tone(440, 0.05, 'square', 0.3); this._tone(440, 0.05, 'square', 0.3, 0, 0.09); break;
      case 'starve':  this._tone(233, 0.3, 'triangle', 0.4, -60); break;
      case 'step':    this._noise(0.02, 0.06, 1500); break;
    }
  }
};
