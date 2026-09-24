// 봇: 사람과 똑같은 입력(이동·버튼)을 만들어 낸다.
// 가장 가까운 상대에게 다가가 때리거나 잡아서 가장자리로 끌고 가 던진다. 스스로 떨어지지 않게 발밑을 살핀다.
import { BTN } from './fighter.js';
import * as M from './math.js';

const LEVELS = {
  1: { react: 0.45, aggro: 0.55, grab: 0.25, grapple: 0.05, aim: 0.6 },
  2: { react: 0.25, aggro: 0.8, grab: 0.4, grapple: 0.15, aim: 0.8 },
  3: { react: 0.12, aggro: 1, grab: 0.5, grapple: 0.25, aim: 0.95 },
};

export class Bot {
  constructor(sim, fighter, level = 2, seed = 1) {
    this.sim = sim;
    this.f = fighter;
    this.lv = LEVELS[level] || LEVELS[2];
    this.rand = M.rng(seed * 7919 + 13);
    this.taps = { jump: 0, handL: 0, handR: 0, kick: 0, head: 0, grapple: 0 };
    this.target = null;
    this.retargetT = 0;
    this.mode = 'approach';
    this.modeT = 0;
    this.thinkT = 0;
    this.nextHand = 'handL';
    this.attackT = 0;
    this.btn = 0;
    this.move = { x: 0, z: 0 };
    this.center = { x: sim.map.def.camera.target[0], y: 0, z: sim.map.def.camera.target[2] };
  }

  tap(k) {
    this.taps = { ...this.taps, [k]: this.taps[k] + 1 };
  }

  /** 발밑 앞쪽에 땅이 있는지 (가장자리 감지) */
  groundAhead(from, dir, dist) {
    const p = { x: from.x + dir.x * dist, y: from.y + 0.2, z: from.z + dir.z * dist };
    return this.sim.castDown(p, this.f, 3.5) !== null;
  }

  pickTarget() {
    const fp = this.f.pos();
    let best = null;
    let bestD = Infinity;
    for (const o of this.sim.fighters) {
      if (o === this.f || o.out) continue;
      // 가깝고, 많이 맞았고(%), 쓰러진 상대를 노린다
      const d = M.distXZ(fp, o.pos()) + (o.koT > 0 ? -1 : 0) - Math.min(1.5, o.pct / 100) + this.rand() * 0.8;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    this.target = best;
  }

  update(dt) {
    const f = this.f;
    this.modeT += dt;
    this.thinkT -= dt;
    this.retargetT -= dt;
    if (this.sim.inputLocked || f.out) return this.output(0, 0, 0);

    // 잡혔거나 조르기 당하면 마구 누른다
    if (f.awake && this.sim.isHeld(f)) {
      if (this.rand() < 0.35 * this.lv.aggro + 0.1) this.tap(['jump', 'kick', 'handL', 'handR'][Math.floor(this.rand() * 4)]);
      const away = this.sim.holdersOf(f)[0];
      const dir = away ? M.norm({ x: f.pos().x - away.pos().x, y: 0, z: f.pos().z - away.pos().z }) : { x: 0, z: 0 };
      return this.output(dir.x, dir.z, 0);
    }
    if (!f.controllable) return this.output(0, 0, 0);

    if (this.retargetT <= 0 || !this.target || this.target.out) {
      this.pickTarget();
      this.retargetT = 1.2 + this.rand() * 1.5;
    }
    const t = this.target;
    if (!t) return this.output(0, 0, 0);

    const fp = f.pos();
    const tp = t.pos();
    const toT = { x: tp.x - fp.x, y: 0, z: tp.z - fp.z };
    const dist = M.lenXZ(toT);
    const dirT = M.norm(toT);
    const holding = f.holdingFighter();
    let btn = 0;
    let mv = { x: 0, z: 0 };

    // 마운트·서브미션 중
    if (f.grab) {
      if (f.grab.kind === 'mount') {
        if (f.grab.t > 0.5 && this.rand() < 0.02 * (1 + this.lv.grapple * 4)) this.tap('grapple');
        else if (this.rand() < 0.12) this.tap(this.rand() < 0.5 ? 'handL' : 'handR');
      }
      if (f.grab.kind === 'submit') btn |= BTN.GRAPPLE;
      return this.output(0, 0, btn);
    }

    if (holding) {
      // 가장자리 쪽으로 끌고 가서 던진다
      btn |= BTN.HAND_L | BTN.HAND_R;
      const out = M.norm({ x: tp.x - this.center.x, y: 0, z: tp.z - this.center.z });
      const edge = !this.groundAhead(tp, out, 1.6);
      if (this.mode !== 'drag') {
        this.mode = 'drag';
        this.modeT = 0;
        this.suplexRoll = this.rand();
      }
      if (this.suplexRoll < this.lv.grapple && this.modeT > 0.4 && this.modeT < 0.45) this.tap('grapple');
      if (edge || this.modeT > 3.5) {
        btn |= BTN.JUMP; // 들어 올리기
        if (this.modeT > 4.4 || (edge && f.lift && t.pos('pelvis').y > fp.y + 0.6)) {
          btn &= ~(BTN.JUMP | BTN.HAND_L | BTN.HAND_R); // 놓으면서 던지기
          this.mode = 'approach';
          this.modeT = 0;
        }
      } else {
        // 상대를 가장자리 쪽으로: 내가 상대의 안쪽에 서서 바깥으로 민다
        mv = { x: out.x * 0.9, z: out.z * 0.9 };
      }
      return this.output(mv.x, mv.z, btn);
    }

    if (this.mode === 'drag') this.mode = 'approach';

    // 날아가서 몸이 풀린 상대는 끌고 가서 떨어뜨린다. 넘어졌을 뿐이면 올라타거나 걷어찬다.
    if (t.koT > 0 && dist < 1.6 && this.mode !== 'grab') {
      this.mode = 'grab';
      this.modeT = 0;
    } else if (t.downT > 0 && dist < 1.4 && this.thinkT <= 0) {
      this.thinkT = this.lv.react + 0.3;
      if (this.rand() < this.lv.grapple * 1.5) this.tap('grapple');
      else if (this.rand() < 0.6) this.tap('kick');
      else this.mode = 'grab';
    }

    if (this.mode === 'approach') {
      mv = { x: dirT.x, z: dirT.z };
      if (dist > 3) btn |= BTN.SPRINT;
      if (dist < 1.25 && this.thinkT <= 0) {
        this.thinkT = this.lv.react;
        const r = this.rand();
        if (r < this.lv.grab) this.mode = 'grab';
        else if (r < this.lv.grab + this.lv.grapple && dist > 0.9) this.tap('grapple');
        else this.mode = 'punch';
        this.modeT = 0;
      }
    }
    if (this.mode === 'punch') {
      mv = { x: dirT.x * (dist > 0.9 ? 0.6 : 0.1), z: dirT.z * (dist > 0.9 ? 0.6 : 0.1) };
      this.attackT -= dt;
      if (this.attackT <= 0) {
        this.attackT = 0.22 + this.rand() * 0.25 + (1 - this.lv.aggro) * 0.3;
        const r = this.rand();
        if (r < 0.12) this.tap('kick');
        else if (r < 0.2) this.tap('head');
        else {
          this.tap(this.nextHand);
          this.nextHand = this.nextHand === 'handL' ? 'handR' : 'handL';
        }
      }
      if (this.modeT > 1.6 + this.rand() || dist > 2.2) {
        this.mode = 'approach';
        this.modeT = 0;
      }
    }
    if (this.mode === 'grab') {
      mv = { x: dirT.x, z: dirT.z };
      btn |= BTN.HAND_L | BTN.HAND_R;
      if (this.modeT > 2 || dist > 2.5) {
        this.mode = 'approach';
        this.modeT = 0;
      }
    }

    // 조준이 서툰 봇은 살짝 빗나간다
    const wobble = (1 - this.lv.aim) * Math.sin(this.sim.time * 2.3 + this.f.slot);
    mv = { x: mv.x + wobble * mv.z, z: mv.z - wobble * mv.x };

    // 발밑 확인: 가려는 방향에 땅이 없으면 가운데로
    const ml = Math.hypot(mv.x, mv.z);
    if (ml > 0.1) {
      const d = { x: mv.x / ml, y: 0, z: mv.z / ml };
      if (!this.groundAhead(fp, d, 0.9)) {
        const c = M.norm({ x: this.center.x - fp.x, y: 0, z: this.center.z - fp.z });
        mv = { x: c.x, z: c.z };
        btn &= ~BTN.SPRINT;
      }
    }
    return this.output(mv.x, mv.z, btn);
  }

  output(mx, mz, btn) {
    return { mx, mz, btn, taps: this.taps };
  }
}
