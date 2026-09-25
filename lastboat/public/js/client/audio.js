// 소리: 모두 Web Audio 로 합성. 좀비·동료 소리는 위치에 따라 좌우·거리감을 준다.
let ctx = null;
let master = null;
let sfx = null;
let wet = null;
let amb = null;
let noiseBuf = null;
let volume = 0.8;
let ambientNodes = [];
let alarmTimer = null;
try {
  const v = parseFloat(localStorage.getItem('lastboat.volume'));
  if (Number.isFinite(v)) volume = v;
} catch { /* 무시 */ }

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    sfx = ctx.createGain();
    sfx.connect(master);
    amb = ctx.createGain();
    amb.gain.value = 0.5;
    amb.connect(master);
    // 도시 메아리 (잔향)
    const conv = ctx.createConvolver();
    const len = ctx.sampleRate * 1.8;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    conv.buffer = ir;
    wet = ctx.createGain();
    wet.gain.value = 0.28;
    wet.connect(conv).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) {
  volume = v;
  try { localStorage.setItem('lastboat.volume', String(v)); } catch { /* 무시 */ }
  if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
}
export const getVolume = () => volume;

/** 듣는 사람 위치·방향 (카메라) */
export function setListener(x, y, z, fx, fz) {
  if (!ctx) return;
  const L = ctx.listener;
  if (L.positionX) {
    L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
    L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz;
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else {
    L.setPosition(x, y, z);
    L.setOrientation(fx, 0, fz, 0, 1, 0);
  }
}

/** 소리 하나의 출력: 위치가 있으면 패너를 거친다 */
function out(pos, reverb = 0) {
  const g = ctx.createGain();
  let head = g;
  if (pos) {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 3;
    p.rolloffFactor = 1.3;
    p.maxDistance = 120;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(pos[0], pos[1], pos[2]);
    g.connect(p).connect(sfx);
    if (reverb) {
      const r = ctx.createGain();
      r.gain.value = reverb;
      p.connect(r).connect(wet);
    }
  } else {
    g.connect(sfx);
    if (reverb) {
      const r = ctx.createGain();
      r.gain.value = reverb;
      g.connect(r).connect(wet);
    }
  }
  return head;
}

function env(g, t, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(dest, freq, { at = 0, dur = 0.2, type = 'sine', vol = 0.3, slide = null, attack = 0.004 } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  env(g, t, attack, dur, vol);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
  return o;
}

function noise(dest, { at = 0, dur = 0.2, vol = 0.3, type = 'lowpass', freq = 1000, q = 0.8, sweep = null, attack = 0.003 } = {}) {
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, attack, dur, vol);
  s.connect(f).connect(g).connect(dest);
  s.start(t, Math.random() * 1.5);
  s.stop(t + attack + dur + 0.05);
}

const S = {
  pistol: (o) => {
    noise(o, { dur: 0.12, vol: 0.9, type: 'lowpass', freq: 4200, sweep: 600 });
    noise(o, { dur: 0.03, vol: 0.6, type: 'highpass', freq: 2500 });
    tone(o, 140, { dur: 0.12, vol: 0.6, slide: 55 });
  },
  shotgun: (o) => {
    noise(o, { dur: 0.35, vol: 1.1, type: 'lowpass', freq: 2600, sweep: 300 });
    tone(o, 95, { dur: 0.3, vol: 0.9, slide: 38 });
    noise(o, { dur: 0.05, vol: 0.5, type: 'highpass', freq: 2000 });
  },
  rifle: (o) => {
    noise(o, { dur: 0.09, vol: 0.8, type: 'bandpass', freq: 2200, q: 0.6, sweep: 700 });
    noise(o, { dur: 0.025, vol: 0.5, type: 'highpass', freq: 3500 });
    tone(o, 170, { dur: 0.07, vol: 0.45, slide: 70 });
  },
  empty: (o) => tone(o, 2200, { dur: 0.015, vol: 0.15, type: 'square' }),
  magOut: (o) => { noise(o, { dur: 0.04, vol: 0.25, type: 'bandpass', freq: 2500, q: 3 }); tone(o, 900, { dur: 0.02, vol: 0.08, type: 'square' }); },
  magIn: (o) => { noise(o, { dur: 0.05, vol: 0.3, type: 'bandpass', freq: 1800, q: 3 }); tone(o, 600, { at: 0.03, dur: 0.02, vol: 0.12, type: 'square' }); },
  shell: (o) => noise(o, { dur: 0.05, vol: 0.25, type: 'bandpass', freq: 1400, q: 2 }),
  pump: (o) => { noise(o, { dur: 0.08, vol: 0.35, type: 'bandpass', freq: 900, q: 1.5 }); noise(o, { at: 0.12, dur: 0.07, vol: 0.35, type: 'bandpass', freq: 1300, q: 1.5 }); },
  shove: (o) => { noise(o, { dur: 0.15, vol: 0.2, type: 'bandpass', freq: 500, q: 0.8, sweep: 1500 }); },
  thud: (o) => { noise(o, { dur: 0.1, vol: 0.5, type: 'lowpass', freq: 500 }); tone(o, 80, { dur: 0.1, vol: 0.4, slide: 50 }); },
  flesh: (o) => { noise(o, { dur: 0.07, vol: 0.4, type: 'lowpass', freq: 900 }); noise(o, { dur: 0.05, vol: 0.2, type: 'bandpass', freq: 300, q: 2 }); },
  groan: (o) => {
    const base = 70 + Math.random() * 60;
    const dur = 0.8 + Math.random() * 0.9;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * (0.75 + Math.random() * 0.5), t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5 + Math.random() * 5;
    const lg = ctx.createGain();
    lg.gain.value = base * 0.08;
    lfo.connect(lg).connect(osc.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(400 + Math.random() * 300, t);
    f.frequency.linearRampToValueAtTime(250 + Math.random() * 200, t + dur);
    f.Q.value = 3;
    const g = ctx.createGain();
    env(g, t, 0.15, dur, 0.35);
    osc.connect(f).connect(g).connect(o);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.3);
    lfo.stop(t + dur + 0.3);
    noise(o, { dur: dur * 0.8, vol: 0.08, type: 'bandpass', freq: 900, q: 2, attack: 0.1 });
  },
  scream: (o) => {
    tone(o, 320 + Math.random() * 120, { dur: 0.6, vol: 0.3, type: 'sawtooth', slide: 520 + Math.random() * 200, attack: 0.05 });
    noise(o, { dur: 0.6, vol: 0.35, type: 'bandpass', freq: 900, q: 1.5, sweep: 2200, attack: 0.05 });
  },
  attack: (o) => { noise(o, { dur: 0.12, vol: 0.25, type: 'bandpass', freq: 700, q: 1, sweep: 1500 }); },
  die: (o) => { noise(o, { dur: 0.5, vol: 0.3, type: 'lowpass', freq: 500, sweep: 150 }); tone(o, 110, { dur: 0.4, vol: 0.2, type: 'sawtooth', slide: 60 }); },
  hurt: (o) => { noise(o, { dur: 0.12, vol: 0.6, type: 'lowpass', freq: 600 }); tone(o, 140, { dur: 0.18, vol: 0.3, type: 'triangle', slide: 90 }); },
  heart: (o) => { tone(o, 55, { dur: 0.1, vol: 0.5, slide: 40 }); tone(o, 50, { at: 0.18, dur: 0.1, vol: 0.4, slide: 38 }); },
  step: (o) => noise(o, { dur: 0.05, vol: 0.12, type: 'lowpass', freq: 380 }),
  door: (o) => {
    tone(o, 85, { dur: 0.45, vol: 0.12, type: 'sawtooth', slide: 120, attack: 0.03 });
    noise(o, { at: 0.35, dur: 0.05, vol: 0.3, type: 'bandpass', freq: 1500, q: 2 });
  },
  gate: (o) => {
    noise(o, { dur: 0.9, vol: 0.2, type: 'bandpass', freq: 1200, q: 8 });
    noise(o, { dur: 0.15, vol: 0.5, type: 'lowpass', freq: 700 });
  },
  shutter: (o) => {
    for (let i = 0; i < 14; i++) noise(o, { at: i * 0.08, dur: 0.06, vol: 0.18, type: 'bandpass', freq: 800 + Math.random() * 400, q: 1.5 });
  },
  pickup: (o) => { noise(o, { dur: 0.04, vol: 0.2, type: 'bandpass', freq: 2000, q: 2 }); tone(o, 440, { at: 0.03, dur: 0.08, vol: 0.06, type: 'triangle' }); },
  locked: (o) => { noise(o, { dur: 0.06, vol: 0.3, type: 'bandpass', freq: 1600, q: 4 }); noise(o, { at: 0.08, dur: 0.06, vol: 0.3, type: 'bandpass', freq: 1500, q: 4 }); },
  power: (o) => {
    noise(o, { dur: 0.3, vol: 0.6, type: 'lowpass', freq: 400 });
    tone(o, 50, { at: 0.2, dur: 2.5, vol: 0.25, type: 'sawtooth', slide: 60, attack: 0.4 });
    tone(o, 100, { at: 0.2, dur: 2.5, vol: 0.1, type: 'sawtooth', slide: 120, attack: 0.4 });
  },
  mob: (o) => {
    for (let i = 0; i < 6; i++) noise(o, { at: i * 0.15, dur: 1.6, vol: 0.12, type: 'bandpass', freq: 250 + Math.random() * 300, q: 2, sweep: 500 + Math.random() * 400, attack: 0.3 });
  },
  radio: (o) => {
    noise(o, { dur: 1.2, vol: 0.12, type: 'bandpass', freq: 1800, q: 1 });
    for (let i = 0; i < 3; i++) tone(o, 1200, { at: 0.2 + i * 0.25, dur: 0.1, vol: 0.06, type: 'square' });
  },
  horn: (o) => {
    tone(o, 110, { dur: 2.4, vol: 0.4, type: 'sawtooth', attack: 0.2 });
    tone(o, 165, { dur: 2.4, vol: 0.25, type: 'sawtooth', attack: 0.2 });
  },
  heal: (o) => { noise(o, { dur: 0.3, vol: 0.12, type: 'bandpass', freq: 3000, q: 1 }); },
  ui: (o) => tone(o, 700, { dur: 0.03, vol: 0.06, type: 'triangle' }),
};

/** name 재생. opts: { pos: [x,y,z], vol, reverb } */
export function play(name, { pos = null, vol = 1, reverb = 0 } = {}) {
  if (!ctx || !S[name]) return;
  const o = out(pos, reverb);
  o.gain.value = vol;
  S[name](o);
}

// ─── 배경 소리 ───────────────────────────────────────────────────────────────

function loopNoise(freq, type, vol, q = 0.7) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = vol;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.08 + Math.random() * 0.1;
  const lg = ctx.createGain();
  lg.gain.value = vol * 0.6;
  lfo.connect(lg).connect(g.gain);
  s.connect(f).connect(g).connect(amb);
  s.start();
  lfo.start();
  return [s, lfo];
}

export function ambient(region) {
  if (!ctx) return;
  for (const n of ambientNodes) try { n.stop(); } catch { /* 무시 */ }
  ambientNodes = [];
  if (region === 1) {
    ambientNodes.push(...loopNoise(120, 'lowpass', 0.25));
    const o = ctx.createOscillator();
    o.frequency.value = 58;
    const g = ctx.createGain();
    g.gain.value = 0.03;
    o.connect(g).connect(amb);
    o.start();
    ambientNodes.push(o);
  } else if (region === 0) {
    ambientNodes.push(...loopNoise(300, 'lowpass', 0.35));
    ambientNodes.push(...loopNoise(1400, 'bandpass', 0.04, 0.4));
  }
}

/** 멀리서 들리는 사이렌·개 짖는 소리 등 가끔 */
export function distant() {
  if (!ctx) return;
  const o = out(null, 0.6);
  o.gain.value = 0.25;
  const r = Math.random();
  if (r < 0.4) {
    const t0 = 600 + Math.random() * 200;
    for (let i = 0; i < 3; i++) tone(o, t0, { at: i * 1.2, dur: 1.1, vol: 0.05, type: 'sine', slide: t0 * 1.3, attack: 0.3 });
  } else if (r < 0.7) {
    noise(o, { dur: 0.25, vol: 0.2, type: 'lowpass', freq: 600 });
    noise(o, { at: 0.5, dur: 0.25, vol: 0.12, type: 'lowpass', freq: 500 });
  } else S.scream(o);
}

export function alarm(on) {
  if (!ctx) return;
  clearInterval(alarmTimer);
  alarmTimer = null;
  if (!on) return;
  let hi = false;
  const beat = () => {
    const o = out(null, 0.4);
    o.gain.value = 0.35;
    tone(o, hi ? 950 : 720, { dur: 0.48, vol: 0.12, type: 'square', attack: 0.02 });
    hi = !hi;
  };
  beat();
  alarmTimer = setInterval(beat, 500);
}

export function stopAll() {
  alarm(false);
  for (const n of ambientNodes) try { n.stop(); } catch { /* 무시 */ }
  ambientNodes = [];
}
