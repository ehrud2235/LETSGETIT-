// 1인칭 조작: 마우스(포인터 잠금)로 둘러보고 WASD 로 걷는다. 터치 기기는 조이스틱 + 드래그.
// 키는 e.code 로 읽는다 — 한글 입력 상태에서도 W 는 'KeyW' 이다.
import { ROOM, COLLIDERS } from './world.js';

const RADIUS = 0.24;
const SPEED = 2.1;
const LOOK = 0.0023;
const TOUCH_LOOK = 0.005;
const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

function blocked(x, z) {
  if (x < ROOM.xMin + RADIUS || x > ROOM.xMax - RADIUS || z < ROOM.zMin + RADIUS || z > ROOM.zMax - RADIUS) return true;
  return COLLIDERS.some((c) => x > c.minX - RADIUS && x < c.maxX + RADIUS && z > c.minZ - RADIUS && z < c.maxZ + RADIUS);
}

export class FirstPerson {
  constructor(camera, dom, { eye, spawn, onInteract, onLockChange }) {
    this.camera = camera;
    this.dom = dom;
    this.eye = eye;
    this.x = spawn.x;
    this.z = spawn.z;
    this.yaw = spawn.yaw;
    this.pitch = 0;
    this.keys = new Set();
    this.touchMove = { x: 0, y: 0 };
    this.enabled = true;
    this.dragMode = false;
    this.bob = 0;
    this.onInteract = onInteract;
    this.onLockChange = onLockChange;
    this.listeners = [];
    this.bind();
    this.apply();
  }

  get locked() {
    return document.pointerLockElement === this.dom;
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  lock() {
    if (this.dragMode || this.locked) return;
    if (!this.dom.requestPointerLock) {
      this.dragMode = true;
      return;
    }
    try {
      const p = this.dom.requestPointerLock();
      if (p && p.catch) p.catch(() => this.lockFailed());
    } catch {
      this.lockFailed();
    }
  }

  // Esc 직후 재요청 등 일시적인 실패도 있으므로, 여러 번 실패할 때만 드래그 방식으로 바꾼다
  lockFailed() {
    this.failures = (this.failures || 0) + 1;
    if (this.failures >= 3) this.dragMode = true;
    this.onLockChange?.(false);
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  look(dx, dy, k = LOOK) {
    dx = Math.max(-150, Math.min(150, dx));
    dy = Math.max(-150, Math.min(150, dy));
    this.yaw -= dx * k;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * k));
  }

  bind() {
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    this.on(window, 'keydown', (e) => {
      if (typing(e) || !this.enabled) return;
      if (MOVE_KEYS[e.code]) {
        this.keys.add(e.code);
        if (e.code.startsWith('Arrow')) e.preventDefault();
      }
      if (e.code === 'KeyE' && !e.repeat) this.onInteract?.(null);
    });
    this.on(window, 'keyup', (e) => this.keys.delete(e.code));
    this.on(window, 'blur', () => this.keys.clear());

    this.on(document, 'pointerlockchange', () => {
      if (this.locked) this.failures = 0;
      else this.keys.clear();
      this.onLockChange?.(this.locked);
    });
    this.on(document, 'pointerlockerror', () => this.lockFailed());
    this.on(document, 'mousemove', (e) => {
      if (this.locked && this.enabled) this.look(e.movementX, e.movementY);
    });

    // 마우스(잠금 없음) / 터치: 드래그로 둘러보고, 짧게 누르면 그 자리의 물건을 조사
    let drag = null;
    this.on(this.dom, 'pointerdown', (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        if (e.button === 0) this.onInteract?.(null);
        return;
      }
      if (e.pointerType === 'mouse' && !this.dragMode) {
        this.lock();
        return;
      }
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, type: e.pointerType };
      this.dom.setPointerCapture?.(e.pointerId);
    });
    this.on(this.dom, 'pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId || !this.enabled) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      this.look(dx, dy, drag.type === 'touch' ? TOUCH_LOOK : LOOK * 1.6);
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.moved < 8 && this.enabled) {
        const r = this.dom.getBoundingClientRect();
        this.onInteract?.({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 });
      }
      drag = null;
    };
    this.on(this.dom, 'pointerup', end);
    this.on(this.dom, 'pointercancel', () => { drag = null; });
  }

  /** 터치 조이스틱 (#joystick) 연결 */
  attachJoystick(el) {
    if (!el) return;
    const knob = el.querySelector('.knob');
    let id = null;
    let cx = 0;
    let cy = 0;
    const R = 44;
    const set = (x, y) => {
      this.touchMove.x = x;
      this.touchMove.y = y;
      if (knob) knob.style.transform = `translate(${x * R}px, ${-y * R}px)`;
    };
    this.on(el, 'pointerdown', (e) => {
      id = e.pointerId;
      const r = el.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      el.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    this.on(el, 'pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = (e.clientX - cx) / R;
      let dy = -(e.clientY - cy) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      set(dx, dy);
    });
    const stop = (e) => { if (e.pointerId === id) { id = null; set(0, 0); } };
    this.on(el, 'pointerup', stop);
    this.on(el, 'pointercancel', stop);
  }

  update(dt) {
    let ix = this.touchMove.x;
    let iz = this.touchMove.y;
    if (this.enabled) {
      for (const k of this.keys) {
        ix += MOVE_KEYS[k][0];
        iz += MOVE_KEYS[k][1];
      }
    }
    const len = Math.hypot(ix, iz);
    if (this.enabled && len > 0.05) {
      const s = (SPEED * Math.min(1, len)) / len;
      ix *= s;
      iz *= s;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // 앞: (-sin, -cos), 오른쪽: (cos, -sin)
      const vx = ix * cos - iz * sin;
      const vz = -ix * sin - iz * cos;
      const nx = this.x + vx * dt;
      const nz = this.z + vz * dt;
      if (!blocked(nx, this.z)) this.x = nx;
      if (!blocked(this.x, nz)) this.z = nz;
      this.bob += dt * 9;
    } else {
      this.bob = 0;
    }
    this.apply();
  }

  apply() {
    const bobY = this.bob ? Math.sin(this.bob) * 0.018 : 0;
    this.camera.position.set(this.x, this.eye + bobY, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /** 디버그: 특정 위치에 서서 한 점을 바라본다 */
  face(stand, look) {
    this.x = stand[0];
    this.z = stand[1];
    const dx = look[0] - this.x;
    const dy = look[1] - this.eye;
    const dz = look[2] - this.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    this.apply();
  }

  dispose() {
    this.unlock();
    for (const off of this.listeners) off();
    this.listeners = [];
  }
}
