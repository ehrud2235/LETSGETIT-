// 물렁한 격투가: 11개 부위로 된 래그돌 + 균형을 잡으려는 컨트롤러.
// 각 부위의 속도를 목표 자세 쪽으로 조금씩 끌어당기는 방식이라, 맞으면 흔들리고 세게 맞으면 넘어진다.
import { rapier } from './rapier.js';
import * as M from './math.js';

export const DT = 1 / 60;

// 충돌 그룹 (비트)
export const G = { ENV: 0x0001, PROP: 0x0002, FIGHTERS: 0x003c, KILL: 0x0040, ALL: 0xffff };
export const fighterBit = (slot) => 0x0004 << slot;
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);

// 버튼 비트
export const BTN = { JUMP: 1, HAND_L: 2, HAND_R: 4, KICK: 8, HEAD: 16, GRAPPLE: 32, SPRINT: 64, CROUCH: 128 };
export const TAP_KEYS = ['jump', 'handL', 'handR', 'kick', 'head', 'grapple'];
const TAP_BITS = { jump: BTN.JUMP, handL: BTN.HAND_L, handR: BTN.HAND_R, kick: BTN.KICK, head: BTN.HEAD, grapple: BTN.GRAPPLE };

// 네트워크로 보낼 때 이 순서를 쓴다
export const PART_NAMES = ['pelvis', 'torso', 'head', 'uArmL', 'lArmL', 'uArmR', 'lArmR', 'thighL', 'shinL', 'thighR', 'shinR'];

const STAND_H = 0.8; // 서 있을 때 골반 중심 높이
const CROUCH_H = 0.52;
const DOWN = { x: 0, y: -1, z: 0 };

/** 바라보는 방향 기준(왼쪽 = +x, 앞 = +z) 부위 치수. reach 는 팔 길이 배율 */
export function partLayout(reach = 1) {
  const upper = 0.27 * reach;
  const lower = 0.25 * reach;
  const sh = 1.36; // 어깨 높이
  const layout = {
    pelvis: { kind: 'ball', r: 0.25, pos: [0, 0.8, 0], density: 380 },
    torso: { kind: 'capsule', hh: 0.1, r: 0.28, pos: [0, 1.14, 0], density: 260 },
    head: { kind: 'ball', r: 0.26, pos: [0, 1.66, 0], density: 220 },
    thighL: { kind: 'capsule', hh: 0.07, r: 0.115, pos: [0.13, 0.56, 0], density: 330 },
    shinL: { kind: 'capsule', hh: 0.07, r: 0.1, pos: [0.13, 0.28, 0], density: 330, foot: { r: 0.115, off: [0, -0.15, 0.04] } },
  };
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    layout[`uArm${side}`] = { kind: 'capsule', hh: upper * 0.28, r: 0.085, pos: [0.34 * sx, sh - upper / 2, 0], density: 520 };
    layout[`lArm${side}`] = {
      kind: 'capsule', hh: lower * 0.26, r: 0.075, pos: [0.34 * sx, sh - upper - lower / 2, 0], density: 520,
      hand: { r: 0.105, off: [0, -lower / 2 - 0.02, 0] },
    };
  }
  layout.thighR = { ...layout.thighL, pos: [-0.13, 0.56, 0] };
  layout.shinR = { ...layout.shinL, pos: [-0.13, 0.28, 0] };
  layout.joints = [
    ['pelvis', 'torso', [0, 0.97, 0]],
    ['torso', 'head', [0, 1.44, 0]],
    ['torso', 'uArmL', [0.34, sh, 0]],
    ['uArmL', 'lArmL', [0.34, sh - upper, 0]],
    ['torso', 'uArmR', [-0.34, sh, 0]],
    ['uArmR', 'lArmR', [-0.34, sh - upper, 0]],
    ['pelvis', 'thighL', [0.13, 0.7, 0]],
    ['thighL', 'shinL', [0.13, 0.42, 0]],
    ['pelvis', 'thighR', [-0.13, 0.7, 0]],
    ['thighR', 'shinR', [-0.13, 0.42, 0]],
  ];
  return layout;
}

// 깨어 있을 때 부위별 중력 배율 (상체를 가볍게 해서 균형 잡기 쉽게)
const AWAKE_GRAVITY = { pelvis: 1, torso: 0.35, head: 0.2, uArmL: 0.3, lArmL: 0.3, uArmR: 0.3, lArmR: 0.3, thighL: 1, shinL: 1, thighR: 1, shinR: 1 };

/** 팔다리 목표 방향 (바라보는 방향 기준). L 이면 x 부호를 그대로, R 이면 뒤집는다 */
const sideX = (side, x) => (side === 'L' ? x : -x);

export class Fighter {
  /**
   * @param {object} sim  Sim 인스턴스
   * @param {object} opt  { slot, charId, name, mods, spawn:{x,y,z,yaw}, isBot }
   */
  constructor(sim, opt) {
    this.sim = sim;
    this.slot = opt.slot;
    this.charId = opt.charId;
    this.name = opt.name;
    this.isBot = !!opt.isBot;
    this.mods = opt.mods;
    this.layout = partLayout(this.mods.reach);
    this.facing = opt.spawn.yaw;
    this.bodies = {};
    this.colliders = {};
    this.ownHandles = new Set();
    this.joints = [];

    this.maxHp = 100 * this.mods.maxHp;
    this.hp = this.maxHp;
    this.lastDamageT = -99;
    this.koT = 0; // 기절
    this.downT = 0; // 넘어짐 (기절은 아님)
    this.stunT = 0; // 휘청
    this.out = false; // 탈락
    this.outT = 0;
    this.lastHitBy = null;
    this.lastHitT = -99;

    this.grounded = false;
    this.groundDist = null;
    this.jumpT = 0;
    this.jumpCD = 0;
    this.phase = 0; // 걸음 주기
    this.input = { mx: 0, mz: 0, btn: 0, taps: {} };
    this.prevBtn = 0;
    this.prevTaps = {};
    this.pressed = {};

    this.hands = { L: this.newHand(), R: this.newHand() };
    this.kick = { t: -1, dur: 0.42, leg: 'R', cd: 0, hitDone: false };
    this.headbutt = { t: -1, dur: 0.45, cd: 0, hitDone: false };
    this.lift = false; // 잡은 상대를 들어 올리는 중
    this.grab = null; // MMA 동작 상태 (sim/grapple.js 가 관리)
    this.escape = 0; // 잡혔을 때 연타 게이지
    this.grabImmuneT = 0;
    this.stats = { damageDealt: 0, kos: 0, eliminations: 0 };

    this.build(opt.spawn);
  }

  newHand() {
    return { mode: 'idle', t: 0, dur: 0.3, joint: null, target: null, local2: null, active: false, hitDone: false, impulseDone: false };
  }

  // ─── 생성 ──────────────────────────────────────────────────────────────────

  build(spawn) {
    const R = rapier();
    const world = this.sim.world;
    const rot = M.qYaw(spawn.yaw);
    const base = { x: spawn.x, y: spawn.y, z: spawn.z };
    const bit = fighterBit(this.slot);
    const cg = groups(bit, G.ALL & ~bit);
    for (const name of PART_NAMES) {
      const d = this.layout[name];
      const p = M.add(base, M.qRotate(rot, { x: d.pos[0], y: d.pos[1], z: d.pos[2] }));
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(rot)
        .setLinearDamping(0.05)
        .setAngularDamping(name.startsWith('l') || name.startsWith('u') ? 1.2 : 0.8)
        .setCcdEnabled(true)
        .setGravityScale(AWAKE_GRAVITY[name]);
      const body = world.createRigidBody(desc);
      const main = d.kind === 'ball' ? R.ColliderDesc.ball(d.r) : R.ColliderDesc.capsule(d.hh, d.r);
      main.setDensity(d.density).setFriction(0.7).setRestitution(0.05).setCollisionGroups(cg)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      const col = world.createCollider(main, body);
      this.colliders[name] = col;
      this.ownHandles.add(col.handle);
      this.sim.registerCollider(col, { type: 'fighter', fighter: this, part: name, strike: name === 'head' ? 'head' : null });
      if (d.hand) {
        const hd = R.ColliderDesc.ball(d.hand.r).setTranslation(...d.hand.off).setDensity(600).setFriction(1)
          .setCollisionGroups(cg).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
        const hc = world.createCollider(hd, body);
        this.colliders[`hand${name.slice(-1)}`] = hc;
        this.ownHandles.add(hc.handle);
        this.sim.registerCollider(hc, { type: 'fighter', fighter: this, part: name, strike: 'hand', side: name.slice(-1) });
      }
      if (d.foot) {
        const fd = R.ColliderDesc.ball(d.foot.r).setTranslation(...d.foot.off).setDensity(500).setFriction(1.1)
          .setCollisionGroups(cg).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
        const fc = world.createCollider(fd, body);
        this.colliders[`foot${name.slice(-1)}`] = fc;
        this.ownHandles.add(fc.handle);
        this.sim.registerCollider(fc, { type: 'fighter', fighter: this, part: name, strike: 'foot', side: name.slice(-1) });
      }
      this.bodies[name] = body;
      this.sim.registerBody(body, { type: 'fighter', fighter: this, part: name });
    }
    for (const [a, b, anchor] of this.layout.joints) {
      const pa = this.layout[a].pos;
      const pb = this.layout[b].pos;
      const jd = R.JointData.spherical(
        { x: anchor[0] - pa[0], y: anchor[1] - pa[1], z: anchor[2] - pa[2] },
        { x: anchor[0] - pb[0], y: anchor[1] - pb[1], z: anchor[2] - pb[2] },
      );
      const joint = world.createImpulseJoint(jd, this.bodies[a], this.bodies[b], true);
      joint.setContactsEnabled(false);
      this.joints.push(joint);
    }
  }

  destroy() {
    const world = this.sim.world;
    this.releaseHand('L');
    this.releaseHand('R');
    for (const name of PART_NAMES) {
      const body = this.bodies[name];
      if (body) world.removeRigidBody(body);
    }
    this.bodies = {};
  }

  // ─── 도우미 ────────────────────────────────────────────────────────────────

  get alive() {
    return !this.out;
  }

  get awake() {
    return !this.out && this.koT <= 0;
  }

  get controllable() {
    return this.awake && this.downT <= 0;
  }

  pos(part = 'pelvis') {
    return this.bodies[part].translation();
  }

  /** 손(구) 중심의 월드 좌표 */
  handPos(side) {
    const b = this.bodies[`lArm${side}`];
    const off = this.layout[`lArm${side}`].hand.off;
    return M.add(b.translation(), M.qRotate(b.rotation(), { x: off[0], y: off[1], z: off[2] }));
  }

  footPos(side) {
    const b = this.bodies[`shin${side}`];
    const off = this.layout[`shin${side}`].foot.off;
    return M.add(b.translation(), M.qRotate(b.rotation(), { x: off[0], y: off[1], z: off[2] }));
  }

  forward() {
    return { x: Math.sin(this.facing), y: 0, z: Math.cos(this.facing) };
  }

  /** 월드 기준 목표 회전으로 부위를 돌린다 (각속도를 목표 쪽으로 섞는다) */
  drive(part, qTarget, gain, strength, max = 18) {
    const b = this.bodies[part];
    const w = b.angvel();
    const des = M.qErrorAngVel(qTarget, b.rotation(), gain, max);
    b.setAngvel({ x: w.x + (des.x - w.x) * strength, y: w.y + (des.y - w.y) * strength, z: w.z + (des.z - w.z) * strength }, true);
  }

  /** 팔다리(아래쪽이 -y 축)를 월드 방향 dir 로 향하게 한다. 비틀림은 신경 쓰지 않는다. */
  aim(part, dir, gain, strength, max = 22) {
    const b = this.bodies[part];
    const q = b.rotation();
    const cur = M.qRotate(q, DOWN);
    const d = M.norm(dir);
    const c = M.cross(cur, d);
    const s = M.len(c);
    const angle = Math.atan2(s, M.dot(cur, d));
    const w = b.angvel();
    let des = { x: 0, y: 0, z: 0 };
    if (s > 1e-5) des = M.scale(c, Math.min(angle * gain, max) / s);
    // 비틀림 성분은 서서히 없앤다
    const twist = M.dot(w, cur);
    const wPerp = M.sub(w, M.scale(cur, twist));
    b.setAngvel(M.add(M.add(wPerp, M.scale(M.sub(des, wPerp), strength)), M.scale(cur, twist * 0.85)), true);
  }

  /** 바라보는 방향 기준 벡터를 월드로 */
  toWorld(v) {
    const s = Math.sin(this.facing);
    const c = Math.cos(this.facing);
    return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
  }

  addVel(part, dv) {
    const b = this.bodies[part];
    const v = b.linvel();
    b.setLinvel({ x: v.x + dv.x, y: v.y + dv.y, z: v.z + dv.z }, true);
  }

  blendVel(part, target, k, axes = 'xyz') {
    const b = this.bodies[part];
    const v = b.linvel();
    b.setLinvel({
      x: axes.includes('x') ? v.x + (target.x - v.x) * k : v.x,
      y: axes.includes('y') ? v.y + (target.y - v.y) * k : v.y,
      z: axes.includes('z') ? v.z + (target.z - v.z) * k : v.z,
    }, true);
  }

  forEachBody(fn) {
    for (const name of PART_NAMES) fn(this.bodies[name], name);
  }

  setAwakeGravity(awake) {
    this.setGravityMode(awake ? 'awake' : 'limp');
  }

  setGravityMode(mode) {
    if (this.gravMode === mode) return;
    this.gravMode = mode;
    const air = mode === 'air' ? this.mods.airGravity : 1;
    this.forEachBody((b, name) => b.setGravityScale(mode === 'awake' ? AWAKE_GRAVITY[name] : air, true));
  }

  // ─── 입력 ──────────────────────────────────────────────────────────────────

  setInput(input) {
    if (!input) return;
    this.input = input;
  }

  readPresses() {
    const inp = this.input;
    const taps = inp.taps || {};
    for (const k of TAP_KEYS) {
      const bit = TAP_BITS[k];
      const held = (inp.btn & bit) !== 0;
      const was = (this.prevBtn & bit) !== 0;
      const tapChanged = taps[k] !== undefined && this.prevTaps[k] !== undefined && taps[k] !== this.prevTaps[k];
      this.pressed[k] = (held && !was) || tapChanged;
    }
    this.prevBtn = inp.btn;
    this.prevTaps = { ...taps };
  }

  held(bit) {
    return (this.input.btn & bit) !== 0;
  }

  // ─── 매 프레임 ─────────────────────────────────────────────────────────────

  preStep(dt, t) {
    if (this.out) return;
    this.readPresses();
    const anyPress = TAP_KEYS.some((k) => this.pressed[k]);
    if (anyPress && this.sim.isHeld(this)) this.escape += 1;
    this.escape = Math.max(0, this.escape - dt * 1.6);

    for (const k of ['stunT', 'downT', 'jumpT', 'jumpCD', 'grabImmuneT']) this[k] = Math.max(0, this[k] - dt);
    this.kick.cd = Math.max(0, this.kick.cd - dt);
    this.headbutt.cd = Math.max(0, this.headbutt.cd - dt);

    // 땅 감지
    const pp = this.bodies.pelvis.translation();
    this.groundDist = this.sim.castDown(pp, this, 2.2);
    this.grounded = this.groundDist !== null && this.groundDist < STAND_H + 0.2;

    if (this.koT > 0) {
      this.koT -= dt;
      if (this.koT <= 0) this.wakeUp();
      else {
        this.relax();
        return;
      }
    }

    // 기절 게이지 회복
    if (t - this.lastDamageT > 2.5) this.hp = Math.min(this.maxHp, this.hp + 9 * this.mods.regen * dt);

    const lifted = this.sim.isLifted(this);
    let ctrl = this.downT > 0 ? 0 : this.stunT > 0 ? 0.25 : 1;
    if (lifted) ctrl *= 0.3;
    const locked = this.sim.inputLocked;
    const inp = locked ? { mx: 0, mz: 0, btn: 0 } : this.input;
    if (locked) for (const k of TAP_KEYS) this.pressed[k] = false;

    const move = M.clampLen({ x: inp.mx || 0, y: 0, z: inp.mz || 0 }, 1);
    const moving = M.lenXZ(move) > 0.15;
    const sprint = (inp.btn & BTN.SPRINT) !== 0;
    const crouch = (inp.btn & BTN.CROUCH) !== 0;
    const holdingFighter = this.holdingFighter();

    // 방향 전환
    if (moving && ctrl > 0 && !this.grab) {
      const want = Math.atan2(move.x, move.z);
      const turn = M.angleDiff(this.facing, want);
      const rate = (holdingFighter ? 6 : 11) * dt;
      this.facing += M.clamp(turn, -rate, rate);
    }

    // 동작 입력
    if (ctrl > 0.5 && !locked) {
      if (this.pressed.grapple) this.sim.grapple.press(this);
      if (this.pressed.jump) this.onJump();
      if (this.pressed.kick && this.kick.cd <= 0 && this.kick.t < 0) this.startKick();
      if (this.pressed.head && this.headbutt.cd <= 0 && this.headbutt.t < 0) this.startHeadbutt();
      for (const side of ['L', 'R']) if (this.pressed[`hand${side}`]) this.onHandPress(side);
    }
    if (!this.held(BTN.JUMP) && this.lift) this.throwHeld();

    // 몸통 자세
    const speedK = moving ? Math.min(1, M.lenXZ(move)) : 0;
    let lean = 0.1 * speedK * (sprint ? 1.8 : 1);
    if (crouch) lean += 0.35;
    if (this.lift) lean -= 0.25;
    lean += this.kickLean() + this.headbuttLean();
    if (this.grab && this.grab.lean !== undefined) lean = this.grab.lean;
    const B = M.qYaw(this.facing);
    const torsoQ = M.qMul(B, M.qAxisAngle(1, 0, 0, lean));
    const str = ctrl * (this.grounded ? 1 : 0.6);
    this.drive('torso', torsoQ, 14, 0.3 * str);
    this.drive('pelvis', M.qMul(B, M.qAxisAngle(1, 0, 0, lean * 0.3)), 14, 0.3 * str);
    this.drive('head', M.qMul(B, M.qAxisAngle(1, 0, 0, lean * 0.5)), 12, 0.25 * str);

    // 버티기 (골반을 서 있는 높이로)
    const standH = crouch ? CROUCH_H : this.grab && this.grab.standH !== undefined ? this.grab.standH : STAND_H;
    if (ctrl > 0 && this.groundDist !== null && this.jumpT <= 0 && !lifted) {
      const err = standH - this.groundDist;
      if (err > -0.15) {
        const vy = M.clamp(err * 12, -3, 4.5);
        this.blendVel('pelvis', { x: 0, y: vy, z: 0 }, 0.35 * ctrl, 'y');
        this.blendVel('torso', { x: 0, y: vy, z: 0 }, 0.2 * ctrl, 'y');
      }
    }
    // 땅을 딛고 설 수 있을 때만 상체를 가볍게. 공중·들린 상태에서는 제대로 떨어진다 (풍신은 천천히)
    this.setGravityMode(this.grounded && ctrl > 0.2 && !lifted ? 'awake' : 'air');

    // 이동
    let speed = 3.3 * this.mods.speed * (sprint ? 1.55 : 1) * (crouch ? 0.5 : 1) * (holdingFighter ? 0.72 : 1);
    if (this.lift) speed *= 0.7;
    if (this.grab && this.grab.speedMul !== undefined) speed *= this.grab.speedMul;
    const vDes = { x: move.x * speed, y: 0, z: move.z * speed };
    const k = (this.grounded ? 0.2 : 0.05) * ctrl;
    if (k > 0 && !(this.grab && this.grab.noMove)) {
      this.blendVel('pelvis', vDes, k, 'xz');
      this.blendVel('torso', vDes, k * 0.8, 'xz');
    }
    if (moving && this.grounded) this.phase += dt * (5 + speed * 2.2);

    // 팔다리
    this.poseLegs(ctrl, speedK, crouch);
    for (const side of ['L', 'R']) this.updateHand(side, dt, ctrl);
    this.updateKick(dt, ctrl);
    this.updateHeadbutt(dt, ctrl);
    if (this.lift) this.liftAssist();
  }

  relax() {
    // 기절 중에도 관절이 완전히 꺾이지 않게 아주 약하게 자세를 유지
    const B = M.qYaw(this.facing);
    for (const side of ['L', 'R']) {
      this.aim(`thigh${side}`, this.toWorld({ x: 0, y: -1, z: 0.1 }), 4, 0.02);
      this.aim(`shin${side}`, this.toWorld({ x: 0, y: -1, z: -0.05 }), 4, 0.02);
    }
    this.drive('head', B, 3, 0.01);
  }

  // ─── 다리 ──────────────────────────────────────────────────────────────────

  poseLegs(ctrl, speedK, crouch) {
    if (ctrl <= 0) return;
    const kickingLeg = this.kick.t >= 0 ? this.kick.leg : null;
    for (const [side, off] of [['L', 0], ['R', Math.PI]]) {
      if (side === kickingLeg) continue;
      let thigh;
      let shin;
      if (!this.grounded && this.jumpT <= 0 && this.groundDist === null) {
        thigh = { x: sideX(side, 0.05), y: -0.8, z: 0.45 };
        shin = { x: 0, y: -1, z: -0.1 };
      } else if (crouch) {
        thigh = { x: sideX(side, 0.2), y: -0.55, z: 0.8 };
        shin = { x: 0, y: -1, z: -0.2 };
      } else {
        const a = Math.sin(this.phase + off) * 0.6 * speedK;
        const bend = Math.max(0, Math.cos(this.phase + off)) * 0.9 * speedK;
        thigh = { x: sideX(side, 0.04), y: -Math.cos(a), z: Math.sin(a) };
        shin = { x: 0, y: -Math.cos(a - bend), z: Math.sin(a - bend) };
      }
      this.aim(`thigh${side}`, this.toWorld(thigh), 14, 0.3 * ctrl);
      this.aim(`shin${side}`, this.toWorld(shin), 14, 0.3 * ctrl);
    }
  }

  // ─── 점프 ──────────────────────────────────────────────────────────────────

  onJump() {
    if (this.hands.L.mode === 'hold' || this.hands.R.mode === 'hold') {
      // 잡고 있으면 점프 대신 들어올리기 / 기어오르기
      this.lift = true;
      return;
    }
    if (!this.grounded || this.jumpCD > 0) return;
    const vy = 4.3 * Math.sqrt(this.mods.jump);
    for (const p of ['pelvis', 'torso', 'head', 'thighL', 'thighR']) {
      const v = this.bodies[p].linvel();
      this.bodies[p].setLinvel({ x: v.x, y: vy, z: v.z }, true);
    }
    this.jumpT = 0.3;
    this.jumpCD = 0.55;
    this.sim.emit({ type: 'jump', slot: this.slot });
  }

  // ─── 손: 주먹 / 뻗기 / 잡기 ────────────────────────────────────────────────

  onHandPress(side) {
    const h = this.hands[side];
    if (h.mode === 'hold') return;
    h.mode = 'punch';
    h.t = 0;
    h.dur = 0.32 / this.mods.punchSpeed;
    h.active = false;
    h.hitSet = new Set();
    h.impulseDone = false;
  }

  updateHand(side, dt, ctrl) {
    const h = this.hands[side];
    const bit = side === 'L' ? BTN.HAND_L : BTN.HAND_R;
    const held = this.held(bit) && !this.sim.inputLocked;
    const u = `uArm${side}`;
    const l = `lArm${side}`;
    if (this.grab && this.grab.armPoint && h.mode !== 'punch') {
      // 잡기 기술 중: 팔을 기술 목표(상대 목·허리)로 뻗는다
      const sh = this.bodies[u].translation();
      const dir = M.sub(this.grab.armPoint, sh);
      this.aim(u, dir, 18, 0.4);
      this.aim(l, dir, 18, 0.4);
      if (h.mode === 'hold' && !this.checkGrip(side)) {
        this.releaseHand(side);
        h.mode = 'idle';
      }
      return;
    }
    const walkSwing = Math.sin(this.phase + (side === 'L' ? Math.PI : 0)) * 0.45 * (this.grounded ? 1 : 0);

    if (h.mode === 'punch') {
      h.t += dt;
      const p = h.t / h.dur;
      if (p < 0.28) {
        this.aim(u, this.toWorld({ x: sideX(side, 0.35), y: -0.35, z: -0.55 }), 20, 0.45 * ctrl);
        this.aim(l, this.toWorld({ x: sideX(side, -0.1), y: 0.3, z: 0.9 }), 20, 0.45 * ctrl);
      } else {
        h.active = p < 0.95;
        const reach = this.toWorld({ x: sideX(side, 0.05), y: 0.12, z: 1 });
        this.aim(u, reach, 30, 0.7 * ctrl, 30);
        this.aim(l, reach, 30, 0.7 * ctrl, 30);
        if (!h.impulseDone && ctrl > 0.5) {
          h.impulseDone = true;
          const f = this.forward();
          const pw = 6.5 * this.mods.punchPower;
          this.addVel(l, { x: f.x * pw, y: 0.6, z: f.z * pw });
          this.addVel(u, { x: f.x * pw * 0.5, y: 0.3, z: f.z * pw * 0.5 });
          this.addVel('torso', { x: f.x * 0.9, y: 0, z: f.z * 0.9 });
          this.sim.emit({ type: 'swing', slot: this.slot, side });
        }
      }
      if (p >= 1) {
        h.active = false;
        h.mode = held ? 'reach' : 'idle';
      }
      return;
    }

    if (h.mode === 'reach' || h.mode === 'hold') {
      if (!held || ctrl <= 0) {
        this.releaseHand(side);
        h.mode = 'idle';
      } else if (h.mode === 'reach') {
        this.tryGrab(side);
      } else if (!this.checkGrip(side)) {
        this.releaseHand(side);
        h.mode = held ? 'reach' : 'idle';
      }
    }

    if (h.mode === 'reach' || h.mode === 'hold') {
      let dirU;
      let dirL;
      if (this.lift) {
        dirU = { x: sideX(side, 0.12), y: 1, z: 0.35 };
        dirL = { x: sideX(side, 0.05), y: 1, z: 0.25 };
      } else {
        dirU = { x: sideX(side, 0.12), y: 0.08, z: 1 };
        dirL = { x: sideX(side, -0.05), y: 0.12, z: 1 };
      }
      this.aim(u, this.toWorld(dirU), 16, 0.35 * ctrl);
      this.aim(l, this.toWorld(dirL), 16, 0.35 * ctrl);
      return;
    }

    // 평소 자세
    this.aim(u, this.toWorld({ x: sideX(side, 0.3), y: -Math.cos(walkSwing), z: Math.sin(walkSwing) }), 10, 0.18 * ctrl);
    this.aim(l, this.toWorld({ x: sideX(side, 0.12), y: -0.9, z: 0.35 + walkSwing * 0.5 }), 10, 0.18 * ctrl);
  }

  tryGrab(side) {
    const h = this.hands[side];
    const R = rapier();
    const world = this.sim.world;
    const hp = this.handPos(side);
    const shape = new R.Ball(0.18);
    let best = null;
    let bestD = Infinity;
    const found = [];
    world.intersectionsWithShape(hp, { x: 0, y: 0, z: 0, w: 1 }, shape, (col) => {
      found.push(col.handle);
      return true;
    }, undefined, undefined, undefined, undefined, (col) => !this.ownHandles.has(col.handle));
    for (const handle of found) {
      const info = this.sim.colliderInfo.get(handle);
      if (!info || info.type === 'kill' || info.noGrab) continue;
      if (info.type === 'fighter' && (info.fighter === this || info.fighter.grabImmuneT > 0 || info.fighter.out)) continue;
      const col = world.getCollider(handle);
      const body = col && col.parent();
      if (!body) continue;
      const d = M.dist(body.translation(), hp);
      if (d < bestD) {
        bestD = d;
        best = { col, body, info };
      }
    }
    if (!best) return;
    const other = best.body;
    const oq = other.rotation();
    const local2 = M.qRotate(M.qConj(oq), M.sub(hp, other.translation()));
    const off = this.layout[`lArm${side}`].hand.off;
    const jd = R.JointData.spherical({ x: off[0], y: off[1], z: off[2] }, local2);
    h.joint = world.createImpulseJoint(jd, this.bodies[`lArm${side}`], other, true);
    h.local2 = local2;
    h.body = other;
    h.target = best.info;
    h.mode = 'hold';
    h.gripT = 0;
    this.sim.emit({ type: 'grab', slot: this.slot, side, target: best.info.type === 'fighter' ? best.info.fighter.slot : -1 });
  }

  /** 손이 너무 벌어지면(잡은 게 멀어지면) 놓친다 */
  checkGrip(side) {
    const h = this.hands[side];
    if (!h.joint || !h.body || !this.sim.world.getRigidBody(h.body.handle)) return false;
    if (h.target.type === 'fighter' && h.target.fighter.out) return false;
    const anchor = M.add(h.body.translation(), M.qRotate(h.body.rotation(), h.local2));
    return M.dist(anchor, this.handPos(side)) < 0.5;
  }

  releaseHand(side) {
    const h = this.hands[side];
    if (h.joint) {
      try {
        this.sim.world.removeImpulseJoint(h.joint, true);
      } catch { /* 이미 사라진 관절 */ }
    }
    h.joint = null;
    h.body = null;
    h.target = null;
    h.local2 = null;
    if (!this.hands.L.joint && !this.hands.R.joint) this.lift = false;
  }

  releaseAll() {
    for (const side of ['L', 'R']) {
      this.releaseHand(side);
      this.hands[side].mode = 'idle';
      this.hands[side].active = false;
    }
    this.lift = false;
    if (this.grab) this.sim.grapple.cancel(this);
  }

  /** 지금 잡고 있는 상대 격투가 (없으면 null) */
  holdingFighter() {
    for (const side of ['L', 'R']) {
      const h = this.hands[side];
      if (h.mode === 'hold' && h.target && h.target.type === 'fighter') return h.target.fighter;
    }
    return null;
  }

  heldThing() {
    for (const side of ['L', 'R']) {
      const h = this.hands[side];
      if (h.mode === 'hold' && h.target) return h;
    }
    return null;
  }

  // ─── 들어올리기 / 던지기 / 기어오르기 ──────────────────────────────────────

  liftAssist() {
    const h = this.heldThing();
    if (!h) {
      this.lift = false;
      return;
    }
    const torso = this.bodies.torso.translation();
    const f = this.forward();
    if (h.target.type === 'fighter' || h.target.type === 'prop') {
      // 잡은 것을 머리 위로
      const goal = { x: torso.x + f.x * 0.3, y: torso.y + 1.35, z: torso.z + f.z * 0.3 };
      const bodies = h.target.type === 'fighter' ? ['pelvis', 'torso'].map((p) => h.target.fighter.bodies[p]) : [h.body];
      for (const b of bodies) {
        const p = b.translation();
        const v = b.linvel();
        const want = M.clampLen(M.scale(M.sub(goal, p), 5), 4.5);
        b.setLinvel({ x: v.x + (want.x - v.x) * 0.12, y: v.y + (want.y - v.y) * 0.12, z: v.z + (want.z - v.z) * 0.12 }, true);
      }
    } else {
      // 고정된 것을 잡고 있으면 몸을 끌어올린다
      const anchor = M.add(h.body.translation(), M.qRotate(h.body.rotation(), h.local2));
      const pel = this.bodies.pelvis.translation();
      const up = anchor.y + 0.1 - pel.y;
      const toward = M.norm({ x: anchor.x - pel.x, y: 0, z: anchor.z - pel.z });
      const vy = up > 0 ? Math.min(3.8, up * 6 + 1) : 0;
      const push = up < 0.35 ? 2.2 : 0.4;
      for (const p of ['pelvis', 'torso']) this.blendVel(p, { x: toward.x * push, y: vy, z: toward.z * push }, 0.25);
    }
  }

  throwHeld() {
    const target = this.holdingFighter();
    const f = this.forward();
    if (target) {
      // 머리 위로 높이 들어 올렸을수록 멀리 던진다
      const liftK = M.clamp((target.pos('pelvis').y - this.pos('pelvis').y) / 0.9, 0, 1);
      const hor = 2.5 + 3.6 * liftK;
      const up = 1.8 + 2.2 * liftK;
      for (const side of ['L', 'R']) this.releaseHand(side), (this.hands[side].mode = 'idle');
      target.forEachBody((b) => {
        const v = b.linvel();
        b.setLinvel({ x: v.x * 0.3 + f.x * hor, y: Math.max(v.y, up), z: v.z * 0.3 + f.z * hor }, true);
      });
      target.stunT = Math.max(target.stunT, 1.1);
      target.markHit(this);
      target.grabImmuneT = 0.6;
      this.sim.emit({ type: 'throw', slot: this.slot, target: target.slot });
    } else {
      const h = this.heldThing();
      if (h && h.target.type === 'prop') {
        const b = h.body;
        h.target.thrower = this;
        for (const side of ['L', 'R']) this.releaseHand(side), (this.hands[side].mode = 'idle');
        const v = b.linvel();
        b.setLinvel({ x: v.x * 0.3 + f.x * 9, y: Math.max(v.y, 3), z: v.z * 0.3 + f.z * 9 }, true);
        this.sim.emit({ type: 'throw', slot: this.slot, target: -1 });
      }
    }
    this.lift = false;
  }

  // ─── 발차기 / 박치기 ───────────────────────────────────────────────────────

  startKick() {
    this.kick.t = 0;
    this.kick.leg = this.kick.leg === 'R' ? 'L' : 'R';
    this.kick.hitSet = new Set();
    this.kick.impulseDone = false;
  }

  kickLean() {
    if (this.kick.t < 0) return 0;
    const p = this.kick.t / this.kick.dur;
    return p < 0.8 ? -0.22 : 0;
  }

  updateKick(dt, ctrl) {
    const k = this.kick;
    if (k.t < 0) return;
    k.t += dt;
    const p = k.t / k.dur;
    const side = k.leg;
    if (p < 0.25) {
      this.aim(`thigh${side}`, this.toWorld({ x: 0, y: -0.7, z: -0.6 }), 18, 0.4 * ctrl);
      this.aim(`shin${side}`, this.toWorld({ x: 0, y: -0.6, z: -0.8 }), 18, 0.4 * ctrl);
    } else {
      k.active = p < 0.85;
      const d = this.toWorld({ x: 0, y: 0.15, z: 1 });
      this.aim(`thigh${side}`, d, 28, 0.6 * ctrl, 28);
      this.aim(`shin${side}`, d, 28, 0.6 * ctrl, 28);
      if (!k.impulseDone && ctrl > 0.5) {
        k.impulseDone = true;
        const f = this.forward();
        const pw = 7 * this.mods.kickPower;
        this.addVel(`shin${side}`, { x: f.x * pw, y: 1.2, z: f.z * pw });
        this.sim.emit({ type: 'swing', slot: this.slot, side: 'kick' });
      }
    }
    if (p >= 1) {
      k.t = -1;
      k.active = false;
      k.cd = 0.18;
    }
  }

  startHeadbutt() {
    this.headbutt.t = 0;
    this.headbutt.hitSet = new Set();
    this.headbutt.impulseDone = false;
  }

  headbuttLean() {
    const hb = this.headbutt;
    if (hb.t < 0) return 0;
    const p = hb.t / hb.dur;
    if (p < 0.25) return -0.35;
    if (p < 0.8) return 0.95;
    return 0.3;
  }

  updateHeadbutt(dt, ctrl) {
    const hb = this.headbutt;
    if (hb.t < 0) return;
    hb.t += dt;
    const p = hb.t / hb.dur;
    hb.active = p >= 0.25 && p < 0.8;
    if (p >= 0.25 && !hb.impulseDone && ctrl > 0.5) {
      hb.impulseDone = true;
      const f = this.forward();
      this.addVel('head', { x: f.x * 5.5, y: -0.5, z: f.z * 5.5 });
      this.addVel('torso', { x: f.x * 2.2, y: 0, z: f.z * 2.2 });
      this.sim.emit({ type: 'swing', slot: this.slot, side: 'head' });
    }
    if (p >= 1) {
      hb.t = -1;
      hb.active = false;
      hb.cd = 0.25;
    }
  }

  /** 지금 타격 판정이 살아 있는 부위인지 */
  strikeActive(info) {
    if (!info.strike) return false;
    if (info.strike === 'hand') return this.hands[info.side].active;
    if (info.strike === 'foot') return this.kick.active && this.kick.leg === info.side;
    if (info.strike === 'head') return this.headbutt.active;
    return false;
  }

  // ─── 피해 / 기절 ───────────────────────────────────────────────────────────

  markHit(from) {
    if (from && from !== this) {
      this.lastHitBy = from;
      this.lastHitT = this.sim.time;
    }
  }

  damage(amount, from) {
    if (this.out || amount <= 0) return;
    this.markHit(from);
    this.lastDamageT = this.sim.time;
    if (this.koT > 0) {
      this.koT = Math.min(this.koT + amount * 0.01, 7);
      return;
    }
    this.hp -= amount;
    if (from && from !== this) from.stats.damageDealt += amount;
    this.stunT = Math.max(this.stunT, Math.min(0.7, 0.08 + amount * 0.02));
    if (this.hp <= 0) this.knockOut(3.4 + Math.min(2, -this.hp * 0.05), from);
  }

  knockOut(duration, from) {
    this.hp = 0;
    this.koT = duration / this.mods.recover;
    this.releaseAll();
    this.setAwakeGravity(false);
    if (from && from !== this) from.stats.kos += 1;
    this.sim.emit({ type: 'ko', slot: this.slot, by: from ? from.slot : -1 });
  }

  knockDown(duration) {
    this.downT = Math.max(this.downT, duration / this.mods.recover);
    this.releaseAll();
  }

  wakeUp() {
    this.koT = 0;
    this.hp = this.maxHp * 0.55;
    this.stunT = 0.6;
    this.setAwakeGravity(true);
    this.sim.emit({ type: 'wake', slot: this.slot });
  }

  eliminate() {
    if (this.out) return;
    this.out = true;
    this.outT = this.sim.time;
    this.releaseAll();
    this.setAwakeGravity(false);
    const credit = this.lastHitBy && this.sim.time - this.lastHitT < 12 ? this.lastHitBy : null;
    if (credit) credit.stats.eliminations += 1;
    this.sim.emit({ type: 'out', slot: this.slot, by: credit ? credit.slot : -1 });
  }

  /** 렌더러/네트워크용 상태 요약 */
  status() {
    let flags = 0;
    if (this.out) flags |= 1;
    if (this.koT > 0) flags |= 2;
    if (this.downT > 0) flags |= 4;
    if (this.stunT > 0) flags |= 8;
    if (this.sim.isHeld(this)) flags |= 16;
    if (this.hands.L.mode === 'hold' || this.hands.R.mode === 'hold') flags |= 32;
    if (this.lift) flags |= 64;
    const attacker = this.sim.grapple.attackerOf(this);
    return {
      flags,
      hp: Math.max(0, this.hp / this.maxHp),
      grab: this.grab ? this.grab.kind : null,
      grabProgress: this.grab ? this.grab.progress || 0 : 0,
      victimOf: attacker && attacker.grab ? attacker.grab.kind : null,
      victimProgress: attacker && attacker.grab ? attacker.grab.progress || 0 : 0,
      escape: this.escape,
    };
  }
}
