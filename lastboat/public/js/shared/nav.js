// 좀비 길찾기: 0.5m 격자 (얇은 철망도 꼭 한 칸은 막히게). 벽(이동)·시야 막힘을 칸마다 센다.
// 사람마다 "흐름장"(그 사람까지 걸어가는 거리)을 만들어 두면 좀비는 숫자가 작아지는 칸으로 걷기만 하면 된다.
import { F, pointInBox } from './geom.js';

const INF = 0xffff;

export class NavGrid {
  constructor(map, cell = 0.5) {
    const b = map.bounds;
    this.x0 = b.x0;
    this.z0 = b.z0;
    this.cell = cell;
    this.W = Math.ceil((b.x1 - b.x0) / cell);
    this.H = Math.ceil((b.z1 - b.z0) / cell);
    const N = this.W * this.H;
    this.N = N;
    this.move = new Uint8Array(N);
    this.sight = new Uint8Array(N);
    // 좀비가 부술 수 있는 문(보통 문)이 막고 있는 칸: 길찾기에서 비싸게 지나갈 수 있다
    this.bash = new Uint8Array(N);
    this.bashDoor = new Int16Array(N).fill(-1);
    this.bashIds = map.doors.filter((d) => d.kind === 'door' && !d.locked).map((d) => d.id);
    this.doorCells = new Map();
    for (const c of map.colliders) this.rasterize(c);
    this.buckets = [];
  }

  idx(x, z) {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return -1;
    return j * this.W + i;
  }

  cx(idx) {
    return this.x0 + ((idx % this.W) + 0.5) * this.cell;
  }

  cz(idx) {
    return this.z0 + (Math.floor(idx / this.W) + 0.5) * this.cell;
  }

  rasterize(c) {
    const base = c.baseFlags;
    const cellsMove = [];
    const cellsSight = [];
    const pad = 0.26;
    const i0 = Math.max(0, Math.floor((c.minX - pad - this.x0) / this.cell));
    const i1 = Math.min(this.W - 1, Math.floor((c.maxX + pad - this.x0) / this.cell));
    const j0 = Math.max(0, Math.floor((c.minZ - pad - this.z0) / this.cell));
    const j1 = Math.min(this.H - 1, Math.floor((c.maxZ + pad - this.z0) / this.cell));
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * this.cell;
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * this.cell;
        const k = j * this.W + i;
        if (base & F.MOVE && pointInBox(x, z, c, 0.25)) cellsMove.push(k);
        if (base & F.SIGHT && pointInBox(x, z, c, pad)) cellsSight.push(k);
      }
    }
    const active = c.flags & F.MOVE;
    if (c.id) {
      const d = this.doorCells.get(c.id) || { move: [], sight: [], closed: false };
      d.move.push(...cellsMove);
      d.sight.push(...cellsSight);
      d.bashable = this.bashIds.includes(c.id);
      if (d.bashable) for (const k of cellsMove) this.bashDoor[k] = this.bashIds.indexOf(c.id);
      if (active) d.closed = true;
      this.doorCells.set(c.id, d);
      if (!active) return;
      if (d.bashable) for (const k of cellsMove) this.bash[k]++;
    }
    for (const k of cellsMove) if (this.move[k] < 255) this.move[k]++;
    for (const k of cellsSight) if (this.sight[k] < 255) this.sight[k]++;
  }

  /** 문이 닫히면 막힘, 열리면 뚫림 */
  setDoor(id, closed) {
    const d = this.doorCells.get(id);
    if (!d || d.closed === closed) return;
    d.closed = closed;
    const s = closed ? 1 : -1;
    for (const k of d.move) this.move[k] = Math.max(0, this.move[k] + s);
    if (d.bashable) for (const k of d.move) this.bash[k] = Math.max(0, this.bash[k] + s);
    for (const k of d.sight) this.sight[k] = Math.max(0, this.sight[k] + s);
  }

  free(x, z) {
    const k = this.idx(x, z);
    return k >= 0 && this.move[k] === 0;
  }

  freeIdx(k) {
    return k >= 0 && this.move[k] === 0;
  }

  /** 가장 가까운 빈칸 (r 칸 안) */
  nearestFree(x, z, r = 4) {
    const k = this.idx(x, z);
    if (this.freeIdx(k)) return k;
    const ci = Math.floor((x - this.x0) / this.cell);
    const cj = Math.floor((z - this.z0) / this.cell);
    for (let d = 1; d <= r; d++) {
      for (let dj = -d; dj <= d; dj++) {
        for (let di = -d; di <= d; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== d) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.W || j >= this.H) continue;
          const kk = j * this.W + i;
          if (this.move[kk] === 0) return kk;
        }
      }
    }
    return -1;
  }

  newField() {
    return { dist: new Uint16Array(this.N), stamp: new Uint32Array(this.N), cur: 0, ok: false, at: -1 };
  }

  /** (x, z) 에서 퍼져 나가는 거리장. 곧은 칸 2, 대각선 3 (0.5m 칸이라 1m = 4). maxCost 까지만 */
  flow(field, x, z, maxCost = 420) {
    const start = this.nearestFree(x, z, 4);
    field.cur++;
    field.ok = start >= 0;
    field.at = start;
    if (start < 0) return field;
    const { dist, stamp } = field;
    const cur = field.cur;
    const W = this.W;
    const move = this.move;
    const bash = this.bash;
    const B = this.buckets;
    // 막힌 칸이지만 부술 수 있는 문뿐이면 비싸게 지나간다
    const DOOR_COST = 40;
    for (let c = 0; c <= maxCost + 3; c++) {
      if (!B[c]) B[c] = [];
      else B[c].length = 0;
    }
    dist[start] = 0;
    stamp[start] = cur;
    B[0].push(start);
    const N = this.N;
    for (let c = 0; c <= maxCost; c++) {
      const list = B[c];
      for (let n = 0; n < list.length; n++) {
        const k = list[n];
        if (dist[k] !== c) continue;
        const i = k % W;
        const left = i > 0;
        const right = i < W - 1;
        const up = k >= W;
        const down = k < N - W;
        const fl = left && move[k - 1] === 0;
        const fr = right && move[k + 1] === 0;
        const fu = up && move[k - W] === 0;
        const fd = down && move[k + W] === 0;
        const c2 = c + 2;
        const c3 = c + 3;
        if (c2 <= maxCost) {
          if (fl) relax(k - 1, c2);
          if (fr) relax(k + 1, c2);
          if (fu) relax(k - W, c2);
          if (fd) relax(k + W, c2);
        }
        const cd = c + DOOR_COST;
        if (cd <= maxCost) {
          if (left && !fl && bash[k - 1] > 0 && move[k - 1] === bash[k - 1]) relax(k - 1, cd);
          if (right && !fr && bash[k + 1] > 0 && move[k + 1] === bash[k + 1]) relax(k + 1, cd);
          if (up && !fu && bash[k - W] > 0 && move[k - W] === bash[k - W]) relax(k - W, cd);
          if (down && !fd && bash[k + W] > 0 && move[k + W] === bash[k + W]) relax(k + W, cd);
        }
        if (c3 <= maxCost) {
          if (fl && fu && move[k - W - 1] === 0) relax(k - W - 1, c3);
          if (fr && fu && move[k - W + 1] === 0) relax(k - W + 1, c3);
          if (fl && fd && move[k + W - 1] === 0) relax(k + W - 1, c3);
          if (fr && fd && move[k + W + 1] === 0) relax(k + W + 1, c3);
        }
      }
    }
    return field;

    function relax(kk, cost) {
      if (stamp[kk] !== cur || dist[kk] > cost) {
        stamp[kk] = cur;
        dist[kk] = cost;
        B[cost].push(kk);
      }
    }
  }

  distAt(field, x, z) {
    const k = this.idx(x, z);
    if (k < 0 || field.stamp[k] !== field.cur) return INF;
    return field.dist[k];
  }

  /** 그 칸을 막고 있는 부술 수 있는 문 id (없으면 null) */
  doorAtCell(x, z) {
    const k = this.idx(x, z);
    if (k < 0 || this.bash[k] === 0) return null;
    const i = this.bashDoor[k];
    return i >= 0 ? this.bashIds[i] : null;
  }

  /** 흐름장에서 한 칸 더 가까운 이웃 칸의 중심 → [x, z] 또는 null */
  next(field, x, z) {
    const k = this.idx(x, z);
    if (k < 0) return null;
    const { dist, stamp } = field;
    const cur = field.cur;
    const here = stamp[k] === cur ? dist[k] : INF;
    const W = this.W;
    let best = here;
    let bk = -1;
    const move = this.move;
    const check = (kk, diag, a, b) => {
      if (kk < 0 || kk >= this.N || stamp[kk] !== cur) return;
      if (diag && (move[a] !== 0 || move[b] !== 0 || move[kk] !== 0)) return;
      if (dist[kk] < best) {
        best = dist[kk];
        bk = kk;
      }
    };
    check(k - 1, false);
    check(k + 1, false);
    check(k - W, false);
    check(k + W, false);
    check(k - W - 1, true, k - 1, k - W);
    check(k - W + 1, true, k + 1, k - W);
    check(k + W - 1, true, k - 1, k + W);
    check(k + W + 1, true, k + 1, k + W);
    if (bk < 0) return null;
    return [this.cx(bk), this.cz(bk)];
  }

  /** 시야가 트였는지 (칸 단위 광선) */
  los(ax, az, bx, bz) {
    let x = Math.floor((ax - this.x0) / this.cell);
    let z = Math.floor((az - this.z0) / this.cell);
    const tx = Math.floor((bx - this.x0) / this.cell);
    const tz = Math.floor((bz - this.z0) / this.cell);
    const dx = bx - ax;
    const dz = bz - az;
    const sx = dx > 0 ? 1 : -1;
    const sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(this.cell / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(this.cell / dz) : Infinity;
    const fx = (ax - this.x0) / this.cell - x;
    const fz = (az - this.z0) / this.cell - z;
    let tmx = dx > 0 ? (1 - fx) * tdx : fx * tdx;
    let tmz = dz > 0 ? (1 - fz) * tdz : fz * tdz;
    let n = Math.abs(tx - x) + Math.abs(tz - z);
    while (n-- > 0) {
      if (tmx < tmz) {
        x += sx;
        tmx += tdx;
      } else {
        z += sz;
        tmz += tdz;
      }
      if (x < 0 || z < 0 || x >= this.W || z >= this.H) return false;
      if ((x !== tx || z !== tz) && this.sight[z * this.W + x] > 0) return false;
    }
    return true;
  }
}

export { INF };
