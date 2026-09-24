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
    musicBus.gain.value = musicOn ? 0.18 : 0;
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
  if (musicBus) musicBus.gain.setTargetAtTime(v ? 0.18 : 0, ctx.currentTime, 0.1);
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
function getNoiseBuf() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function noise({ at = 0, dur = 0.2, vol = 0.2, type = 'bandpass', freq = 1000, q = 1, sweep = null, bus = null, attack = 0.005 } = {}) {
  if (!ctx) return;
  getNoiseBuf();
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

// 맞는 소리는 전부 "퍽·쿵" 같은 둔탁한 소리: 짧은 저음 몸통 소리 + 낮게 거른 잡음. 음이 미끄러지는(띠용) 소리는 쓰지 않는다.
function thud({ at = 0, low = 80, body = 0.09, vol = 0.4, cut = 900, crack = 0.05, crackVol = 0.35 } = {}) {
  tone(low, { at, dur: body, vol, slide: low * 0.8, type: 'sine' });
  noise({ at, dur: crack, vol: crackVol, type: 'lowpass', freq: cut, q: 0.7 });
}

const SFX = {
  // 주먹: 퍽
  punch: (power = 1) => thud({ low: 95 - power * 12, body: 0.07 + power * 0.03, vol: 0.32 * power, cut: 1000 + power * 300, crack: 0.045, crackVol: 0.42 * power }),
  // 발차기: 퍽 (더 묵직)
  kick: (power = 1) => thud({ low: 70, body: 0.12, vol: 0.42 * power, cut: 800, crack: 0.06, crackVol: 0.45 * power }),
  // 박치기: 딱 + 쿵
  headbutt: (power = 1) => {
    noise({ dur: 0.035, vol: 0.3 * power, type: 'bandpass', freq: 1600, q: 1.4 });
    thud({ low: 75, body: 0.12, vol: 0.4 * power, cut: 700, crack: 0.05, crackVol: 0.3 * power });
  },
  // 헛손질: 짧은 바람 소리 (작게)
  swing: () => noise({ dur: 0.1, vol: 0.035, type: 'bandpass', freq: 650, q: 0.9 }),
  // 점프: 발 구르는 소리
  jump: () => noise({ dur: 0.05, vol: 0.07, type: 'lowpass', freq: 500 }),
  // 잡기: 옷 움켜쥐는 소리
  grab: () => noise({ dur: 0.05, vol: 0.07, type: 'bandpass', freq: 1300, q: 0.8 }),
  // 던지기: 낮은 휙
  throw: () => noise({ dur: 0.22, vol: 0.12, type: 'bandpass', freq: 420, q: 0.7, attack: 0.03 }),
  // 바닥에 처박힘: 쿵
  slam: (power = 1) => thud({ low: 55, body: 0.2, vol: 0.5 * power, cut: 420, crack: 0.14, crackVol: 0.45 * power }),
  // 장외: 멀리서 쿵 + 관중 웅성
  out: () => {
    thud({ at: 0.35, low: 48, body: 0.25, vol: 0.35, cut: 260, crack: 0.2, crackVol: 0.3 });
    SFX.crowd(0.8);
  },
  // 경기 시작 공: 한 번만 "땡"
  bell: () => {
    tone(880, { dur: 1.1, vol: 0.12 });
    tone(880 * 2.76, { dur: 0.5, vol: 0.03 });
  },
  beep: () => noise({ dur: 0.04, vol: 0.1, type: 'lowpass', freq: 700 }),
  crowd: (k = 1) => {
    noise({ dur: 1.6, vol: 0.1 * k, type: 'bandpass', freq: 900, q: 0.6, attack: 0.15 });
    noise({ dur: 1.4, vol: 0.06 * k, type: 'bandpass', freq: 2000, q: 0.8, attack: 0.2 });
  },
  takedown: () => {
    thud({ low: 55, body: 0.22, vol: 0.5, cut: 450, crack: 0.12, crackVol: 0.45 });
    SFX.crowd(0.5);
  },
  // 탭아웃: 매트를 손바닥으로 탁탁탁
  tap: () => {
    for (let i = 0; i < 3; i++) noise({ at: i * 0.14, dur: 0.035, vol: 0.28, type: 'lowpass', freq: 900 });
    SFX.crowd(0.8);
  },
  gust: () => noise({ dur: 2.4, vol: 0.1, type: 'lowpass', freq: 380, q: 0.5, attack: 0.5 }),
  // 철창 떨어짐: 쇠 부딪히는 소리 + 쿵
  fence: () => {
    noise({ dur: 0.35, vol: 0.12, type: 'bandpass', freq: 2600, q: 6 });
    thud({ at: 0.05, low: 60, body: 0.2, vol: 0.35, cut: 500, crack: 0.1, crackVol: 0.3 });
  },
  click: () => noise({ dur: 0.025, vol: 0.06, type: 'lowpass', freq: 1500 }),
  win: () => SFX.crowd(1.3),
};

export function sfx(name, arg) {
  if (!ctx || muted) return;
  if (!throttle(name, name === 'punch' ? 40 : 60)) return;
  (SFX[name] || SFX.click)(arg);
}

/** 게임 이벤트 → 소리 (세게 맞을수록 더 묵직하게) */
export function soundForEvent(ev) {
  switch (ev.type) {
    case 'hit': {
      const power = Math.min(1.5, 0.55 + (ev.kb || 2) / 7);
      if (ev.kind === 'foot') sfx('kick', power);
      else if (ev.kind === 'head') sfx('headbutt', power);
      else sfx('punch', power);
      break;
    }
    case 'swing': sfx('swing'); break;
    case 'jump': sfx('jump'); break;
    case 'grab': sfx('grab'); break;
    case 'throw': sfx('throw'); break;
    case 'slam': sfx('slam', ev.speed > 10 ? 1.2 : 0.8); break;
    case 'out': sfx('out'); break;
    case 'fight': sfx('bell'); break;
    case 'roundEnd': sfx('win'); break;
    case 'takedown': sfx('takedown'); break;
    case 'suplex': sfx('slam', 1.2); break;
    case 'submitWin': sfx('tap'); break;
    case 'suddenDeath': sfx('bell'); break;
    case 'mapEvent':
      if (ev.what === 'gust') sfx('gust');
      if (ev.what === 'fenceDrop') sfx('fence');
      break;
    default:
  }
}

// ─── 배경음: 흥겨운 음악 대신 낮게 깔리는 북소리와 관중 웅성거림 ──────────────
let musicTimer = null;
let step = 0;
let crowdSrc = null;
const BPM = 84;
// 16칸: 1=큰북, 2=낮은 탐, 3=작은 탐
const DRUMS = [1, 0, 0, 0, 0, 0, 2, 0, 1, 0, 1, 0, 0, 0, 3, 0];

export function startMusic() {
  if (!ctx || musicTimer) return;
  const stepDur = 60 / BPM / 4;
  let next = ctx.currentTime + 0.1;
  // 관중 웅성거림: 잡음을 계속 틀어 둔다
  if (!crowdSrc) {
    crowdSrc = ctx.createBufferSource();
    crowdSrc.buffer = getNoiseBuf();
    crowdSrc.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    crowdSrc.connect(f).connect(g).connect(musicBus);
    crowdSrc.start();
  }
  musicTimer = setInterval(() => {
    while (next < ctx.currentTime + 0.3) {
      const at = next - ctx.currentTime;
      const d = DRUMS[step % 16];
      if (d === 1) thudBus(at, 52, 0.28, 0.55);
      else if (d === 2) thudBus(at, 78, 0.2, 0.3);
      else if (d === 3) thudBus(at, 95, 0.16, 0.25);
      next += stepDur;
      step += 1;
    }
  }, 60);
}

function thudBus(at, low, dur, vol) {
  tone(low, { at, dur, vol, slide: low * 0.75, bus: musicBus });
  noise({ at, dur: dur * 0.4, vol: vol * 0.35, type: 'lowpass', freq: 300, bus: musicBus });
}

export function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
  if (crowdSrc) {
    try { crowdSrc.stop(); } catch { /* 무시 */ }
    crowdSrc = null;
  }
}
