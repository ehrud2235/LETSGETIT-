// 타격 효과: 튀는 먼지·파편, 화면 흔들림, 돌풍 줄무늬 (글자는 띄우지 않는다)
import * as THREE from 'three';
import { canvasTexture } from './materials.js';

const dotTex = () => canvasTexture(64, 64, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,.8)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
});

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.shake = 0;
    this.dot = dotTex();
    const MAX = 400;
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX * 3);
    this.pCol = new Float32Array(MAX * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(this.pGeo, new THREE.PointsMaterial({ size: 0.16, map: this.dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.parts = [];
    this.max = MAX;
    this.wind = null;
  }

  sparks(pos, color, n, speed) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= this.max) this.parts.shift();
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.3) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({
        p: new THREE.Vector3(pos.x, pos.y, pos.z),
        v: new THREE.Vector3(Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s + 1.5, Math.sin(a) * Math.cos(b) * s),
        life: 0.35 + Math.random() * 0.25, age: 0, c, g: 9,
      });
    }
  }

  dust(pos, n = 8) {
    const c = new THREE.Color('#d8d2c8');
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= this.max) this.parts.shift();
      const a = Math.random() * Math.PI * 2;
      this.parts.push({ p: new THREE.Vector3(pos.x, pos.y + 0.05, pos.z), v: new THREE.Vector3(Math.cos(a) * 1.4, 0.4 + Math.random() * 0.6, Math.sin(a) * 1.4), life: 0.6, age: 0, c, g: -0.5 });
    }
  }

  /** 시뮬레이션 이벤트를 효과로 */
  onEvent(ev, fighterPos) {
    switch (ev.type) {
      case 'hit': {
        // 세게 날아갈수록 더 많이 튀고 더 흔들린다
        const kb = ev.kb || 2;
        const big = kb > 4.5;
        this.sparks(ev.pos, '#f3eee2', big ? 16 : 7, big ? 4.2 : 2.4);
        this.shake = Math.max(this.shake, Math.min(0.35, 0.04 + kb * 0.03));
        break;
      }
      case 'slam':
        this.dust(ev.pos, ev.speed > 10 ? 14 : 8);
        this.shake = Math.max(this.shake, 0.1);
        break;
      case 'out': {
        const p = fighterPos(ev.slot);
        if (p) this.dust({ x: p.x, y: Math.max(p.y, -1), z: p.z }, 10);
        break;
      }
      case 'mapEvent':
        if (ev.what === 'gust') this.wind = { dir: ev.dir, t: 0, dur: ev.dur };
        if (ev.what === 'fenceDrop') this.dust(ev.pos, 16);
        break;
      default:
        break;
    }
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.parts.splice(i, 1);
        continue;
      }
      p.v.y -= p.g * dt;
      p.p.addScaledVector(p.v, dt);
    }
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (p) {
        const f = 1 - p.age / p.life;
        this.pPos.set([p.p.x, p.p.y, p.p.z], i * 3);
        this.pCol.set([p.c.r * f, p.c.g * f, p.c.b * f], i * 3);
      } else {
        this.pPos.set([0, -999, 0], i * 3);
      }
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    this.shake = Math.max(0, this.shake - dt * 1.2);
    if (this.wind) {
      this.wind.t += dt;
      if (this.wind.t > this.wind.dur) this.wind = null;
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
