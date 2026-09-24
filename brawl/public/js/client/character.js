// 캐릭터 모델: 물리 부위마다 말랑한 덩어리를 붙이고, 캐릭터별 의상·소품을 얹는다.
// 공식 아바타 그림이 아니라, 알려진 특징(색·소품)만 살린 오리지널 캐리커처다.
import * as THREE from 'three';
import { partLayout, PART_NAMES } from '../sim/fighter.js';
import { ROSTER_BY_ID } from '../sim/roster.js';
import { jellyMaterial } from './materials.js';

const geo = new Map();
function cached(key, make) {
  if (!geo.has(key)) geo.set(key, make());
  return geo.get(key);
}
const sphere = (r, ws = 24, hs = 18) => cached(`s${r}`, () => new THREE.SphereGeometry(r, ws, hs));
const capsule = (r, len) => cached(`c${r}:${len.toFixed(3)}`, () => new THREE.CapsuleGeometry(r, len, 8, 18));

function mesh(g, mat, parent, pos = [0, 0, 0], scale = null, rot = null) {
  const m = new THREE.Mesh(g, mat);
  m.position.set(...pos);
  if (scale) m.scale.set(...scale);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

/**
 * @returns {{ root: THREE.Group, parts: Record<string, THREE.Group>, update(status, t): void }}
 */
export function buildCharacter(charId, mods) {
  const c = ROSTER_BY_ID[charId] || ROSTER_BY_ID.wakgood;
  const look = c.look;
  const L = partLayout(mods.reach);
  const root = new THREE.Group();
  const parts = {};
  for (const name of PART_NAMES) {
    const g = new THREE.Group();
    g.matrixAutoUpdate = true;
    root.add(g);
    parts[name] = g;
  }
  const M = (color) => jellyMaterial(color);
  const skin = M(look.skin);
  const top = M(look.top);
  const sleeves = look.sleeves === 'skin' ? skin : M(look.sleeves);
  const pants = M(look.pants);
  const shoes = M(look.shoes);
  const black = M('#141418');
  const white = M('#ffffff');

  // 몸통 / 골반
  mesh(sphere(0.28), pants, parts.pelvis, [0, 0, 0], [1.08, 0.86, 0.98]);
  mesh(capsule(0.305, L.torso.hh * 2 + 0.04), top, parts.torso, [0, 0.01, 0], [1.02, 1, 0.94]);

  // 머리
  const hs = look.head || {};
  const sy = hs.sy || 1;
  const sz = hs.sz || 1;
  const headR = 0.285;
  mesh(sphere(headR, 28, 20), skin, parts.head, [0, 0.02 * sy, 0], [1, sy, sz]);
  const face = new THREE.Group();
  parts.head.add(face);
  const fz = headR * sz * 0.93;
  const eyeY = 0.03 * sy;
  switch (look.eyes) {
    case 'sunglasses': {
      const gl = new THREE.Group();
      mesh(cached('glass', () => new THREE.CapsuleGeometry(0.06, 0.06, 6, 12)), black, gl, [0.085, 0, 0], null, [0, 0, Math.PI / 2]);
      mesh(cached('glass', () => new THREE.CapsuleGeometry(0.06, 0.06, 6, 12)), black, gl, [-0.085, 0, 0], null, [0, 0, Math.PI / 2]);
      mesh(cached('bridge', () => new THREE.BoxGeometry(0.08, 0.02, 0.02)), black, gl, [0, 0.02, 0]);
      gl.position.set(0, eyeY + 0.02, fz);
      face.add(gl);
      break;
    }
    case 'big':
    case 'blue': {
      for (const sx of [1, -1]) {
        mesh(sphere(0.075, 16, 12), white, face, [0.1 * sx, eyeY, fz - 0.02], [1, 1.15, 0.6]);
        mesh(sphere(0.045, 12, 10), look.eyes === 'blue' ? M('#3c8dde') : black, face, [0.1 * sx, eyeY - 0.005, fz + 0.02], [1, 1.1, 0.6]);
        mesh(sphere(0.022, 10, 8), black, face, [0.1 * sx, eyeY - 0.005, fz + 0.035], [1, 1.1, 0.5]);
        mesh(sphere(0.014, 8, 6), white, face, [0.1 * sx + 0.018, eyeY + 0.025, fz + 0.045]);
      }
      break;
    }
    case 'clown': {
      for (const sx of [1, -1]) {
        mesh(cached('diamond', () => new THREE.OctahedronGeometry(0.06)), M('#3b6fe0'), face, [0.1 * sx, eyeY + 0.01, fz - 0.03], [0.7, 1.3, 0.3]);
        mesh(sphere(0.038, 12, 10), black, face, [0.1 * sx, eyeY, fz + 0.01], [1, 1.35, 0.5]);
      }
      mesh(cached('smile', () => new THREE.TorusGeometry(0.08, 0.018, 8, 16, Math.PI)), M('#e02424'), face, [0, -0.09 * sy, fz - 0.01], null, [0, 0, Math.PI]);
      break;
    }
    default:
      for (const sx of [1, -1]) mesh(sphere(0.042, 12, 10), black, face, [0.1 * sx, eyeY, fz], [1, 1.45, 0.5]);
  }
  if (look.nose) mesh(sphere(look.nose.size, 16, 12), M(look.nose.color), face, [0, -0.03 * sy, fz + look.nose.size * 0.35], [1, 0.85, 1.15]);

  // 머리카락
  if (look.hair) {
    const hm = M(look.hair.color);
    const hair = new THREE.Group();
    parts.head.add(hair);
    const cap = (frac, s = 1.06) => mesh(cached(`cap${frac}`, () => new THREE.SphereGeometry(headR, 26, 14, 0, Math.PI * 2, 0, Math.PI * frac)), hm, hair, [0, 0.02 * sy, -0.01], [s, sy * s, sz * s], [-0.35, 0, 0]);
    switch (look.hair.style) {
      case 'long':
        cap(0.55);
        mesh(capsule(0.2, 0.32), hm, hair, [0, -0.12, -0.14], [1.25, 1, 0.6]);
        break;
      case 'bob':
        cap(0.6, 1.1);
        for (const sx of [1, -1]) mesh(capsule(0.1, 0.18), hm, hair, [0.24 * sx, -0.06, -0.02], [1, 1, 1]);
        break;
      case 'twin':
        cap(0.5);
        for (const sx of [1, -1]) mesh(capsule(0.085, 0.3), hm, hair, [0.3 * sx, -0.18, -0.08], null, [0.2, 0, 0.25 * sx]);
        break;
      case 'slick':
        cap(0.42, 1.05);
        mesh(sphere(0.12, 12, 10), hm, hair, [0, 0.18 * sy, 0.14], [1.6, 0.6, 1]);
        break;
      case 'curly':
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          mesh(sphere(0.11, 12, 10), hm, hair, [Math.cos(a) * 0.24, 0.12 * sy + Math.sin(i * 1.7) * 0.04, Math.sin(a) * 0.2 - 0.05]);
        }
        mesh(sphere(0.14, 12, 10), hm, hair, [0, 0.26 * sy, -0.04]);
        break;
      default:
        cap(0.45, 1.05);
    }
  }

  // 팔
  for (const side of ['L', 'R']) {
    const u = L[`uArm${side}`];
    const l = L[`lArm${side}`];
    mesh(capsule(0.095, u.hh * 2 + 0.06), sleeves, parts[`uArm${side}`]);
    mesh(capsule(0.085, l.hh * 2 + 0.04), look.sleeves === 'skin' || look.extras?.includes('vest') ? (look.sleeves === 'skin' ? skin : sleeves) : sleeves, parts[`lArm${side}`]);
    mesh(sphere(0.115, 18, 14), look.extras?.includes('labcoat') || look.extras?.includes('skirt') ? white : skin, parts[`lArm${side}`], l.hand.off);
    // 다리
    const t = L[`thigh${side}`];
    const s = L[`shin${side}`];
    mesh(capsule(0.125, t.hh * 2 + 0.05), pants, parts[`thigh${side}`]);
    mesh(capsule(0.11, s.hh * 2 + 0.04), pants, parts[`shin${side}`]);
    mesh(sphere(0.125, 16, 12), shoes, parts[`shin${side}`], [s.foot.off[0], s.foot.off[1] + 0.01, s.foot.off[2] + 0.03], [1, 0.72, 1.4]);
  }

  // 소품
  const ex = new Set(look.extras || []);
  const tz = 0.28;
  if (ex.has('tie')) {
    mesh(cached('shirtV', () => new THREE.ConeGeometry(0.12, 0.26, 3)), white, parts.torso, [0, 0.18, tz - 0.02], [1, 1, 0.3], [Math.PI, 0, 0]);
    mesh(cached('tie', () => new THREE.BoxGeometry(0.06, 0.3, 0.03)), M('#c23b3b'), parts.torso, [0, 0.06, tz + 0.01]);
  }
  if (ex.has('labcoat')) {
    mesh(cached('coat', () => new THREE.CylinderGeometry(0.29, 0.36, 0.5, 22, 1, true)), jellyMaterial('#f4f6fb'), parts.pelvis, [0, -0.12, 0]).material.side = THREE.DoubleSide;
    mesh(cached('lapel', () => new THREE.BoxGeometry(0.07, 0.34, 0.03)), M('#dfe3ec'), parts.torso, [0.09, 0.05, tz], null, [0, 0, 0.2]);
    mesh(cached('lapel', () => new THREE.BoxGeometry(0.07, 0.34, 0.03)), M('#dfe3ec'), parts.torso, [-0.09, 0.05, tz], null, [0, 0, -0.2]);
    mesh(cached('inner', () => new THREE.BoxGeometry(0.1, 0.3, 0.02)), M('#4b3f6b'), parts.torso, [0, 0.05, tz - 0.01]);
  }
  if (ex.has('cap')) {
    const cm = M(look.cap || '#c8262b');
    mesh(cached('capdome', () => new THREE.SphereGeometry(0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), cm, parts.head, [0, 0.07 * sy, -0.01], [1, 0.75, 1]);
    mesh(cached('brim', () => new THREE.CylinderGeometry(0.19, 0.19, 0.025, 20, 1, false, -Math.PI / 2, Math.PI)), cm, parts.head, [0, 0.07 * sy, 0.17]);
    mesh(sphere(0.035, 10, 8), M('#f2c94c'), parts.head, [0, 0.16 * sy, 0.25]);
  }
  if (ex.has('mustache')) {
    for (const sx of [1, -1]) mesh(sphere(0.06, 12, 8), white, face, [0.045 * sx, -0.085 * sy, fz - 0.005], [1.4, 0.5, 0.6], [0, 0, -0.35 * sx]);
    for (const sx of [1, -1]) mesh(cached('brow', () => new THREE.BoxGeometry(0.09, 0.025, 0.03)), white, face, [0.1 * sx, eyeY + 0.08, fz - 0.01], null, [0, 0, 0.15 * sx]);
  }
  if (ex.has('skirt')) {
    const sk = mesh(cached('skirt', () => new THREE.CylinderGeometry(0.27, 0.44, 0.3, 24, 1, true)), M(look.top), parts.pelvis, [0, -0.06, 0]);
    sk.material.side = THREE.DoubleSide;
    mesh(cached('frill', () => new THREE.TorusGeometry(0.43, 0.035, 8, 28)), white, parts.pelvis, [0, -0.2, 0], null, [Math.PI / 2, 0, 0]);
  }
  if (ex.has('ribbon')) {
    const rm = M('#ff4f8f');
    for (const sx of [1, -1]) mesh(cached('bow', () => new THREE.ConeGeometry(0.08, 0.14, 12)), rm, parts.head, [0.08 * sx, 0.28 * sy, -0.08], null, [0, 0, (Math.PI / 2) * sx]);
    mesh(sphere(0.04, 10, 8), rm, parts.head, [0, 0.28 * sy, -0.08]);
  }
  if (ex.has('vest')) {
    mesh(cached('collar', () => new THREE.ConeGeometry(0.1, 0.18, 3)), white, parts.torso, [0, 0.22, tz - 0.02], [1, 1, 0.3], [Math.PI, 0, 0]);
    for (const y of [0.02, -0.08, -0.18]) mesh(sphere(0.022, 8, 6), M('#c9a24a'), parts.torso, [0, y, tz + 0.015]);
  }
  if (ex.has('bowtie')) {
    const bm = M('#b3122b');
    for (const sx of [1, -1]) mesh(cached('bowtie', () => new THREE.ConeGeometry(0.05, 0.09, 10)), bm, parts.torso, [0.045 * sx, 0.25, tz + 0.01], null, [0, 0, (Math.PI / 2) * sx]);
  }
  if (ex.has('dots')) {
    const dm = [M('#f3c623'), M('#2f6fd6'), M('#ffffff')];
    const pts = [[0.12, 0.1], [-0.1, 0.16], [0.02, -0.05], [-0.16, -0.08], [0.16, -0.12], [-0.02, 0.2]];
    pts.forEach(([x, y], i) => mesh(sphere(0.045, 10, 8), dm[i % 3], parts.torso, [x, y, 0.27 - Math.abs(x) * 0.25], [1, 1, 0.35]));
  }
  if (ex.has('antenna')) {
    const am = M('#3fae6a');
    for (const sx of [1, -1]) {
      mesh(cached('ant', () => new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6)), black, parts.head, [0.09 * sx, 0.36 * sy, 0], null, [0, 0, -0.35 * sx]);
      mesh(sphere(0.045, 10, 8), am, parts.head, [0.14 * sx, 0.5 * sy, 0]);
    }
  }
  if (ex.has('headphones')) {
    mesh(cached('band', () => new THREE.TorusGeometry(0.3, 0.028, 8, 24, Math.PI)), M('#222226'), parts.head, [0, 0.02 * sy, -0.02]);
    for (const sx of [1, -1]) mesh(cached('cup', () => new THREE.CylinderGeometry(0.085, 0.085, 0.07, 16)), M('#e8413a'), parts.head, [0.29 * sx, 0, -0.02], null, [0, 0, Math.PI / 2]);
  }
  if (ex.has('pizza')) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.11); shape.lineTo(0.09, 0.07); shape.lineTo(-0.09, 0.07); shape.closePath();
    mesh(cached('pizza', () => new THREE.ShapeGeometry(shape)), M('#f4c542'), parts.torso, [0.05, 0.05, tz + 0.02]).material.side = THREE.DoubleSide;
    for (const [x, y] of [[0.03, 0.04], [0.07, 0.02], [0.05, -0.03]]) mesh(sphere(0.016, 8, 6), M('#d93a2b'), parts.torso, [x, y, tz + 0.03]);
  }

  return {
    root,
    parts,
    /** 상태에 따른 표시 (지금은 따로 없음 — 몸짓이 전부) */
    update() {},
  };
}
