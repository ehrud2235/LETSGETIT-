// 동료 생존자 모델: 걷기·조준·쓰러짐, 손에 든 무기, 손전등, 이름표.
import * as THREE from 'three';
import { PARTS, poseMatrices, headGeometry } from './body.js';
import { textTex } from './textures.js';

const LOOKS = [
  { jacket: '#35557f', pants: '#2a3448', skin: '#e2bca2', hair: '#1c1612', pack: '#3a3a2a' },
  { jacket: '#8a4a26', pants: '#343a2e', skin: '#d8b08e', hair: '#3a2616', pack: '#2a3a4a' },
];

export class Survivor {
  constructor(scene, slot, name) {
    this.scene = scene;
    const L = LOOKS[slot % LOOKS.length];
    this.group = new THREE.Group();
    this.parts = PARTS.map((p) => {
      const geo = p.face ? headGeometry(p.size) : new THREE.BoxGeometry(...p.size);
      const color = p.kind === 'shirt' || p.kind === 'sleeve' ? L.jacket : p.kind === 'pants' ? L.pants : p.kind === 'shoes' ? '#1a1a1a' : L.skin;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
      m.matrixAutoUpdate = false;
      m.castShadow = true;
      this.group.add(m);
      return m;
    });
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.26), new THREE.MeshStandardMaterial({ color: L.hair, roughness: 1 }));
    hair.position.set(0, 0.13, 0.01);
    this.parts[2].add(hair);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.18), new THREE.MeshStandardMaterial({ color: L.pack, roughness: 1 }));
    pack.position.set(0, 0.02, 0.21);
    this.parts[1].add(pack);
    this.gun = new THREE.Group();
    this.gun.rotation.x = -Math.PI / 2;
    this.gun.position.set(0, -0.17, -0.02);
    this.parts[6].add(this.gun);
    this.guns = {};
    const dark = new THREE.MeshStandardMaterial({ color: '#1c1c1e', roughness: 0.4, metalness: 0.6 });
    const wood = new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.8 });
    const mk = (parts) => {
      const g = new THREE.Group();
      for (const [w, h, d, x, y, z, mat] of parts) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        g.add(m);
      }
      g.visible = false;
      this.gun.add(g);
      return g;
    };
    this.guns[0] = mk([[0.04, 0.05, 0.2, 0, 0, -0.08, dark], [0.035, 0.1, 0.05, 0, -0.06, 0, dark]]);
    this.guns[1] = mk([[0.05, 0.05, 0.75, 0, 0.02, -0.3, dark], [0.06, 0.07, 0.25, 0, -0.01, 0.12, wood], [0.06, 0.05, 0.2, 0, -0.02, -0.28, wood]]);
    this.guns[2] = mk([[0.05, 0.07, 0.62, 0, 0.02, -0.22, dark], [0.04, 0.14, 0.06, 0, -0.07, -0.12, dark], [0.05, 0.08, 0.22, 0, 0, 0.16, dark]]);
    this.guns[3] = mk([[0.3, 0.1, 0.22, 0, 0, -0.05, new THREE.MeshStandardMaterial({ color: '#c8201c' })]]);
    this.flash = new THREE.SpotLight('#fff6e0', 0, 40, 0.45, 0.6, 1.35);
    this.flash.castShadow = false;
    scene.add(this.flash, this.flash.target);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTex(name, { w: 256, h: 64, bg: 'rgba(0,0,0,0.45)', size: 0.55 }), depthTest: false, transparent: true, toneMapped: false }));
    this.tag.scale.set(1.1, 0.28, 1);
    this.tag.renderOrder = 5;
    scene.add(this.tag);
    scene.add(this.group);
    this.mats = PARTS.map(() => new THREE.Matrix4());
    this.phase = 0;
    this.prev = null;
    this.speed = 0;
  }

  setName(name) {
    this.tag.material.map = textTex(name, { w: 256, h: 64, bg: 'rgba(0,0,0,0.45)', size: 0.55 });
  }

  /** s: { x, z, yaw, pitch, status, flags, weapon } */
  update(s, dt, t) {
    if (!s) {
      this.group.visible = false;
      this.tag.visible = false;
      this.flash.intensity = 0;
      return;
    }
    this.group.visible = true;
    if (this.prev) {
      const d = Math.hypot(s.x - this.prev.x, s.z - this.prev.z);
      const v = dt > 0 ? d / dt : 0;
      this.speed += (Math.min(8, v) - this.speed) * Math.min(1, dt * 8);
    }
    this.prev = { x: s.x, z: s.z };
    this.phase += dt * (1 + this.speed * 2.2);
    const ph = this.phase;
    const run = Math.min(1, this.speed / 4.5);
    const amp = this.speed < 0.3 ? 0 : 0.3 + run * 0.45;
    const pitch = s.pitch || 0;
    const p = { x: s.x, z: s.z, yaw: s.yaw, scale: 1 };
    const w = s.weapon;
    for (const [k, g] of Object.entries(this.guns)) g.visible = Number(k) === w;
    if (s.status === 1 || s.status === 2) {
      // 쓰러짐: 등을 대고 누워 권총을 든다
      p.fall = 1.35;
      p.y = 0.05;
      p.legL = 0.3;
      p.kneeL = -0.8;
      p.legR = 0.05;
      p.armR = s.status === 1 ? [1.9, -0.2] : [0.3, -0.6];
      p.armL = [0.4, 0.8];
      p.head = [-0.6, 0.3, 0];
      for (const [k, g] of Object.entries(this.guns)) g.visible = s.status === 1 && Number(k) === 0;
    } else {
      p.legL = Math.sin(ph) * amp;
      p.legR = -Math.sin(ph) * amp;
      p.kneeL = -(0.1 + Math.max(0, Math.sin(ph + 1.4)) * amp);
      p.kneeR = -(0.1 + Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * amp);
      p.bob = Math.abs(Math.sin(ph)) * 0.04 * run;
      p.lean = -0.05 - run * 0.15;
      p.head = [-pitch * 0.6, 0, 0];
      if (w === 3) {
        p.armR = [0.9, -0.1];
        p.armL = [0.9, 0.3];
        p.elbowL = 0.6;
        p.elbowR = 0.6;
      } else {
        p.armR = [1.5 + pitch * 0.8, -0.08];
        p.armL = [1.35 + pitch * 0.8, 0.5];
        p.elbowR = 0.08;
        p.elbowL = 0.45;
      }
      if (s.flags & 8) {
        p.armR = [0.7, -0.4];
        p.armL = [0.7, 0.4];
      }
    }
    poseMatrices(p, this.mats);
    this.parts.forEach((m, i) => {
      m.matrix.copy(this.mats[i]);
      m.matrixWorldNeedsUpdate = true;
    });
    // 손전등
    const on = !!(s.flags & 1) && s.status !== 2;
    const fx = -Math.sin(s.yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(s.yaw) * Math.cos(pitch);
    const ey = s.status === 0 ? 1.45 : 0.4;
    this.flash.position.set(s.x + fx * 0.4, ey, s.z + fz * 0.4);
    this.flash.target.position.set(s.x + fx * 10, ey + fy * 10, s.z + fz * 10);
    this.flash.intensity = on ? 36 : 0;
    this.tag.visible = true;
    this.tag.position.set(s.x, s.status === 0 ? 2.15 : 0.9, s.z);
  }

  dispose() {
    this.scene.remove(this.group, this.flash, this.flash.target, this.tag);
  }
}
