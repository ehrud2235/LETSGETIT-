// 1인칭 손과 무기. 벽에 파묻히지 않도록 따로 그린다 (깊이만 비우고 위에 덧그림).
import * as THREE from 'three';
import { glowTex } from './textures.js';

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(new THREE.AmbientLight('#8a96b0', 0.9));
    const rim = new THREE.DirectionalLight('#9fb4e8', 0.8);
    rim.position.set(-1, 0.6, -0.4);
    this.scene.add(rim);
    const key = new THREE.DirectionalLight('#fff4e0', 1.1);
    key.position.set(0.5, 1, 0.8);
    this.scene.add(key);
    this.flashLight = new THREE.PointLight('#ffb060', 0, 3, 2);
    this.flashLight.position.set(0.1, -0.05, -0.8);
    this.scene.add(this.flashLight);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.models = {
      pistol: this.pistol(),
      shotgun: this.shotgun(),
      rifle: this.rifle(),
      medkit: this.medkit(),
    };
    for (const m of Object.values(this.models)) {
      m.visible = false;
      this.root.add(m);
    }
    this.cur = 'pistol';
    this.models.pistol.visible = true;
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffc070', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.muzzle.scale.set(0.001, 0.001, 1);
    this.scene.add(this.muzzle);
    this.recoil = 0;
    this.kick = 0;
    this.switchT = 0;
    this.reloadT = 0;
    this.reloadDur = 1;
    this.shoveT = 0;
    this.healK = 0;
    this.bobT = 0;
    this.sway = new THREE.Vector2();
    this.flashT = 0;
    this.downed = false;
  }

  mats() {
    return {
      dark: new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.35, metalness: 0.55 }),
      mid: new THREE.MeshStandardMaterial({ color: '#5a5e66', roughness: 0.45, metalness: 0.45 }),
      wood: new THREE.MeshStandardMaterial({ color: '#6a4228', roughness: 0.7 }),
      skin: new THREE.MeshStandardMaterial({ color: '#d6a88a', roughness: 0.8 }),
      glove: new THREE.MeshStandardMaterial({ color: '#4a4038', roughness: 0.9 }),
      sleeve: new THREE.MeshStandardMaterial({ color: '#35557f', roughness: 0.9 }),
    };
  }

  build(parts) {
    const g = new THREE.Group();
    for (const [w, h, d, x, y, z, mat, rx = 0] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      g.add(m);
    }
    return g;
  }

  hands(M, g, leftZ = -0.18) {
    // 오른손(손잡이)과 왼손(받침)
    g.add(this.build([
      [0.07, 0.09, 0.1, 0, -0.07, 0.02, M.glove],
      [0.08, 0.08, 0.3, 0.02, -0.12, 0.2, M.sleeve],
      [0.07, 0.07, 0.09, -0.02, -0.05, leftZ, M.glove],
      [0.08, 0.08, 0.3, -0.1, -0.1, leftZ + 0.16, M.sleeve, -0.3],
    ]));
  }

  pistol() {
    const M = this.mats();
    const g = this.build([
      [0.035, 0.04, 0.2, 0, 0.02, -0.08, M.dark],
      [0.033, 0.03, 0.18, 0, -0.005, -0.08, M.mid],
      [0.032, 0.1, 0.05, 0, -0.05, 0.0, M.dark, -0.2],
      [0.012, 0.012, 0.02, 0, 0.045, -0.17, M.dark],
    ]);
    this.hands(M, g, -0.02);
    g.userData = { pos: [0.16, -0.16, -0.32], tip: [0, 0.02, -0.2] };
    return g;
  }

  shotgun() {
    const M = this.mats();
    const g = this.build([
      [0.045, 0.045, 0.7, 0, 0.03, -0.3, M.dark],
      [0.04, 0.04, 0.5, 0, -0.01, -0.3, M.mid],
      [0.06, 0.07, 0.22, 0, 0.0, -0.02, M.dark],
      [0.06, 0.065, 0.2, 0, -0.03, -0.42, M.wood],
      [0.055, 0.09, 0.3, 0, -0.04, 0.2, M.wood, 0.15],
    ]);
    this.hands(M, g, -0.42);
    g.userData = { pos: [0.17, -0.18, -0.3], tip: [0, 0.03, -0.66] };
    return g;
  }

  rifle() {
    const M = this.mats();
    const g = this.build([
      [0.045, 0.07, 0.34, 0, 0.0, -0.08, M.dark],
      [0.03, 0.03, 0.4, 0, 0.02, -0.42, M.mid],
      [0.035, 0.13, 0.06, 0, -0.09, -0.1, M.dark, 0.15],
      [0.05, 0.08, 0.2, 0, -0.01, 0.17, M.dark],
      [0.03, 0.03, 0.06, 0, 0.06, -0.05, M.mid],
      [0.05, 0.05, 0.2, 0, -0.01, -0.3, M.mid],
    ]);
    this.hands(M, g, -0.3);
    g.userData = { pos: [0.16, -0.17, -0.3], tip: [0, 0.02, -0.62] };
    return g;
  }

  medkit() {
    const M = this.mats();
    const red = new THREE.MeshStandardMaterial({ color: '#c8201c', roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, emissive: '#333' });
    const g = this.build([
      [0.34, 0.24, 0.12, 0, 0, 0, red],
      [0.16, 0.05, 0.005, 0, 0, -0.063, white],
      [0.05, 0.16, 0.005, 0, 0, -0.063, white],
      [0.08, 0.08, 0.1, 0.18, -0.08, 0.06, M.glove],
      [0.08, 0.08, 0.1, -0.18, -0.08, 0.06, M.glove],
    ]);
    g.userData = { pos: [0.0, -0.2, -0.42], tip: [0, 0, 0] };
    return g;
  }

  setWeapon(name) {
    if (this.cur === name) return;
    this.cur = name;
    this.switchT = 0.35;
  }

  fire(strength = 1) {
    this.recoil = Math.min(1.5, this.recoil + strength);
    this.flashT = 0.05;
    const tip = this.models[this.cur].userData.tip;
    this.muzzleTip = tip;
  }

  reload(dur) {
    this.reloadT = dur;
    this.reloadDur = dur;
  }

  shove() {
    this.shoveT = 0.35;
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt, { moving, sprint, lookDX, lookDY, heal = 0, downed = false }) {
    for (const [k, m] of Object.entries(this.models)) m.visible = k === this.cur;
    const m = this.models[this.cur];
    const base = m.userData.pos;
    this.bobT += dt * (moving ? (sprint ? 13 : 9) : 1.5);
    const bobA = moving ? (sprint ? 0.022 : 0.012) : 0.003;
    this.sway.x += ((-lookDX * 0.0006) - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += ((lookDY * 0.0006) - this.sway.y) * Math.min(1, dt * 10);
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.switchT = Math.max(0, this.switchT - dt);
    this.reloadT = Math.max(0, this.reloadT - dt);
    this.shoveT = Math.max(0, this.shoveT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    let x = base[0] + Math.cos(this.bobT) * bobA + this.sway.x;
    let y = base[1] + Math.abs(Math.sin(this.bobT)) * bobA + this.sway.y - this.recoil * 0.02;
    let z = base[2] + this.recoil * 0.06;
    let rx = this.recoil * 0.12;
    let ry = 0;
    let rz = 0;
    if (sprint && moving && this.cur !== 'medkit') {
      rx -= 0.25;
      ry += 0.6;
      x += 0.04;
    }
    if (this.switchT > 0) y -= Math.sin((this.switchT / 0.35) * Math.PI * 0.5) * 0.35;
    if (this.reloadT > 0) {
      const k = 1 - this.reloadT / this.reloadDur;
      const a = Math.sin(k * Math.PI);
      rx -= a * 0.5;
      rz += a * 0.6;
      y -= a * 0.1;
    }
    if (this.shoveT > 0) {
      const a = Math.sin((1 - this.shoveT / 0.35) * Math.PI);
      z -= a * 0.18;
      x -= a * 0.12;
      rz += a * 0.8;
      ry += a * 0.4;
    }
    if (this.cur === 'medkit' && heal > 0) {
      y += Math.sin(heal * 30) * 0.01 - heal * 0.08;
      rx += heal * 0.6;
    }
    if (downed) {
      y -= 0.04;
      rz += 0.3;
    }
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    // 총구 불꽃
    if (this.flashT > 0 && this.cur !== 'medkit') {
      const tip = new THREE.Vector3(...m.userData.tip).applyEuler(m.rotation).add(m.position);
      this.muzzle.position.copy(tip);
      const s = 0.25 + Math.random() * 0.15;
      this.muzzle.scale.set(s, s, 1);
      this.muzzle.material.rotation = Math.random() * 6;
      this.flashLight.intensity = 4;
    } else {
      this.muzzle.scale.set(0.001, 0.001, 1);
      this.flashLight.intensity = 0;
    }
  }

  /** 세상 조명 밝기에 따라 무기도 어둡게 (지하에서 너무 밝지 않게) */
  setAmbient(k) {
    this.scene.children.forEach((c) => {
      if (c.isAmbientLight) c.intensity = 0.35 + k * 0.6;
    });
  }
}
