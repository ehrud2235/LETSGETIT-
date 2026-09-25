// 맵 만들기 도구: 건물·벽·방·문·자동차·가로등 같은 것을 "데이터"로 쌓는다.
// 시뮬레이션(충돌·길찾기)과 화면(3D 모델)이 같은 데이터를 쓴다. three.js 에 의존하지 않는다.
import { F, makeCollider } from './geom.js';

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MapBuilder {
  constructor() {
    this.colliders = [];
    this.visuals = []; // { k: 종류, ... } — 화면에서 모양을 만든다
    this.grounds = []; // { x0, z0, x1, z1, mat, y }
    this.lamps = []; // 가로등 { x, z, y, color, broken }
    this.lights = []; // 그 밖의 불빛 { x, y, z, color, power, range, kind }
    this.items = []; // 줍는 것 { id, type, spots: [[x,z,y]] }
    this.notes = []; // 읽는 쪽지 { id, x, z, y, title, text }
    this.doors = []; // 문 { id, x, z, axis, w, h, locked, key, flag, label, lockedMsg }
    this.interacts = []; // 조작 { id, x, z, y, r, label, kind }
    this.triggers = []; // 구역 { id, x0, z0, x1, z1 }
    this.groups = []; // 배치 좀비 { x, z, r, n }
    this.hordes = []; // 떼 좀비 나오는 곳 { x, z, tag }
    this.signs = []; // 글씨 간판 { x, y, z, rot, w, h, text, color, bg, flag }
    this.fires = []; // 불타는 곳 { x, z, s }
    this.portals = []; // 계단 이동 { id, x0, z0, x1, z1, to: { x, z, yaw } }
    this.regions = []; // 지역 이름 { name, x0, z0, x1, z1, underground }
  }

  /** 충돌체 추가 (중심·반크기 기준) */
  col(cx, cz, hx, hz, { rot = 0, y0 = 0, h = 3, flags = F.ALL, id = null, tag = null } = {}) {
    const c = makeCollider({ cx, cz, hx, hz, rot, y0, h, flags, id, tag });
    this.colliders.push(c);
    return c;
  }

  /** 네모 모서리 좌표로 충돌체 */
  colRect(x0, z0, x1, z1, opt = {}) {
    return this.col((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) / 2, Math.abs(z1 - z0) / 2, opt);
  }

  ground(x0, z0, x1, z1, mat, y = 0.01) {
    this.grounds.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), mat, y });
  }

  /** 일반 상자 (y0 부터 높이 h) */
  box(cx, cz, w, d, h, { rot = 0, y0 = 0, mat = 'concrete', color = null, flags = F.ALL, collide = true, id = null, cast = true } = {}) {
    this.visuals.push({ k: 'box', x: cx, z: cz, w, d, h, rot, y0, mat, color, cast });
    if (collide && flags) this.col(cx, cz, w / 2, d / 2, { rot, y0, h, flags, id });
  }

  boxRect(x0, z0, x1, z1, h, opt = {}) {
    this.box((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(z1 - z0), h, opt);
  }

  /** 들어갈 수 없는 건물 (창문 외벽) */
  building(x0, z0, x1, z1, h, style = 0, { lit = 0.25, roof = true, seed = 0 } = {}) {
    this.visuals.push({ k: 'building', x0, z0, x1, z1, h, style, lit, roof, seed: seed || Math.floor((x0 * 31 + z0 * 17 + h) * 7) });
    this.colRect(x0, z0, x1, z1, { h, flags: F.ALL });
  }

  /** 얇은 벽 (축에 맞춘 선분) */
  wall(x0, z0, x1, z1, h = 3, t = 0.3, { mat = 'concrete', flags = F.ALL, color = null, y0 = 0 } = {}) {
    if (x0 === x1) this.box(x0, (z0 + z1) / 2, t, Math.abs(z1 - z0), h, { mat, flags, color, y0 });
    else if (z0 === z1) this.box((x0 + x1) / 2, z0, Math.abs(x1 - x0), t, h, { mat, flags, color, y0 });
    else throw new Error('wall 은 축에 맞춘 선분만');
  }

  /** 철망 울타리: 막히지만 총알·시야는 통과 */
  fence(x0, z0, x1, z1, h = 2.6) {
    this.visuals.push({ k: 'fence', x0, z0, x1, z1, h });
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rot = -Math.atan2(z1 - z0, x1 - x0);
    this.col((x0 + x1) / 2, (z0 + z1) / 2, len / 2, 0.08, { rot, h, flags: F.MOVE });
  }

  /** 난간 (강변 등): 막히지만 총알·시야 통과 */
  railing(x0, z0, x1, z1, h = 1.1) {
    this.visuals.push({ k: 'railing', x0, z0, x1, z1, h });
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rot = -Math.atan2(z1 - z0, x1 - x0);
    this.col((x0 + x1) / 2, (z0 + z1) / 2, len / 2, 0.1, { rot, h, flags: F.MOVE });
  }

  /**
   * 들어갈 수 있는 방. doors: [{ side: 'n'|'s'|'w'|'e', at: 좌표, w, id?, door: {...} }]
   * n = z0 쪽 벽, s = z1 쪽 벽, w = x0 쪽 벽, e = x1 쪽 벽
   */
  room(x0, z0, x1, z1, { h = 3.4, t = 0.3, doors = [], ext = 'brick', int = 'plaster', floor = 'tile', light = true, lightColor = '#e8f0ff', flicker = false, roofH = 0.4, color = null, name = null, extColor = null } = {}) {
    const walls = [
      ['n', x0, z0, x1, z0],
      ['s', x0, z1, x1, z1],
      ['w', x0, z0, x0, z1],
      ['e', x1, z0, x1, z1],
    ];
    for (const [side, ax, az, bx, bz] of walls) {
      const horiz = az === bz;
      const a = horiz ? ax : az;
      const b = horiz ? bx : bz;
      const gaps = doors.filter((d) => d.side === side).map((d) => [d.at - d.w / 2, d.at + d.w / 2]).sort((p, q) => p[0] - q[0]);
      let cur = a;
      const segs = [];
      for (const [g0, g1] of gaps) {
        if (g0 > cur) segs.push([cur, g0]);
        cur = Math.max(cur, g1);
        // 문 위 벽
        const mid = (g0 + g1) / 2;
        const len = g1 - g0;
        if (horiz) this.visuals.push({ k: 'box', x: mid, z: az, w: len, d: t, h: h - 2.3, y0: 2.3, rot: 0, mat: ext, color: extColor, cast: true, inner: int });
        else this.visuals.push({ k: 'box', x: ax, z: mid, w: t, d: len, h: h - 2.3, y0: 2.3, rot: 0, mat: ext, color: extColor, cast: true, inner: int });
      }
      if (cur < b) segs.push([cur, b]);
      for (const [s0, s1] of segs) {
        // 모서리 쪽만 벽 두께만큼 늘려서 구석을 메운다 (문 쪽으로는 늘리지 않는다)
        const e0 = horiz && s0 === a ? s0 - t / 2 : s0;
        const e1 = horiz && s1 === b ? s1 + t / 2 : s1;
        if (horiz) this.box((e0 + e1) / 2, az, e1 - e0, t, h, { mat: ext, color: extColor });
        else this.box(ax, (e0 + e1) / 2, t, e1 - e0, h, { mat: ext, color: extColor });
      }
    }
    // 지붕 (충돌은 필요 없음: 안에서 올려다 보는 천장 겸)
    this.visuals.push({ k: 'roof', x0: x0 - t / 2, z0: z0 - t / 2, x1: x1 + t / 2, z1: z1 + t / 2, y: h, t: roofH, mat: ext, color: extColor });
    this.visuals.push({ k: 'floor', x0, z0, x1, z1, mat: floor });
    this.visuals.push({ k: 'interior', x0, z0, x1, z1, h, mat: int });
    if (light) this.lights.push({ x: (x0 + x1) / 2, y: h - 0.2, z: (z0 + z1) / 2, color: lightColor, power: 1, range: Math.max(8, Math.hypot(x1 - x0, z1 - z0) * 0.8), kind: flicker ? 'flicker' : 'ceiling', panel: true });
    for (const d of doors) {
      if (!d.id) continue;
      const horiz = d.side === 'n' || d.side === 's';
      const x = horiz ? d.at : d.side === 'w' ? x0 : x1;
      const z = horiz ? (d.side === 'n' ? z0 : z1) : d.at;
      this.door(d.id, x, z, horiz ? 'x' : 'z', d.w, d.door || {});
    }
    if (name) this.regions.push({ name, x0, z0, x1, z1, indoor: true });
  }

  /**
   * 문. axis 'x' = 문짝이 x 방향으로 놓임(북/남 벽), 'z' = z 방향(서/동 벽).
   * locked: 열쇠(key) 나 조건(flag)이 있어야 열림
   */
  door(id, x, z, axis, w, { h = 2.3, locked = false, key = null, flag = null, label = '문', lockedMsg = '잠겨 있다.', kind = 'door', open = false, color = null } = {}) {
    const c = axis === 'x'
      ? this.col(x, z, w / 2, 0.08, { h, flags: open ? 0 : F.ALL, id })
      : this.col(x, z, 0.08, w / 2, { h, flags: open ? 0 : F.ALL, id });
    c.baseFlags = F.ALL;
    this.doors.push({ id, x, z, axis, w, h, locked, key, flag, label, lockedMsg, kind, open, color });
  }

  car(x, z, rot, color, { wreck = false, burnt = false, police = false, flags = F.MOVE | F.SHOT } = {}) {
    this.visuals.push({ k: 'car', x, z, rot, color, wreck, burnt, police });
    this.col(x, z, 2.2, 0.95, { rot, h: 1.5, flags });
  }

  bus(x, z, rot, color = '#2f7d4f', { burnt = false } = {}) {
    this.visuals.push({ k: 'bus', x, z, rot, color, burnt });
    this.col(x, z, 5.6, 1.3, { rot, h: 3.2, flags: F.ALL });
  }

  truck(x, z, rot, color = '#4a5a3a') {
    this.visuals.push({ k: 'truck', x, z, rot, color });
    this.col(x, z, 3.8, 1.25, { rot, h: 3, flags: F.ALL });
  }

  container(x, z, rot, color, stack = 1, { long = true } = {}) {
    const L = long ? 12.2 : 6.1;
    this.visuals.push({ k: 'container', x, z, rot, color, stack, len: L });
    this.col(x, z, L / 2, 1.22, { rot, h: 2.6 * stack, flags: F.ALL });
  }

  lamp(x, z, rot = 0, { h = 7, color = '#ffd9a0', broken = false, arm = 1.6 } = {}) {
    const hx = x + Math.sin(rot) * arm;
    const hz = z + Math.cos(rot) * arm;
    this.visuals.push({ k: 'lamp', x, z, rot, h, arm, broken });
    this.lamps.push({ x: hx, y: h - 0.3, z: hz, color, broken });
    this.col(x, z, 0.14, 0.14, { h, flags: F.MOVE | F.SHOT });
  }

  tree(x, z, s = 1) {
    this.visuals.push({ k: 'tree', x, z, s });
    this.col(x, z, 0.25 * s, 0.25 * s, { h: 3, flags: F.MOVE | F.SHOT });
  }

  barrier(x, z, rot, len = 3) {
    this.visuals.push({ k: 'barrier', x, z, rot, len });
    this.col(x, z, len / 2, 0.35, { rot, h: 0.9, flags: F.MOVE | F.SHOT });
  }

  sandbags(x, z, rot, len = 3, h = 1.2) {
    this.visuals.push({ k: 'sandbags', x, z, rot, len, h });
    this.col(x, z, len / 2, 0.45, { rot, h, flags: F.MOVE | F.SHOT });
  }

  /** 잡동사니 더미 (길막) */
  junk(x, z, w, d, rot = 0, seed = 1) {
    this.visuals.push({ k: 'junk', x, z, w, d, rot, seed });
    this.col(x, z, w / 2, d / 2, { rot, h: 2.2, flags: F.MOVE | F.SHOT });
  }

  /** 내려진 셔터 (골목 입구 막기) */
  shutter(x, z, w, axis, h = 3.2) {
    this.visuals.push({ k: 'shutter', x, z, w, axis, h });
    if (axis === 'x') this.col(x, z, w / 2, 0.12, { h, flags: F.ALL });
    else this.col(x, z, 0.12, w / 2, { h, flags: F.ALL });
  }

  stairs(x, z, rot, w, len, depth = 3) {
    this.visuals.push({ k: 'stairs', x, z, rot, w, len, depth });
  }

  light(x, y, z, color, { power = 1, range = 12, kind = 'point' } = {}) {
    this.lights.push({ x, y, z, color, power, range, kind });
  }

  fire(x, z, s = 1) {
    this.fires.push({ x, z, s });
    this.lights.push({ x, y: 1.4, z, color: '#ff8a3a', power: 1.4 * s, range: 14 * s, kind: 'fire' });
  }

  sign(x, y, z, rot, w, h, text, { color = '#ffffff', bg = '#1c3f7a', glow = true, flag = null, size = 0.62 } = {}) {
    this.signs.push({ x, y, z, rot, w, h, text, color, bg, glow, flag, size });
  }

  item(id, type, spots, extra = {}) {
    this.items.push({ id, type, spots: spots.map((s) => [s[0], s[1], s[2] ?? 0.9]), ...extra });
  }

  note(id, x, z, title, text, y = 1.2) {
    this.notes.push({ id, x, z, y, title, text });
  }

  interact(id, x, z, label, kind, { y = 1.2, r = 2.2, msg = null } = {}) {
    this.interacts.push({ id, x, z, y, r, label, kind, msg });
  }

  trigger(id, x0, z0, x1, z1) {
    this.triggers.push({ id, x0, z0, x1, z1 });
  }

  zombies(x, z, r, n) {
    this.groups.push({ x, z, r, n });
  }

  horde(x, z, tag) {
    this.hordes.push({ x, z, tag });
  }

  portal(id, x0, z0, x1, z1, to) {
    this.portals.push({ id, x0, z0, x1, z1, to });
  }

  /**
   * 골목 미로: 블록 사이 골목이 격자로 나 있고, 일부 골목 구간이 잡동사니로 막힌다.
   * 막히지 않은 골목만으로도 모든 교차로가 이어지도록(신장 트리) 만든다.
   *  - 노드 (i, j): i = 0..cols, j = 0..rows 인 골목 교차점
   *  - outsideRow: 이 줄의 노드는 바깥(큰길)이라 미로에 넣지 않고, exits 로 준 i 만 드나들 수 있다
   *  - skip(i, j): 블록 (i, j) 을 비워 광장으로
   */
  maze({ x0, z0, cols, rows, bw, bd, lane, seed, extraOpen = 0.25, outsideRow = null, exits = [], start = [0, 0], forceOpen = [], skip = () => false, onBlock, onBlocker, onExitBlocker }) {
    const R = rng(seed);
    const nx = (i) => x0 + lane / 2 + i * (bw + lane);
    const nz = (j) => z0 + lane / 2 + j * (bd + lane);
    const inside = (i, j) => i >= 0 && i <= cols && j >= 0 && j <= rows && j !== outsideRow;
    const edges = new Map(); // key → { a, b, open }
    const key = (a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${a}|${b}` : `${b}|${a}`);
    const plazaEdge = (a, b) => {
      // 광장 안쪽 골목(양옆 블록이 비었거나 광장에 닿음)은 막지 않는다
      if (a[1] === b[1]) {
        const i = Math.min(a[0], b[0]);
        const j = a[1];
        return (j - 1 >= 0 && skip(i, j - 1)) || (j < rows && skip(i, j));
      }
      const j = Math.min(a[1], b[1]);
      const i = a[0];
      return (i - 1 >= 0 && skip(i - 1, j)) || (i < cols && skip(i, j));
    };
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        if (!inside(i, j)) continue;
        if (inside(i + 1, j)) edges.set(key([i, j], [i + 1, j]), { a: [i, j], b: [i + 1, j], open: false });
        if (inside(i, j + 1)) edges.set(key([i, j], [i, j + 1]), { a: [i, j], b: [i, j + 1], open: false });
      }
    }
    // 무작위 깊이 우선 탐색으로 신장 트리
    const seen = new Set([`${start}`]);
    const stack = [start];
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const nbrs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dz]) => [cur[0] + dx, cur[1] + dz])
        .filter((n) => inside(n[0], n[1]) && !seen.has(`${n}`));
      if (!nbrs.length) {
        stack.pop();
        continue;
      }
      const nxt = nbrs[Math.floor(R() * nbrs.length)];
      edges.get(key(cur, nxt)).open = true;
      seen.add(`${nxt}`);
      stack.push(nxt);
    }
    for (const e of edges.values()) {
      if (!e.open && (R() < extraOpen || plazaEdge(e.a, e.b))) e.open = true;
    }
    for (const [a, b] of forceOpen) {
      const e = edges.get(key(a, b));
      if (e) e.open = true;
    }
    // 블록
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (skip(i, j)) continue;
        const bx0 = x0 + lane + i * (bw + lane);
        const bz0 = z0 + lane + j * (bd + lane);
        onBlock(i, j, bx0, bz0, bx0 + bw, bz0 + bd, R);
      }
    }
    // 막힌 골목 구간
    for (const e of edges.values()) {
      if (e.open) continue;
      const horiz = e.a[1] === e.b[1];
      const mx = (nx(e.a[0]) + nx(e.b[0])) / 2;
      const mz = (nz(e.a[1]) + nz(e.b[1])) / 2;
      onBlocker(mx, mz, horiz, R);
    }
    // 바깥으로 나가는 골목 입구
    if (outsideRow !== null) {
      const inner = outsideRow === 0 ? 1 : outsideRow - 1;
      for (let i = 0; i <= cols; i++) {
        if (exits.includes(i)) continue;
        const mz = (nz(outsideRow) + nz(inner)) / 2;
        onExitBlocker(nx(i), mz, R);
      }
    }
    return { nx, nz, edges: [...edges.values()] };
  }

  /** 모든 데이터를 한 덩어리로 */
  finish(extra) {
    return {
      colliders: this.colliders,
      visuals: this.visuals,
      grounds: this.grounds,
      lamps: this.lamps,
      lights: this.lights,
      items: this.items,
      notes: this.notes,
      doors: this.doors,
      interacts: this.interacts,
      triggers: this.triggers,
      groups: this.groups,
      hordes: this.hordes,
      signs: this.signs,
      fires: this.fires,
      portals: this.portals,
      regions: this.regions,
      ...extra,
    };
  }
}
