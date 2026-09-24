// MMA 잡기 기술. 잡기 버튼(F) 하나로 상황에 맞는 기술이 나간다.
//  - 달리다가 / 가까이서: 태클 → 성공하면 그대로 마운트
//  - 상대를 손으로 잡은 채 마주 보고: 수플렉스 (머리 위로 넘겨 꽂기)
//  - 상대 등 뒤에서 잡은 채: 리어 네이키드 초크 (서브미션)
//  - 넘어진 상대 위에서: 마운트 → 한 번 더 누르면 서브미션
// 당하는 쪽은 아무 버튼이나 연타해서 빠져나온다.
import * as M from './math.js';

const TACKLE_RANGE = 2.4;
const MOUNT_RANGE = 1.7;

export class Grapple {
  constructor(sim) {
    this.sim = sim;
    this.victims = new Map(); // 당하는 사람 → 거는 사람
    this.slams = []; // 수플렉스로 날아가는 중인 사람: 머리부터 떨어지면 피해
  }

  isVictim(f) {
    return this.victims.has(f);
  }

  attackerOf(f) {
    return this.victims.get(f) || null;
  }

  // ─── 버튼 ──────────────────────────────────────────────────────────────────

  press(f) {
    if (f.grab) {
      // 기절한 상대는 조를 수 없다 (마운트에서 때리거나 던지는 수밖에)
      if (f.grab.kind === 'mount' && f.grab.target.koT <= 0) this.start(f, 'submit', f.grab.target, { fromMount: true });
      return;
    }
    const target = this.findTarget(f);
    if (!target) return;
    const d = M.distXZ(f.pos('torso'), target.pos('torso'));
    const holding = f.holdingFighter();
    if (this.isDown(target) && d < MOUNT_RANGE && !this.isVictim(target)) {
      this.start(f, 'mount', target);
    } else if (holding === target) {
      const behind = this.isBehind(f, target);
      if (behind && target.koT > 0) return;
      this.start(f, behind ? 'submit' : 'suplex', target);
    } else if (d < TACKLE_RANGE && !this.isDown(target)) {
      this.start(f, 'tackle', target);
    }
  }

  isDown(t) {
    const up = M.qRotate(t.bodies.torso.rotation(), { x: 0, y: 1, z: 0 }).y;
    return t.koT > 0 || t.downT > 0 || up < 0.45;
  }

  /** f 가 t 의 등 뒤에 있는지 */
  isBehind(f, t) {
    const tf = t.forward();
    const rel = M.norm({ x: f.pos('torso').x - t.pos('torso').x, y: 0, z: f.pos('torso').z - t.pos('torso').z });
    return M.dot(tf, rel) < -0.3;
  }

  /** 앞쪽에 있는 가장 가까운 상대 */
  findTarget(f) {
    const fp = f.pos('torso');
    const fw = f.forward();
    let best = null;
    let bestScore = Infinity;
    for (const o of this.sim.fighters) {
      if (o === f || o.out) continue;
      const op = o.pos('torso');
      const d = M.distXZ(fp, op);
      if (d > TACKLE_RANGE + 0.3) continue;
      const dir = M.norm({ x: op.x - fp.x, y: 0, z: op.z - fp.z });
      const facing = M.dot(dir, fw);
      if (facing < -0.2 && d > 0.8) continue;
      const score = d - facing * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  start(f, kind, target, extra = {}) {
    const prev = f.grab;
    if (prev) this.victims.delete(prev.target);
    f.grab = { kind, target, t: 0, progress: 0, ...extra };
    if (kind !== 'tackle') this.victims.set(target, f);
    if (kind === 'suplex' || kind === 'mount') {
      target.releaseAll();
    }
    this.sim.emit({ type: 'grapple', kind, slot: f.slot, target: target.slot });
  }

  cancel(f) {
    if (f.grab) {
      if (this.victims.get(f.grab.target) === f) this.victims.delete(f.grab.target);
    }
    f.grab = null;
  }

  /** 당하던 사람이 풀려남 */
  freeVictim(v) {
    const a = this.victims.get(v);
    if (a) this.cancel(a);
    this.victims.delete(v);
  }

  // ─── 매 프레임 ─────────────────────────────────────────────────────────────

  update(dt) {
    for (const f of this.sim.fighters) {
      const g = f.grab;
      if (!g) continue;
      const t = g.target;
      if (!f.awake || f.downT > 0 || !t || t.out) {
        this.cancel(f);
        continue;
      }
      g.t += dt;
      if (g.kind === 'tackle') this.tickTackle(f, g, dt);
      else if (g.kind === 'mount') this.tickMount(f, g, dt);
      else if (g.kind === 'submit') this.tickSubmit(f, g, dt);
      else if (g.kind === 'suplex') this.tickSuplex(f, g, dt);
    }
    for (const [v, a] of this.victims) {
      if (a.grab && a.grab.target === v) continue;
      this.victims.delete(v);
    }
    const now = this.sim.time;
    this.slams = this.slams.filter((s) => {
      if (s.target.out || now > s.until) return false;
      const head = s.target.pos('head');
      if (now - s.start > 0.25 && (head.y < 0.6 || s.target.pos('torso').y < 0.55)) {
        s.target.damage(22, s.by);
        this.sim.emit({ type: 'hit', slot: s.target.slot, by: s.by.slot, kind: 'head', part: 'head', dmg: 22, pos: head });
        this.sim.emit({ type: 'slam', slot: s.target.slot, dmg: 22, pos: head });
        return false;
      }
      return true;
    });
  }

  tickTackle(f, g) {
    const t = g.target;
    const fp = f.pos('torso');
    const tp = t.pos('pelvis');
    const dir = M.norm({ x: tp.x - fp.x, y: 0, z: tp.z - fp.z });
    f.facing = Math.atan2(dir.x, dir.z);
    g.lean = 0.95;
    g.standH = 0.55;
    g.noMove = true;
    g.armPoint = tp;
    if (g.t < 0.4) {
      for (const p of ['pelvis', 'torso']) f.blendVel(p, M.scale(dir, 7.2), 0.35, 'xz');
    }
    if (M.dist(fp, tp) < 0.8 || M.dist(f.pos('head'), t.pos('torso')) < 0.55) {
      // 성공: 상대를 뒤로 넘어뜨리고 그대로 올라탄다
      t.knockDown(2.2);
      t.markHit(f);
      for (const p of ['torso', 'head']) t.addVel(p, { x: dir.x * 3.5, y: -1.5, z: dir.z * 3.5 });
      t.addVel('pelvis', { x: -dir.x * 1.5, y: 0.5, z: -dir.z * 1.5 });
      t.damage(6, f);
      this.sim.emit({ type: 'takedown', slot: t.slot, by: f.slot, pos: tp });
      this.start(f, 'mount', t);
      return;
    }
    if (g.t > 0.6) {
      // 헛방: 앞으로 고꾸라진다
      this.cancel(f);
      f.knockDown(0.8);
      this.sim.emit({ type: 'whiff', slot: f.slot });
    }
  }

  tickMount(f, g) {
    const t = g.target;
    t.downT = Math.max(t.downT, 0.25);
    const tt = t.pos('torso');
    const goal = { x: tt.x, y: tt.y + 0.5, z: tt.z };
    const fp = f.pos('pelvis');
    const want = M.clampLen(M.scale(M.sub(goal, fp), 7), 5);
    f.blendVel('pelvis', want, 0.35);
    f.blendVel('torso', { x: want.x, y: want.y + 0.5, z: want.z }, 0.2);
    t.blendVel('torso', { x: 0, y: -1.2, z: 0 }, 0.08, 'y');
    g.lean = 0.25;
    g.standH = 0.45;
    g.noMove = true;
    g.speedMul = 0;
    if (g.t > 9) this.cancel(f);
  }

  tickSubmit(f, g, dt) {
    const t = g.target;
    const fromMount = !!g.fromMount;
    t.downT = Math.max(t.downT, fromMount ? 0.25 : 0);
    t.stunT = Math.max(t.stunT, 0.2);
    const head = t.pos('head');
    g.armPoint = head;
    g.noMove = true;
    g.speedMul = 0;
    if (fromMount) {
      const tt = t.pos('torso');
      f.blendVel('pelvis', M.clampLen(M.scale(M.sub({ x: tt.x, y: tt.y + 0.5, z: tt.z }, f.pos('pelvis')), 7), 5), 0.35);
      g.lean = 0.6;
      g.standH = 0.45;
    } else {
      // 등 뒤에서 목을 감싼다: 서로 붙어 있게
      const back = M.sub(head, M.scale(t.forward(), 0.35));
      f.blendVel('torso', M.clampLen(M.scale(M.sub({ x: back.x, y: head.y - 0.2, z: back.z }, f.pos('torso')), 6), 4), 0.25);
      g.lean = 0.2;
    }
    const squeezing = f.held(32);
    g.progress += squeezing ? dt * 0.36 * f.mods.submit : -dt * 0.15;
    // 당하는 쪽 연타
    const presses = ['jump', 'handL', 'handR', 'kick', 'head', 'grapple'].filter((k) => t.pressed[k]).length;
    g.progress -= presses * 0.05;
    g.progress = Math.max(0, g.progress);
    if (g.progress >= 1) {
      this.cancel(f);
      t.knockOut(6.5, f);
      f.stats.submissions = (f.stats.submissions || 0) + 1;
      this.sim.emit({ type: 'submitWin', slot: t.slot, by: f.slot });
    } else if (g.t > 1 && g.progress <= 0) {
      this.cancel(f);
      t.grabImmuneT = 1;
      this.sim.emit({ type: 'escape', slot: t.slot });
    }
  }

  tickSuplex(f, g) {
    const t = g.target;
    const fw = f.forward();
    g.noMove = true;
    if (g.t < 0.28) {
      // 허리를 낮추고 상대를 끌어안아 들어 올린다
      g.lean = -0.2;
      g.standH = 0.62;
      for (const p of ['pelvis', 'torso']) t.blendVel(p, { x: 0, y: 3.2, z: 0 }, 0.25, 'y');
      t.stunT = Math.max(t.stunT, 0.4);
    } else if (g.t < 0.62) {
      // 뒤로 젖히며 머리 위로 넘긴다
      g.lean = -1.5;
      g.standH = 0.7;
      if (!g.thrown) {
        g.thrown = true;
        f.releaseHand('L');
        f.releaseHand('R');
        f.hands.L.mode = 'idle';
        f.hands.R.mode = 'idle';
        // 다리는 크게, 머리는 작게 띄워서 뒤로 한 바퀴 돌며 등 뒤에 꽂힌다
        t.forEachBody((b, name) => {
          const v = b.linvel();
          const legs = name === 'pelvis' || name.startsWith('thigh') || name.startsWith('shin');
          const back = legs ? 2.6 : 1.4;
          b.setLinvel({ x: v.x * 0.2 - fw.x * back, y: legs ? 5.2 : 2.2, z: v.z * 0.2 - fw.z * back }, true);
        });
        t.knockDown(1.9);
        t.markHit(f);
        this.slams.push({ target: t, by: f, start: this.sim.time, until: this.sim.time + 2 });
        this.sim.emit({ type: 'suplex', slot: t.slot, by: f.slot, pos: t.pos('torso') });
      }
    } else {
      if (g.t > 1.0) {
        this.cancel(f);
        f.knockDown(0.5);
      }
    }
  }
}
