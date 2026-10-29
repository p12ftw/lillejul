// Musik på storskärmen.
// Egna MP3-filer (uppladdade i admin) används om de finns, annars spelas
// egenkomponerad julmusik som genereras direkt i webbläsaren (Web Audio).

const KEY = 'quiz-music-muted';
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

// ---- Låtar (egna kompositioner) -------------------------------------------
// Steg = åttondelsnot. null = paus.
const SONGS = {
  lobby: {
    bpm: 112,
    chords: [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]],   // C  Am  F  G
    melody: [
      72, null, 76, 79, 76, null, 74, 72,
      69, null, 72, 76, 74, 72, 69, null,
      65, 69, 72, null, 77, 76, 74, 72,
      74, null, 71, 67, 69, 71, 74, null,
      72, 74, 76, null, 79, null, 81, 79,
      76, null, 72, null, 74, 76, 72, null,
      77, null, 76, 74, 72, null, 69, 72,
      71, 72, 74, 71, 67, null, null, null,
    ],
    bells: [1, 0, 1, 0, 1, 0, 1, 1],
  },
  question: {
    bpm: 150,
    chords: [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]],   // Am F C G
    melody: [
      76, null, 76, null, 77, 76, 74, null,
      72, null, 72, null, 74, 72, 69, null,
      72, null, 76, null, 79, 77, 76, null,
      74, 76, 74, 71, 74, null, null, null,
    ],
    bells: [1, 1, 1, 1, 1, 1, 1, 1],
    arp: true,
    tick: true,
  },
};

export class Music {
  constructor() {
    try { this.muted = localStorage.getItem(KEY) === '1'; } catch { this.muted = false; }
    this.mode = null;
    this.urls = {};
    this.el = null;
    this.ctx = null;
    this.song = null;
    this.blocked = false;
    this.onChange = () => {};
    const unlock = () => this.unlock();
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }

  get state() {
    if (this.muted) return 'muted';
    if (this.blocked && this.mode) return 'blocked';
    return 'on';
  }

  setUrls(urls) {
    this.urls = urls || {};
    if (this.mode) this.apply();
  }

  /** mode: 'lobby' | 'question' | null (tyst) */
  play(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.apply();
  }

  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem(KEY, this.muted ? '1' : '0'); } catch {}
    this.apply();
  }

  // ---- intern ----
  ensureCtx() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  unlock() {
    const c = this.ensureCtx();
    const wasBlocked = this.blocked;
    if (wasBlocked) this.unlockedAt = Date.now();
    if (c && c.state !== 'running') c.resume().then(() => { if (wasBlocked) this.apply(); }).catch(() => {});
    else if (wasBlocked) this.apply();
  }

  stopAll() {
    if (this.el) {
      const el = this.el; this.el = null;
      const fade = setInterval(() => {
        el.volume = Math.max(0, el.volume - 0.08);
        if (el.volume <= 0.01) { clearInterval(fade); el.pause(); el.src = ''; }
      }, 40);
    }
    if (this.song) {
      const s = this.song; this.song = null;
      clearInterval(s.timer);
      const t = this.ctx.currentTime;
      s.out.gain.cancelScheduledValues(t);
      s.out.gain.setValueAtTime(s.out.gain.value, t);
      s.out.gain.linearRampToValueAtTime(0, t + 0.5);
      setTimeout(() => s.out.disconnect(), 800);
    }
  }

  apply() {
    this.stopAll();
    this.blocked = false;
    if (this.muted || !this.mode) return this.onChange();

    const url = this.urls[this.mode];
    if (url) {
      const el = new Audio(url);
      el.loop = true;
      el.volume = 0.7;
      this.el = el;
      el.play().catch(() => { if (this.el === el) { this.blocked = true; this.onChange(); } });
    } else {
      const c = this.ensureCtx();
      if (!c) return this.onChange();
      if (c.state !== 'running') {
        c.resume().catch(() => {});
        setTimeout(() => { if (c.state !== 'running' && this.mode) { this.blocked = true; this.onChange(); } }, 300);
      }
      this.startSynth(SONGS[this.mode]);
    }
    this.onChange();
  }

  startSynth(song) {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    out.gain.linearRampToValueAtTime(1, c.currentTime + 0.6);
    out.connect(this.master);
    const stepDur = 60 / song.bpm / 2;          // åttondelar
    let step = 0;
    let next = c.currentTime + 0.05;
    const s = { out, timer: null };
    const schedule = () => {
      while (next < c.currentTime + 0.2) {
        this.playStep(song, step, next, stepDur, out);
        next += stepDur;
        step = (step + 1) % song.melody.length;
      }
    };
    schedule();
    s.timer = setInterval(schedule, 40);
    this.song = s;
  }

  playStep(song, step, t, d, out) {
    const bar = Math.floor(step / 8) % song.chords.length;
    const inBar = step % 8;
    const chord = song.chords[bar];

    // Bas på 1 och 3
    if (inBar === 0 || inBar === 4) this.tone(out, midi(chord[0] - 12), t, d * 3.5, 'triangle', 0.22);
    // Mjuk ackordmatta i början av takten
    if (inBar === 0) chord.forEach(n => this.tone(out, midi(n), t, d * 7.5, 'sine', 0.045));
    // Arpeggio (frågemusiken)
    if (song.arp) this.tone(out, midi(chord[inBar % 3] + 12), t, d * 0.9, 'square', 0.025, 1800);
    // Melodi som klockspel
    const m = song.melody[step];
    if (m) this.bell(out, midi(m), t, 0.11);
    // Bjällror
    if (song.bells[inBar]) this.jingle(out, t, inBar % 2 ? 0.05 : 0.08);
    // Tickande klocka på varje fjärdedel (frågemusiken)
    if (song.tick && inBar % 2 === 0) this.tone(out, inBar % 4 === 0 ? 1650 : 1250, t, 0.03, 'sine', 0.06);
  }

  tone(out, f, t, dur, type, vol, lowpass) {
    const c = this.ctx;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lowpass) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass; o.connect(lp); node = lp; }
    node.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  bell(out, f, t, vol) {
    // FM-klocka
    const c = this.ctx;
    const car = c.createOscillator(); const mod = c.createOscillator();
    const modGain = c.createGain(); const g = c.createGain();
    car.frequency.value = f; mod.frequency.value = f * 3.5;
    modGain.gain.setValueAtTime(f * 2, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + 0.8);
    mod.connect(modGain); modGain.connect(car.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    car.connect(g); g.connect(out);
    car.start(t); mod.start(t); car.stop(t + 1.3); mod.stop(t + 1.3);
  }

  jingle(out, t, vol) {
    const c = this.ctx;
    if (!this.noise) {
      const len = c.sampleRate * 0.2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = c.createBufferSource(); src.buffer = this.noise;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(hp); hp.connect(g); g.connect(out);
    src.start(t); src.stop(t + 0.15);
  }

  // ---- ljudeffekter ----
  fx(kind) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.01;
    if (kind === 'reveal') [72, 76, 79, 84].forEach((n, i) => this.bell(this.master, midi(n), t + i * 0.09, 0.16));
    if (kind === 'tick') this.tone(this.master, 1800, t, 0.05, 'sine', 0.12);
    if (kind === 'fanfare') [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.bell(this.master, midi(n), t + i * 0.12, 0.15));
  }
}
