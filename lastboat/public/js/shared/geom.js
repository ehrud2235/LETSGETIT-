// 충돌 계산: 모든 벽·차·상자는 "위에서 보면 회전된 직사각형 + 높이" 로 다룬다.
// 사람과 좀비는 위에서 보면 원. 총알은 3D 광선.

/** 충돌체 플래그 */
export const F = { MOVE: 1, SHOT: 2, SIGHT: 4, ALL: 7 };

/**
 * 충돌체 만들기. rot 은 three.js 의 rotation.y 와 같은 방향.
 * 월드 = (lx*cos + lz*sin, -lx*sin + lz*cos)
 */
export function makeCollider({ cx, cz, hx, hz, rot = 0, y0 = 0, h = 3, flags = F.ALL, id = null, tag = null }) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // 위에서 본 외접 사각형 (공간 해시용)
  const ex = Math.abs(hx * c) + Math.abs(hz * s);
  const ez = Math.abs(hx * s) + Math.abs(hz * c);
  return { cx, cz, hx, hz, rot, cos: c, sin: s, y0, y1: y0 + h, flags, baseFlags: flags, id, tag, minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, stamp: 0 };
}

/** 원(px,pz,r) 과 충돌체 겹침 → { nx, nz, depth } (밀어낼 방향) 또는 null */
export function circleVsBox(px, pz, r, b) {
  const dx = px - b.cx;
  const dz = pz - b.cz;
  const lx = dx * b.cos - dz * b.sin;
  const lz = dx * b.sin + dz * b.cos;
  const qx = lx < -b.hx ? -b.hx : lx > b.hx ? b.hx : lx;
  const qz = lz < -b.hz ? -b.hz : lz > b.hz ? b.hz : lz;
  const ddx = lx - qx;
  const ddz = lz - qz;
  const d2 = ddx * ddx + ddz * ddz;
  if (d2 >= r * r) return null;
  let nlx;
  let nlz;
  let depth;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    nlx = ddx / d;
    nlz = ddz / d;
    depth = r - d;
  } else {
    // 중심이 상자 안: 가장 가까운 면으로
    const penX = b.hx - Math.abs(lx);
    const penZ = b.hz - Math.abs(lz);
    if (penX < penZ) {
      nlx = lx >= 0 ? 1 : -1;
      nlz = 0;
      depth = penX + r;
    } else {
      nlx = 0;
      nlz = lz >= 0 ? 1 : -1;
      depth = penZ + r;
    }
  }
  return { nx: nlx * b.cos + nlz * b.sin, nz: -nlx * b.sin + nlz * b.cos, depth };
}

/** 점이 충돌체 안(여유 pad 포함)에 있는지 */
export function pointInBox(px, pz, b, pad = 0) {
  const dx = px - b.cx;
  const dz = pz - b.cz;
  const lx = dx * b.cos - dz * b.sin;
  const lz = dx * b.sin + dz * b.cos;
  return Math.abs(lx) <= b.hx + pad && Math.abs(lz) <= b.hz + pad;
}

/** 3D 광선과 충돌체 → 맞은 거리 t 또는 -1 */
export function rayVsBox(ox, oy, oz, dx, dy, dz, maxT, b) {
  const rx = ox - b.cx;
  const rz = oz - b.cz;
  const lox = rx * b.cos - rz * b.sin;
  const loz = rx * b.sin + rz * b.cos;
  const ldx = dx * b.cos - dz * b.sin;
  const ldz = dx * b.sin + dz * b.cos;
  let t0 = 0;
  let t1 = maxT;
  // x 슬랩
  if (Math.abs(ldx) < 1e-9) {
    if (lox < -b.hx || lox > b.hx) return -1;
  } else {
    let a = (-b.hx - lox) / ldx;
    let c = (b.hx - lox) / ldx;
    if (a > c) [a, c] = [c, a];
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  // y 슬랩
  if (Math.abs(dy) < 1e-9) {
    if (oy < b.y0 || oy > b.y1) return -1;
  } else {
    let a = (b.y0 - oy) / dy;
    let c = (b.y1 - oy) / dy;
    if (a > c) [a, c] = [c, a];
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  // z 슬랩
  if (Math.abs(ldz) < 1e-9) {
    if (loz < -b.hz || loz > b.hz) return -1;
  } else {
    let a = (-b.hz - loz) / ldz;
    let c = (b.hz - loz) / ldz;
    if (a > c) [a, c] = [c, a];
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  return t0;
}

/** 공간 해시에 넣은 충돌체 모음 */
export class ColliderSet {
  constructor(colliders, cell = 8) {
    this.list = colliders;
    this.cell = cell;
    this.buckets = new Map();
    this.stamp = 1;
    this.byId = new Map();
    for (const c of colliders) {
      this.insert(c);
      if (c.id) {
        if (!this.byId.has(c.id)) this.byId.set(c.id, []);
        this.byId.get(c.id).push(c);
      }
    }
  }

  key(ix, iz) {
    return ix * 73856093 ^ iz * 19349663;
  }

  insert(c) {
    const s = this.cell;
    for (let ix = Math.floor(c.minX / s); ix <= Math.floor(c.maxX / s); ix++) {
      for (let iz = Math.floor(c.minZ / s); iz <= Math.floor(c.maxZ / s); iz++) {
        const k = this.key(ix, iz);
        let b = this.buckets.get(k);
        if (!b) this.buckets.set(k, (b = []));
        b.push(c);
      }
    }
  }

  /** 영역과 겹칠 수 있는 충돌체 (flags 가 mask 와 겹치는 것만) */
  query(x0, z0, x1, z1, mask, out = []) {
    out.length = 0;
    const s = this.cell;
    const st = ++this.stamp;
    for (let ix = Math.floor(x0 / s); ix <= Math.floor(x1 / s); ix++) {
      for (let iz = Math.floor(z0 / s); iz <= Math.floor(z1 / s); iz++) {
        const b = this.buckets.get(this.key(ix, iz));
        if (!b) continue;
        for (const c of b) {
          if (c.stamp === st || !(c.flags & mask)) continue;
          c.stamp = st;
          if (c.maxX < x0 || c.minX > x1 || c.maxZ < z0 || c.minZ > z1) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /** 원을 벽 밖으로 밀어낸다 → [x, z] */
  resolveCircle(x, z, r, mask = F.MOVE, iterations = 3) {
    const tmp = this._tmp || (this._tmp = []);
    for (let it = 0; it < iterations; it++) {
      const list = this.query(x - r, z - r, x + r, z + r, mask, tmp);
      let moved = false;
      for (const c of list) {
        const hit = circleVsBox(x, z, r, c);
        if (hit) {
          x += hit.nx * hit.depth;
          z += hit.nz * hit.depth;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }

  /** 원이 어느 충돌체와든 겹치는지 */
  overlaps(x, z, r, mask = F.MOVE) {
    const tmp = this._tmp2 || (this._tmp2 = []);
    for (const c of this.query(x - r, z - r, x + r, z + r, mask, tmp)) if (circleVsBox(x, z, r, c)) return true;
    return false;
  }

  /** 광선이 처음 맞는 충돌체 → { t, collider } 또는 null */
  raycast(ox, oy, oz, dx, dy, dz, maxT, mask = F.SHOT) {
    const ex = ox + dx * maxT;
    const ez = oz + dz * maxT;
    const tmp = this._tmp3 || (this._tmp3 = []);
    const list = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), mask, tmp);
    let best = null;
    let bestT = maxT;
    for (const c of list) {
      const t = rayVsBox(ox, oy, oz, dx, dy, dz, bestT, c);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = c;
      }
    }
    return best ? { t: bestT, collider: best } : null;
  }

  /** 문 여닫기 등으로 id 가 같은 충돌체의 플래그를 바꾼다 */
  setFlags(id, flags) {
    for (const c of this.byId.get(id) || []) c.flags = flags;
  }
}
