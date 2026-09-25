// 효과: 피 튀김, 바닥 핏자국, 벽 먼지, 예광탄, 동료 총구 불빛
import * as THREE from 'three';
import { glowTex, bloodTex } from './textures.js';

const MAXP = 600;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];
    this.pPos = new Float32Array(MAXP * 3);
    this.pCol = new Float32Array(MAXP * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.09, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.sparkPos = new Float32Array(200 * 3);
    this.sparkCol = new Float32Array(200 * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparkPts = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.12, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.sparkPts.frustumCulled = false;
    scene.add(this.sparkPts);
    this.sparks = [];
    // 바닥 핏자국
    const dg = new THREE.PlaneGeometry(1, 1);
    dg.rotateX(-Math.PI / 2);
    this.decals = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ map: bloodTex(), transparent: true, depthWrite: false, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -4 }), 160);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    scene.add(this.decals);
    this.decalN = 0;
    // 예광탄
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(40 * 6);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracers = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    this.tracerList = [];
    this.muzzle = new THREE.PointLight('#ffb060', 0, 12, 2);
    scene.add(this.muzzle);
    this.muzzleT = 0;
    this.m4 = new THREE.Matrix4();
  }

  blood(x, y, z, n = 10, dir = null, big = false) {
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAXP) this.parts.shift();
      const s = big ? 3 : 1.8;
      let vx = (Math.random() - 0.5) * s;
      let vy = Math.random() * s;
      let vz = (Math.random() - 0.5) * s;
      if (dir) {
        vx += dir[0] * 2.5;
        vz += dir[2] * 2.5;
      }
      this.parts.push({ x, y, z, vx, vy, vz, life: 0.5 + Math.random() * 0.4, t: 0, r: 0.35 + Math.random() * 0.2, g: 0.02, b: 0.02, grav: 9 });
    }
  }

  dust(x, y, z, n = 6) {
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAXP) this.parts.shift();
      this.parts.push({ x, y, z, vx: (Math.random() - 0.5) * 1.2, vy: Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.2, life: 0.4 + Math.random() * 0.3, t: 0, r: 0.5, g: 0.48, b: 0.45, grav: 1 });
    }
    for (let i = 0; i < 3; i++) {
      if (this.sparks.length >= 200) this.sparks.shift();
      this.sparks.push({ x, y, z, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 5, life: 0.15 + Math.random() * 0.1, t: 0 });
    }
  }

  bloodDecal(x, z, s = 1) {
    const i = this.decalN % 160;
    this.decalN++;
    this.decals.count = Math.min(160, this.decalN);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
    this.m4.compose(new THREE.Vector3(x, z > 380 ? 0.045 : 0.13, z), q, new THREE.Vector3(s * (0.8 + Math.random() * 0.8), 1, s * (0.8 + Math.random() * 0.8)));
    this.decals.setMatrixAt(i, this.m4);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  tracer(o, e) {
    this.tracerList.push({ o, e, t: 0 });
    if (this.tracerList.length > 40) this.tracerList.shift();
  }

  flashAt(x, y, z) {
    this.muzzle.position.set(x, y, z);
    this.muzzle.intensity = 30;
    this.muzzleT = 0.05;
  }

  update(dt) {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) {
        p.y = 0.05;
        p.vx *= 0.3;
        p.vz *= 0.3;
        p.vy = 0;
      }
    }
    for (const p of this.parts) {
      if (n >= MAXP) break;
      const f = 1 - p.t / p.life;
      this.pPos.set([p.x, p.y, p.z], n * 3);
      this.pCol.set([p.r * f, p.g * f, p.b * f], n * 3);
      n++;
    }
    for (let i = n; i < MAXP; i++) this.pPos[i * 3 + 1] = -999;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      if (s.t >= s.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.vy -= 9 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
    }
    for (const s of this.sparks) {
      const f = 1 - s.t / s.life;
      this.sparkPos.set([s.x, s.y, s.z], n * 3);
      this.sparkCol.set([f, 0.7 * f, 0.3 * f], n * 3);
      n++;
    }
    for (let i = n; i < 200; i++) this.sparkPos[i * 3 + 1] = -999;
    this.sparkPts.geometry.attributes.position.needsUpdate = true;
    this.sparkPts.geometry.attributes.color.needsUpdate = true;
    // 예광탄
    let k = 0;
    for (let i = this.tracerList.length - 1; i >= 0; i--) {
      const tr = this.tracerList[i];
      tr.t += dt;
      if (tr.t > 0.06) this.tracerList.splice(i, 1);
    }
    for (const tr of this.tracerList) {
      const a = Math.min(1, tr.t / 0.06);
      const sx = tr.o[0] + (tr.e[0] - tr.o[0]) * a * 0.6;
      const sy = tr.o[1] + (tr.e[1] - tr.o[1]) * a * 0.6;
      const sz = tr.o[2] + (tr.e[2] - tr.o[2]) * a * 0.6;
      this.tracerPos.set([sx, sy, sz, tr.e[0], tr.e[1], tr.e[2]], k * 6);
      k++;
    }
    this.tracerGeo.setDrawRange(0, k * 2);
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.muzzleT -= dt;
    if (this.muzzleT <= 0) this.muzzle.intensity = 0;
  }
}
