// 시뮬레이션용 작은 벡터/쿼터니언 도구 (브라우저와 Node 양쪽에서 사용, three.js 의존 없음)

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const lenXZ = (a) => Math.hypot(a.x, a.z);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function norm(a) {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export function clampLen(a, max) {
  const l = len(a);
  return l > max ? scale(a, max / l) : a;
}

export const qId = () => ({ x: 0, y: 0, z: 0, w: 1 });

export function qMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export const qConj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function qNorm(q) {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

export function qAxisAngle(x, y, z, angle) {
  const s = Math.sin(angle / 2);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(angle / 2) };
}

/** y축 회전. yaw=0 이면 +z 를 바라본다. */
export const qYaw = (yaw) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

export function qRotate(q, v) {
  // v' = q v q*
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/** from 방향을 to 방향으로 돌리는 최소 회전 (둘 다 단위벡터) */
export function qFromUnitVectors(from, to) {
  let r = dot(from, to) + 1;
  let x;
  let y;
  let z;
  if (r < 1e-6) {
    r = 0;
    if (Math.abs(from.x) > Math.abs(from.z)) {
      x = -from.y; y = from.x; z = 0;
    } else {
      x = 0; y = -from.z; z = from.y;
    }
  } else {
    x = from.y * to.z - from.z * to.y;
    y = from.z * to.x - from.x * to.z;
    z = from.x * to.y - from.y * to.x;
  }
  return qNorm({ x, y, z, w: r });
}

/**
 * 현재 회전 cur 를 target 으로 맞추기 위한 각속도 (rad/s).
 * gain: 1초에 오차의 몇 배만큼 돌릴지, max: 최대 각속도.
 */
export function qErrorAngVel(target, cur, gain, max) {
  let e = qMul(target, qConj(cur));
  if (e.w < 0) e = { x: -e.x, y: -e.y, z: -e.z, w: -e.w };
  const s = Math.sqrt(Math.max(0, 1 - e.w * e.w));
  if (s < 1e-5) return v3();
  const angle = 2 * Math.acos(Math.min(1, e.w));
  const k = Math.min(angle * gain, max) / s;
  return { x: e.x * k, y: e.y * k, z: e.z * k };
}

/** 쿼터니언의 y축 회전 성분 (바라보는 방향 yaw) */
export function yawOf(q) {
  const f = qRotate(q, { x: 0, y: 0, z: 1 });
  return Math.atan2(f.x, f.z);
}

export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 결정적인 난수 (시드 고정) */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
