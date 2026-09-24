// 게임 화면: 조명, 그림자, 모두를 담는 카메라, 캐릭터·맵 모델에 물리 결과를 입힌다.
import * as THREE from 'three';
import { MAPS } from '../sim/maps.js';
import { PART_NAMES } from '../sim/fighter.js';
import { modsOf } from '../sim/roster.js';
import { buildCharacter } from './character.js';
import { buildMapView } from './mapview.js';
import { Effects } from './fx.js';

const NPARTS = PART_NAMES.length;

export class GameRenderer {
  constructor(container, { quality = 'medium' } = {}) {
    this.container = container;
    this.quality = quality;
    const renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'low' ? 1 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.scene = null;
    this.fighters = new Map();
    this.camState = null;
    this.t = 0;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 라운드마다 장면을 새로 만든다. roster: [{slot, charId}] (슬롯 순서) */
  setupRound(mapId, roster) {
    this.disposeScene();
    const def = MAPS[mapId] || MAPS.octagon;
    this.def = def;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(def.env.bg);
    if (def.env.fog) scene.fog = new THREE.Fog(def.env.fog[0], def.env.fog[1], def.env.fog[2]);
    const [hs, hg, hi] = def.env.hemi;
    scene.add(new THREE.HemisphereLight(hs, hg, hi));
    const sun = new THREE.DirectionalLight(def.env.sun.color, def.env.sun.intensity);
    sun.position.set(...def.env.sun.pos);
    sun.castShadow = this.renderer.shadowMap.enabled;
    const size = def.env.sun.size || 10;
    sun.shadow.camera.left = -size; sun.shadow.camera.right = size;
    sun.shadow.camera.top = size; sun.shadow.camera.bottom = -size;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
    const sm = this.quality === 'high' ? 4096 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    scene.add(sun, sun.target);
    for (const s of def.env.spots || []) {
      const pl = new THREE.PointLight(s[3], 40, 30, 1.6);
      pl.position.set(s[0], s[1], s[2]);
      scene.add(pl);
    }
    this.mapView = buildMapView(def);
    scene.add(this.mapView.group);
    this.fighters = new Map();
    this.order = [];
    for (const r of roster) {
      const ch = buildCharacter(r.charId, modsOf(r.charId));
      scene.add(ch.root);
      this.fighters.set(r.slot, ch);
      this.order.push(r.slot);
    }
    this.fx = new Effects(scene);
    this.scene = scene;
    this.camera.fov = def.camera.fov || 42;
    this.camera.updateProjectionMatrix();
    this.camState = null;
  }

  disposeScene() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
    });
    this.fx?.dispose();
    this.scene = null;
  }

  /** transforms: [격투가 × 11부위 × 7] + [맵 물체 × 7], statuses: 슬롯 순서 */
  applyFrame(transforms, statuses) {
    if (!this.scene || !transforms) return;
    let i = 0;
    for (const slot of this.order) {
      const ch = this.fighters.get(slot);
      for (const name of PART_NAMES) {
        const g = ch.parts[name];
        g.position.set(transforms[i], transforms[i + 1], transforms[i + 2]);
        g.quaternion.set(transforms[i + 3], transforms[i + 4], transforms[i + 5], transforms[i + 6]);
        i += 7;
      }
    }
    for (const o of this.mapView.objects) {
      if (i + 7 > transforms.length) break;
      o.group.position.set(transforms[i], transforms[i + 1], transforms[i + 2]);
      o.group.quaternion.set(transforms[i + 3], transforms[i + 4], transforms[i + 5], transforms[i + 6]);
      i += 7;
    }
    this.statuses = statuses;
  }

  fighterPos(slot, part = 'pelvis') {
    const ch = this.fighters.get(slot);
    return ch ? ch.parts[part].position : null;
  }

  onEvents(events) {
    if (!this.fx) return;
    for (const ev of events) this.fx.onEvent(ev, (slot) => this.fighterPos(slot, 'head'));
  }

  updateCamera(dt) {
    const cam = this.def.camera;
    const pts = [];
    for (const slot of this.order) {
      const st = this.statuses?.find((s) => s.slot === slot);
      if (st && st.flags & 1) continue;
      const p = this.fighterPos(slot);
      if (p && p.y > -3) pts.push(p);
    }
    let cx = cam.target[0];
    let cy = cam.target[1];
    let cz = cam.target[2];
    let spread = 3;
    if (pts.length) {
      const min = new THREE.Vector3(Infinity, Infinity, Infinity);
      const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      for (const p of pts) {
        min.min(p);
        max.max(p);
      }
      cx = (min.x + max.x) / 2 * 0.8 + cam.target[0] * 0.2;
      cz = (min.z + max.z) / 2 * 0.8 + cam.target[2] * 0.2;
      cy = Math.max(cam.target[1], Math.min((min.y + max.y) / 2, 3));
      spread = Math.max(max.x - min.x, (max.z - min.z) * 1.3, 2.5);
    }
    const want = Math.min(cam.maxDist, Math.max(cam.minDist, spread * 1.25 + 6));
    if (!this.camState) this.camState = { x: cx, y: cy, z: cz, d: want };
    const s = this.camState;
    const k = 1 - Math.exp(-dt * 2.5);
    s.x += (cx - s.x) * k;
    s.y += (cy - s.y) * k;
    s.z += (cz - s.z) * k;
    s.d += (want - s.d) * (1 - Math.exp(-dt * 1.6));
    const yaw = cam.yaw;
    const pitch = cam.pitch;
    const shake = this.fx ? this.fx.shake : 0;
    const jx = (Math.random() - 0.5) * shake;
    const jy = (Math.random() - 0.5) * shake;
    this.camera.position.set(
      s.x + Math.sin(yaw) * Math.cos(pitch) * s.d + jx,
      s.y + Math.sin(pitch) * s.d + jy,
      s.z + Math.cos(yaw) * Math.cos(pitch) * s.d,
    );
    this.camera.lookAt(s.x + jx * 0.3, s.y, s.z);
  }

  render(dt) {
    if (!this.scene) return;
    this.t += dt;
    for (const slot of this.order) {
      const st = this.statuses?.find((x) => x.slot === slot);
      this.fighters.get(slot).update(st, this.t);
    }
    this.mapView.update(this.t, dt);
    this.fx.update(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** 월드 좌표 → 화면 픽셀 (이름표용) */
  project(p) {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 };
  }

  dispose() {
    this.disposeScene();
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { NPARTS };
