// 효과음과 오르골 멜로디. 모두 Web Audio 로 합성한다 (외부 파일 없음).

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('otherside.muted') === '1'; } catch { /* 저장소 없음 */ }

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function isMuted() { return muted; }

export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('otherside.muted', v ? '1' : '0'); } catch { /* 무시 */ }
  if (master) master.gain.setTargetAtTime(v ? 0 : 0.8, ctx.currentTime, 0.05);
}

function tone(freq, { at = 0, dur = 0.3, type = 'sine', vol = 0.2, attack = 0.005, slideTo = null } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise({ at = 0, dur = 0.3, vol = 0.15, filter = 'bandpass', freq = 1200, q = 1, sweepTo = null } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

function bell(freq, at = 0, vol = 0.18, dur = 2.2) {
  tone(freq, { at, dur, vol });
  tone(freq * 2.01, { at, dur: dur * 0.6, vol: vol * 0.4 });
  tone(freq * 3.02, { at, dur: dur * 0.3, vol: vol * 0.15 });
}

function musicBoxNote(freq, at, vol = 0.16) {
  tone(freq, { at, dur: 1.4, vol, type: 'sine' });
  tone(freq * 4, { at, dur: 0.25, vol: vol * 0.25, type: 'sine' });
  tone(freq * 2, { at, dur: 0.6, vol: vol * 0.3, type: 'triangle' });
}

const SFX = {
  switch: () => { noise({ dur: 0.04, vol: 0.3, filter: 'highpass', freq: 2500 }); tone(1800, { dur: 0.03, vol: 0.05, type: 'square' }); },
  click: () => noise({ dur: 0.03, vol: 0.15, filter: 'highpass', freq: 3000 }),
  pickup: () => { tone(660, { dur: 0.12, vol: 0.12, type: 'triangle' }); tone(990, { at: 0.08, dur: 0.18, vol: 0.12, type: 'triangle' }); },
  unlock: () => { noise({ dur: 0.05, vol: 0.25, filter: 'highpass', freq: 1500 }); noise({ at: 0.12, dur: 0.06, vol: 0.3, filter: 'bandpass', freq: 900 }); tone(523, { at: 0.2, dur: 0.25, vol: 0.12, type: 'triangle' }); tone(784, { at: 0.32, dur: 0.4, vol: 0.12, type: 'triangle' }); },
  fail: () => { tone(220, { dur: 0.15, vol: 0.12, type: 'square' }); tone(196, { at: 0.18, dur: 0.22, vol: 0.12, type: 'square' }); },
  chime: () => { bell(523.25, 0, 0.2, 2.6); bell(392, 0.9, 0.2, 2.8); },
  whoosh: () => noise({ dur: 0.7, vol: 0.22, filter: 'bandpass', freq: 300, sweepTo: 3000, q: 0.8 }),
  grow: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.5, vol: 0.08, type: 'triangle' })),
  static: () => noise({ dur: 0.9, vol: 0.09, filter: 'bandpass', freq: 2000, q: 0.5 }),
  tick: () => { noise({ dur: 0.02, vol: 0.2, filter: 'highpass', freq: 4000 }); noise({ at: 0.15, dur: 0.02, vol: 0.2, filter: 'highpass', freq: 3000 }); },
  thud: () => { tone(90, { dur: 0.25, vol: 0.3, slideTo: 50 }); noise({ dur: 0.15, vol: 0.2, filter: 'lowpass', freq: 400 }); },
  door: () => { noise({ dur: 1.4, vol: 0.18, filter: 'bandpass', freq: 500, sweepTo: 180, q: 3 }); bell(392, 0.6, 0.12, 3); },
  message: () => tone(880, { dur: 0.1, vol: 0.05, type: 'sine' }),
  event: () => { tone(440, { dur: 0.3, vol: 0.06, type: 'triangle' }); tone(554, { at: 0.1, dur: 0.4, vol: 0.05, type: 'triangle' }); },
};

export function sfx(name) {
  if (!ctx || muted) return;
  (SFX[name] || SFX.click)();
}

// 반짝반짝 작은 별 (Twinkle Twinkle Little Star, 전래 동요)
const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0 };
const TWINKLE = [
  'C5', 'C5', 'G5', 'G5', 'A5', 'A5', 'G5-', 'F5', 'F5', 'E5', 'E5', 'D5', 'D5', 'C5-',
  'G5', 'G5', 'F5', 'F5', 'E5', 'E5', 'D5-', 'G5', 'G5', 'F5', 'F5', 'E5', 'E5', 'D5-',
  'C5', 'C5', 'G5', 'G5', 'A5', 'A5', 'G5-', 'F5', 'F5', 'E5', 'E5', 'D5', 'D5', 'C5-',
];

let musicUntil = 0;

export function playMusic(name = 'twinkle', { beat = 0.42, vol = 0.16 } = {}) {
  if (!ctx || muted) return;
  if (ctx.currentTime < musicUntil) return;
  let at = 0.1;
  for (const n of TWINKLE) {
    const long = n.endsWith('-');
    const key = n.replace('-', '');
    musicBoxNote(NOTE[key], at, vol);
    musicBoxNote(NOTE[key] / 2, at, vol * 0.25);
    // 오르골 태엽이 풀리듯 끝으로 갈수록 조금씩 느려진다
    at += (long ? beat * 2 : beat) * (1 + at / 90);
  }
  musicUntil = ctx.currentTime + at;
}
