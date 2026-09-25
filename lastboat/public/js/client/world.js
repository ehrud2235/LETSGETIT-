// 맵 데이터를 3D 로. 같은 재질끼리 한 덩어리(mesh)로 합쳐서 그리는 횟수를 줄인다.
// 밤 조명: 달빛 + 손전등 + 가까운 불빛 몇 개만 진짜 조명, 나머지는 바닥의 빛 웅덩이와 전등 후광으로 흉내.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceTex, facadeTex, glowTex, chainTex, textTex, canvasTex } from './textures.js';
import { rng } from '../shared/mapkit.js';

const MATS = {
  asphalt: { scale: 6, rough: 0.95 },
  road: { tex: 'asphalt', scale: 6, rough: 0.9 },
  sidewalk: { scale: 4, rough: 0.9 },
  paving: { scale: 4, rough: 0.9 },
  brick: { scale: 3, rough: 0.9 },
  concrete: { scale: 5, rough: 0.92 },
  plaster: { scale: 4, rough: 0.95 },
  granite: { scale: 3, rough: 0.55 },
  corrugated: { scale: 3, rough: 0.6, metal: 0.35 },
  wood: { scale: 2, rough: 0.85 },
  tile: { scale: 2, rough: 0.55 },
  metal: { scale: 2, rough: 0.55, metal: 0.45 },
  painted: { scale: 3, rough: 0.6 },
  board: { scale: 1.6, rough: 0.95 },
  shelf: { scale: 3, rough: 0.8 },
  canvas: { scale: 3, rough: 1 },
  tunnel: { scale: 5, rough: 0.95 },
  ballast: { scale: 3, rough: 1 },
  platform: { scale: 3, rough: 0.8 },
  grass: { scale: 5, rough: 1 },
  sand: { scale: 3, rough: 1 },
  gravel: { scale: 3, rough: 1 },
  roof: { scale: 6, rough: 0.95 },
  shutter: { scale: 3, rough: 0.6, metal: 0.3 },
  trainHull: { scale: 8, rough: 0.45, metal: 0.4 },
  seat: { scale: 2, rough: 0.95 },
  rubber: { scale: 1, rough: 0.95 },
  glass: { scale: 3, rough: 0.15, metal: 0.6 },
  foliage: { color: true, rough: 1 },
  lampHead: { emissive: true },
};

const GROUND_Y = { road: 0.004, asphalt: 0.006, concrete: 0.008, gravel: 0.01, sand: 0.012, grass: 0.03, paving: 0.1, sidewalk: 0.12, tile: 0.02, platform: 0.02, ballast: 0.004, wood: 0.02 };

/** 같은 재질 도형을 모아 두었다가 한 번에 합친다 */
class Bag {
  constructor() {
    this.lists = new Map();
  }

  add(mat, geo) {
    if (!this.lists.has(mat)) this.lists.set(mat, []);
    this.lists.get(mat).push(geo);
  }
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3(1, 1, 1);
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** 월드 크기 기준 UV 를 가진 상자 (비색인, 색 속성 포함) */
function boxGeo(w, h, d, scale, color, offU = 0, offV = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // 면 순서: +x, -x, +y, -y, +z, -z (각 4 정점)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * (dims[f][0] / scale) + offU, uv.getY(i) * (dims[f][1] / scale) + offV);
    }
  }
  return colorize(g.toNonIndexed(), color);
}

function colorize(g, color) {
  const c = new THREE.Color(color || '#ffffff');
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function place(g, x, y, z, rot = 0, rx = 0, rz = 0) {
  const e = new THREE.Euler(rx, rot, rz, 'YXZ');
  tmpQ.setFromEuler(e);
  tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS);
  g.applyMatrix4(tmpM);
  return g;
}

/** 로컬 좌표(lx, ly, lz)를 (x, z, rot) 기준 월드로 */
function local(x, z, rot, lx, lz) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

export class World {
  constructor(scene, map, { quality = 'medium' } = {}) {
    this.scene = scene;
    this.map = map;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.bag = new Bag();
    this.facadeBags = new Map();
    this.chainGeos = [];
    this.materials = new Map();
    this.flags = { power: false };
    this.buildGround();
    for (const v of map.visuals) this.visual(v);
    this.flush();
    this.buildSigns();
    this.buildDoors();
    this.buildItems();
    this.buildInteracts();
    this.buildNotes();
    this.buildLights();
    this.buildFires();
    this.buildSky();
    this.buildBoat();
  }

  mat(name) {
    if (this.materials.has(name)) return this.materials.get(name);
    const def = MATS[name] || MATS.concrete;
    let m;
    if (def.emissive) {
      m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    } else if (def.color) {
      m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: def.rough, flatShading: true });
    } else {
      m = new THREE.MeshStandardMaterial({ map: surfaceTex(def.tex || name), vertexColors: true, roughness: def.rough ?? 0.9, metalness: def.metal ?? 0 });
    }
    this.materials.set(name, m);
    return m;
  }

  add(mat, geo) {
    this.bag.add(mat, geo);
  }

  box(mat, x, y0, z, w, h, d, { rot = 0, color = null, offU = 0, offV = 0, rx = 0, rz = 0 } = {}) {
    const scale = (MATS[mat] && MATS[mat].scale) || 3;
    const g = boxGeo(w, h, d, scale, color, offU, offV);
    place(g, x, y0 + h / 2, z, rot, rx, rz);
    this.add(mat, g);
  }

  flush() {
    for (const [mat, list] of this.bag.lists) {
      if (!list.length) continue;
      const g = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(g, this.mat(mat));
      mesh.castShadow = mat !== 'lampHead' && mat !== 'glass';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    for (const [style, list] of this.facadeBags) {
      const g = mergeGeometries(list, false);
      const f = facadeTex(style);
      const m = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.em, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.9, roughness: 0.9, vertexColors: true });
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    if (this.chainGeos.length) {
      const g = mergeGeometries(this.chainGeos, false);
      const t = chainTex();
      const m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5, vertexColors: true });
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.bag = new Bag();
    this.facadeBags = new Map();
    this.chainGeos = [];
  }

  // ─── 바닥 ──────────────────────────────────────────────────────────────────

  buildGround() {
    // 지상의 땅 (강과 바다는 비워 둔다)
    for (const [x0, z0, x1, z1] of [[-80, -80, 232, 330], [264, -80, 360, 330]]) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ((x1 - x0) / 6), uv.getY(i) * ((z1 - z0) / 6));
      g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      this.add('asphalt', colorize(g.toNonIndexed(), '#b0b0b0'));
    }
    this.map.grounds.forEach((gr, i) => {
      const w = gr.x1 - gr.x0;
      const d = gr.z1 - gr.z0;
      const y = (GROUND_Y[gr.mat] ?? 0.01) + i * 0.00025 + (gr.z0 > 380 ? 0 : 0);
      if (gr.mat === 'sidewalk' || gr.mat === 'paving') {
        this.box(gr.mat, gr.x0 + w / 2, 0, gr.z0 + d / 2, w, y, d);
      } else {
        const scale = (MATS[gr.mat] && MATS[gr.mat].scale) || 4;
        const g = new THREE.PlaneGeometry(w, d);
        g.rotateX(-Math.PI / 2);
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (w / scale), uv.getY(k) * (d / scale));
        g.translate(gr.x0 + w / 2, y, gr.z0 + d / 2);
        this.add(gr.mat === 'road' ? 'road' : gr.mat, colorize(g.toNonIndexed(), gr.mat === 'road' ? '#a8a8a8' : '#ffffff'));
      }
    });
  }

  // ─── 보이는 것들 ───────────────────────────────────────────────────────────

  visual(v) {
    switch (v.k) {
      case 'box':
        this.box(v.mat, v.x, v.y0 || 0, v.z, v.w, v.h, v.d, { rot: v.rot, color: v.color });
        break;
      case 'building':
        this.building(v);
        break;
      case 'fence':
        this.fence(v);
        break;
      case 'railing':
        this.railing(v);
        break;
      case 'roof':
        this.box(v.mat === 'granite' ? 'granite' : 'roof', (v.x0 + v.x1) / 2, v.y, (v.z0 + v.z1) / 2, v.x1 - v.x0, v.t, v.z1 - v.z0, { color: v.mat === 'granite' ? null : '#9a9a9a' });
        break;
      case 'floor':
        this.box(v.mat, (v.x0 + v.x1) / 2, 0, (v.z0 + v.z1) / 2, v.x1 - v.x0, 0.03, v.z1 - v.z0);
        break;
      case 'water':
        this.water(v);
        break;
      case 'skyline':
        this.skyline();
        break;
      case 'embank':
        this.box('concrete', v.x, -3, (v.z0 + v.z1) / 2, 0.6, 3.05, v.z1 - v.z0, { color: '#6a6c70' });
        break;
      case 'gatePanels':
        this.gatePanels(v);
        break;
      case 'parkingLines':
        for (let x = v.x0 + 2.4; x < v.x1; x += 4.8) for (const z of [v.z0 + 3, v.z0 + 15, v.z0 + 29]) this.box('painted', x, 0.012, z, 0.12, 0.004, 5.2, { color: '#d8d8d8' });
        break;
      case 'roadLines':
        this.roadLines(v);
        break;
      case 'car':
        this.car(v);
        break;
      case 'bus':
        this.bus(v);
        break;
      case 'truck':
        this.truck(v);
        break;
      case 'container':
        this.container(v);
        break;
      case 'lamp':
        this.lampPost(v);
        break;
      case 'tree':
        this.tree(v);
        break;
      case 'barrier':
        this.box('concrete', v.x, 0, v.z, v.len, 0.35, 0.7, { rot: v.rot, color: '#c8c8c4' });
        this.box('concrete', v.x, 0.35, v.z, v.len, 0.5, 0.3, { rot: v.rot, color: '#c8c8c4' });
        this.box('painted', v.x, 0.62, v.z, v.len * 0.9, 0.08, 0.31, { rot: v.rot, color: '#c83a2a' });
        break;
      case 'sandbags':
        this.sandbags(v);
        break;
      case 'junk':
        this.junk(v);
        break;
      case 'shutter':
        if (v.axis === 'x') this.box('shutter', v.x, 0, v.z, v.w, v.h, 0.22);
        else this.box('shutter', v.x, 0, v.z, 0.22, v.h, v.w);
        break;
      case 'stairs':
        this.stairs(v);
        break;
      case 'canopy':
        this.box('painted', (v.x0 + v.x1) / 2, v.h, (v.z0 + v.z1) / 2, v.x1 - v.x0, 0.7, v.z1 - v.z0, { color: '#d8d8d8' });
        this.box('painted', (v.x0 + v.x1) / 2, v.h + 0.05, v.z0 - 0.02, v.x1 - v.x0, 0.6, 0.06, { color: '#b8201c' });
        for (let x = v.x0 + 3; x < v.x1 - 1; x += 5) this.box('lampHead', x, v.h - 0.03, (v.z0 + v.z1) / 2, 1.6, 0.04, 0.5, { color: '#f4f8ff' });
        break;
      case 'transformer':
        this.box('metal', v.x, 0, v.z, 4, 3, 3.2, { color: '#7a8a86' });
        for (let k = -1; k <= 1; k++) this.box('metal', v.x + k * 1.2, 3, v.z, 0.25, 1.2, 0.25, { color: '#a8b0b0' });
        for (let k = -3; k <= 3; k++) this.box('metal', v.x + k * 0.5, 0.2, v.z + 1.75, 0.08, 2.4, 0.3, { color: '#5a6666' });
        break;
      case 'pylon':
        this.pylon(v);
        break;
      case 'tower':
        this.tower(v);
        break;
      case 'crane':
        this.crane(v);
        break;
      case 'pier':
        this.box('concrete', (v.x0 + v.x1) / 2, 0, (v.z0 + v.z1) / 2, v.x1 - v.x0, 0.05, v.z1 - v.z0, { color: '#8a8a86' });
        this.box('painted', v.x1 - 0.3, 0.05, (v.z0 + v.z1) / 2, 0.3, 0.02, v.z1 - v.z0, { color: '#d8b020' });
        break;
      case 'train':
        this.train(v);
        break;
      case 'turnstiles':
        for (let x = v.x0 + 0.5; x < v.x1; x += 1.8) {
          this.box('metal', x, 0, v.z, 1.3, 1.05, 0.5, { color: '#8a9098' });
          this.box('glass', x + 0.8, 0.5, v.z, 0.05, 0.6, 0.45);
        }
        break;
      case 'awning':
        this.awning(v);
        break;
      case 'ceiling':
        this.box('tunnel', (v.x0 + v.x1) / 2, v.y, (v.z0 + v.z1) / 2, v.x1 - v.x0, 0.3, v.z1 - v.z0, { color: '#6a6c70' });
        break;
      case 'bridge':
        this.bridge(v);
        break;
      case 'platformEdge':
        this.box('painted', (v.x0 + v.x1) / 2, 0.021, v.z - 0.35, v.x1 - v.x0, 0.006, 0.5, { color: '#d8b020' });
        this.box('granite', (v.x0 + v.x1) / 2, -0.9, v.z + 0.05, v.x1 - v.x0, 0.92, 0.1);
        break;
      case 'tracks':
        for (const z of v.zs) {
          for (const dz of [-0.72, 0.72]) this.box('metal', (v.x0 + v.x1) / 2, 0.005, z + dz, v.x1 - v.x0, 0.14, 0.08, { color: '#7a7470' });
          for (let x = v.x0; x < v.x1; x += 1.4) this.box('wood', x, 0.001, z, 0.22, 0.08, 2.4, { color: '#5a4a3a' });
        }
        break;
      case 'pond':
        this.water({ x0: v.x0, z0: v.z0, x1: v.x1, z1: v.z1, y: -0.25 });
        for (const [x0, z0, x1, z1] of [[v.x0 - 0.4, v.z0 - 0.4, v.x1 + 0.4, v.z0], [v.x0 - 0.4, v.z1, v.x1 + 0.4, v.z1 + 0.4], [v.x0 - 0.4, v.z0, v.x0, v.z1], [v.x1, v.z0, v.x1 + 0.4, v.z1]]) this.box('granite', (x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, 0.3, z1 - z0);
        break;
      default:
    }
  }

  building(v) {
    const style = v.style;
    const w = v.x1 - v.x0;
    const d = v.z1 - v.z0;
    const cx = (v.x0 + v.x1) / 2;
    const cz = (v.z0 + v.z1) / 2;
    if (style === 6) {
      this.box('corrugated', cx, 0, cz, w, v.h, d, { color: '#9aa2a8' });
      this.box('roof', cx, v.h, cz, w + 0.4, 0.4, d + 0.4);
      return;
    }
    const R = rng(v.seed || 1);
    const offU = Math.floor(R() * 8) * 3 / 24;
    const offV = Math.floor(R() * 8) * 3 / 24;
    const g = boxGeo(w, v.h, d, 24, '#ffffff', offU, offV);
    // 위·아래 면은 창문 없이 (지붕은 따로)
    place(g, cx, v.h / 2, cz);
    const pos = g.attributes.position;
    const keep = [];
    for (let i = 0; i < pos.count; i += 3) {
      const nY = g.attributes.normal.getY(i);
      if (Math.abs(nY) < 0.5) keep.push(i);
    }
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const src = g.attributes[name];
      const arr = new Float32Array(keep.length * 3 * src.itemSize);
      keep.forEach((i, n) => {
        for (let k = 0; k < 3; k++) for (let c = 0; c < src.itemSize; c++) arr[(n * 3 + k) * src.itemSize + c] = src.array[(i + k) * src.itemSize + c];
      });
      out.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize));
    }
    // 1층 높이가 3m 줄에 맞도록 세로 UV 를 0부터
    const uv = out.attributes.uv;
    const p = out.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setY(i, p.getY(i) / 24);
    if (!this.facadeBags.has(style)) this.facadeBags.set(style, []);
    this.facadeBags.get(style).push(out);
    if (v.roof) {
      this.box('roof', cx, v.h, cz, w + 0.3, 0.5, d + 0.3);
      if (v.h > 12 && R() < 0.6) this.box('metal', cx + (R() - 0.5) * w * 0.5, v.h + 0.5, cz + (R() - 0.5) * d * 0.5, 2.5, 2, 2.5, { color: '#6a6e72' });
    }
  }

  fence(v) {
    const len = Math.hypot(v.x1 - v.x0, v.z1 - v.z0);
    const rot = -Math.atan2(v.z1 - v.z0, v.x1 - v.x0);
    const cx = (v.x0 + v.x1) / 2;
    const cz = (v.z0 + v.z1) / 2;
    const g = new THREE.PlaneGeometry(len, v.h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / 1.2), uv.getY(i) * (v.h / 1.2));
    place(g, cx, v.h / 2, cz, rot);
    this.chainGeos.push(colorize(g.toNonIndexed(), '#ffffff'));
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.box('metal', v.x0 + (v.x1 - v.x0) * t, 0, v.z0 + (v.z1 - v.z0) * t, 0.08, v.h + 0.1, 0.08, { color: '#7a8088' });
    }
    this.box('metal', cx, v.h, cz, len, 0.06, 0.06, { rot, color: '#7a8088' });
  }

  railing(v) {
    const len = Math.hypot(v.x1 - v.x0, v.z1 - v.z0);
    const rot = -Math.atan2(v.z1 - v.z0, v.x1 - v.x0);
    const cx = (v.x0 + v.x1) / 2;
    const cz = (v.z0 + v.z1) / 2;
    for (const y of [0.5, 1.0]) this.box('metal', cx, y, cz, len, 0.06, 0.06, { rot, color: '#5a6068' });
    const n = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.box('metal', v.x0 + (v.x1 - v.x0) * t, 0, v.z0 + (v.z1 - v.z0) * t, 0.07, 1.1, 0.07, { color: '#5a6068' });
    }
  }

  gatePanels(v) {
    const axis = v.axis || 'x';
    for (const s of [-1, 1]) {
      const ang = v.open ? s * 1.2 : v.broken ? s * 0.5 : 0;
      const hx = axis === 'x' ? v.x + s * v.w / 2 : v.x;
      const hz = axis === 'x' ? v.z : v.z + s * v.w / 2;
      const len = v.w / 2;
      const baseRot = axis === 'x' ? 0 : -Math.PI / 2;
      const rot = baseRot + (s < 0 ? 0 : Math.PI) + ang;
      const [cx, cz] = local(hx, hz, rot, len / 2, 0);
      this.box('metal', cx, 0.1, cz, len, 0.08, 0.06, { rot, color: '#3a4048' });
      this.box('metal', cx, 1.9, cz, len, 0.08, 0.06, { rot, color: '#3a4048' });
      for (let k = 0; k < 6; k++) {
        const [bx, bz] = local(hx, hz, rot, (k + 0.5) * (len / 6), 0);
        this.box('metal', bx, 0.1, bz, 0.05, 1.85, 0.05, { color: '#3a4048' });
      }
    }
  }

  roadLines(v) {
    if (v.dir === 'x') {
      for (let x = v.x0 + 2; x < v.x1; x += 8) {
        this.box('painted', x, 0.013, v.z - 0.12, 4, 0.004, 0.12, { color: '#d8b020' });
        this.box('painted', x, 0.013, v.z + 0.12, 4, 0.004, 0.12, { color: '#d8b020' });
      }
      for (const dz of [-v.width / 2 + 0.6, v.width / 2 - 0.6]) this.box('painted', (v.x0 + v.x1) / 2, 0.013, v.z + dz, v.x1 - v.x0, 0.004, 0.15, { color: '#c8c8c8' });
      for (const dz of [-v.width / 4, v.width / 4]) for (let x = v.x0 + 3; x < v.x1; x += 10) this.box('painted', x, 0.013, v.z + dz, 3, 0.004, 0.12, { color: '#c8c8c8' });
    } else {
      // dir 'z': x0..x1 은 z 범위, z 는 중심 x
      for (let z = v.x0 + 2; z < v.x1; z += 8) this.box('painted', v.z, 0.013, z, 0.12, 0.004, 4, { color: '#d8b020' });
    }
  }

  car(v) {
    const R = rng(Math.floor(v.x * 131 + v.z * 71));
    const body = v.burnt ? '#2a2624' : v.color;
    const tilt = v.wreck ? (R() - 0.5) * 0.08 : 0;
    const roll = v.wreck ? (R() - 0.5) * 0.06 : 0;
    const P = (lx, lz) => local(v.x, v.z, v.rot, lx, lz);
    let [x, z] = P(0, 0);
    this.box('painted', x, 0.32, z, 4.3, 0.72, 1.86, { rot: v.rot, color: body, rx: roll, rz: tilt });
    [x, z] = P(-0.25, 0);
    this.box('painted', x, 1.02, z, 2.3, 0.55, 1.7, { rot: v.rot, color: body, rx: roll, rz: tilt });
    if (!v.burnt) this.box('glass', x, 1.07, z, 2.34, 0.42, 1.72, { rot: v.rot, rx: roll, rz: tilt });
    for (const [lx, lz] of [[1.35, 0.85], [1.35, -0.85], [-1.35, 0.85], [-1.35, -0.85]]) {
      [x, z] = P(lx, lz);
      this.box('rubber', x, 0, z, 0.7, 0.66, 0.26, { rot: v.rot });
    }
    if (!v.burnt) {
      for (const lz of [0.62, -0.62]) {
        [x, z] = P(2.16, lz);
        this.box('lampHead', x, 0.72, z, 0.04, 0.12, 0.34, { rot: v.rot, color: R() < 0.15 ? '#fff4c8' : '#3a3a34' });
        [x, z] = P(-2.16, lz);
        this.box('lampHead', x, 0.74, z, 0.04, 0.1, 0.32, { rot: v.rot, color: '#5a0a0a' });
      }
    }
    if (v.police) {
      [x, z] = P(-0.25, 0.4);
      this.box('lampHead', x, 1.58, z, 0.3, 0.12, 0.5, { rot: v.rot, color: '#ff2a2a' });
      [x, z] = P(-0.25, -0.4);
      this.box('lampHead', x, 1.58, z, 0.3, 0.12, 0.5, { rot: v.rot, color: '#2a5aff' });
      [x, z] = P(0, 0);
      this.box('painted', x, 0.66, z, 4.32, 0.14, 1.88, { rot: v.rot, color: '#1b3f8a' });
    }
  }

  bus(v) {
    const body = v.burnt ? '#242120' : v.color;
    const P = (lx, lz) => local(v.x, v.z, v.rot, lx, lz);
    let [x, z] = P(0, 0);
    this.box('painted', x, 0.4, z, 11.2, 2.8, 2.55, { rot: v.rot, color: body });
    this.box(v.burnt ? 'rubber' : 'glass', x, 1.55, z, 10.6, 1.0, 2.58, { rot: v.rot });
    for (const lx of [-3.8, 3.6]) {
      for (const lz of [1.2, -1.2]) {
        [x, z] = P(lx, lz);
        this.box('rubber', x, 0, z, 1.0, 0.95, 0.3, { rot: v.rot });
      }
    }
  }

  truck(v) {
    const P = (lx, lz) => local(v.x, v.z, v.rot, lx, lz);
    let [x, z] = P(2.6, 0);
    this.box('painted', x, 0.6, z, 2.2, 1.9, 2.3, { rot: v.rot, color: v.color });
    this.box('glass', x + 0, 1.6, z, 2.24, 0.6, 2.1, { rot: v.rot });
    [x, z] = P(-1.1, 0);
    this.box('painted', x, 0.6, z, 5.2, 0.5, 2.4, { rot: v.rot, color: '#3a4430' });
    this.box('canvas', x, 1.1, z, 5.2, 1.9, 2.4, { rot: v.rot });
    for (const lx of [2.6, -0.4, -2.6]) for (const lz of [1.1, -1.1]) {
      [x, z] = P(lx, lz);
      this.box('rubber', x, 0, z, 1.0, 1.0, 0.35, { rot: v.rot });
    }
  }

  container(v) {
    const L = v.len;
    for (let s = 0; s < v.stack; s++) {
      const c = new THREE.Color(v.color).multiplyScalar(0.85 + ((s * 37) % 10) / 40);
      this.box('corrugated', v.x, s * 2.6, v.z, L, 2.58, 2.44, { rot: v.rot, color: `#${c.getHexString()}` });
    }
  }

  lampPost(v) {
    this.box('metal', v.x, 0, v.z, 0.16, v.h, 0.16, { color: '#3a3e44' });
    const [ax, az] = [v.x + Math.sin(v.rot) * v.arm / 2, v.z + Math.cos(v.rot) * v.arm / 2];
    this.box('metal', ax, v.h - 0.1, az, 0.1, 0.1, v.arm, { rot: v.rot, color: '#3a3e44' });
    const [hx, hz] = [v.x + Math.sin(v.rot) * v.arm, v.z + Math.cos(v.rot) * v.arm];
    this.box('metal', hx, v.h - 0.28, hz, 0.5, 0.2, 0.7, { rot: v.rot, color: '#2a2e34' });
    this.box('lampHead', hx, v.h - 0.33, hz, 0.4, 0.05, 0.6, { rot: v.rot, color: v.broken ? '#2a2a2a' : '#ffe6b8' });
  }

  tree(v) {
    const s = v.s;
    const R = rng(Math.floor(v.x * 97 + v.z * 13));
    this.box('wood', v.x, 0, v.z, 0.3 * s, 2.6 * s, 0.3 * s, { color: '#4a3a2a' });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.IcosahedronGeometry((1.3 + R() * 0.6) * s, 0);
      g.scale(1, 0.85, 1);
      place(g, v.x + (R() - 0.5) * 1.2 * s, (2.8 + R() * 1.3) * s, v.z + (R() - 0.5) * 1.2 * s, R() * 6);
      const shade = 0.6 + R() * 0.4;
      this.add('foliage', colorize(g, new THREE.Color('#1f3a1c').multiplyScalar(shade)));
    }
  }

  sandbags(v) {
    const rows = Math.round(v.h / 0.3);
    const n = Math.max(1, Math.round(v.len / 0.7));
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < n; i++) {
        const lx = -v.len / 2 + (i + 0.5 + (r % 2) * 0.5) * (v.len / n);
        if (lx > v.len / 2) continue;
        const [x, z] = local(v.x, v.z, v.rot, lx, 0);
        this.box('canvas', x, r * 0.3, z, v.len / n - 0.05, 0.29, 0.85, { rot: v.rot, color: '#b8a878' });
      }
    }
  }

  junk(v) {
    const R = rng(v.seed || 1);
    const n = 5 + Math.floor(R() * 5);
    for (let i = 0; i < n; i++) {
      const lx = (R() - 0.5) * v.w * 0.9;
      const lz = (R() - 0.5) * v.d * 0.9;
      const [x, z] = local(v.x, v.z, v.rot, lx, lz);
      const t = R();
      const sz = 0.5 + R() * 0.9;
      const y = R() < 0.4 ? R() * 1.1 : 0;
      if (t < 0.4) this.box('wood', x, y, z, sz, sz * 0.8, sz, { rot: R() * 3, color: '#9a7a50' });
      else if (t < 0.7) this.box('metal', x, y, z, sz * 0.7, sz * 1.2, sz * 0.7, { rot: R() * 3, color: ['#3a5a3a', '#5a3a2a', '#3a4a6a'][Math.floor(R() * 3)] });
      else if (t < 0.85) this.box('rubber', x, y, z, 0.7, 0.25, 0.7, { rot: R() * 3 });
      else this.box('painted', x, 0, z, sz * 1.4, sz * 0.5, sz, { rot: R() * 3, color: '#6a6a6a', rx: R() * 0.4 });
    }
    this.box('wood', v.x, 0, v.z, v.w * 0.95, 0.9, v.d * 0.95, { rot: v.rot, color: '#6a5a40' });
  }

  stairs(v) {
    // 어둠 속으로 내려가는 계단처럼 보이게: 가로 줄무늬가 점점 어두워지는 판
    const tex = canvasTex('stairs', 128, 256, (g, w, h) => {
      for (let i = 0; i < 16; i++) {
        const k = 1 - i / 16;
        const v8 = Math.floor(120 * k * k);
        g.fillStyle = `rgb(${v8},${v8},${v8 + 4})`;
        g.fillRect(0, (i * h) / 16, w, h / 16);
        g.fillStyle = `rgb(${Math.floor(v8 * 1.4)},${Math.floor(v8 * 1.4)},${Math.floor(v8 * 1.4)})`;
        g.fillRect(0, (i * h) / 16, w, 3);
      }
    }, { repeat: false });
    const g = new THREE.PlaneGeometry(v.w, v.len);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ map: tex });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(v.x, 0.03, v.z);
    mesh.rotation.y = v.rot;
    this.group.add(mesh);
  }

  awning(v) {
    const col = v.color;
    const len = v.side === 'n' || v.side === 's' ? v.x1 - v.x0 : v.z1 - v.z0;
    if (v.side === 'n') this.box('canvas', (v.x0 + v.x1) / 2, 2.6, v.z0 - 0.6, len, 0.1, 1.2, { color: col, rx: -0.25 });
    if (v.side === 's') this.box('canvas', (v.x0 + v.x1) / 2, 2.6, v.z1 + 0.6, len, 0.1, 1.2, { color: col, rx: 0.25 });
    if (v.side === 'w') this.box('canvas', v.x0 - 0.6, 2.6, (v.z0 + v.z1) / 2, 1.2, 0.1, len, { color: col, rz: 0.25 });
    if (v.side === 'e') this.box('canvas', v.x1 + 0.6, 2.6, (v.z0 + v.z1) / 2, 1.2, 0.1, len, { color: col, rz: -0.25 });
  }

  pylon(v) {
    const h = v.h;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const g = new THREE.BoxGeometry(0.25, h, 0.25);
      const lean = 0.07;
      place(g, v.x + sx * 1.3, h / 2, v.z + sz * 1.3, 0, -sz * lean, sx * lean);
      this.add('metal', colorize(g.toNonIndexed(), '#6a7078'));
    }
    for (let y = 4; y < h; y += 4) {
      const w = 2.6 * (1 - y / h) + 0.6;
      for (const [dx, dz, rot] of [[0, -w / 2, 0], [0, w / 2, 0], [-w / 2, 0, Math.PI / 2], [w / 2, 0, Math.PI / 2]]) this.box('metal', v.x + dx, y, v.z + dz, w, 0.12, 0.12, { rot, color: '#6a7078' });
    }
    this.box('metal', v.x, h - 6, v.z, 9, 0.3, 0.3, { color: '#6a7078' });
    this.box('lampHead', v.x, h + 0.2, v.z, 0.4, 0.4, 0.4, { color: '#ff2a2a' });
  }

  tower(v) {
    this.box('concrete', v.x, 3.4, v.z, 4, v.h - 3.4, 4, { color: '#c0c4c8' });
    this.box('painted', v.x, v.h, v.z, 7, 0.4, 7, { color: '#d0d4d8' });
    this.box('glass', v.x, v.h + 0.4, v.z, 6.6, 2.4, 6.6);
    this.box('lampHead', v.x, v.h + 0.9, v.z, 6.62, 1.2, 6.62, { color: '#6a8aa0' });
    this.box('painted', v.x, v.h + 2.8, v.z, 7.2, 0.4, 7.2, { color: '#d0d4d8' });
    this.box('metal', v.x + 2, v.h + 3.2, v.z, 0.1, 4, 0.1, { color: '#888' });
    this.box('lampHead', v.x + 2, v.h + 7.2, v.z, 0.25, 0.25, 0.25, { color: '#ff2a2a' });
  }

  crane(v) {
    const H = 30;
    const col = '#c8a020';
    for (const [dx, dz] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) this.box('metal', v.x + dx, 0, v.z + dz, 1.1, H, 1.1, { color: col });
    for (const dz of [-5, 5]) this.box('metal', v.x, H, v.z + dz, 14, 1.2, 1.2, { color: col });
    this.box('metal', v.x + 12, H + 1.2, v.z, 40, 1.4, 3, { color: col });
    this.box('metal', v.x - 2, H + 1.2, v.z, 6, 3, 5, { color: '#8a9098' });
    for (const y of [8, 16, 24]) for (const dz of [-5, 5]) this.box('metal', v.x, y, v.z + dz, 12, 0.5, 0.5, { color: col });
    this.box('lampHead', v.x + 31, H + 2.2, v.z, 0.5, 0.5, 0.5, { color: '#ff2a2a' });
    this.box('lampHead', v.x - 6, H + 1.4, v.z - 5, 0.4, 0.4, 0.4, { color: '#ff2a2a' });
  }

  train(v) {
    const len = v.x1 - v.x0;
    const cx = (v.x0 + v.x1) / 2;
    const cz = (v.z0 + v.z1) / 2;
    const w = v.z1 - v.z0;
    if (!v.interior) {
      this.box('trainHull', cx, 0.2, cz, len, 3.3, w, { color: '#d0d4d8' });
      for (let x = v.x0 + 20; x < v.x1; x += 20) this.box('rubber', x, 0.2, cz, 0.4, 3.35, w + 0.05);
      return;
    }
    // 탈선 열차: 지붕·바닥·창문 띠·손잡이
    this.box('trainHull', cx, 3.2, cz, len, 0.3, w, { color: '#b9bec4' });
    this.box('tile', cx, 0, cz, len, 0.06, w - 0.5, { color: '#6a6e74' });
    for (const z of [v.z0 + 0.05, v.z1 - 0.05]) this.box('glass', cx, 1.3, z, len - 0.4, 0.9, 0.3);
    for (let x = v.x0 + 3; x < v.x1 - 2; x += 3.5) {
      this.box('metal', x, 0, cz - 1.1, 0.05, 3.2, 0.05, { color: '#c8ccd0' });
      this.box('metal', x + 1.6, 0, cz + 1.1, 0.05, 3.2, 0.05, { color: '#c8ccd0' });
    }
    this.box('metal', cx, 2.6, cz - 1.1, len, 0.04, 0.04, { color: '#c8ccd0' });
    this.box('metal', cx, 2.6, cz + 1.1, len, 0.04, 0.04, { color: '#c8ccd0' });
    for (let x = v.x0 + 4; x < v.x1; x += 8) this.box('lampHead', x, 3.17, cz, 1.4, 0.04, 0.3, { color: '#c8d4e0' });
  }

  bridge(v) {
    const cz = (v.z0 + v.z1) / 2;
    const w = v.z1 - v.z0;
    this.box('concrete', (v.x0 + v.gap0) / 2, -1.1, cz, v.gap0 - v.x0, 1.1, w, { color: '#7a7c80' });
    this.box('concrete', (v.gap1 + v.x1) / 2, -1.1, cz, v.x1 - v.gap1, 1.1, w, { color: '#7a7c80' });
    this.box('asphalt', (v.x0 + v.gap0) / 2, 0, cz, v.gap0 - v.x0, 0.02, w - 2);
    this.box('asphalt', (v.gap1 + v.x1) / 2, 0, cz, v.x1 - v.gap1, 0.02, w - 2);
    // 무너져 내린 조각
    this.box('concrete', v.gap0 + 2.5, -2.6, cz - 2, 6, 1, w * 0.6, { color: '#6a6c70', rz: -0.5 });
    this.box('concrete', v.gap1 - 2, -2.4, cz + 3, 5, 1, w * 0.5, { color: '#6a6c70', rz: 0.6 });
    for (const x of [v.x0 + 3, v.x1 - 3]) this.box('concrete', x, -8, cz, 2.5, 7, w * 0.7, { color: '#5a5c60' });
    for (const z of [v.z0 + 0.3, v.z1 - 0.3]) {
      this.box('metal', (v.x0 + v.gap0) / 2, 0, z, v.gap0 - v.x0, 1.1, 0.12, { color: '#5a6068' });
      this.box('metal', (v.gap1 + v.x1) / 2, 0, z, v.x1 - v.gap1, 1.1, 0.12, { color: '#5a6068' });
    }
  }

  water(v) {
    const t = canvasTex('water', 256, 256, (g, w, h) => {
      const R = rng(9);
      g.fillStyle = '#0a1420';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 600; i++) {
        g.fillStyle = `rgba(${60 + Math.floor(R() * 60)},${90 + Math.floor(R() * 60)},${120 + Math.floor(R() * 60)},${0.05 + R() * 0.12})`;
        g.fillRect(R() * w, R() * h, 6 + R() * 26, 1 + R() * 2);
      }
    });
    const g = new THREE.PlaneGeometry(v.x1 - v.x0, v.z1 - v.z0);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ((v.x1 - v.x0) / 20), uv.getY(i) * ((v.z1 - v.z0) / 20));
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.15, metalness: 0.6, color: '#8aa0b8' });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set((v.x0 + v.x1) / 2, v.y, (v.z0 + v.z1) / 2);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    (this.waters || (this.waters = [])).push(t);
  }

  skyline() {
    const R = rng(404);
    const spots = [];
    for (let i = 0; i < 90; i++) {
      const side = Math.floor(R() * 3);
      let x;
      let z;
      if (side === 0) { x = -40 - R() * 140; z = -120 + R() * 460; }
      else if (side === 1) { x = -160 + R() * 400; z = -30 - R() * 150; }
      else { x = -160 + R() * 400; z = 272 + R() * 100; }
      if (x > 228 && x < 268) continue;
      spots.push([x, z]);
    }
    for (const [x, z] of spots) {
      const w = 14 + R() * 24;
      const d = 14 + R() * 24;
      const h = 25 + R() * 70;
      this.building({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h, style: Math.floor(R() * 3), roof: true, seed: Math.floor(R() * 1e6) });
    }
  }

  // ─── 간판 ──────────────────────────────────────────────────────────────────

  buildSigns() {
    this.signs = [];
    for (const s of this.map.signs) {
      const tex = textTex(s.text, { w: 512, h: Math.max(64, Math.round((512 * s.h) / s.w)), color: s.color, bg: s.bg, size: s.size });
      const m = s.glow ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), m);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.rot;
      this.group.add(mesh);
      this.signs.push({ def: s, mesh });
    }
    this.applySignPower();
  }

  applySignPower() {
    for (const { def, mesh } of this.signs) {
      if (!def.flag) continue;
      const on = !!this.flags[def.flag];
      mesh.material.color.setScalar(on ? 1 : 0.12);
    }
  }

  // ─── 문 ────────────────────────────────────────────────────────────────────

  buildDoors() {
    this.doors = new Map();
    for (const d of this.map.doors) {
      const g = new THREE.Group();
      const pivot = new THREE.Group();
      g.add(pivot);
      g.position.set(d.x, 0, d.z);
      g.rotation.y = d.axis === 'x' ? 0 : -Math.PI / 2;
      const col = d.color || (d.kind === 'shutter' ? '#9aa0a6' : d.kind === 'gate' ? '#3a4048' : '#6a4a32');
      const mat = new THREE.MeshStandardMaterial({ color: col, map: surfaceTex(d.kind === 'shutter' ? 'shutter' : d.kind === 'gate' ? 'metal' : 'wood'), roughness: 0.7, metalness: d.kind === 'door' ? 0 : 0.4 });
      const parts = [];
      if (d.kind === 'shutter') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, 0.12), mat);
        m.position.y = d.h / 2;
        pivot.add(m);
        parts.push(m);
      } else if (d.kind === 'gate') {
        for (const s of [-1, 1]) {
          const half = new THREE.Group();
          half.position.x = s * d.w / 2;
          pivot.add(half);
          const bars = new THREE.Group();
          for (let k = 0; k <= 8; k++) {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, d.h, 0.06), mat);
            bar.position.set(-s * (k / 8) * (d.w / 2), d.h / 2, 0);
            bars.add(bar);
          }
          for (const y of [0.15, d.h / 2, d.h - 0.1]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(d.w / 2, 0.08, 0.08), mat);
            rail.position.set(-s * d.w / 4, y, 0);
            bars.add(rail);
          }
          half.add(bars);
          parts.push(half);
        }
      } else {
        const hinge = new THREE.Group();
        hinge.position.x = -d.w / 2;
        pivot.add(hinge);
        const m = new THREE.Mesh(new THREE.BoxGeometry(d.w - 0.04, d.h - 0.02, 0.06), mat);
        m.position.set(d.w / 2, d.h / 2, 0);
        hinge.add(m);
        const knob = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.14), new THREE.MeshStandardMaterial({ color: '#c8b070', metalness: 0.8, roughness: 0.3 }));
        knob.position.set(d.w - 0.18, 1.0, 0);
        hinge.add(knob);
        parts.push(hinge);
      }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(g);
      this.doors.set(d.id, { def: d, g, parts, open: d.open, t: d.open ? 1 : 0 });
    }
  }

  setDoor(id, open) {
    const d = this.doors.get(id);
    if (d) d.open = open;
  }

  // ─── 아이템 ────────────────────────────────────────────────────────────────

  buildItems() {
    this.items = new Map();
    const glow = new THREE.SpriteMaterial({ map: glowTex(), color: '#bfe0ff', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const def of this.map.items) {
      const g = makeItemModel(def.type);
      const halo = new THREE.Sprite(glow);
      halo.scale.set(0.9, 0.9, 1);
      halo.position.y = 0.15;
      g.add(halo);
      g.visible = false;
      this.group.add(g);
      this.items.set(def.id, { def, g, halo, state: null });
    }
  }

  setItems(items) {
    for (const [id, st] of Object.entries(items)) {
      const it = this.items.get(id);
      if (!it) continue;
      it.state = st;
      const persistent = st.type === 'shotgun' || st.type === 'rifle' || st.type === 'ammo';
      it.g.visible = !st.taken || persistent;
      it.g.position.set(st.x, st.y, st.z);
    }
  }

  // ─── 조작 장치·쪽지 ───────────────────────────────────────────────────────

  buildInteracts() {
    this.inters = new Map();
    for (const d of this.map.interacts) {
      if (d.kind === 'look') continue;
      const g = new THREE.Group();
      g.position.set(d.x, d.y, d.z);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false }));
      lamp.position.y = 0.35;
      g.add(lamp);
      const btn = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: d.kind === 'radio' ? '#2a3a2a' : '#c8a020', roughness: 0.5 }));
      g.add(btn);
      this.group.add(g);
      this.inters.set(d.id, { def: d, g, lamp });
    }
  }

  buildNotes() {
    const tex = canvasTex('note', 64, 80, (g, w, h) => {
      g.fillStyle = '#efe9d8';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(40,40,60,0.6)';
      for (let i = 0; i < 8; i++) g.fillRect(6, 10 + i * 8, 30 + (i * 13) % 20, 2);
    }, { repeat: false });
    const m = new THREE.MeshBasicMaterial({ map: tex, color: '#9a9a8a' });
    this.noteMeshes = [];
    for (const n of this.map.notes) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.4), m);
      mesh.position.set(n.x, n.y, n.z);
      // 가장 가까운 벽을 향하도록: 위에 놓인 쪽지는 눕힌다
      if (n.y < 1.1) mesh.rotation.x = -Math.PI / 2;
      else mesh.lookAt(n.x + (n.x % 1 < 0.5 ? 0 : 0), n.y, n.z + 1);
      this.group.add(mesh);
      this.noteMeshes.push(mesh);
    }
  }

  // ─── 불빛 ──────────────────────────────────────────────────────────────────

  buildLights() {
    const q = this.quality;
    this.poolSize = q === 'low' ? 4 : q === 'high' ? 10 : 7;
    this.sources = [];
    for (const l of this.map.lamps) if (!l.broken) this.sources.push({ x: l.x, y: l.y, z: l.z, color: l.color, base: 55, range: 22, kind: 'lamp', decal: 7 });
    for (const l of this.map.lights) {
      const base = { ceiling: 14, bulb: 7, flicker: 12, fire: 28, emergency: 7, flood: 90, siren: 10, power: 18, point: 12 }[l.kind] || 12;
      this.sources.push({ x: l.x, y: l.y, z: l.z, color: l.color, base: base * (l.power || 1), range: l.range * 1.4, kind: l.kind, decal: Math.min(9, l.range * 0.5), seed: Math.random() * 100 });
    }
    this.pool = [];
    for (let i = 0; i < this.poolSize; i++) {
      const pl = new THREE.PointLight('#ffffff', 0, 20, 2);
      pl.castShadow = false;
      this.scene.add(pl);
      this.pool.push({ light: pl, src: null, fade: 0 });
    }
    // 바닥의 빛 웅덩이 (가짜 조명)
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    decalGeo.rotateX(-Math.PI / 2);
    const decalMat = new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decals = new THREE.InstancedMesh(decalGeo, decalMat, this.sources.length);
    this.decals.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    const c = new THREE.Color();
    this.sources.forEach((s, i) => {
      const r = s.decal * 2;
      const gy = s.z > 380 ? 0.035 : 0.14;
      m4.compose(new THREE.Vector3(s.x, gy, s.z), new THREE.Quaternion(), new THREE.Vector3(r, 1, r));
      this.decals.setMatrixAt(i, m4);
      c.set(s.color).multiplyScalar(s.kind === 'fire' ? 0.25 : 0.18);
      this.decals.setColorAt(i, c);
    });
    this.group.add(this.decals);
    // 전등 후광 (안개 속 번짐)
    const pos = [];
    const col = [];
    for (const s of this.sources) {
      if (s.kind === 'fire') continue;
      pos.push(s.x, s.y, s.z);
      c.set(s.color).multiplyScalar(s.kind === 'emergency' ? 0.7 : 0.45);
      col.push(c.r, c.g, c.b);
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.halos = new THREE.Points(hg, new THREE.PointsMaterial({ size: 2.4, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }));
    this.halos.frustumCulled = false;
    this.group.add(this.halos);
    this.lightT = 0;
    this.applyPowerLights();
  }

  applyPowerLights() {
    const c = new THREE.Color();
    this.sources.forEach((s, i) => {
      const on = s.kind !== 'power' || this.flags.power;
      s.on = on;
      c.set(s.color).multiplyScalar(on ? (s.kind === 'fire' ? 0.25 : 0.18) : 0);
      this.decals.setColorAt(i, c);
    });
    this.decals.instanceColor.needsUpdate = true;
  }

  setFlags(flags) {
    const was = this.flags.power;
    this.flags = { ...flags };
    if (was !== this.flags.power) {
      this.applySignPower();
      this.applyPowerLights();
    }
  }

  updateLights(dt, t, cam) {
    this.lightT -= dt;
    const under = cam.z > 380;
    if (this.lightT <= 0) {
      this.lightT = 0.25;
      const cand = [];
      for (const s of this.sources) {
        if (!s.on || (s.z > 380) !== under) continue;
        const d = Math.hypot(s.x - cam.x, s.z - cam.z);
        if (d < 55) cand.push([d - (s.kind === 'flood' ? 15 : 0), s]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      const want = new Set(cand.slice(0, this.poolSize).map((c) => c[1]));
      for (const p of this.pool) if (p.src && !want.has(p.src)) p.src = null;
      for (const s of want) {
        if (this.pool.some((p) => p.src === s)) continue;
        const free = this.pool.find((p) => !p.src);
        if (free) {
          free.src = s;
          free.fade = 0;
          free.light.position.set(s.x, s.y - 0.2, s.z);
          free.light.color.set(s.color);
          free.light.distance = s.range;
        }
      }
    }
    for (const p of this.pool) {
      if (!p.src) {
        p.light.intensity *= Math.max(0, 1 - dt * 6);
        continue;
      }
      p.fade = Math.min(1, p.fade + dt * 3);
      const s = p.src;
      let k = 1;
      if (s.kind === 'flicker') k = Math.sin(t * 13 + s.seed) > 0.85 || Math.sin(t * 2.3 + s.seed * 3) > 0.97 ? 0.1 : 1;
      else if (s.kind === 'fire') k = 0.75 + 0.25 * Math.sin(t * 17 + s.seed) * Math.sin(t * 7.3 + s.seed);
      else if (s.kind === 'siren') {
        k = 1;
        p.light.color.set(Math.sin(t * 6) > 0 ? '#ff2a2a' : '#2a5aff');
      } else if (s.kind === 'emergency') k = 0.8 + 0.2 * Math.sin(t * 2 + s.seed);
      p.light.intensity = s.base * k * p.fade;
    }
  }

  // ─── 불 ────────────────────────────────────────────────────────────────────

  buildFires() {
    const n = this.map.fires.length * 24;
    this.fireData = [];
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (const f of this.map.fires) {
      for (let i = 0; i < 24; i++) this.fireData.push({ f, t: Math.random(), dx: (Math.random() - 0.5) * 1.6 * f.s, dz: (Math.random() - 0.5) * 1.6 * f.s, life: 0.6 + Math.random() * 0.8 });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.firePts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.3, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.firePts.frustumCulled = false;
    this.group.add(this.firePts);
  }

  updateFires(dt) {
    const pos = this.firePts.geometry.attributes.position;
    const col = this.firePts.geometry.attributes.color;
    this.fireData.forEach((p, i) => {
      p.t += dt / p.life;
      if (p.t > 1) {
        p.t = 0;
        p.dx = (Math.random() - 0.5) * 1.6 * p.f.s;
        p.dz = (Math.random() - 0.5) * 1.6 * p.f.s;
      }
      const k = p.t;
      pos.setXYZ(i, p.f.x + p.dx * (1 - k * 0.5), 0.7 + k * 2.4 * p.f.s, p.f.z + p.dz * (1 - k * 0.5));
      const a = (1 - k) * (k < 0.1 ? k * 10 : 1);
      col.setXYZ(i, 1 * a, (0.45 - k * 0.3) * a, 0.08 * a);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  // ─── 하늘 ──────────────────────────────────────────────────────────────────

  buildSky() {
    const g = new THREE.SphereGeometry(700, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color('#03050b') }, mid: { value: new THREE.Color('#0b1224') }, hor: { value: new THREE.Color('#2a2430') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.7, h)) : mix(hor, mid, smoothstep(-0.05, 0.15, h)); gl_FragColor = vec4(c, 1.0); }',
    });
    this.sky = new THREE.Mesh(g, m);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    // 별
    const R = rng(77);
    const sp = [];
    for (let i = 0; i < 1400; i++) {
      const a = R() * Math.PI * 2;
      const y = 0.12 + R() * 0.88;
      const r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(a) * r * 650, y * 650, Math.sin(a) * r * 650);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#c8d4ff', size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
    this.scene.add(this.stars);
    // 달
    const moonTex = canvasTex('moon', 128, 128, (g2, w, h) => {
      const gr = g2.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(240,244,255,1)');
      gr.addColorStop(0.32, 'rgba(225,232,250,1)');
      gr.addColorStop(0.36, 'rgba(160,180,230,0.35)');
      gr.addColorStop(1, 'rgba(100,120,200,0)');
      g2.fillStyle = gr;
      g2.fillRect(0, 0, w, h);
      g2.fillStyle = 'rgba(150,160,190,0.35)';
      for (const [x, y, r] of [[54, 52, 7], [72, 70, 5], [60, 76, 4]]) { g2.beginPath(); g2.arc(x, y, r, 0, 7); g2.fill(); }
    }, { repeat: false });
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, toneMapped: false }));
    this.moon.scale.set(90, 90, 1);
    this.moonDir = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();
    this.scene.add(this.moon);
  }

  // ─── 구조선 ────────────────────────────────────────────────────────────────

  buildBoat() {
    const g = new THREE.Group();
    const hullM = new THREE.MeshStandardMaterial({ color: '#c8ccd0', roughness: 0.6 });
    const redM = new THREE.MeshStandardMaterial({ color: '#8a1c1c', roughness: 0.7 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 30), redM);
    hull.position.y = -0.6;
    g.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.4, 29), hullM);
    deck.position.y = 1.1;
    g.add(deck);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 8), hullM);
    cabin.position.set(0, 2.9, 4);
    g.add(cabin);
    const win = new THREE.Mesh(new THREE.BoxGeometry(6.05, 0.9, 7), new THREE.MeshBasicMaterial({ color: '#ffe0a0', toneMapped: false }));
    win.position.set(0, 3.4, 4);
    g.add(win);
    const light = new THREE.SpotLight('#fff4d8', 0, 90, 0.35, 0.5, 1.2);
    light.position.set(0, 5, -2);
    light.target.position.set(-20, 0, 0);
    g.add(light, light.target);
    this.boatLight = light;
    g.visible = false;
    this.scene.add(g);
    this.boat = g;
  }

  updateBoat(boatT) {
    if (boatT < 0) {
      this.boat.visible = false;
      return;
    }
    const b = this.map.boat;
    this.boat.visible = true;
    const k = Math.min(1, boatT / 10);
    const e = 1 - (1 - k) * (1 - k);
    this.boat.position.set(b.from[0] + (b.to[0] - b.from[0]) * e, 0, b.from[1] + (b.to[1] - b.from[1]) * e);
    this.boat.rotation.z = Math.sin(boatT * 0.8) * 0.02;
    this.boatLight.intensity = 160;
  }

  // ─── 매 프레임 ─────────────────────────────────────────────────────────────

  update(dt, t, cam) {
    this.updateLights(dt, t, cam);
    this.updateFires(dt);
    for (const d of this.doors.values()) {
      const want = d.open ? 1 : 0;
      if (d.t !== want) {
        d.t += Math.sign(want - d.t) * Math.min(Math.abs(want - d.t), dt * 2.5);
        const k = d.t;
        if (d.def.kind === 'shutter') d.parts[0].position.y = d.def.h / 2 + k * (d.def.h - 0.3);
        else if (d.def.kind === 'gate') {
          d.parts[0].rotation.y = -k * 1.5;
          d.parts[1].rotation.y = k * 1.5;
        } else d.parts[0].rotation.y = -k * 1.6;
      }
    }
    for (const it of this.items.values()) {
      if (!it.g.visible) continue;
      it.halo.material.opacity = 0.25 + 0.12 * Math.sin(t * 3);
      const near = Math.hypot(it.g.position.x - cam.x, it.g.position.z - cam.z);
      it.halo.visible = near < 12;
    }
    for (const i of this.inters.values()) {
      const used = (i.def.kind === 'power' && this.flags.power) || (i.def.kind === 'gate' && this.flags.portGate) || (i.def.kind === 'radio' && this.flags.radio);
      i.lamp.material.color.set(used ? '#2aff5a' : Math.sin(t * 5) > 0 ? '#ff2a2a' : '#3a0a0a');
    }
    if (this.waters) for (const w of this.waters) w.offset.set(t * 0.01, t * 0.02);
    this.sky.position.copy(cam);
    this.stars.position.copy(cam);
    this.moon.position.copy(cam).addScaledVector(this.moonDir, 600);
    const under = cam.z > 380;
    this.sky.visible = !under;
    this.stars.visible = !under;
    this.moon.visible = !under;
  }
}

/** 바닥에 놓인 아이템 모양 */
export function makeItemModel(type) {
  const g = new THREE.Group();
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, ...o });
  const add = (w, h, d, mat, x = 0, y = 0, z = 0, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = ry;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  if (type === 'medkit') {
    add(0.42, 0.14, 0.3, M('#c8201c'));
    add(0.2, 0.01, 0.06, M('#ffffff', { emissive: '#555' }), 0, 0.14);
    add(0.06, 0.01, 0.2, M('#ffffff', { emissive: '#555' }), 0, 0.14);
  } else if (type === 'key') {
    add(0.05, 0.02, 0.16, M('#e8c040', { metalness: 0.9, roughness: 0.3, emissive: '#403010' }));
    add(0.1, 0.02, 0.08, M('#e8c040', { metalness: 0.9, roughness: 0.3, emissive: '#403010' }), 0, 0, -0.1);
    add(0.12, 0.03, 0.05, M('#2a60c0'), 0, 0, -0.18);
  } else if (type === 'ammo') {
    add(0.5, 0.26, 0.3, M('#3a4a2a'));
    add(0.5, 0.26, 0.3, M('#3a4a2a'), 0.05, 0.26, 0.02, 0.2);
    add(0.12, 0.05, 0.02, M('#e8c040'), 0, 0.2, 0.16);
  } else if (type === 'shotgun') {
    add(0.9, 0.08, 0.06, M('#1c1c1e', { metalness: 0.6 }), 0, 0.02);
    add(0.3, 0.1, 0.07, M('#5a3a22'), -0.5, 0);
    add(0.25, 0.07, 0.08, M('#3a2a1a'), 0.15, -0.01);
  } else if (type === 'rifle') {
    add(0.8, 0.07, 0.05, M('#1c1c1e', { metalness: 0.6 }), 0, 0.04);
    add(0.3, 0.12, 0.06, M('#2a2a2c'), -0.05, 0);
    add(0.08, 0.2, 0.05, M('#2a2a2c'), 0.05, -0.12);
    add(0.25, 0.1, 0.05, M('#2a2a2c'), -0.45, 0);
  }
  return g;
}
