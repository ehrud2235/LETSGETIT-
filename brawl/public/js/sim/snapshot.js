// 네트워크용 이진 형식. 호스트 → 다른 사람: 스냅샷, 다른 사람 → 호스트: 입력.
// 위치는 2mm 단위 int16, 회전은 int16 쿼터니언으로 줄여서 물체 하나에 14바이트.

export const MSG = { INPUT: 1, SNAPSHOT: 2 };
const PHASES = ['countdown', 'fight', 'roundEnd', 'matchEnd'];
const GRABS = [null, 'tackle', 'mount', 'submit', 'suplex'];
const POS_SCALE = 500;
const clamp16 = (v) => Math.max(-32767, Math.min(32767, Math.round(v)));

/**
 * @param {object} s  { tick, time, phase, phaseT, roundTime, round, statuses:[{slot,flags,pct,grab,grabProgress,victimOf,victimProgress,escape}], transforms: Float32Array, nBodies }
 */
export function encodeSnapshot(s) {
  const nF = s.statuses.length;
  const size = 1 + 4 + 4 + 1 + 4 + 4 + 1 + 1 + 2 + nF * 9 + s.nBodies * 14;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, MSG.SNAPSHOT); o += 1;
  v.setUint32(o, s.tick, true); o += 4;
  v.setFloat32(o, s.time, true); o += 4;
  v.setUint8(o, Math.max(0, PHASES.indexOf(s.phase))); o += 1;
  v.setFloat32(o, s.phaseT, true); o += 4;
  v.setFloat32(o, s.roundTime, true); o += 4;
  v.setUint8(o, s.round & 255); o += 1;
  v.setUint8(o, nF); o += 1;
  v.setUint16(o, s.nBodies, true); o += 2;
  for (const st of s.statuses) {
    v.setUint8(o, st.slot); o += 1;
    v.setUint8(o, st.flags); o += 1;
    v.setUint16(o, Math.round(Math.max(0, Math.min(999, st.pct || 0))), true); o += 2;
    v.setUint8(o, Math.max(0, GRABS.indexOf(st.grab))); o += 1;
    v.setUint8(o, Math.round(Math.max(0, Math.min(1, st.grabProgress || 0)) * 255)); o += 1;
    v.setUint8(o, Math.max(0, GRABS.indexOf(st.victimOf))); o += 1;
    v.setUint8(o, Math.round(Math.max(0, Math.min(1, st.victimProgress || 0)) * 255)); o += 1;
    v.setUint8(o, Math.min(255, Math.round((st.escape || 0) * 10))); o += 1;
  }
  const t = s.transforms;
  for (let i = 0; i < s.nBodies; i++) {
    const b = i * 7;
    v.setInt16(o, clamp16(t[b] * POS_SCALE), true); o += 2;
    v.setInt16(o, clamp16(t[b + 1] * POS_SCALE), true); o += 2;
    v.setInt16(o, clamp16(t[b + 2] * POS_SCALE), true); o += 2;
    v.setInt16(o, clamp16(t[b + 3] * 32767), true); o += 2;
    v.setInt16(o, clamp16(t[b + 4] * 32767), true); o += 2;
    v.setInt16(o, clamp16(t[b + 5] * 32767), true); o += 2;
    v.setInt16(o, clamp16(t[b + 6] * 32767), true); o += 2;
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const v = new DataView(buf);
  let o = 1;
  const tick = v.getUint32(o, true); o += 4;
  const time = v.getFloat32(o, true); o += 4;
  const phase = PHASES[v.getUint8(o)]; o += 1;
  const phaseT = v.getFloat32(o, true); o += 4;
  const roundTime = v.getFloat32(o, true); o += 4;
  const round = v.getUint8(o); o += 1;
  const nF = v.getUint8(o); o += 1;
  const nBodies = v.getUint16(o, true); o += 2;
  const statuses = [];
  for (let i = 0; i < nF; i++) {
    statuses.push({
      slot: v.getUint8(o),
      flags: v.getUint8(o + 1),
      pct: v.getUint16(o + 2, true),
      grab: GRABS[v.getUint8(o + 4)],
      grabProgress: v.getUint8(o + 5) / 255,
      victimOf: GRABS[v.getUint8(o + 6)],
      victimProgress: v.getUint8(o + 7) / 255,
      escape: v.getUint8(o + 8) / 10,
    });
    o += 9;
  }
  const transforms = new Float32Array(nBodies * 7);
  for (let i = 0; i < nBodies; i++) {
    const b = i * 7;
    transforms[b] = v.getInt16(o, true) / POS_SCALE;
    transforms[b + 1] = v.getInt16(o + 2, true) / POS_SCALE;
    transforms[b + 2] = v.getInt16(o + 4, true) / POS_SCALE;
    transforms[b + 3] = v.getInt16(o + 6, true) / 32767;
    transforms[b + 4] = v.getInt16(o + 8, true) / 32767;
    transforms[b + 5] = v.getInt16(o + 10, true) / 32767;
    transforms[b + 6] = v.getInt16(o + 12, true) / 32767;
    o += 14;
  }
  return { tick, time, phase, phaseT, roundTime, round, statuses, transforms, nBodies };
}

const TAPS = ['jump', 'handL', 'handR', 'kick', 'head', 'grapple'];

/** 입력: [종류][개수] 다음 플레이어마다 [슬롯][mx int8][mz int8][btn][탭 카운터 6개] */
export function encodeInputs(list) {
  const buf = new ArrayBuffer(2 + list.length * 10);
  const v = new DataView(buf);
  v.setUint8(0, MSG.INPUT);
  v.setUint8(1, list.length);
  let o = 2;
  for (const p of list) {
    v.setUint8(o, p.slot);
    v.setInt8(o + 1, Math.round(Math.max(-1, Math.min(1, p.mx)) * 127));
    v.setInt8(o + 2, Math.round(Math.max(-1, Math.min(1, p.mz)) * 127));
    v.setUint8(o + 3, p.btn & 255);
    TAPS.forEach((k, i) => v.setUint8(o + 4 + i, (p.taps?.[k] || 0) & 255));
    o += 10;
  }
  return buf;
}

export function decodeInputs(buf) {
  const v = new DataView(buf);
  const n = v.getUint8(1);
  const out = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    const taps = {};
    TAPS.forEach((k, j) => { taps[k] = v.getUint8(o + 4 + j); });
    out.push({ slot: v.getUint8(o), mx: v.getInt8(o + 1) / 127, mz: v.getInt8(o + 2) / 127, btn: v.getUint8(o + 3), taps });
    o += 10;
  }
  return out;
}

/** 두 스냅샷 사이를 보간 (위치는 선형, 회전은 정규화 선형) */
export function lerpTransforms(a, b, k, out) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 7) {
    out[i] = a[i] + (b[i] - a[i]) * k;
    out[i + 1] = a[i + 1] + (b[i + 1] - a[i + 1]) * k;
    out[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * k;
    let bx = b[i + 3];
    let by = b[i + 4];
    let bz = b[i + 5];
    let bw = b[i + 6];
    if (a[i + 3] * bx + a[i + 4] * by + a[i + 5] * bz + a[i + 6] * bw < 0) {
      bx = -bx; by = -by; bz = -bz; bw = -bw;
    }
    const x = a[i + 3] + (bx - a[i + 3]) * k;
    const y = a[i + 4] + (by - a[i + 4]) * k;
    const z = a[i + 5] + (bz - a[i + 5]) * k;
    const w = a[i + 6] + (bw - a[i + 6]) * k;
    const l = Math.hypot(x, y, z, w) || 1;
    out[i + 3] = x / l;
    out[i + 4] = y / l;
    out[i + 5] = z / l;
    out[i + 6] = w / l;
  }
  return out;
}
