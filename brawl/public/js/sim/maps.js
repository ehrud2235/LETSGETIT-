// 맵 정의. 같은 데이터로 물리(충돌체)와 그래픽(메시)을 만든다.
// pieces: 고정된 지형, objects: 움직이는 물체(네트워크로 위치를 보냄), deco: 그래픽 전용 장식.
import { rapier } from './rapier.js';
import { G, groups } from './fighter.js';
import * as M from './math.js';

export function eulerQuat(rx = 0, ry = 0, rz = 0) {
  const c1 = Math.cos(rx / 2); const c2 = Math.cos(ry / 2); const c3 = Math.cos(rz / 2);
  const s1 = Math.sin(rx / 2); const s2 = Math.sin(ry / 2); const s3 = Math.sin(rz / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

/** three.js CylinderGeometry 와 같은 꼭짓점 배치의 각기둥 (seg 각형) */
export function prismPoints(r, h, seg) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push(r * Math.sin(a), h / 2, r * Math.cos(a), r * Math.sin(a), -h / 2, r * Math.cos(a));
  }
  return new Float32Array(pts);
}

function colliderDesc(R, s) {
  switch (s.shape) {
    case 'box': return R.ColliderDesc.cuboid(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2);
    case 'ball': return R.ColliderDesc.ball(s.r);
    case 'capsule': return R.ColliderDesc.capsule(s.h / 2, s.r);
    case 'cyl':
      return (s.seg || 24) >= 16 ? R.ColliderDesc.cylinder(s.h / 2, s.r) : R.ColliderDesc.convexHull(prismPoints(s.r, s.h, s.seg));
    default: throw new Error(`알 수 없는 모양 ${s.shape}`);
  }
}

// ─── 맵 데이터 ───────────────────────────────────────────────────────────────

const OCT_R = 5.15;
const octVertex = (i, r = OCT_R) => {
  const a = (i / 8) * Math.PI * 2;
  return [r * Math.sin(a), r * Math.cos(a)];
};

function octagonDef() {
  const pieces = [
    { shape: 'cyl', r: OCT_R, h: 0.6, seg: 8, pos: [0, -0.3, 0], color: '#3a4152', mat: 'canvas', top: 'octagon' },
    { shape: 'cyl', r: OCT_R + 0.55, h: 0.5, seg: 8, pos: [0, -0.62, 0], color: '#1c1f28', mat: 'metal', collide: false },
    { shape: 'cyl', r: 1.2, h: 16, seg: 16, pos: [0, -8.8, 0], color: '#15171e', mat: 'metal', collide: false },
  ];
  const objects = [];
  for (let i = 0; i < 8; i++) {
    const [x, z] = octVertex(i);
    pieces.push({ shape: 'cyl', r: 0.11, h: 1.75, seg: 12, pos: [x, 0.875, z], color: i % 4 === 0 ? '#d23c3c' : i % 4 === 2 ? '#2f6fd6' : '#20232b', mat: 'pad' });
    const am = ((i + 0.5) / 8) * Math.PI * 2;
    const rm = OCT_R * Math.cos(Math.PI / 8) - 0.04;
    objects.push({
      id: `fence${i}`, kind: 'kinematic', shape: 'box', size: [2 * OCT_R * Math.sin(Math.PI / 8) - 0.2, 1.6, 0.08],
      pos: [rm * Math.sin(am), 0.8, rm * Math.cos(am)], rot: [0, am, 0], color: '#2a2d35', mat: 'fence',
    });
  }
  const spawns = [0, 2, 4, 6].map((i) => {
    const a = ((i + 1) / 8) * Math.PI * 2;
    const x = 2.7 * Math.sin(a);
    const z = 2.7 * Math.cos(a);
    return [x, 0, z, Math.atan2(-x, -z)];
  });
  return {
    id: 'octagon',
    name: '옥타곤',
    desc: '공중에 매달린 MMA 케이지. 시간이 지나면 철창이 하나씩 떨어져 나간다.',
    env: {
      bg: '#070910', fog: ['#070910', 24, 62],
      hemi: ['#b7c3ff', '#1a1426', 0.55], sun: { color: '#fff4e6', intensity: 2.6, pos: [5, 16, 7], size: 8 },
      spots: [[-9, 11, 9, '#ffd9a8'], [9, 11, 9, '#a8c8ff'], [-9, 11, -9, '#ffb3c1'], [9, 11, -9, '#c1ffd6']],
    },
    camera: { yaw: 0, pitch: 0.86, fov: 40, minDist: 11, maxDist: 20, target: [0, 0.4, 0] },
    killY: -5,
    spawns,
    pieces,
    objects,
    deco: [{ type: 'arena', r: 26 }, { type: 'banner', text: '물렁 난투 · FIGHT NIGHT', pos: [0, 6.5, -16], w: 14, color: '#ff4d6d' }],
    init(ctx) {
      const order = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => ctx.rand() - 0.5);
      return { order, next: 0, nextAt: 16, drops: [] };
    },
    update(ctx, dt) {
      const st = ctx.state;
      if (ctx.sim.phase === 'fight' && st.next < 8 && ctx.sim.roundTime >= st.nextAt) {
        this.dropFence(ctx, st.order[st.next++]);
        st.nextAt += 13;
      }
      for (const d of st.drops) {
        d.t += dt;
        const o = ctx.objects[d.i];
        const y = 0.8 - Math.min(1, d.t / 0.7) ** 2 * 2.6;
        o.body.setNextKinematicTranslation({ x: o.def.pos[0], y, z: o.def.pos[2] });
      }
    },
    dropFence(ctx, i) {
      if (ctx.state.drops.some((d) => d.i === i)) return;
      ctx.state.drops.push({ i, t: 0 });
      const o = ctx.objects[i];
      ctx.sim.emit({ type: 'mapEvent', what: 'fenceDrop', id: o.def.id, pos: { x: o.def.pos[0], y: 0.8, z: o.def.pos[2] } });
    },
    suddenDeath(ctx) {
      for (let i = 0; i < 8; i++) this.dropFence(ctx, i);
      ctx.state.next = 8;
    },
  };
}

function rooftopDef() {
  const pieces = [
    { shape: 'box', size: [14, 1, 10], pos: [0, -0.5, 0], color: '#8d8a86', mat: 'concrete' },
    // 뒤쪽 난간 (중간에 틈)
    { shape: 'box', size: [5.6, 0.5, 0.3], pos: [-4.2, 0.25, -4.85], color: '#b2aca4', mat: 'concrete' },
    { shape: 'box', size: [5.6, 0.5, 0.3], pos: [4.2, 0.25, -4.85], color: '#b2aca4', mat: 'concrete' },
    // 옆 난간 (일부만)
    { shape: 'box', size: [0.3, 0.5, 4], pos: [-6.85, 0.25, -2.7], color: '#b2aca4', mat: 'concrete' },
    { shape: 'box', size: [0.3, 0.5, 3], pos: [6.85, 0.25, -3.2], color: '#b2aca4', mat: 'concrete' },
    // 바 카운터
    { shape: 'box', size: [4.2, 1.05, 0.8], pos: [-3.4, 0.525, -2.6], color: '#6b3f2a', mat: 'wood' },
    { shape: 'box', size: [4.4, 0.08, 1.0], pos: [-3.4, 1.09, -2.6], color: '#2b1b14', mat: 'wood' },
    { shape: 'box', size: [4.2, 1.6, 0.35], pos: [-3.4, 0.8, -4.3], color: '#3a261c', mat: 'wood' },
    // 간판 기둥과 간판
    { shape: 'cyl', r: 0.09, h: 3.6, seg: 12, pos: [1.2, 1.8, -4.55], color: '#2c2c33', mat: 'metal' },
    { shape: 'cyl', r: 0.09, h: 3.6, seg: 12, pos: [4.8, 1.8, -4.55], color: '#2c2c33', mat: 'metal' },
    { shape: 'box', size: [4.4, 1.3, 0.18], pos: [3, 3.05, -4.55], color: '#1a1320', mat: 'metal', sign: 'RUSUK BAR' },
    // 물탱크
    { shape: 'cyl', r: 1.05, h: 1.7, seg: 20, pos: [5.4, 1.75, 2.6], color: '#9aa7b3', mat: 'metal' },
    { shape: 'cyl', r: 0.07, h: 0.9, seg: 8, pos: [4.7, 0.45, 1.9], color: '#4a4f57', mat: 'metal' },
    { shape: 'cyl', r: 0.07, h: 0.9, seg: 8, pos: [6.1, 0.45, 1.9], color: '#4a4f57', mat: 'metal' },
    { shape: 'cyl', r: 0.07, h: 0.9, seg: 8, pos: [4.7, 0.45, 3.3], color: '#4a4f57', mat: 'metal' },
    { shape: 'cyl', r: 0.07, h: 0.9, seg: 8, pos: [6.1, 0.45, 3.3], color: '#4a4f57', mat: 'metal' },
    // 실외기
    { shape: 'box', size: [1.3, 0.9, 1.0], pos: [-5.6, 0.45, 2.6], color: '#d9d6cf', mat: 'metal' },
    { shape: 'box', size: [1.0, 0.7, 0.9], pos: [-1.2, 0.35, 3.6], color: '#d9d6cf', mat: 'metal' },
    // 옆 건물 (낮은 옥상, 뛰어서 건너갈 수 있음)
    { shape: 'box', size: [6, 1, 9], pos: [-11.2, -1.9, -0.5], color: '#6f6b67', mat: 'concrete' },
    { shape: 'box', size: [6, 40, 9], pos: [-11.2, -22.4, -0.5], color: '#3b3a45', mat: 'building', collide: false },
    { shape: 'box', size: [14, 40, 10], pos: [0, -21, 0], color: '#4a4552', mat: 'building', collide: false },
  ];
  const objects = [];
  [[-4.6, -1.7], [-3.4, -1.7], [-2.2, -1.7], [0.2, 1.2]].forEach(([x, z], i) => {
    objects.push({ id: `stool${i}`, kind: 'dynamic', shape: 'cyl', r: 0.22, h: 0.72, seg: 16, pos: [x, 0.37, z], color: '#c0392b', mat: 'plastic', density: 120 });
  });
  objects.push({ id: 'keg', kind: 'dynamic', shape: 'cyl', r: 0.3, h: 0.7, seg: 16, pos: [2.2, 0.36, 0.2], color: '#b08d57', mat: 'metal', density: 200 });
  return {
    id: 'rooftop',
    name: '루석바 옥상',
    desc: '해 질 녘 루석바 옥상. 가끔 거센 돌풍이 불어 사람을 난간 밖으로 밀어낸다.',
    env: {
      bg: '#f39a6b', sky: ['#40285e', '#e46a5b', '#ffc98a'], fog: ['#e89a7a', 22, 70],
      hemi: ['#ffd6b0', '#4a3a55', 0.8], sun: { color: '#ffd29a', intensity: 2.4, pos: [-10, 9, 6], size: 10 },
    },
    camera: { yaw: 0, pitch: 0.8, fov: 42, minDist: 11, maxDist: 21, target: [0, 0.5, 0] },
    killY: -6,
    spawns: [[-3, 0, 1.5, Math.PI * 0.75], [3, 0, 1.5, -Math.PI * 0.75], [-3.5, 0, -0.6, Math.PI * 0.5], [2.8, 0, -1.5, -Math.PI * 0.5]],
    pieces,
    objects,
    deco: [{ type: 'city', seed: 7 }, { type: 'bottles', pos: [-3.4, 1.62, -4.2], w: 3.8 }],
    init() {
      return { nextGust: 14, gust: null, every: 16, power: 1 };
    },
    update(ctx, dt) {
      const st = ctx.state;
      if (ctx.sim.phase === 'fight' && ctx.sim.roundTime >= st.nextGust && !st.gust) {
        const dir = ctx.rand() < 0.7 ? { x: 0, z: 1 } : { x: ctx.rand() < 0.5 ? -1 : 1, z: 0 };
        st.gust = { t: 0, dur: 2.6, dir };
        st.nextGust = ctx.sim.roundTime + st.every;
        ctx.sim.emit({ type: 'mapEvent', what: 'gust', dir, dur: 2.6 });
      }
      if (st.gust) {
        st.gust.t += dt;
        const k = Math.sin(Math.min(1, st.gust.t / st.gust.dur) * Math.PI) * 5.2 * st.power * dt;
        for (const f of ctx.sim.fighters) {
          if (f.out) continue;
          const resist = f.held(64) ? 0.5 : 1; // 달리기(버티기) 중이면 덜 밀린다
          f.forEachBody((b) => {
            const v = b.linvel();
            b.setLinvel({ x: v.x + st.gust.dir.x * k * resist, y: v.y, z: v.z + st.gust.dir.z * k * resist }, true);
          });
        }
        for (const o of ctx.objects) {
          if (!o.dynamic) continue;
          const v = o.body.linvel();
          o.body.setLinvel({ x: v.x + st.gust.dir.x * k * 1.3, y: v.y, z: v.z + st.gust.dir.z * k * 1.3 }, true);
        }
        if (st.gust.t >= st.gust.dur) st.gust = null;
      }
    },
    suddenDeath(ctx) {
      ctx.state.every = 7;
      ctx.state.power = 1.4;
      ctx.state.nextGust = Math.min(ctx.state.nextGust, ctx.sim.roundTime + 2);
    },
  };
}

function factoryDef() {
  const pieces = [
    { shape: 'box', size: [6, 1, 6], pos: [0, -0.5, 0], color: '#5b5f66', mat: 'metal', stripes: true },
    { shape: 'box', size: [7, 0.5, 2.6], pos: [-6.5, -0.25, 0], color: '#2a2c30', mat: 'belt', belt: -1 },
    { shape: 'box', size: [7, 0.5, 2.6], pos: [6.5, -0.25, 0], color: '#2a2c30', mat: 'belt', belt: 1 },
    // 벨트 옆 난간
    { shape: 'box', size: [7, 0.35, 0.12], pos: [-6.5, 0.17, -1.36], color: '#e8b923', mat: 'hazard' },
    { shape: 'box', size: [7, 0.35, 0.12], pos: [6.5, 0.17, -1.36], color: '#e8b923', mat: 'hazard' },
    // 뒤쪽 발판과 계단
    { shape: 'box', size: [6, 1.4, 1.6], pos: [0, -0.1, -3.8], color: '#4b4f56', mat: 'metal' },
    { shape: 'box', size: [2.2, 0.3, 1.6], pos: [-4.1, 1.45, -3.8], color: '#6d7179', mat: 'grate' },
    { shape: 'box', size: [2.2, 0.3, 1.6], pos: [4.1, 1.45, -3.8], color: '#6d7179', mat: 'grate' },
    { shape: 'box', size: [0.14, 3.2, 0.14], pos: [-5.1, 0, -4.5], color: '#e8b923', mat: 'hazard', collide: false },
    { shape: 'box', size: [0.14, 3.2, 0.14], pos: [5.1, 0, -4.5], color: '#e8b923', mat: 'hazard', collide: false },
    // 크레인 레일
    { shape: 'box', size: [22, 0.3, 0.3], pos: [0, 4.4, 0], color: '#3b3e44', mat: 'metal', collide: false },
    // 파쇄기 구덩이 (그래픽)
    { shape: 'box', size: [3, 0.4, 3.2], pos: [-11.6, -2.6, 0], color: '#1b1c1f', mat: 'metal', collide: false },
    { shape: 'box', size: [3, 0.4, 3.2], pos: [11.6, -2.6, 0], color: '#1b1c1f', mat: 'metal', collide: false },
  ];
  const objects = [];
  for (let i = 0; i < 4; i++) {
    objects.push({ id: `crate${i}`, kind: 'dynamic', shape: 'box', size: [0.75, 0.75, 0.75], pos: [-1.6 + i * 1.05, 0.4 + (i % 2) * 0.8, -1.8 + (i % 2) * 3.4], color: '#b07a3c', mat: 'crate', density: 90 });
  }
  objects.push({ id: 'hook', kind: 'kinematic', shape: 'box', size: [1.4, 0.18, 0.3], pos: [0, 3.1, 0], color: '#e8b923', mat: 'hazard' });
  objects.push({ id: 'crusherL', kind: 'kinematic', shape: 'box', size: [2.6, 1.4, 3], pos: [-11.6, -0.6, 0], color: '#8a2b24', mat: 'metal', noGrab: true });
  objects.push({ id: 'crusherR', kind: 'kinematic', shape: 'box', size: [2.6, 1.4, 3], pos: [11.6, -0.6, 0], color: '#8a2b24', mat: 'metal', noGrab: true });
  return {
    id: 'factory',
    name: '고멤 공장',
    desc: '컨베이어 벨트가 파쇄기 쪽으로 흘러간다. 천장 크레인에 매달려 건너갈 수도 있다.',
    env: {
      bg: '#1b1d22', fog: ['#1b1d22', 20, 55],
      hemi: ['#ffe2b8', '#262a33', 0.7], sun: { color: '#ffe0b0', intensity: 2.2, pos: [3, 14, 6], size: 12 },
      spots: [[-6, 6, 0, '#ffb070'], [6, 6, 0, '#ffb070']],
    },
    camera: { yaw: 0, pitch: 0.66, fov: 44, minDist: 17, maxDist: 26, target: [0, 0.4, 0] },
    killY: -3.2,
    killZones: [{ min: [-13.5, -3, -2], max: [-10, -0.2, 2] }, { min: [10, -3, -2], max: [13.5, -0.2, 2] }],
    spawns: [[-1.8, 0, 1.6, Math.PI * 0.8], [1.8, 0, 1.6, -Math.PI * 0.8], [-1.8, 0, -1.2, Math.PI * 0.3], [1.8, 0, -1.2, -Math.PI * 0.3]],
    pieces,
    objects,
    deco: [{ type: 'factory' }],
    init() {
      return { beltSpeed: 1.9, crusherPhase: 0 };
    },
    update(ctx, dt) {
      const st = ctx.state;
      const t = ctx.sim.time;
      // 벨트: 위에 있는 것을 바깥쪽으로 민다
      const onBelt = (p) => Math.abs(p.z) < 1.35 && Math.abs(p.x) > 3.05 && Math.abs(p.x) < 10 && p.y > -0.2 && p.y < 1.1;
      for (const f of ctx.sim.fighters) {
        if (f.out) continue;
        const p = f.bodies.pelvis.translation();
        if (!onBelt(p)) continue;
        const dir = Math.sign(p.x);
        f.forEachBody((b, name) => {
          if (!['pelvis', 'thighL', 'thighR', 'shinL', 'shinR', 'torso'].includes(name)) return;
          const v = b.linvel();
          b.setLinvel({ x: v.x + (dir * st.beltSpeed - v.x) * 0.06, y: v.y, z: v.z }, true);
        });
      }
      for (const o of ctx.objects) {
        if (!o.dynamic) continue;
        const p = o.body.translation();
        if (onBelt(p)) {
          const v = o.body.linvel();
          o.body.setLinvel({ x: v.x + (Math.sign(p.x) * st.beltSpeed - v.x) * 0.1, y: v.y, z: v.z }, true);
        }
        if (p.y < -4) {
          // 떨어진 상자는 위에서 다시 떨어뜨린다
          o.body.setTranslation({ x: (ctx.rand() - 0.5) * 3, y: 7, z: (ctx.rand() - 0.5) * 2 }, true);
          o.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          o.body.setAngvel({ x: ctx.rand(), y: ctx.rand(), z: 0 }, true);
        }
      }
      // 크레인 고리: 좌우로 왕복
      const hook = ctx.byId.hook;
      hook.body.setNextKinematicTranslation({ x: Math.sin(t * 0.32) * 9, y: 3.1, z: 0 });
      // 파쇄기: 쿵쿵 내려찍는다
      for (const [id, off] of [['crusherL', 0], ['crusherR', Math.PI]]) {
        const c = ctx.byId[id];
        const ph = (t * 1.4 + off) % (Math.PI * 2);
        const y = -0.6 - Math.max(0, Math.sin(ph)) * 1.5;
        c.body.setNextKinematicTranslation({ x: c.def.pos[0], y, z: 0 });
      }
    },
    suddenDeath(ctx) {
      ctx.state.beltSpeed = 3.3;
    },
  };
}

function pitchDef() {
  const pieces = [
    { shape: 'cyl', r: 0.5, h: 18, seg: 16, pos: [0, -9.6, 0], color: '#cfd8e3', mat: 'metal', collide: false },
  ];
  const objects = [
    {
      id: 'pitch', kind: 'dynamic', shape: 'box', size: [12, 0.5, 7.5], pos: [0, -0.25, 0], color: '#3fae4f', mat: 'grass', density: 900, pitch: true,
      parts: [
        // 골대 (같은 몸체에 붙은 충돌체) — 위치는 발판 중심 기준
        { shape: 'box', size: [0.14, 1.9, 0.14], pos: [-5.7, 1.2, -1.4], color: '#ffffff' },
        { shape: 'box', size: [0.14, 1.9, 0.14], pos: [-5.7, 1.2, 1.4], color: '#ffffff' },
        { shape: 'box', size: [0.14, 0.14, 2.94], pos: [-5.7, 2.1, 0], color: '#ffffff' },
        { shape: 'box', size: [0.14, 1.9, 0.14], pos: [5.7, 1.2, -1.4], color: '#ffffff' },
        { shape: 'box', size: [0.14, 1.9, 0.14], pos: [5.7, 1.2, 1.4], color: '#ffffff' },
        { shape: 'box', size: [0.14, 0.14, 2.94], pos: [5.7, 2.1, 0], color: '#ffffff' },
      ],
    },
    { id: 'ball', kind: 'dynamic', shape: 'ball', r: 0.42, pos: [0, 0.8, 0], color: '#ffffff', mat: 'ball', density: 35, restitution: 0.75, hitMul: 1.6 },
  ];
  return {
    id: 'pitch',
    name: '비밀 FC 하늘 구장',
    desc: '구름 위에 떠 있는 풋살장. 사람이 몰리는 쪽으로 기울어진다. 축구공 조심!',
    env: {
      bg: '#8fd0ff', sky: ['#4a9fe8', '#9fd8ff', '#e8f6ff'], fog: ['#cfeaff', 30, 90],
      hemi: ['#ffffff', '#88b37a', 0.9], sun: { color: '#fff7e0', intensity: 2.8, pos: [6, 18, 9], size: 11 },
    },
    camera: { yaw: 0, pitch: 0.74, fov: 42, minDist: 12, maxDist: 22, target: [0, 0.3, 0] },
    killY: -6,
    spawns: [[-3.5, 0.3, 1.8, Math.PI * 0.5], [3.5, 0.3, 1.8, -Math.PI * 0.5], [-3.5, 0.3, -1.8, Math.PI * 0.5], [3.5, 0.3, -1.8, -Math.PI * 0.5]],
    pieces,
    objects,
    deco: [{ type: 'clouds', seed: 3 }],
    init(ctx) {
      // 발판을 가운데 기둥에 z 축 경첩으로 매단다 (좌우로 기울어짐)
      const R = ctx.R;
      const pitch = ctx.byId.pitch.body;
      const jd = R.JointData.revolute({ x: 0, y: -0.25, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
      const j = ctx.world.createImpulseJoint(jd, ctx.fixed, pitch, true);
      j.setContactsEnabled(false);
      return { spring: 1, limit: 0.32, ballOutT: 0 };
    },
    update(ctx, dt) {
      const st = ctx.state;
      const pitch = ctx.byId.pitch.body;
      const q = pitch.rotation();
      // z 축 기울기 각도
      const right = M.qRotate(q, { x: 1, y: 0, z: 0 });
      const angle = Math.atan2(right.y, right.x);
      const w = pitch.angvel();
      let wz = w.z - angle * 2.4 * st.spring * dt * 60 * 0.05 - w.z * 0.04;
      if (Math.abs(angle) > st.limit && Math.sign(wz) === Math.sign(angle)) wz *= 0.3;
      pitch.setAngvel({ x: 0, y: 0, z: wz }, true);
      // 공이 떨어지면 가운데로
      const ball = ctx.byId.ball.body;
      if (ball.translation().y < -5) {
        st.ballOutT += dt;
        if (st.ballOutT > 2) {
          st.ballOutT = 0;
          ball.setTranslation({ x: 0, y: 4, z: 0 }, true);
          ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    },
    suddenDeath(ctx) {
      ctx.state.spring = 0.45;
      ctx.state.limit = 0.5;
    },
  };
}

export const MAP_LIST = [octagonDef(), rooftopDef(), factoryDef(), pitchDef()];
export const MAPS = Object.fromEntries(MAP_LIST.map((m) => [m.id, m]));

// ─── 맵 만들기 ───────────────────────────────────────────────────────────────

export function buildMap(id, sim, seed = 1) {
  const def = MAPS[id] || MAPS.octagon;
  const R = rapier();
  const world = sim.world;
  const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
  const envGroups = groups(G.ENV, G.ALL);
  for (const p of def.pieces) {
    if (p.collide === false) continue;
    const cd = colliderDesc(R, p)
      .setTranslation(p.pos[0], p.pos[1], p.pos[2])
      .setRotation(eulerQuat(...(p.rot || [0, 0, 0])))
      .setFriction(p.friction ?? 0.9)
      .setRestitution(p.restitution ?? 0.05)
      .setCollisionGroups(envGroups);
    const col = world.createCollider(cd, fixed);
    sim.registerCollider(col, { type: 'env', noGrab: !!p.noGrab });
  }

  const objects = [];
  const byId = {};
  for (const o of def.objects) {
    const q = eulerQuat(...(o.rot || [0, 0, 0]));
    const bd = (o.kind === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
      .setTranslation(o.pos[0], o.pos[1], o.pos[2])
      .setRotation(q);
    if (o.kind === 'dynamic') bd.setCcdEnabled(true).setAngularDamping(0.4).setLinearDamping(0.05);
    const body = world.createRigidBody(bd);
    const isProp = o.kind === 'dynamic' && !o.pitch;
    const cg = isProp ? groups(G.PROP, G.ALL) : envGroups;
    const info = { type: isProp ? 'prop' : 'env', body, noGrab: !!o.noGrab, hitMul: o.hitMul, id: o.id };
    for (const part of [o, ...(o.parts || [])]) {
      const cd = colliderDesc(R, part).setDensity(o.density || 100).setFriction(o.friction ?? 0.8)
        .setRestitution(part === o ? o.restitution ?? 0.1 : 0.1).setCollisionGroups(cg)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      if (part !== o) cd.setTranslation(part.pos[0], part.pos[1], part.pos[2]);
      const col = world.createCollider(cd, body);
      sim.registerCollider(col, info);
    }
    const obj = { id: o.id, def: o, body, dynamic: o.kind === 'dynamic', info };
    objects.push(obj);
    byId[o.id] = obj;
    sim.registerBody(body, { type: 'object', obj });
  }

  const ctx = { sim, world, R, fixed, objects, byId, rand: M.rng(seed), state: {}, def };
  ctx.state = def.init ? def.init(ctx) : {};
  const zones = def.killZones || [];
  return {
    id: def.id,
    def,
    objects,
    byId,
    spawns: def.spawns,
    killY: def.killY,
    inKillZone(p) {
      return zones.some((z) => p.x > z.min[0] && p.x < z.max[0] && p.y > z.min[1] && p.y < z.max[1] && p.z > z.min[2] && p.z < z.max[2]);
    },
    update(dt) {
      if (def.update) def.update(ctx, dt);
    },
    suddenDeath() {
      if (def.suddenDeath) def.suddenDeath(ctx);
    },
  };
}
