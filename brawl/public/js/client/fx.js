// 타격 효과: 불꽃, 만화 의성어("퍽!"), 먼지, 화면 흔들림, 돌풍 줄무늬
import * as THREE from 'three';
import { canvasTexture, FONT } from './materials.js';

const WORDS = { hand: ['퍽!', '빡!', '팍!'], foot: ['뻑!', '콰직!'], head: ['쾅!', '꽝!'], body: ['쿵!'], prop: ['떵!'], slam: ['쿵!'], ko: ['K.O.'], out: ['아웃!'], tap: ['탭!'] };
const COLORS = { hand: '#fff3b0', foot: '#ffd166', head: '#ff8fa3', body: '#ffffff', prop: '#9be7ff', slam: '#ffffff', ko: '#ffe066', out: '#ff5a5f', tap: '#7cf0a7' };

const texCache = new Map();
function wordTexture(word, color) {
  const key = word + color;
  if (!texCache.has(key)) {
    texCache.set(key, canvasTexture(256, 128, (g, w, h) => {
      g.font = `bold 84px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 14;
      g.strokeStyle = '#1b1b24';
      g.strokeText(word, w / 2, h / 2 + 4);
      g.fillStyle = color;
      g.fillText(word, w / 2, h / 2 + 4);
    }));
  }
  return texCache.get(key);
}

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
    this.items = [];
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

  word(kind, pos, scale = 1) {
    const list = WORDS[kind] || WORDS.hand;
    const word = list[Math.floor(Math.random() * list.length)];
    const mat = new THREE.SpriteMaterial({ map: wordTexture(word, COLORS[kind] || '#fff'), transparent: true, depthTest: false });
    const s = new THREE.Sprite(mat);
    s.position.set(pos.x + (Math.random() - 0.5) * 0.3, pos.y + 0.4, pos.z);
    s.renderOrder = 10;
    this.group.add(s);
    this.items.push({ obj: s, age: 0, life: 0.75, base: 0.9 * scale, vy: 0.9 });
  }

  /** 시뮬레이션 이벤트를 효과로 */
  onEvent(ev, fighterPos) {
    switch (ev.type) {
      case 'hit': {
        const big = ev.dmg >= 14;
        this.sparks(ev.pos, ev.kind === 'foot' ? '#ffd166' : '#fff3b0', big ? 18 : 10, big ? 5 : 3);
        if (ev.dmg >= 6) this.word(ev.kind, ev.pos, big ? 1.25 : 0.9);
        this.shake = Math.max(this.shake, big ? 0.22 : 0.08);
        break;
      }
      case 'slam':
        this.dust(ev.pos, 12);
        if (ev.dmg >= 8) this.word('slam', ev.pos, 1);
        this.shake = Math.max(this.shake, 0.15);
        break;
      case 'ko': {
        const p = fighterPos(ev.slot);
        if (p) {
          this.word('ko', p, 1.5);
          this.sparks(p, '#ffe066', 24, 4);
        }
        this.shake = Math.max(this.shake, 0.3);
        break;
      }
      case 'out': {
        const p = fighterPos(ev.slot);
        if (p) this.word('out', { x: p.x, y: Math.max(p.y, -1), z: p.z }, 1.6);
        break;
      }
      case 'submitWin': {
        const p = fighterPos(ev.slot);
        if (p) this.word('tap', p, 1.5);
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
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const k = it.age / it.life;
      const pop = k < 0.15 ? k / 0.15 : 1;
      it.obj.scale.set(it.base * 2 * pop, it.base * pop, 1);
      it.obj.position.y += it.vy * dt;
      it.obj.material.opacity = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      if (it.age >= it.life) {
        this.group.remove(it.obj);
        it.obj.material.dispose();
        this.items.splice(i, 1);
      }
    }
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
