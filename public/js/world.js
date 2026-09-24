// 3D 방 만들기. 두 방은 치수와 가구 배치가 완전히 같고, 색감과 물건의 상태만 다르다.
// (눈높이도 다르다: 노을의 방에서는 아이의 눈높이로 세상을 본다.)
import * as THREE from 'three';
import * as TX from './textures.js';

export const ROOM = { xMin: -3, xMax: 3, zMin: -2.5, zMax: 2.5, height: 2.7 };
export const EYE = { A: 1.62, B: 1.18 };
export const SPAWN = { x: 0.3, z: 1.1, yaw: Math.PI / 2 };

// 가구 충돌 영역 (x/z 평면)
export const COLLIDERS = [
  { minX: -2.92, maxX: -1.48, minZ: -2.5, maxZ: -0.48 }, // 침대
  { minX: -1.42, maxX: -0.88, minZ: -2.5, maxZ: -2.02 }, // 협탁
  { minX: 1.3, maxX: 2.82, minZ: -2.5, maxZ: -1.86 }, // 책상
  { minX: 2.6, maxX: 3, minZ: -0.54, maxZ: 0.54 }, // 책장
  { minX: 1.82, maxX: 2.58, minZ: 1.32, maxZ: 1.88 }, // 상자
];

// 디버그/자동 테스트용: 각 물건을 바라볼 위치와 시선
export const ANCHORS = {
  switch: { stand: [-2.2, 0.15], look: [-2.985, 1.25, 0.12] },
  door: { stand: [-2.0, 0.9], look: [-2.97, 1.3, 1.0] },
  window: { stand: [-1.0, -1.3], look: [-1.75, 1.95, -2.5] },
  plant: { stand: [-0.9, -1.6], look: [-1.05, 1.16, -2.38] },
  clock: { stand: [-0.1, -1.2], look: [-0.1, 2.12, -2.47] },
  frame: { stand: [-0.1, -1.4], look: [-0.1, 1.5, -2.47] },
  mirror: { stand: [0.8, -1.3], look: [0.8, 1.2, -2.47] },
  wallart: { stand: [1.9, -1.2], look: [1.95, 1.72, -2.48] },
  desk: { stand: [1.6, -1.2], look: [1.57, 0.55, -1.9] },
  radio: { stand: [2.3, -1.3], look: [2.42, 0.87, -2.2] },
  nightstand: { stand: [-1.0, -1.5], look: [-1.15, 0.4, -2.04] },
  bed: { stand: [-1.0, -0.6], look: [-2.0, 0.5, -1.2] },
  shelf: { stand: [2.0, 0], look: [2.8, 1.2, 0] },
  box: { stand: [1.3, 1.0], look: [2.2, 0.3, 1.6] },
  ceiling: { stand: [0, -0.1], look: [0, 2.7, -0.95] },
};

const DIGITS = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  3: ['###', '..#', '###', '..#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
};

function digitStars() {
  const cell = 0.075;
  const gap = 0.12;
  const code = '0314';
  const width = code.length * cell * 3 + (code.length - 1) * gap;
  const x0 = -width / 2 + cell / 2;
  const pts = [];
  [...code].forEach((d, i) => DIGITS[d].forEach((row, r) => [...row].forEach((c, col) => {
    // 고개를 들어 천장을 보면 화면 위쪽이 등 뒤(+z) 방향이다. 그래서 윗줄이 +z 쪽에 온다.
    if (c === '#') pts.push([x0 + i * (cell * 3 + gap) + col * cell, -0.8 - r * cell]);
  })));
  return pts;
}

function decoStars() {
  const rnd = TX.mulberry32(1107);
  const pts = [];
  while (pts.length < 46) {
    const x = -2.8 + rnd() * 5.6;
    const z = -2.3 + rnd() * 4.6;
    if (Math.abs(x) < 0.8 && z > -1.3 && z < -0.7) continue; // 숫자 자리
    if (Math.hypot(x, z - 0.4) < 0.45) continue; // 전등
    pts.push([x, z, 0.7 + rnd() * 0.8, rnd() * Math.PI]);
  }
  return pts;
}

let STAR_GEO = null;
function starGeometry() {
  if (STAR_GEO) return STAR_GEO;
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i + Math.PI / 2;
    const r = i % 2 ? 0.45 : 1;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i) s.lineTo(x, y);
    else s.moveTo(x, y);
  }
  STAR_GEO = new THREE.ShapeGeometry(s);
  return STAR_GEO;
}

// ─── 메시 도우미 ─────────────────────────────────────────────────────────────

const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });
const HIT = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

function mesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const box = (p, w, h, d, mat, x, y, z) => mesh(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
const cyl = (p, rt, rb, h, mat, x, y, z, seg = 24) => mesh(p, new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
const ball = (p, r, mat, x, y, z) => mesh(p, new THREE.SphereGeometry(r, 20, 14), mat, x, y, z);
const plane = (p, w, h, mat, x, y, z) => mesh(p, new THREE.PlaneGeometry(w, h), mat, x, y, z);

function keyMesh(parent, color = '#ffd45a') {
  const g = new THREE.Group();
  const m = std(color, { metalness: 0.6, roughness: 0.35, emissive: color, emissiveIntensity: 0.2 });
  mesh(g, new THREE.TorusGeometry(0.018, 0.006, 8, 20), m);
  box(g, 0.05, 0.008, 0.006, m, 0.04, 0, 0);
  box(g, 0.008, 0.016, 0.006, m, 0.058, -0.01, 0);
  parent.add(g);
  g.userData.mat = m;
  return g;
}

// ─── 방 ─────────────────────────────────────────────────────────────────────

export function buildRoom(role) {
  const T = TX.THEMES[role];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000');
  const hot = new Map();
  const R = {}; // update/tick 에서 쓰는 참조

  const hotGroup = (id) => {
    const g = new THREE.Group();
    g.userData.hot = id;
    scene.add(g);
    hot.set(id, g);
    return g;
  };

  // 조명
  R.hemi = new THREE.HemisphereLight(T.lamp, T.floor, 1);
  R.lamp = new THREE.PointLight(T.lamp, 8, 0, 2);
  R.lamp.position.set(0, 2.4, 0.4);
  R.win = new THREE.DirectionalLight(T.window, 0.8);
  R.win.position.set(-1.5, 2.4, -4);
  R.win.target.position.set(0.8, 0, 1.2);
  R.switchLight = new THREE.PointLight(T.glow, 0, 1.6, 2);
  R.switchLight.position.set(-2.8, 1.25, 0.12);
  scene.add(R.hemi, R.lamp, R.win, R.win.target, R.switchLight);

  // 바닥 / 벽 / 천장
  const floor = plane(scene, 6, 5, std('#ffffff', { map: TX.floorTex(role) }), 0, 0, 0);
  floor.rotation.x = -Math.PI / 2;
  const H = ROOM.height;
  const walls = [
    [6, 0, H / 2, -2.5, 0],
    [6, 0, H / 2, 2.5, Math.PI],
    [5, -3, H / 2, 0, Math.PI / 2],
    [5, 3, H / 2, 0, -Math.PI / 2],
  ];
  for (const [w, x, y, z, ry] of walls) {
    const m = plane(scene, w, H, std('#ffffff', { map: TX.wallTex(role, [w / 0.5, H / 0.5]) }), x, y, z);
    m.rotation.y = ry;
    const base = box(scene, w, 0.1, 0.02, std(T.trim), 0, 0.05, 0);
    base.position.set(x + Math.sin(ry) * 0.01, 0.05, z + Math.cos(ry) * 0.01);
    base.rotation.y = ry;
  }

  // 천장 + 별
  const ceiling = hotGroup('ceiling');
  const ceil = plane(ceiling, 6, 5, std(T.ceiling), 0, H, 0);
  ceil.rotation.x = Math.PI / 2;
  R.lampMesh = cyl(scene, 0.24, 0.2, 0.06, std(T.paper, { emissive: T.lamp, emissiveIntensity: 1 }), 0, H - 0.03, 0.4, 32);
  const starGeo = starGeometry();
  const addStar = (group, x, z, r, rot, mat) => {
    const s = mesh(group, starGeo, mat, x, H - 0.004, z);
    s.rotation.set(Math.PI / 2, 0, rot);
    s.scale.setScalar(r);
    return s;
  };
  const deco = decoStars();
  const digits = digitStars();
  if (role === 'B') {
    R.litStars = new THREE.Group();
    const pale = std('#fff7d6', { emissive: '#fff2b0', emissiveIntensity: 0.1 });
    for (const [x, z, s, rot] of deco) addStar(R.litStars, x, z, 0.04 * s, rot, pale);
    digits.forEach(([x, z], i) => addStar(R.litStars, x + (((i * 37) % 11) - 5) * 0.012, z + (((i * 17) % 9) - 4) * 0.012, 0.03, i, pale));
    R.glowStars = new THREE.Group();
    R.glowMat = new THREE.MeshBasicMaterial({ color: '#fffbd0' });
    const dim = new THREE.MeshBasicMaterial({ color: '#f6ff9a', transparent: true, opacity: 0.5 });
    for (const [x, z, s, rot] of deco) addStar(R.glowStars, x, z, 0.035 * s, rot, dim);
    for (const [x, z] of digits) addStar(R.glowStars, x, z, 0.034, 0, R.glowMat);
    ceiling.add(R.litStars, R.glowStars);
  } else {
    // 누군가 별을 떼어낸 자국
    R.marks = new THREE.Group();
    const mark = std('#39466a', { transparent: true, opacity: 0.55 });
    for (const [x, z, s, rot] of deco) addStar(R.marks, x, z, 0.04 * s, rot, mark);
    ceiling.add(R.marks);
  }

  // 창문 (뒷벽 왼쪽)
  const win = hotGroup('window');
  R.skyMat = new THREE.MeshBasicMaterial({ map: TX.skyTex(role) });
  plane(win, 1.3, 1.2, R.skyMat, -1.5, 1.65, -2.495);
  const trim = std(T.trim);
  box(win, 1.42, 0.06, 0.08, trim, -1.5, 2.27, -2.47);
  box(win, 0.06, 1.3, 0.08, trim, -2.18, 1.65, -2.47);
  box(win, 0.06, 1.3, 0.08, trim, -0.82, 1.65, -2.47);
  box(win, 0.035, 1.2, 0.05, trim, -1.5, 1.65, -2.475);
  box(win, 1.3, 0.035, 0.05, trim, -1.5, 1.65, -2.475);
  box(win, 1.52, 0.04, 0.24, trim, -1.5, 1.03, -2.39);
  const curtain = std(T.curtain);
  box(win, 0.3, 1.55, 0.04, curtain, -2.34, 1.68, -2.42).rotation.y = 0.05;
  box(win, 0.3, 1.55, 0.04, curtain, -0.66, 1.68, -2.42).rotation.y = -0.05;
  cyl(win, 0.015, 0.015, 2.0, std(T.woodDark), -1.5, 2.45, -2.42).rotation.z = Math.PI / 2;

  // 화분 (창턱)
  const plant = hotGroup('plant');
  plant.position.set(-1.05, 1.05, -2.38);
  const potColor = role === 'A' ? '#8a7f78' : '#d0754d';
  cyl(plant, 0.075, 0.058, 0.13, std(potColor), 0, 0.065, 0);
  cyl(plant, 0.083, 0.083, 0.022, std(potColor), 0, 0.13, 0);
  cyl(plant, 0.07, 0.07, 0.01, std('#4a3528'), 0, 0.126, 0);
  box(plant, 0.22, 0.34, 0.2, HIT(), 0, 0.17, 0);
  R.plant = {};
  if (role === 'A') {
    const dead = new THREE.Group();
    const twig = std('#6b5a4a');
    const t1 = cyl(dead, 0.006, 0.008, 0.24, twig, 0, 0.24, 0); t1.rotation.z = 0.12;
    const t2 = cyl(dead, 0.004, 0.005, 0.12, twig, -0.04, 0.26, 0); t2.rotation.z = 0.8;
    const t3 = cyl(dead, 0.004, 0.005, 0.1, twig, 0.03, 0.32, 0); t3.rotation.z = -0.7;
    const leaf = ball(dead, 0.02, std('#7a6a55'), 0.07, 0.36, 0); leaf.scale.set(1, 0.4, 0.6);
    const bloom = new THREE.Group();
    const stem = std('#4f7a4f');
    cyl(bloom, 0.007, 0.009, 0.32, stem, 0, 0.29, 0);
    const b1 = cyl(bloom, 0.005, 0.006, 0.16, stem, -0.05, 0.3, 0); b1.rotation.z = 0.7;
    const b2 = cyl(bloom, 0.005, 0.006, 0.14, stem, 0.05, 0.34, 0); b2.rotation.z = -0.7;
    const leafMat = std('#6fa36a');
    for (const [x, y, rz] of [[-0.06, 0.24, 0.5], [0.06, 0.28, -0.5], [-0.03, 0.36, 0.9], [0.04, 0.4, -0.9]]) {
      const l = ball(bloom, 0.04, leafMat, x, y, 0.01); l.scale.set(1, 0.25, 0.5); l.rotation.z = rz;
    }
    const petal = std('#f7f9ff', { emissive: '#ffffff', emissiveIntensity: 0.08 });
    const heart = std('#ffe28a');
    for (const [x, y] of [[0, 0.46], [-0.11, 0.38], [0.1, 0.41]]) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const p = ball(bloom, 0.018, petal, x + Math.cos(a) * 0.02, y + Math.sin(a) * 0.02, 0.01);
        p.scale.set(1, 1, 0.4);
      }
      ball(bloom, 0.011, heart, x, y, 0.016);
    }
    R.key = keyMesh(plant);
    R.key.position.set(0.03, 0.14, 0.05);
    R.key.rotation.set(-1.2, 0, 0.4);
    plant.add(dead, bloom);
    R.plant.dead = dead;
    R.plant.bloom = bloom;
  } else {
    const leafMat = std('#77b85a');
    const stemMat = std('#5f9a4a');
    const sprout = new THREE.Group();
    cyl(sprout, 0.004, 0.005, 0.06, stemMat, 0, 0.16, 0);
    for (const s of [-1, 1]) { const l = ball(sprout, 0.02, leafMat, s * 0.02, 0.19, 0); l.scale.set(1, 0.3, 0.6); l.rotation.z = -s * 0.4; }
    const watered = new THREE.Group();
    cyl(watered, 0.005, 0.006, 0.12, stemMat, 0, 0.19, 0);
    for (const [x, y, rz] of [[-0.035, 0.22, 0.4], [0.035, 0.24, -0.4], [0, 0.26, 0]]) {
      const l = ball(watered, 0.03, std('#83c75f'), x, y, 0); l.scale.set(1, 0.3, 0.6); l.rotation.z = rz;
    }
    R.drops = new THREE.MeshBasicMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.9 });
    ball(watered, 0.006, R.drops, -0.05, 0.2, 0.03);
    ball(watered, 0.005, R.drops, 0.05, 0.22, 0.03);
    plant.add(sprout, watered);
    R.plant.sprout = sprout;
    R.plant.watered = watered;
  }

  // 전등 스위치 (왼쪽 벽, 문 옆)
  const sw = hotGroup('switch');
  R.switchMat = std(T.paper, { emissive: T.glow, emissiveIntensity: 0 });
  box(sw, 0.02, 0.13, 0.085, R.switchMat, -2.99, 1.25, 0.12);
  box(sw, 0.02, 0.04, 0.03, std('#c8ccd6'), -2.975, 1.26, 0.12);
  box(sw, 0.08, 0.34, 0.28, HIT(), -2.96, 1.25, 0.12);

  // 문 (왼쪽 벽)
  const door = hotGroup('door');
  box(door, 0.05, 2.05, 0.95, std(T.wood), -2.975, 1.025, 0.9);
  box(door, 0.06, 0.08, 1.12, std(T.trim), -2.97, 2.09, 0.9);
  box(door, 0.06, 2.1, 0.07, std(T.trim), -2.97, 1.05, 0.39);
  box(door, 0.06, 2.1, 0.07, std(T.trim), -2.97, 1.05, 1.41);
  const panel = std(T.woodDark);
  box(door, 0.012, 0.72, 0.68, panel, -2.946, 1.55, 0.92);
  box(door, 0.012, 0.72, 0.68, panel, -2.946, 0.58, 0.92);
  const knobMat = std('#d9b24a', { metalness: 0.7, roughness: 0.3 });
  ball(door, 0.035, knobMat, -2.925, 1.0, 0.52);
  R.doorGlow = new THREE.MeshBasicMaterial({ color: T.glow, transparent: true, opacity: 0 });
  box(door, 0.01, 0.012, 0.9, R.doorGlow, -2.94, 0.008, 0.9);
  box(door, 0.012, 2.0, 0.012, R.doorGlow, -2.94, 1.0, 0.43);
  if (role === 'A') {
    const kp = plane(door, 0.12, 0.17, std('#ffffff', { map: TX.keypadTex() }), -2.947, 1.3, 0.52);
    kp.rotation.y = Math.PI / 2;
    R.ledMat = std('#ef4444', { emissive: '#ef4444', emissiveIntensity: 1.5 });
    ball(door, 0.012, R.ledMat, -2.943, 1.42, 0.52);
  } else {
    box(door, 0.01, 0.05, 0.018, std('#1a1208'), -2.946, 0.88, 0.52);
    R.doorKey = keyMesh(door);
    R.doorKey.position.set(-2.915, 0.88, 0.52);
    R.doorKey.rotation.set(0, Math.PI / 2, Math.PI / 2);
  }

  // 벽시계
  const clock = hotGroup('clock');
  clock.position.set(-0.1, 2.12, -2.47);
  const rim = cyl(clock, 0.29, 0.29, 0.05, std(T.woodDark), 0, 0, 0, 40);
  rim.rotation.x = Math.PI / 2;
  R.clockFace = TX.clockFaceTex(role, role === 'B');
  R.clockReversed = role === 'B';
  plane(clock, 0.52, 0.52, std('#ffffff', { map: R.clockFace, transparent: true, alphaTest: 0.5 }), 0, 0, 0.027);
  const hand = (len, w, color, z) => {
    const pivot = new THREE.Group();
    pivot.position.z = z;
    box(pivot, w, len, 0.006, std(color), 0, len / 2 - 0.02, 0);
    clock.add(pivot);
    return pivot;
  };
  R.hourHand = hand(0.13, 0.018, T.ink, 0.034);
  R.minHand = hand(0.2, 0.012, T.ink, 0.04);
  R.secHand = hand(0.22, 0.005, '#c0392b', 0.046);
  const cap = cyl(clock, 0.014, 0.014, 0.02, std(T.ink), 0, 0, 0.05);
  cap.rotation.x = Math.PI / 2;

  // 액자
  const frame = hotGroup('frame');
  frame.position.set(-0.1, 1.5, -2.475);
  box(frame, 0.64, 0.49, 0.03, std(T.woodDark), 0, 0, 0);
  R.frameTex = { photo: TX.frameTex('photo'), empty: TX.frameTex('empty') };
  R.frameMat = std('#ffffff', { map: R.frameTex.empty });
  plane(frame, 0.55, 0.4, R.frameMat, 0, 0, 0.017);

  // 거울
  const mirror = hotGroup('mirror');
  mirror.position.set(0.8, 1.17, -2.47);
  box(mirror, 0.76, 1.68, 0.04, std(T.woodDark), 0, 0, 0);
  box(mirror, 0.84, 0.07, 0.06, std(T.woodDark), 0, 0.86, 0.005);
  R.fog = plane(mirror, 0.64, 1.56, std('#ffffff', { map: TX.mirrorFogTex(role), roughness: 0.4 }), 0, 0, 0.022);
  R.glassTex = TX.mirrorGlassTex(role);
  R.glass = plane(mirror, 0.64, 1.56, new THREE.MeshBasicMaterial({ map: R.glassTex }), 0, 0, 0.022);
  R.silhouette = plane(mirror, 0.64, 1.28, new THREE.MeshBasicMaterial({ map: TX.silhouetteTex(role), transparent: true, opacity: 0.3, depthWrite: false }), 0, -0.14, 0.024);
  R.streak = plane(mirror, 0.05, 1.4, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false }), -0.12, 0.05, 0.026);
  R.streak.rotation.z = -0.25;

  // 벽 장식 (달력 / 크레파스 그림)
  const art = hotGroup('wallart');
  art.position.set(1.95, 1.72, -2.485);
  const artPlane = plane(art, 0.5, 0.406, std('#ffffff', { map: role === 'A' ? TX.calendarTex() : TX.crayonTex() }), 0, 0, 0);
  if (role === 'B') artPlane.rotation.z = -0.05;
  ball(art, 0.012, std(role === 'A' ? '#c0392b' : '#3f7fd0'), 0, 0.18, 0.005);

  // 책상
  const desk = hotGroup('desk');
  box(desk, 1.52, 0.05, 0.62, std(T.wood), 2.05, 0.745, -2.19);
  box(desk, 0.5, 0.72, 0.58, std(T.woodDark), 1.57, 0.36, -2.2);
  box(desk, 0.05, 0.72, 0.58, std(T.woodDark), 2.78, 0.36, -2.2);
  box(desk, 0.46, 0.3, 0.02, std(T.woodLight), 1.57, 0.25, -1.905);
  ball(desk, 0.014, std(T.ink), 1.57, 0.25, -1.89);
  R.drawer = new THREE.Group();
  box(R.drawer, 0.46, 0.2, 0.03, std(T.woodLight), 1.57, 0.58, -1.9);
  box(R.drawer, 0.44, 0.15, 0.5, std('#2a2522'), 1.57, 0.57, -2.16);
  ball(R.drawer, 0.014, std(T.ink), 1.57, 0.6, -1.88);
  if (role === 'A') R.lock = box(R.drawer, 0.04, 0.05, 0.02, std('#c9b04a', { metalness: 0.6, roughness: 0.3 }), 1.57, 0.53, -1.88);
  desk.add(R.drawer);
  if (role === 'A') {
    box(desk, 0.3, 0.04, 0.22, std('#9fb0d0'), 1.6, 0.79, -2.3);
    box(desk, 0.28, 0.03, 0.2, std('#7f90b5'), 1.6, 0.825, -2.3);
    box(desk, 0.24, 0.005, 0.3, std(T.paper), 1.95, 0.772, -2.15).rotation.y = 0.2;
  } else {
    const colors = ['#e0584f', '#3f7fd0', '#6cbf5a', '#ffc93c', '#b56ad9'];
    colors.forEach((c, i) => { const cr = cyl(desk, 0.007, 0.007, 0.09, std(c), 1.55 + i * 0.03, 0.78, -2.15); cr.rotation.z = Math.PI / 2; cr.rotation.y = i * 0.3; });
    box(desk, 0.26, 0.005, 0.2, std(T.paper), 1.95, 0.772, -2.12).rotation.y = -0.15;
  }

  // 라디오 (책상 위)
  const radio = hotGroup('radio');
  radio.position.set(2.45, 0.77, -2.28);
  box(radio, 0.46, 0.34, 0.3, HIT(), 0, 0.15, 0);
  if (role === 'A') {
    box(radio, 0.38, 0.22, 0.16, std('#7a6250'), 0, 0.11, 0);
    plane(radio, 0.34, 0.18, std('#8c735f'), 0, 0.11, 0.081);
    mesh(radio, new THREE.CircleGeometry(0.06, 24), std('#5d4a3c'), -0.08, 0.11, 0.083);
    R.radioTex = TX.radioDisplayTex(881);
    plane(radio, 0.14, 0.052, new THREE.MeshBasicMaterial({ map: R.radioTex }), 0.08, 0.15, 0.083);
    const knob = cyl(radio, 0.022, 0.022, 0.02, std('#3f3228'), 0.08, 0.07, 0.09);
    knob.rotation.x = Math.PI / 2;
    const ant = cyl(radio, 0.004, 0.004, 0.36, std('#9aa3b5', { metalness: 0.8, roughness: 0.3 }), 0.14, 0.36, -0.03);
    ant.rotation.z = -0.5;
  } else {
    box(radio, 0.36, 0.2, 0.14, std('#ff8fa3'), 0, 0.1, 0);
    mesh(radio, new THREE.CircleGeometry(0.065, 24), std('#ffd1dc'), -0.08, 0.1, 0.071);
    mesh(radio, new THREE.CircleGeometry(0.04, 24), std('#e86a86'), -0.08, 0.1, 0.072);
    plane(radio, 0.12, 0.035, std('#fff4e0'), 0.08, 0.13, 0.071);
    const heart = ball(radio, 0.018, std('#e0584f'), 0.08, 0.06, 0.075);
    heart.scale.set(1, 0.9, 0.3);
    const handle = mesh(radio, new THREE.TorusGeometry(0.12, 0.012, 8, 24, Math.PI), std('#e86a86'), 0, 0.2, 0);
    handle.scale.set(1, 0.45, 1);
    R.waves = new THREE.Group();
    R.waveMat = new THREE.MeshBasicMaterial({ color: T.glow, transparent: true, opacity: 0.8 });
    for (const r of [0.06, 0.1]) {
      const w = mesh(R.waves, new THREE.TorusGeometry(r, 0.006, 6, 20, Math.PI * 0.6), R.waveMat, 0, 0, 0);
      w.rotation.z = -Math.PI * 0.3;
    }
    R.waves.position.set(0.2, 0.12, 0.02);
    radio.add(R.waves);
  }

  // 협탁
  const ns = hotGroup('nightstand');
  ns.position.set(-1.15, 0, -2.25);
  box(ns, 0.5, 0.52, 0.42, std(T.wood), 0, 0.26, 0);
  box(ns, 0.54, 0.03, 0.46, std(T.woodLight), 0, 0.535, 0);
  box(ns, 0.4, 0.16, 0.02, std(T.woodLight), 0, 0.36, 0.215);
  ball(ns, 0.012, std(T.ink), 0, 0.36, 0.23);
  if (role === 'A') {
    R.glassCup = new THREE.Group();
    cyl(R.glassCup, 0.035, 0.03, 0.1, new THREE.MeshStandardMaterial({ color: '#dfeaff', transparent: true, opacity: 0.35, roughness: 0.1 }), 0, 0.05, 0);
    cyl(R.glassCup, 0.031, 0.027, 0.065, new THREE.MeshStandardMaterial({ color: '#8fb8ff', transparent: true, opacity: 0.65, roughness: 0.1 }), 0, 0.035, 0);
    R.glassCup.position.set(-0.08, 0.55, 0.05);
    ns.add(R.glassCup);
    const env = plane(ns, 0.13, 0.08, std('#ffffff', { map: TX.envelopeTex() }), 0.1, 0.552, 0.06);
    env.rotation.set(-Math.PI / 2, 0, -0.3);
  } else {
    const fur = std('#f3ece6');
    const body = ball(ns, 0.08, fur, 0, 0.63, 0); body.scale.set(1, 0.95, 0.85);
    ball(ns, 0.062, fur, 0, 0.75, 0.01);
    const e1 = ball(ns, 0.022, fur, -0.025, 0.84, 0); e1.scale.set(1, 3, 0.8);
    const e2 = ball(ns, 0.022, fur, 0.06, 0.79, 0); e2.scale.set(1, 3, 0.8); e2.rotation.z = -1.1;
    const eye = std('#3a2a22');
    ball(ns, 0.008, eye, -0.022, 0.76, 0.064);
    ball(ns, 0.008, eye, 0.022, 0.76, 0.064);
    box(ns, 0.06, 0.03, 0.005, std('#ffd27a'), 0, 0.67, 0.075);
  }

  // 침대
  const bed = hotGroup('bed');
  box(bed, 1.44, 0.3, 2.04, std(T.bedFrame), -2.2, 0.15, -1.5);
  box(bed, 1.36, 0.2, 1.96, std(T.mattress), -2.2, 0.4, -1.5);
  box(bed, 1.44, 0.95, 0.08, std(T.bedFrame), -2.2, 0.5, -2.46);
  const pillow = box(bed, 1.0, 0.12, 0.38, std(T.pillow), -2.2, 0.56, -2.16);
  const blanket = box(bed, 1.42, 0.05, 1.45, std('#ffffff', { map: TX.blanketTex(role) }), -2.2, 0.525, -1.18);
  if (role === 'B') {
    pillow.rotation.y = 0.12;
    blanket.rotation.y = 0.07;
    blanket.position.x = -2.15;
  }

  // 책장 (오른쪽 벽)
  const shelf = hotGroup('shelf');
  const sw1 = std(T.wood);
  box(shelf, 0.02, 2.0, 1.0, std(T.woodDark), 2.99, 1.0, 0);
  box(shelf, 0.38, 2.0, 0.03, sw1, 2.81, 1.0, -0.5);
  box(shelf, 0.38, 2.0, 0.03, sw1, 2.81, 1.0, 0.5);
  for (const y of [0.02, 0.5, 1.0, 1.5, 1.98]) box(shelf, 0.36, 0.03, 1.0, sw1, 2.81, y, 0);
  const rnd = TX.mulberry32(role === 'A' ? 41 : 314);
  const colorsA = ['#56607a', '#6a7390', '#4a5470', '#7d86a0', '#5e6884'];
  const colorsB = ['#e0584f', '#3f7fd0', '#6cbf5a', '#ffc93c', '#b56ad9', '#ff8fa3'];
  const bookMats = (role === 'A' ? colorsA : colorsB).map((c) => std(c));
  [0.035, 0.515, 1.015, 1.515].forEach((base, level) => {
    let z = -0.47;
    let n = 0;
    while (z < 0.46) {
      const t = role === 'A' ? 0.045 : 0.03 + rnd() * 0.035;
      if (role === 'A' && level === 0 && n === 5) { z += 0.22; n++; continue; } // 빼낸 자리
      if (z + t > 0.47) break;
      const bh = role === 'A' ? 0.3 + (n % 3) * 0.01 : 0.2 + rnd() * 0.2;
      const mat = role === 'A' ? bookMats[n % bookMats.length] : bookMats[Math.floor(rnd() * bookMats.length)];
      box(shelf, 0.24, bh, t - 0.004, mat, 2.86, base + bh / 2, z + t / 2);
      z += t;
      n++;
    }
  });
  if (role === 'B') ball(shelf, 0.07, std('#3f7fd0'), 2.8, 1.6, 0.3);

  // 상자
  const bx = hotGroup('box');
  bx.position.set(2.2, 0, 1.6);
  if (role === 'A') {
    const side = std('#7a7580');
    const front = std('#ffffff', { map: TX.boxFrontTex('A') });
    const body = mesh(bx, new THREE.BoxGeometry(0.72, 0.46, 0.52), [side, front, std('#8f8a93'), side, side, front], 0, 0.23, 0);
    body.userData.multi = true;
    box(bx, 0.72, 0.005, 0.08, std('#b9b3a2'), 0, 0.462, 0);
  } else {
    const side = std('#ffffff', { map: TX.toyBoxSideTex() });
    const front = std('#ffffff', { map: TX.boxFrontTex('B') });
    const inside = std('#6b2a24');
    mesh(bx, new THREE.BoxGeometry(0.72, 0.46, 0.52), [side, front, inside, side, side, front], 0, 0.23, 0);
    R.lid = new THREE.Group();
    R.lid.position.set(0, 0.46, 0.26);
    box(R.lid, 0.74, 0.05, 0.54, std('#e8574d'), 0, 0.025, -0.27);
    bx.add(R.lid);
    R.toys = new THREE.Group();
    ball(R.toys, 0.07, std('#3f7fd0'), -0.15, 0.47, -0.05);
    box(R.toys, 0.1, 0.1, 0.1, std('#ffc93c'), 0.05, 0.47, 0.05);
    ball(R.toys, 0.05, std('#6cbf5a'), 0.2, 0.46, -0.08);
    bx.add(R.toys);
  }

  // 러그 (노을의 방)
  if (role === 'B') {
    const rug = mesh(scene, new THREE.CircleGeometry(1, 48), std('#ffffff', { map: TX.rugTex() }), 0.3, 0.004, 0.3);
    rug.rotation.x = -Math.PI / 2;
    rug.scale.set(1.3, 0.9, 1);
  }

  // ─── 상태 반영 ──────────────────────────────────────────────────────────────
  const state = { lit: false, clock: null, doorReady: false, stars: false, radioOn: false, plant: null, mirrorOpen: false };

  function setClock(c) {
    const dir = c.reversed ? -1 : 1;
    const hourAngle = dir * ((c.h % 12) + c.m / 60) * (Math.PI / 6);
    const minAngle = dir * c.m * (Math.PI / 30);
    R.hourHand.rotation.z = -hourAngle;
    R.minHand.rotation.z = -minAngle;
    if (R.clockReversed !== c.reversed) {
      R.clockReversed = c.reversed;
      R.clockFace.userData.redraw((g, w, h) => TX.drawClockFace(g, w, h, c.reversed, T));
    }
    state.clock = c;
  }

  function update(view) {
    const o = view.objects;
    const lit = view.lit;
    state.lit = lit;
    R.hemi.intensity = lit ? 1.15 : 0.06;
    R.lamp.intensity = lit ? 7 : 0;
    R.win.intensity = lit ? 0.9 : 0.4;
    R.lampMesh.material.emissiveIntensity = lit ? 1 : 0;
    R.skyMat.color.setScalar(lit ? 1 : 0.55);
    R.switchLight.intensity = lit ? 0 : 0.6;
    if (!lit) R.switchMat.emissiveIntensity = 1;
    else R.switchMat.emissiveIntensity = 0;

    setClock(o.clock);

    state.mirrorOpen = o.mirror === 'open';
    R.fog.visible = !state.mirrorOpen;
    R.glass.visible = state.mirrorOpen;
    R.silhouette.visible = state.mirrorOpen;

    if (role === 'A') {
      R.plant.dead.visible = o.plant === 'dead';
      R.plant.bloom.visible = o.plant !== 'dead';
      R.key.visible = o.plant === 'bloomKey';
      R.glassCup.visible = !!o.glass;
      R.drawer.position.z = o.drawer === 'open' ? 0.3 : 0;
      R.lock.visible = o.drawer !== 'open';
      R.frameMat.map = R.frameTex[o.frame === 'photo' ? 'photo' : 'empty'];
      R.radioTex.userData.redraw((g, w, h) => TX.drawRadioDisplay(g, w, h, o.radioFreq));
      const unlocked = o.door === 'unlocked';
      R.ledMat.color.set(unlocked ? '#4ade80' : '#ef4444');
      R.ledMat.emissive.set(unlocked ? '#4ade80' : '#ef4444');
      R.marks.visible = lit;
    } else {
      R.plant.sprout.visible = o.plant === 'sprout';
      R.plant.watered.visible = o.plant === 'watered';
      R.lid.rotation.x = o.toybox === 'open' ? 1.15 : 0;
      R.toys.visible = o.toybox === 'open';
      R.frameMat.map = R.frameTex.photo;
      R.doorKey.visible = o.door === 'unlocked';
      state.radioOn = !!o.radioOn;
      R.waves.visible = state.radioOn;
      state.stars = !!o.stars;
      R.litStars.visible = lit;
      R.glowStars.visible = !lit && state.stars;
    }
    state.doorReady = !!view.doorReady;
    R.frameMat.needsUpdate = true;
  }

  function tick(t) {
    const c = state.clock;
    if (c) {
      if (c.running) R.secHand.rotation.z = -((t % 60) / 60) * Math.PI * 2;
      else if (c.reversed) R.secHand.rotation.z = ((t % 3) / 3) * Math.PI * 2;
      else R.secHand.rotation.z = -2.1 + Math.sin(t * 38) * 0.035;
    }
    if (state.mirrorOpen) {
      R.glassTex.offset.y = (t * 0.04) % 1;
      R.silhouette.material.opacity = 0.24 + Math.sin(t * 0.9) * 0.08;
    }
    if (!state.lit) R.switchMat.emissiveIntensity = 0.7 + Math.sin(t * 3) * 0.35;
    R.doorGlow.opacity = state.doorReady ? 0.55 + Math.sin(t * 3.2) * 0.35 : 0;
    if (role === 'A' && R.key.visible) R.key.userData.mat.emissiveIntensity = 0.4 + Math.sin(t * 5) * 0.4;
    if (role === 'B') {
      if (state.radioOn) {
        R.waveMat.opacity = 0.5 + Math.sin(t * 6) * 0.4;
        R.waves.scale.setScalar(1 + Math.sin(t * 6) * 0.08);
      }
      if (R.glowStars.visible) R.glowMat.color.setScalar(0.85 + Math.sin(t * 2) * 0.15);
      R.drops.opacity = 0.5 + Math.sin(t * 3) * 0.4;
    }
  }

  function dispose() {
    scene.traverse((obj) => {
      if (obj.geometry && obj.geometry !== STAR_GEO) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    });
    for (const tex of Object.values(R.frameTex)) tex.dispose();
  }

  return { role, scene, hot, update, tick, dispose, eye: EYE[role] };
}
