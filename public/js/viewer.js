// 3D 화면: 렌더러 + 방 + 1인칭 조작 + 시선(레이캐스트)으로 물건 고르기.
import * as THREE from 'three';
import { buildRoom, SPAWN, ANCHORS } from './world.js';
import { FirstPerson } from './controls.js';

const REACH = 3.2;

function makeRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  return renderer;
}

function visibleInTree(obj) {
  for (let o = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function hotOf(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData.hot) return o.userData.hot;
  return null;
}

export function createViewer(container, role, { onInteract, onTarget, onLockChange } = {}) {
  const renderer = makeRenderer(container);
  const room = buildRoom(role);
  const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 40);
  const raycaster = new THREE.Raycaster();
  raycaster.far = REACH;
  let target = null;
  let raf = 0;
  let paused = false;
  const clock = new THREE.Clock();

  const pick = (ndc) => {
    camera.updateMatrixWorld();
    raycaster.setFromCamera(new THREE.Vector2(ndc?.x || 0, ndc?.y || 0), camera);
    const hits = raycaster.intersectObjects(room.scene.children, true);
    for (const h of hits) {
      if (!h.object.isMesh || !visibleInTree(h.object)) continue;
      return hotOf(h.object); // 가장 가까운 보이는 물체가 핫스팟이 아니면 가려진 것
    }
    return null;
  };

  const controls = new FirstPerson(camera, renderer.domElement, {
    eye: room.eye,
    spawn: SPAWN,
    onLockChange,
    onInteract: (ndc) => {
      const id = pick(ndc);
      if (id) onInteract?.(id);
    },
  });

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (!paused) controls.update(dt);
    room.tick(t);
    const next = paused ? null : pick(null);
    if (next !== target) {
      target = next;
      onTarget?.(target);
    }
    renderer.render(room.scene, camera);
  };
  loop();

  return {
    renderer,
    controls,
    update: (view) => room.update(view),
    get target() { return target; },
    get locked() { return controls.locked; },
    lock: () => controls.lock(),
    unlock: () => controls.unlock(),
    setPaused(v) {
      paused = v;
      controls.enabled = !v;
      if (v) controls.unlock();
    },
    attachJoystick: (el) => controls.attachJoystick(el),
    /** 디버그/자동 테스트: 물건 앞으로 이동해 바라본다 */
    face(id) {
      const a = ANCHORS[id];
      if (a) controls.face(a.stand, a.look);
      return pick(null);
    },
    interactCenter() {
      const id = pick(null);
      if (id) onInteract?.(id);
      return id;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      room.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * 엔딩용: 사람이 조작하지 않는 카메라가 천천히 방을 둘러본다.
 * 같은 시간값을 주면 두 방의 카메라가 정확히 겹친다.
 */
export function createShowcase(container, view) {
  const renderer = makeRenderer(container);
  const room = buildRoom(view.role);
  room.update(view);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.03, 40);
  const start = performance.now();
  let raf = 0;
  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    const t = (performance.now() - start) / 1000;
    // 문 앞에서 방 안쪽을 향해 천천히 들어가며 고개를 돌린다
    const k = Math.min(1, t / 14);
    const ease = k * k * (3 - 2 * k);
    camera.position.set(-2.2 + ease * 1.6, 1.45 + Math.sin(t * 0.5) * 0.02, 1.6 - ease * 0.8);
    camera.lookAt(0.4 + ease * 0.3, 1.3 - ease * 0.1, -2.5);
    room.tick(t);
    renderer.render(room.scene, camera);
  };
  loop();
  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      room.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
