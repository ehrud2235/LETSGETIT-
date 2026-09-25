// 좀비 그리기: 부위마다 인스턴스 메시 하나 → 좀비가 80마리여도 11번만 그린다.
import * as THREE from 'three';
import { PARTS, poseMatrices, headGeometry } from './body.js';
import { faceTex } from './textures.js';

const MAX = 110;
const SHIRTS = ['#5a4a3a', '#3a4a5a', '#6a2a2a', '#2f3d2a', '#8a8a80', '#3a3a44', '#6a5a2a', '#4a2a4a', '#2a4a4a', '#7a6a5a', '#9a9a9a', '#1f2a44'];
const PANTS = ['#2a2a30', '#3a3a4a', '#4a3a2a', '#22282e', '#5a5048', '#2e3a4a'];
const SKIN = ['#8a9a82', '#9aa08e', '#7a8a7a', '#a09a86', '#8f9484', '#9a8f86'];
const SHOES = ['#1c1a18', '#2a2420', '#3a3a3a'];

export function zombieLook(variant) {
  const v = variant | 0;
  return {
    shirt: SHIRTS[v % SHIRTS.length],
    pants: PANTS[(v * 3) % PANTS.length],
    skin: SKIN[(v * 7) % SKIN.length],
    shoes: SHOES[(v * 5) % SHOES.length],
    short: v % 3 === 0,
    scale: 0.93 + ((v * 13) % 10) / 70,
  };
}

export class ZombieRenderer {
  constructor(scene) {
    this.meshes = PARTS.map((p) => {
      const geo = p.face ? headGeometry(p.size) : new THREE.BoxGeometry(...p.size);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, map: p.face ? faceTex() : null });
      const m = new THREE.InstancedMesh(geo, mat, MAX);
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    });
    this.anim = new Map(); // id → 애니메이션 상태
    this.mats = PARTS.map(() => new THREE.Matrix4());
    this.color = new THREE.Color();
  }

  /** list: [{ id, x, z, yaw, state, variant, speed, flags }] (보간된 위치) */
  update(list, dt, t) {
    let n = 0;
    const seen = new Set();
    for (const z of list) {
      if (n >= MAX) break;
      seen.add(z.id);
      let a = this.anim.get(z.id);
      if (!a) {
        a = { phase: Math.random() * 6, fallDir: Math.random() < 0.7 ? 1 : -1, roll: (Math.random() - 0.5) * 0.6, swing: 0, prevSwing: false, deadT: 0, look: zombieLook(z.variant), arms: 0 };
        this.anim.set(z.id, a);
      }
      poseMatrices(this.pose(z, a, dt, t), this.mats);
      const L = a.look;
      for (let p = 0; p < PARTS.length; p++) {
        this.meshes[p].setMatrixAt(n, this.mats[p]);
        const kind = PARTS[p].kind;
        this.color.set(kind === 'shirt' ? L.shirt : kind === 'pants' || kind === 'shoes' ? L.pants : kind === 'sleeve' ? (L.short ? L.skin : L.shirt) : L.skin);
        this.meshes[p].setColorAt(n, this.color);
      }
      n++;
    }
    for (const id of this.anim.keys()) if (!seen.has(id)) this.anim.delete(id);
    for (const m of this.meshes) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  pose(z, a, dt, t) {
    const L = a.look;
    const sp = z.speed;
    const p = { x: z.x, z: z.z, yaw: z.yaw, scale: L.scale };
    const idp = z.id * 1.37;
    if (z.state === 4) {
      // 쓰러짐: 0.6초 동안 뒤(또는 앞)로 넘어가고 그대로 누워 있다
      a.deadT += dt;
      const k = Math.min(1, a.deadT / 0.55);
      const e = k * k * (3 - 2 * k);
      p.fall = a.fallDir * e * (Math.PI / 2 - 0.08);
      p.fallRoll = a.roll * e;
      p.y = -e * 0.05 - Math.max(0, a.deadT - 12) * 0.05;
      p.armL = [0.3 + e * 1.2, 0.3 + e * 0.6];
      p.armR = [0.3 + e * 0.8, -0.3 - e * 0.8];
      p.legL = e * 0.3;
      p.legR = -e * 0.1;
      p.kneeL = -e * 0.4;
      p.head = [a.fallDir * e * 0.4, a.roll, 0];
      return p;
    }
    const chasing = z.state === 2 || z.state === 3;
    a.phase += dt * (0.8 + sp * 2.3);
    const ph = a.phase;
    const run = Math.min(1, sp / 4.5);
    const amp = sp < 0.2 ? 0 : 0.28 + run * 0.5;
    p.legL = Math.sin(ph) * amp;
    p.legR = -Math.sin(ph) * amp;
    p.kneeL = -(0.15 + Math.max(0, Math.sin(ph + 1.4)) * 1.1 * amp);
    p.kneeR = -(0.15 + Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * 1.1 * amp);
    p.bob = Math.abs(Math.sin(ph)) * 0.05 * run - 0.02;
    p.lean = -0.12 - run * 0.35;
    p.sway = Math.sin(ph * 0.5 + idp) * 0.05 + (sp < 0.2 ? Math.sin(t * 0.7 + idp) * 0.06 : 0);
    p.twist = Math.sin(ph) * 0.12 * run;
    p.head = [0.25 + Math.sin(t * 1.3 + idp) * 0.08, Math.sin(t * 0.6 + idp) * 0.3, 0.2 + Math.sin(t * 0.9 + idp) * 0.15];
    // 팔: 쫓아올 때 앞으로 뻗는다
    a.arms += ((chasing ? 1 : 0) - a.arms) * Math.min(1, dt * 4);
    const reach = a.arms;
    p.armL = [0.15 + reach * (1.25 + Math.sin(ph) * 0.2), 0.12 - reach * 0.05];
    p.armR = [0.1 + reach * (1.35 - Math.sin(ph) * 0.2), -0.12 + reach * 0.05];
    p.elbowL = reach * 0.25 + 0.15;
    p.elbowR = reach * 0.2 + 0.15;
    if (!chasing) {
      p.armL[0] += Math.sin(ph) * amp * 0.5;
      p.armR[0] -= Math.sin(ph) * amp * 0.5;
    }
    // 할퀴기
    const swinging = !!(z.flags & 2);
    if (swinging && !a.prevSwing) a.swing = 0.4;
    a.prevSwing = swinging;
    if (a.swing > 0) {
      a.swing -= dt;
      const k = 1 - a.swing / 0.4;
      const arc = Math.sin(k * Math.PI);
      p.armR = [2.3 - k * 1.9, -0.3 - arc * 0.5];
      p.armL = [2.0 - k * 1.2, 0.3 + arc * 0.3];
      p.lean -= arc * 0.3;
      p.twist += arc * 0.4;
    }
    // 밀쳐져 휘청
    if (z.flags & 1) {
      p.lean = 0.35;
      p.armL = [0.8 + Math.sin(t * 20) * 0.4, 0.8];
      p.armR = [0.8 - Math.sin(t * 20) * 0.4, -0.8];
    }
    // 총 맞은 순간 움찔
    if (z.flags & 4) {
      p.lean += 0.25;
      p.head[0] -= 0.4;
    }
    return p;
  }
}
