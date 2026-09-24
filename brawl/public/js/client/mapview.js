// 맵 그래픽: sim/maps.js 의 같은 데이터로 메시를 만든다. deco 는 그래픽 전용 장식.
import * as THREE from 'three';
import { eulerQuat } from '../sim/maps.js';
import * as MAT from './materials.js';

function shapeGeometry(s) {
  switch (s.shape) {
    case 'box': return new THREE.BoxGeometry(...s.size);
    case 'ball': return new THREE.SphereGeometry(s.r, 32, 20);
    case 'capsule': return new THREE.CapsuleGeometry(s.r, s.h, 8, 16);
    case 'cyl': return new THREE.CylinderGeometry(s.r, s.r, s.h, s.seg || 24);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

function pieceMaterial(p) {
  if (p.mat === 'grass') {
    const top = new THREE.MeshStandardMaterial({ map: MAT.pitchTexture(), roughness: 0.85 });
    const side = new THREE.MeshStandardMaterial({ color: '#e9e2d0', roughness: 0.8 });
    return [side, side, top, side, side, side];
  }
  if (p.mat === 'ball') return new THREE.MeshStandardMaterial({ map: MAT.ballTexture(), roughness: 0.4 });
  if (p.top === 'octagon') {
    const side = new THREE.MeshStandardMaterial({ color: '#1b1e27', roughness: 0.6 });
    return [side, side, side];
  }
  return MAT.surfaceMaterial(p.mat, p.color);
}

function place(obj, p) {
  obj.position.set(...p.pos);
  const q = eulerQuat(...(p.rot || [0, 0, 0]));
  obj.quaternion.set(q.x, q.y, q.z, q.w);
}

/** 조각 하나를 메시로 */
function pieceMesh(p) {
  const m = new THREE.Mesh(shapeGeometry(p), pieceMaterial(p));
  m.castShadow = p.shadow !== false;
  m.receiveShadow = true;
  if (p.mat === 'fence') m.castShadow = false;
  return m;
}

function neonSign(text, w, h) {
  const tex = MAT.textTexture(text, { w: 1024, h: 256, color: '#ffd1f0', glow: '#ff4fd8', size: 150 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  return m;
}

// ─── 장식 ────────────────────────────────────────────────────────────────────

function rng(seed) {
  let s = seed || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function decoArena(group, d) {
  const r = rng(11);
  // 관중석: 둥글게 계단식
  const seatMat = new THREE.MeshStandardMaterial({ color: '#1c1f2b', roughness: 0.9 });
  for (let tier = 0; tier < 5; tier++) {
    const radius = d.r + tier * 2.2;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(radius + 2.2, radius + 2.2, 1.4, 48, 1, true), seatMat);
    ring.material.side = THREE.BackSide;
    ring.position.y = -9 + tier * 1.8;
    group.add(ring);
  }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(d.r + 14, 48), new THREE.MeshStandardMaterial({ color: '#0e1018', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -10;
  floor.receiveShadow = true;
  group.add(floor);
  // 관중 (인스턴스)
  const count = 900;
  const crowd = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), count);
  const tmp = new THREE.Object3D();
  const colors = ['#ff5a5f', '#3fa7ff', '#ffc93c', '#4fd67a', '#f1f1f1', '#b56ad9', '#ff8a3d'];
  for (let i = 0; i < count; i++) {
    const tier = Math.floor(r() * 5);
    const a = r() * Math.PI * 2;
    const radius = d.r + tier * 2.2 + 1.1 + r() * 0.6;
    tmp.position.set(Math.sin(a) * radius, -8.1 + tier * 1.8 + r() * 0.2, Math.cos(a) * radius);
    tmp.scale.setScalar(0.8 + r() * 0.5);
    tmp.updateMatrix();
    crowd.setMatrixAt(i, tmp.matrix);
    crowd.setColorAt(i, new THREE.Color(colors[Math.floor(r() * colors.length)]));
  }
  crowd.userData.bounce = true;
  group.add(crowd);
  // 위에서 내려오는 조명 빛줄기
  const beamMat = new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const beam = new THREE.Mesh(new THREE.ConeGeometry(3.2, 16, 24, 1, true), beamMat);
    beam.position.set(Math.sin(a) * 4, 8, Math.cos(a) * 4);
    beam.lookAt(0, 0, 0);
    beam.rotateX(Math.PI / 2);
    group.add(beam);
  }
  return { crowd };
}

function decoCity(group, d) {
  const r = rng(d.seed || 7);
  const colors = ['#4a4552', '#3b3a45', '#5a4a58', '#2f3140', '#6a5a60'];
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const dist = 22 + r() * 40;
    const w = 4 + r() * 7;
    const h = 20 + r() * 40;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * (0.7 + r() * 0.6)), MAT.surfaceMaterial('building', colors[i % colors.length]));
    b.position.set(Math.sin(a) * dist, -h / 2 - 3 + r() * 14, Math.cos(a) * dist - 8);
    if (Math.abs(b.position.x) < 12 && b.position.z > -8) b.position.z -= 30;
    group.add(b);
  }
}

function decoClouds(group, d) {
  const r = rng(d.seed || 3);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.95 });
  const puff = new THREE.SphereGeometry(1, 14, 10);
  const clouds = [];
  for (let i = 0; i < 26; i++) {
    const cg = new THREE.Group();
    const n = 4 + Math.floor(r() * 4);
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(puff, mat);
      m.position.set((j - n / 2) * 1.6 + r(), r() * 0.8, r() * 1.5);
      m.scale.setScalar(1.3 + r() * 1.4);
      cg.add(m);
    }
    const a = r() * Math.PI * 2;
    const dist = 12 + r() * 40;
    cg.position.set(Math.sin(a) * dist, -8 - r() * 14, Math.cos(a) * dist);
    cg.userData.speed = 0.3 + r() * 0.5;
    group.add(cg);
    clouds.push(cg);
  }
  return { clouds };
}

function decoFactory(group) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 16, 1), MAT.surfaceMaterial('corrugated', '#565b63'));
  wall.position.set(0, 3, -7.5);
  wall.receiveShadow = true;
  group.add(wall);
  const pipeMat = MAT.surfaceMaterial('metal', '#8a6a3a');
  for (let i = 0; i < 5; i++) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 40, 12), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, 5.5 + i * 0.7, -6.8 + (i % 2) * 0.3);
    group.add(pipe);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ color: '#141518', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -6;
  group.add(floor);
  // 매달린 램프
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffe0a0', toneMapped: false });
  for (const x of [-7, 0, 7]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3, 4), MAT.surfaceMaterial('metal', '#222'));
    cord.position.set(x, 7.5, -2);
    group.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.5, 16, 1, true), MAT.surfaceMaterial('metal', '#3a3d42'));
    shade.position.set(x, 5.9, -2);
    group.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), lampMat);
    bulb.position.set(x, 5.7, -2);
    group.add(bulb);
  }
  // "파쇄기" 경고판
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.8), new THREE.MeshBasicMaterial({ map: MAT.textTexture('⚠ 파쇄기 주의', { color: '#1b1b1b', bg: '#e8b923', size: 120 }) }));
  sign.position.set(0, 3.4, -6.95);
  group.add(sign);
}

function decoBottles(group, d) {
  const colors = ['#2e8b57', '#8b2e2e', '#c9a227', '#3a6ea5', '#d8d8d8'];
  for (let i = 0; i < 14; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.28, 10), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }));
    b.position.set(d.pos[0] - d.w / 2 + (i + 0.5) * (d.w / 14), d.pos[1], d.pos[2] + 0.15);
    group.add(b);
  }
}

function decoBanner(group, d) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.w / 4), new THREE.MeshBasicMaterial({ map: MAT.textTexture(d.text, { color: '#ffffff', bg: '#12131a', glow: d.color, size: 110 }), toneMapped: false }));
  m.position.set(...d.pos);
  group.add(m);
}

function skyDome(colors) {
  const [top, mid, bot] = colors;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, bot: { value: new THREE.Color(bot) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.6, h)) : mix(mid, bot, smoothstep(0.0, 0.5, -h)); gl_FragColor = vec4(c, 1.0); }',
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), mat);
  m.renderOrder = -10;
  return m;
}

// ─── 맵 전체 ─────────────────────────────────────────────────────────────────

export function buildMapView(def) {
  const group = new THREE.Group();
  const extras = {};
  if (def.env.sky) group.add(skyDome(def.env.sky));
  const belts = [];
  for (const p of def.pieces) {
    const m = pieceMesh(p);
    place(m, p);
    group.add(m);
    if (p.belt) {
      // 벨트마다 따로 흘러가도록 재질을 복제한다
      m.material = m.material.clone();
      m.material.map = m.material.map.clone();
      m.material.map.needsUpdate = true;
      belts.push({ mesh: m, dir: p.belt });
    }
    if (p.top === 'octagon') {
      // 윗면 로고: 원판(8각)을 따로 깔아야 글자가 똑바로 보인다
      const top = new THREE.Mesh(new THREE.CircleGeometry(p.r, 8), new THREE.MeshStandardMaterial({ map: MAT.octagonTopTexture(), roughness: 0.85 }));
      top.rotation.x = -Math.PI / 2;
      top.position.set(p.pos[0], p.pos[1] + p.h / 2 + 0.003, p.pos[2]);
      top.receiveShadow = true;
      group.add(top);
    }
    if (p.sign) {
      const s = neonSign(p.sign, p.size[0] * 0.95, p.size[1] * 0.8);
      s.position.set(p.pos[0], p.pos[1], p.pos[2] + p.size[2] / 2 + 0.01);
      group.add(s);
    }
  }
  const objects = def.objects.map((o) => {
    const g = new THREE.Group();
    const main = pieceMesh(o);
    g.add(main);
    for (const part of o.parts || []) {
      const pm = pieceMesh({ ...part, mat: part.mat || 'plastic', color: part.color || '#ffffff' });
      pm.position.set(...part.pos);
      g.add(pm);
    }
    if (o.id.startsWith('crusher')) {
      // 파쇄기 톱니
      for (let i = 0; i < 5; i++) {
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 4), MAT.surfaceMaterial('metal', '#c0c4cc'));
        tooth.position.set(-1 + i * 0.5, -0.9, 0);
        tooth.rotation.x = Math.PI;
        g.add(tooth);
      }
    }
    place(g, o);
    group.add(g);
    return { def: o, group: g };
  });
  for (const d of def.deco || []) {
    if (d.type === 'arena') Object.assign(extras, decoArena(group, d));
    if (d.type === 'city') decoCity(group, d);
    if (d.type === 'clouds') Object.assign(extras, decoClouds(group, d));
    if (d.type === 'factory') decoFactory(group, d);
    if (d.type === 'bottles') decoBottles(group, d);
    if (d.type === 'banner') decoBanner(group, d);
  }
  return {
    group,
    objects,
    update(t, dt) {
      for (const b of belts) b.mesh.material.map.offset.x = (-b.dir * t * 0.55) % 1;
      if (extras.clouds) for (const c of extras.clouds) c.position.x += Math.sin(t * 0.05 + c.userData.speed * 10) * 0.002 + c.userData.speed * dt * 0.3;
    },
  };
}
