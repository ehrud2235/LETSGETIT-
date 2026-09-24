// 효과음과 배경음. 모두 Web Audio 로 합성한다 (파일 없음).

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let muted = false;
let musicOn = true;
try {
  muted = localStorage.getItem('brawl.muted') === '1';
  musicOn = localStorage.getItem('brawl.music') !== '0';
} catch { /* 저장소 없음 */ }

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicOn ? 0.22 : 0;
    musicBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export const isMuted = () => muted;
export const isMusicOn = () => musicOn;

export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('brawl.muted', v ? '1' : '0'); } catch { /* 무시 */ }
  if (master) master.gain.setTargetAtTime(v ? 0 : 0.9, ctx.currentTime, 0.05);
}

export function setMusic(v) {
  musicOn = v;
  try { localStorage.setItem('brawl.music', v ? '1' : '0'); } catch { /* 무시 */ }
  if (musicBus) musicBus.gain.setTargetAtTime(v ? 0.22 : 0, ctx.currentTime, 0.1);
}

function env(g, t, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(freq, { at = 0, dur = 0.2, type = 'sine', vol = 0.2, slide = null, bus = null } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  env(g, t, 0.005, dur, vol);
  o.connect(g).connect(bus || sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

let noiseBuf = null;
function noise({ at = 0, dur = 0.2, vol = 0.2, type = 'bandpass', freq = 1000, q = 1, sweep = null, bus = null, attack = 0.005 } = {}) {
  if (!ctx) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, attack, dur, vol);
  src.connect(f).connect(g).connect(bus || sfxBus);
  src.start(t, Math.random());
  src.stop(t + dur + attack + 0.05);
}

let lastPlay = {};
function throttle(name, ms) {
  const now = performance.now();
  if (lastPlay[name] && now - lastPlay[name] < ms) return false;
  lastPlay[name] = now;
  return true;
}

const SFX = {
  punch: (power = 1) => {
    tone(140 + Math.random() * 40, { dur: 0.12, vol: 0.35 * power, slide: 55, type: 'sine' });
    noise({ dur: 0.08, vol: 0.3 * power, type: 'lowpass', freq: 1400 });
  },
  kick: () => {
    tone(90, { dur: 0.18, vol: 0.4, slide: 40 });
    noise({ dur: 0.12, vol: 0.3, type: 'lowpass', freq: 900 });
  },
  headbutt: () => {
    tone(220, { dur: 0.1, vol: 0.25, slide: 90, type: 'triangle' });
    tone(70, { dur: 0.22, vol: 0.4, slide: 35 });
  },
  swing: () => noise({ dur: 0.14, vol: 0.06, type: 'bandpass', freq: 700, sweep: 2600, q: 1.2 }),
  jump: () => tone(260, { dur: 0.16, vol: 0.12, slide: 520, type: 'triangle' }),
  grab: () => tone(520, { dur: 0.06, vol: 0.08, slide: 380, type: 'square' }),
  throw: () => noise({ dur: 0.35, vol: 0.18, type: 'bandpass', freq: 400, sweep: 2400, q: 0.8 }),
  slam: () => {
    tone(60, { dur: 0.35, vol: 0.5, slide: 30 });
    noise({ dur: 0.25, vol: 0.35, type: 'lowpass', freq: 600 });
  },
  ko: () => {
    [880, 1108, 1320].forEach((f, i) => tone(f, { at: i * 0.08, dur: 0.5, vol: 0.12, type: 'triangle' }));
    tone(1800, { at: 0.3, dur: 0.6, vol: 0.05, slide: 900 });
  },
  out: () => {
    tone(1200, { dur: 1.3, vol: 0.12, slide: 180, type: 'sine' });
    SFX.crowd(0.5);
  },
  bell: () => {
    for (const at of [0, 0.25, 0.5]) {
      tone(1320, { at, dur: 1.2, vol: 0.2 });
      tone(1320 * 2.76, { at, dur: 0.6, vol: 0.05 });
    }
  },
  beep: (hi) => tone(hi ? 1320 : 660, { dur: 0.18, vol: 0.18, type: 'square' }),
  crowd: (k = 1) => {
    noise({ dur: 1.6, vol: 0.12 * k, type: 'bandpass', freq: 1100, q: 0.6, attack: 0.15 });
    noise({ dur: 1.4, vol: 0.08 * k, type: 'bandpass', freq: 2400, q: 0.8, attack: 0.2 });
  },
  takedown: () => {
    tone(100, { dur: 0.3, vol: 0.45, slide: 45 });
    SFX.crowd(0.6);
  },
  tap: () => {
    for (let i = 0; i < 3; i++) tone(300, { at: i * 0.12, dur: 0.08, vol: 0.2, type: 'square' });
    SFX.crowd(1);
  },
  gust: () => noise({ dur: 2.4, vol: 0.12, type: 'bandpass', freq: 300, sweep: 900, q: 0.5, attack: 0.5 }),
  fence: () => {
    noise({ dur: 0.5, vol: 0.25, type: 'highpass', freq: 2000 });
    tone(180, { dur: 0.4, vol: 0.2, slide: 90, type: 'sawtooth' });
  },
  click: () => tone(900, { dur: 0.04, vol: 0.08, type: 'square' }),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.12, dur: 0.4, vol: 0.14, type: 'triangle' }));
    SFX.crowd(1.2);
  },
};

export function sfx(name, arg) {
  if (!ctx || muted) return;
  if (!throttle(name, name === 'punch' ? 40 : 60)) return;
  (SFX[name] || SFX.click)(arg);
}

/** 게임 이벤트 → 소리 */
export function soundForEvent(ev) {
  switch (ev.type) {
    case 'hit':
      if (ev.kind === 'foot') sfx('kick');
      else if (ev.kind === 'head') sfx('headbutt');
      else sfx('punch', Math.min(1.4, 0.6 + ev.dmg / 25));
      break;
    case 'swing': sfx('swing'); break;
    case 'jump': sfx('jump'); break;
    case 'grab': sfx('grab'); break;
    case 'throw': sfx('throw'); break;
    case 'slam': sfx('slam'); break;
    case 'ko': sfx('ko'); break;
    case 'out': sfx('out'); break;
    case 'fight': sfx('bell'); break;
    case 'roundEnd': sfx('win'); break;
    case 'takedown': sfx('takedown'); break;
    case 'suplex': sfx('slam'); break;
    case 'submitWin': sfx('tap'); break;
    case 'suddenDeath': sfx('bell'); break;
    case 'mapEvent':
      if (ev.what === 'gust') sfx('gust');
      if (ev.what === 'fenceDrop') sfx('fence');
      break;
    default:
  }
}

// ─── 배경음: 느긋한 펑키 루프 ────────────────────────────────────────────────
let musicTimer = null;
let step = 0;
const BPM = 104;
const BASS = [41, 0, 41, 44, 0, 46, 0, 44, 39, 0, 39, 41, 0, 44, 0, 36];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export function startMusic() {
  if (!ctx || musicTimer) return;
  const stepDur = 60 / BPM / 4;
  let next = ctx.currentTime + 0.1;
  musicTimer = setInterval(() => {
    while (next < ctx.currentTime + 0.3) {
      const at = next - ctx.currentTime;
      const s = step % 16;
      if (s % 4 === 0) tone(55, { at, dur: 0.22, vol: 0.5, slide: 38, bus: musicBus });
      if (s % 8 === 4) noise({ at, dur: 0.12, vol: 0.28, type: 'bandpass', freq: 1800, q: 0.7, bus: musicBus });
      if (s % 2 === 1) noise({ at, dur: 0.03, vol: 0.08, type: 'highpass', freq: 7000, bus: musicBus });
      const n = BASS[s];
      if (n) tone(midi(n), { at, dur: stepDur * 1.6, vol: 0.28, type: 'triangle', bus: musicBus });
      if (s === 0 && Math.floor(step / 16) % 2 === 1) {
        for (const c of [65, 68, 72]) tone(midi(c), { at, dur: stepDur * 6, vol: 0.05, type: 'sawtooth', bus: musicBus });
      }
      next += stepDur;
      step += 1;
    }
  }, 60);
}

export function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}
