// 입력 장치: 키보드 두 가지 배치, 마우스, 게임패드(최대 4개), 터치.
// 키는 e.code(키 위치)로 읽어서 한글 입력 상태에서도 그대로 동작한다.
import { BTN } from '../sim/fighter.js';

export const TAP_KEYS = ['jump', 'handL', 'handR', 'kick', 'head', 'grapple'];

const KB = {
  kbA: {
    label: '키보드 1',
    move: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
    btn: {
      jump: ['Space'], handL: ['KeyJ'], handR: ['KeyK'], kick: ['KeyL', 'KeyE'], head: ['KeyU', 'KeyQ'],
      grapple: ['KeyF'], sprint: ['ShiftLeft'], crouch: ['KeyC', 'ControlLeft'],
    },
    mouse: true,
  },
  kbB: {
    label: '키보드 2',
    move: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] },
    btn: {
      jump: ['Numpad0', 'ControlRight'], handL: ['Numpad1', 'Comma'], handR: ['Numpad2', 'Period'], kick: ['Numpad3', 'Slash'],
      head: ['Numpad4', 'Semicolon'], grapple: ['Numpad5', 'Quote'], sprint: ['Numpad6', 'ShiftRight'], crouch: ['Numpad7', 'BracketRight'],
    },
  },
};

const BIT = { jump: BTN.JUMP, handL: BTN.HAND_L, handR: BTN.HAND_R, kick: BTN.KICK, head: BTN.HEAD, grapple: BTN.GRAPPLE, sprint: BTN.SPRINT, crouch: BTN.CROUCH };
// 표준 게임패드: A 점프, B 발차기, X 박치기, Y 잡기기술, LB 웅크리기, RB 달리기, LT/RT 왼손/오른손
const PAD = { jump: [0], kick: [1], head: [2], grapple: [3], crouch: [4], sprint: [5, 10], handL: [6], handR: [7] };

export const DEVICE_LABELS = { kbA: '키보드 1', kbB: '키보드 2', touch: '터치', pad0: '게임패드 1', pad1: '게임패드 2', pad2: '게임패드 3', pad3: '게임패드 4' };

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.mouse = { L: false, R: false };
    this.taps = {};
    this.touch = { mx: 0, mz: 0, btn: 0 };
    this.enabled = true;
    this.listeners = [];
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    this.on(window, 'keydown', (e) => {
      if (typing(e)) return;
      if (!e.repeat) this.onPress('key', e.code);
      this.keys.add(e.code);
      if (this.enabled && (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Slash' || e.code === 'Quote')) e.preventDefault();
    });
    this.on(window, 'keyup', (e) => this.keys.delete(e.code));
    this.on(window, 'blur', () => { this.keys.clear(); this.mouse.L = this.mouse.R = false; });
    if (target) {
      this.on(target, 'mousedown', (e) => {
        if (e.button === 0) { this.mouse.L = true; this.onPress('mouse', 'L'); }
        if (e.button === 2) { this.mouse.R = true; this.onPress('mouse', 'R'); }
      });
      this.on(window, 'mouseup', (e) => {
        if (e.button === 0) this.mouse.L = false;
        if (e.button === 2) this.mouse.R = false;
      });
      this.on(target, 'contextmenu', (e) => e.preventDefault());
    }
    this.padPrev = {};
  }

  on(t, type, fn, opts) {
    t.addEventListener(type, fn, opts);
    this.listeners.push(() => t.removeEventListener(type, fn, opts));
  }

  counter(device) {
    if (!this.taps[device]) this.taps[device] = Object.fromEntries(TAP_KEYS.map((k) => [k, 0]));
    return this.taps[device];
  }

  onPress(kind, code) {
    for (const [dev, map] of Object.entries(KB)) {
      for (const k of TAP_KEYS) {
        if (kind === 'key' && map.btn[k].includes(code)) this.counter(dev)[k] += 1;
      }
      if (kind === 'mouse' && map.mouse) this.counter(dev)[code === 'L' ? 'handL' : 'handR'] += 1;
    }
    this.lastPress = { kind, code, t: performance.now() };
  }

  /** 새로 연결된 게임패드에서 아무 버튼이나 눌렸는지 (로컬 플레이어 추가용) */
  pollJoin() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const out = [];
    for (const p of pads) {
      if (!p) continue;
      const pressed = p.buttons.some((b) => b.pressed);
      const key = `pad${p.index}`;
      if (pressed && !this.padPrev[`join${key}`]) out.push(key);
      this.padPrev[`join${key}`] = pressed;
    }
    return out;
  }

  connectedPads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return [...pads].filter(Boolean).map((p) => `pad${p.index}`);
  }

  /** 카메라 기준 방향을 월드로 바꿔 준다 */
  static toWorld(ix, iy, yaw) {
    // 앞(화면 위쪽) = 카메라가 바라보는 방향
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    return { x: rx * ix + fx * iy, z: rz * ix + fz * iy };
  }

  /** 장치 하나의 현재 입력 → { mx, mz, btn, taps } (월드 기준) */
  read(device, camYaw) {
    let ix = 0;
    let iy = 0;
    let btn = 0;
    if (!this.enabled) return { mx: 0, mz: 0, btn: 0, taps: this.counter(device) };
    if (KB[device]) {
      const map = KB[device];
      const k = (codes) => codes.some((c) => this.keys.has(c));
      if (k(map.move.left)) ix -= 1;
      if (k(map.move.right)) ix += 1;
      if (k(map.move.up)) iy += 1;
      if (k(map.move.down)) iy -= 1;
      for (const [name, codes] of Object.entries(map.btn)) if (k(codes)) btn |= BIT[name];
      if (map.mouse) {
        if (this.mouse.L) btn |= BTN.HAND_L;
        if (this.mouse.R) btn |= BTN.HAND_R;
      }
    } else if (device.startsWith('pad')) {
      const idx = Number(device.slice(3));
      const pad = navigator.getGamepads ? navigator.getGamepads()[idx] : null;
      if (pad) {
        const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
        ix = dz(pad.axes[0] || 0);
        iy = -dz(pad.axes[1] || 0);
        const b = (i) => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4);
        if (b(14)) ix = -1;
        if (b(15)) ix = 1;
        if (b(12)) iy = 1;
        if (b(13)) iy = -1;
        const c = this.counter(device);
        for (const [name, idxs] of Object.entries(PAD)) {
          const on = idxs.some(b);
          if (on) btn |= BIT[name];
          const prevKey = `${device}:${name}`;
          if (on && !this.padPrev[prevKey] && TAP_KEYS.includes(name)) c[name] += 1;
          this.padPrev[prevKey] = on;
        }
      }
    } else if (device === 'touch') {
      ix = this.touch.mx;
      iy = this.touch.mz;
      btn = this.touch.btn;
      if (Math.hypot(ix, iy) > 0.92) btn |= BTN.SPRINT;
    }
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }
    const w = Input.toWorld(ix, iy, camYaw);
    return { mx: w.x, mz: w.z, btn, taps: { ...this.counter(device) } };
  }

  /** 터치 버튼 누름 */
  touchPress(name, down) {
    const bit = BIT[name];
    if (down) {
      this.touch.btn |= bit;
      if (TAP_KEYS.includes(name)) this.counter('touch')[name] += 1;
    } else {
      this.touch.btn &= ~bit;
    }
  }

  dispose() {
    for (const off of this.listeners) off();
  }
}

export const CONTROLS_HELP = [
  ['이동', 'W A S D', '방향키', '왼쪽 스틱'],
  ['왼손 (탭=주먹, 꾹=잡기)', 'J / 마우스 왼쪽', '1 / ,', 'LT'],
  ['오른손', 'K / 마우스 오른쪽', '2 / .', 'RT'],
  ['점프 (잡고 있으면 들어 올리기)', 'Space', '0 / 오른쪽 Ctrl', 'A'],
  ['발차기', 'L / E', '3 / /', 'B'],
  ['박치기', 'U / Q', '4 / ;', 'X'],
  ['MMA 기술 (태클·수플렉스·마운트·초크)', 'F', "5 / '", 'Y'],
  ['달리기', '왼쪽 Shift', '6 / 오른쪽 Shift', 'RB'],
  ['웅크리기', 'C / 왼쪽 Ctrl', '7 / ]', 'LB'],
];
