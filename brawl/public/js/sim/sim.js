// 경기 시뮬레이션: 물리 세계, 맵, 격투가, 타격 판정, 탈락, 라운드 규칙.
// 방장(호스트)의 브라우저에서 돌고, 다른 사람들은 이 결과를 받아서 그리기만 한다.
import { loadRapier, rapier } from './rapier.js';
import { Fighter, DT, PART_NAMES } from './fighter.js';
import { buildMap } from './maps.js';
import { Grapple } from './grapple.js';
import { Bot } from './bot.js';
import { modsOf } from './roster.js';
import * as M from './math.js';

export const ROUND_COUNTDOWN = 3;
export const ROUND_END_TIME = 4.5;
export const SUDDEN_DEATH_AT = 75;

export class Sim {
  static async create(opts) {
    await loadRapier();
    return new Sim(opts);
  }

  /**
   * @param {object} opts
   *   mapId, winsNeeded, seed,
   *   players: [{ slot, charId, name, isBot, botLevel }]
   */
  constructor(opts) {
    this.opts = { winsNeeded: 3, seed: 1, ...opts };
    this.players = this.opts.players.slice().sort((a, b) => a.slot - b.slot);
    this.scores = Object.fromEntries(this.players.map((p) => [p.slot, 0]));
    this.round = 0;
    this.events = [];
    this.inputs = {};
    this.world = null;
    this.matchWinner = null;
    this.rand = M.rng(this.opts.seed);
    this.startRound();
  }

  get sandbox() {
    return this.players.length < 2;
  }

  // ─── 라운드 ────────────────────────────────────────────────────────────────

  startRound() {
    const R = rapier();
    if (this.world) {
      this.world.free();
      this.eventQueue.free();
    }
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    this.world.numSolverIterations = 6;
    this.eventQueue = new R.EventQueue(true);
    this.colliderInfo = new Map();
    this.bodyInfo = new Map();
    this.heldBy = new Map();
    this.preVel = new Map();
    this.time = 0;
    this.roundTime = 0;
    this.tick = 0;
    this.suddenDeath = false;
    this.round += 1;
    this.map = buildMap(this.opts.mapId, this, this.round * 7919 + this.opts.seed);
    this.grapple = new Grapple(this);
    this.fighters = [];
    this.bots = new Map();
    const spawns = this.map.spawns;
    const order = this.players.map((p, i) => i);
    // 라운드마다 출발 위치를 돌린다
    const shift = (this.round - 1) % spawns.length;
    this.players.forEach((p, i) => {
      const s = spawns[(order[i] + shift) % spawns.length];
      const f = new Fighter(this, {
        slot: p.slot,
        charId: p.charId,
        name: p.name,
        isBot: p.isBot,
        mods: modsOf(p.charId),
        spawn: { x: s[0], y: s[1] + 0.02, z: s[2], yaw: s[3] },
      });
      this.fighters.push(f);
      if (p.isBot || p.botTakeover) this.bots.set(p.slot, new Bot(this, f, p.botLevel || 2, this.round * 31 + p.slot));
    });
    this.phase = 'countdown';
    this.phaseT = ROUND_COUNTDOWN;
    this.inputLocked = true;
    this.emit({ type: 'roundStart', round: this.round, map: this.map.id, scores: { ...this.scores } });
  }

  fighter(slot) {
    return this.fighters.find((f) => f.slot === slot) || null;
  }

  registerCollider(col, info) {
    this.colliderInfo.set(col.handle, info);
  }

  registerBody(body, info) {
    this.bodyInfo.set(body.handle, info);
  }

  emit(ev) {
    this.events.push({ ...ev, t: this.time });
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  setInput(slot, input) {
    this.inputs[slot] = input;
  }

  // ─── 질의 ──────────────────────────────────────────────────────────────────

  /** p 에서 아래로 광선을 쏴서 땅까지 거리 (자기 몸 제외). 없으면 null */
  castDown(p, fighter, maxDist) {
    const R = rapier();
    const ray = new R.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true, undefined, undefined, undefined, undefined, (col) => {
      if (fighter.ownHandles.has(col.handle)) return false;
      const info = this.colliderInfo.get(col.handle);
      return !(info && info.type === 'kill');
    });
    return hit ? hit.timeOfImpact : null;
  }

  isHeld(f) {
    const holders = this.heldBy.get(f);
    return !!(holders && holders.length) || this.grapple.isVictim(f);
  }

  isLifted(f) {
    return (this.heldBy.get(f) || []).some((h) => h.lift);
  }

  holdersOf(f) {
    const list = [...(this.heldBy.get(f) || [])];
    const a = this.grapple.attackerOf(f);
    if (a && !list.includes(a)) list.push(a);
    return list;
  }

  /** f 를 잡고 있는 모든 손을 놓게 한다 (탈출) */
  breakGrabsOn(f) {
    for (const other of this.fighters) {
      if (other === f) continue;
      for (const side of ['L', 'R']) {
        const h = other.hands[side];
        if (h.mode === 'hold' && h.target && h.target.type === 'fighter' && h.target.fighter === f) {
          other.releaseHand(side);
          h.mode = 'idle';
        }
      }
      if (other.grab && other.grab.target === f) this.grapple.cancel(other);
    }
    this.grapple.freeVictim(f);
  }

  // ─── 한 프레임 ─────────────────────────────────────────────────────────────

  step() {
    const dt = DT;
    this.time += dt;
    this.tick += 1;
    if (this.phase === 'fight') this.roundTime += dt;

    // 누가 누구를 잡고 있는지
    this.heldBy = new Map();
    for (const f of this.fighters) {
      for (const side of ['L', 'R']) {
        const h = f.hands[side];
        if (h.mode === 'hold' && h.target && h.target.type === 'fighter') {
          const list = this.heldBy.get(h.target.fighter) || [];
          list.push(f);
          this.heldBy.set(h.target.fighter, list);
        }
      }
    }

    for (const [slot, bot] of this.bots) {
      const f = this.fighter(slot);
      if (f && !f.out) this.inputs[slot] = bot.update(dt);
    }
    for (const f of this.fighters) f.setInput(this.inputs[f.slot]);

    this.map.update(dt);
    for (const f of this.fighters) f.preStep(dt, this.time);
    this.grapple.update(dt);
    this.escapeChecks();

    // 충돌 판정용으로 이번 프레임 직전 속도를 기억
    this.preVel.clear();
    for (const f of this.fighters) {
      if (f.out) continue;
      for (const name of PART_NAMES) {
        const b = f.bodies[name];
        this.preVel.set(b.handle, b.linvel());
      }
    }
    for (const o of this.map.objects) if (o.body && o.dynamic) this.preVel.set(o.body.handle, o.body.linvel());

    this.world.step(this.eventQueue);

    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (started) this.onContact(h1, h2);
    });
    this.strikeChecks();
    this.killChecks();
    this.updateRules(dt);
  }

  // ─── 타격 ──────────────────────────────────────────────────────────────────

  vel(body) {
    return this.preVel.get(body.handle) || body.linvel();
  }

  /** 공격 판정이 살아 있는 손·발·머리가 상대에게 닿았는지 매 프레임 확인 */
  strikeChecks() {
    const R = rapier();
    for (const f of this.fighters) {
      if (!f.awake) continue;
      const strikes = [];
      for (const side of ['L', 'R']) {
        const h = f.hands[side];
        if (h.active) strikes.push({ col: f.colliders[`hand${side}`], part: `lArm${side}`, kind: 'hand', state: h, pos: f.handPos(side), r: 0.16 });
      }
      if (f.kick.active) strikes.push({ col: f.colliders[`foot${f.kick.leg}`], part: `shin${f.kick.leg}`, kind: 'foot', state: f.kick, pos: f.footPos(f.kick.leg), r: 0.17 });
      if (f.headbutt.active) strikes.push({ col: f.colliders.head, part: 'head', kind: 'head', state: f.headbutt, pos: f.bodies.head.translation(), r: 0.3 });
      for (const s of strikes) {
        if (!s.state.hitSet) s.state.hitSet = new Set();
        // 질의 콜백 안에서는 물체를 건드리면 안 된다 (WASM 쪽에서 막힘) → 모아 뒀다가 처리
        const found = [];
        const shape = new R.Ball(s.r);
        this.world.intersectionsWithShape(s.pos, { x: 0, y: 0, z: 0, w: 1 }, shape, (col) => {
          found.push(col.handle);
          return true;
        }, undefined, undefined, undefined, undefined, (col) => !f.ownHandles.has(col.handle));
        for (const handle of found) {
          const info = this.colliderInfo.get(handle);
          if (!info || info.type !== 'fighter' || info.fighter === f || info.fighter.out) continue;
          if (s.state.hitSet.has(info.fighter)) continue;
          s.state.hitSet.add(info.fighter);
          this.applyStrike(f, s, info, s.pos);
        }
      }
    }
  }

  applyStrike(att, s, vicInfo, pos) {
    const vic = vicInfo.fighter;
    const va = this.vel(att.bodies[s.part]);
    const vv = this.vel(vic.bodies[vicInfo.part]);
    const rel = M.len(M.sub(va, vv));
    const m = att.mods;
    const base = s.kind === 'hand' ? 1.0 * m.punchPower : s.kind === 'foot' ? 1.25 * m.kickPower : 1.3 * m.headPower;
    const partMul = vicInfo.part === 'head' ? 1.3 : vicInfo.part === 'torso' || vicInfo.part === 'pelvis' ? 1 : 0.6;
    const ground = att.grab && att.grab.kind === 'mount' ? 1.5 : 1;
    const dmg = M.clamp((rel - 1.5) * 1.6, 2, 16) * base * partMul * ground;
    vic.damage(dmg, att);
    // 넉백: 맞은 사람의 % 가 높을수록 멀리
    const at = att.bodies.torso.translation();
    const vt = vic.bodies.torso.translation();
    const f = att.forward();
    const away = M.lenXZ(M.sub(vt, at)) > 0.05 ? M.norm({ x: vt.x - at.x, y: 0, z: vt.z - at.z }) : f;
    const dir = M.norm({ x: away.x + f.x, y: 0, z: away.z + f.z });
    const kbBase = (1.1 + dmg * 0.075) * (s.kind === 'foot' ? 1.3 : 1);
    const kb = vic.launch(dir, kbBase, vicInfo.part);
    att.stats.maxLaunch = Math.max(att.stats.maxLaunch, kb);
    this.emit({ type: 'hit', slot: vic.slot, by: att.slot, kind: s.kind, part: vicInfo.part, dmg: Math.round(dmg), kb: Math.round(kb * 10) / 10, pos: { x: pos.x, y: pos.y, z: pos.z } });
  }

  onContact(h1, h2) {
    const a = this.colliderInfo.get(h1);
    const b = this.colliderInfo.get(h2);
    if (!a || !b) return;
    if (a.type === 'fighter' && b.type === 'fighter') {
      if (a.fighter === b.fighter) return;
      // 날아온 몸끼리 세게 부딪힘
      const rel = M.len(M.sub(this.vel(a.fighter.bodies[a.part]), this.vel(b.fighter.bodies[b.part])));
      if (rel > 8.5 && this.impactReady(a.fighter) && this.impactReady(b.fighter)) {
        const dmg = Math.min(8, (rel - 8.5) * 1.5);
        a.fighter.damage(dmg, b.fighter.lastHitBy || b.fighter);
        b.fighter.damage(dmg, a.fighter.lastHitBy || a.fighter);
        const p = a.fighter.bodies[a.part].translation();
        this.emit({ type: 'hit', slot: a.fighter.slot, by: b.fighter.slot, kind: 'body', part: a.part, dmg: Math.round(dmg), pos: p });
      }
      return;
    }
    const fi = a.type === 'fighter' ? a : b.type === 'fighter' ? b : null;
    const other = fi === a ? b : a;
    if (!fi || fi.fighter.out) return;
    const fb = fi.fighter.bodies[fi.part];
    if (other.type === 'prop') {
      const pv = this.vel(other.body);
      const rel = M.len(M.sub(pv, this.vel(fb)));
      if (rel > 5.5 && M.len(pv) > 4) {
        const dmg = (rel - 5.5) * 3 * (fi.part === 'head' ? 1.6 : 1) * (other.hitMul || 1);
        fi.fighter.damage(dmg, other.thrower || null);
        fi.fighter.launch(M.norm({ x: pv.x, y: 0, z: pv.z }), 1 + dmg * 0.07, fi.part);
        this.emit({ type: 'hit', slot: fi.fighter.slot, by: other.thrower ? other.thrower.slot : -1, kind: 'prop', part: fi.part, dmg: Math.round(dmg), pos: fb.translation() });
      }
      return;
    }
    if (other.type === 'env') {
      // 바닥·벽에 처박힘: 소리와 먼지는 나지만 % 는 아주 세게 부딪혔을 때만 조금
      const speed = M.len(this.vel(fb));
      if (speed > 8 && this.impactReady(fi.fighter)) {
        const dmg = speed > 11 ? Math.min(6, (speed - 11) * 1.5) : 0;
        if (dmg > 0) fi.fighter.damage(dmg, fi.fighter.lastHitBy);
        this.emit({ type: 'slam', slot: fi.fighter.slot, dmg: Math.round(dmg), speed: Math.round(speed), pos: fb.translation() });
      }
    }
  }

  /** 한 번 부딪히면 몸의 여러 부위가 연달아 닿으니, 사람마다 0.5초에 한 번만 센다 */
  impactReady(f) {
    if (this.time - (f.lastImpactT ?? -9) < 0.5) return false;
    f.lastImpactT = this.time;
    return true;
  }

  // ─── 탈출 / 탈락 ───────────────────────────────────────────────────────────

  escapeChecks() {
    for (const f of this.fighters) {
      if (!f.awake || !this.isHeld(f)) continue;
      const attacker = this.grapple.attackerOf(f);
      if (attacker && attacker.grab && attacker.grab.kind === 'submit') continue; // 서브미션은 게이지로 따로 탈출
      const grip = Math.max(1, ...this.holdersOf(f).map((h) => h.mods.grip));
      // % 가 높을수록 버둥거려도 잘 안 빠져나간다
      const need = (attacker ? 10 : 7) * grip * (0.6 + f.pct / 150);
      if (f.escape >= need) {
        f.escape = 0;
        this.breakGrabsOn(f);
        f.grabImmuneT = 0.9;
        const up = f.bodies.torso.translation();
        for (const h of this.holdersOf(f)) {
          const hp = h.bodies.torso.translation();
          const away = M.norm({ x: hp.x - up.x, y: 0.3, z: hp.z - up.z });
          h.addVel('torso', M.scale(away, 3));
          h.stunT = Math.max(h.stunT, 0.4);
        }
        this.emit({ type: 'escape', slot: f.slot });
      }
    }
  }

  killChecks() {
    for (const f of this.fighters) {
      if (f.out) {
        if (!f.disabled && this.time - f.outT > 3) {
          f.disabled = true;
          f.forEachBody((b) => b.setEnabled(false));
        }
        continue;
      }
      const p = f.bodies.pelvis.translation();
      const h = f.bodies.head.translation();
      if (p.y < this.map.killY || h.y < this.map.killY - 1 || this.map.inKillZone(p) || Math.abs(p.x) > 60 || Math.abs(p.z) > 60) {
        f.eliminate();
      }
    }
  }

  // ─── 규칙 ──────────────────────────────────────────────────────────────────

  alive() {
    return this.fighters.filter((f) => !f.out);
  }

  updateRules(dt) {
    if (this.phase === 'countdown') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'fight';
        this.inputLocked = false;
        this.emit({ type: 'fight' });
      }
      return;
    }
    if (this.phase === 'fight') {
      if (!this.suddenDeath && this.roundTime >= SUDDEN_DEATH_AT) {
        this.suddenDeath = true;
        this.map.suddenDeath();
        this.emit({ type: 'suddenDeath' });
      }
      if (this.sandbox) {
        const f = this.fighters[0];
        if (f && f.out && this.time - f.outT > 2) this.respawn(f);
        return;
      }
      const alive = this.alive();
      if (alive.length <= 1) {
        const winner = alive.length === 1 ? alive[0].slot : -1;
        if (winner >= 0) this.scores[winner] += 1;
        this.phase = 'roundEnd';
        this.phaseT = ROUND_END_TIME;
        this.roundWinner = winner;
        const champ = winner >= 0 && this.scores[winner] >= this.opts.winsNeeded ? winner : null;
        this.emit({ type: 'roundEnd', winner, scores: { ...this.scores }, matchWinner: champ });
        if (champ !== null) this.matchWinner = champ;
      }
      return;
    }
    if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.matchWinner !== null) {
          this.phase = 'matchEnd';
          this.emit({ type: 'matchEnd', winner: this.matchWinner, scores: { ...this.scores }, stats: this.statsSummary() });
        } else {
          this.startRound();
        }
      }
    }
  }

  /** 연결이 끊긴 사람의 캐릭터를 봇이 대신 움직이게 (on=false 면 돌려줌) */
  setBotControl(slot, on) {
    const f = this.fighter(slot);
    if (on && f && !this.bots.has(slot)) this.bots.set(slot, new Bot(this, f, 2, this.round * 31 + slot));
    if (!on && this.bots.has(slot) && !this.players.find((p) => p.slot === slot)?.isBot) this.bots.delete(slot);
    const p = this.players.find((x) => x.slot === slot);
    if (p) p.botTakeover = on;
  }

  respawn(f) {
    const s = this.map.spawns[0];
    const slot = f.slot;
    const opt = { slot, charId: f.charId, name: f.name, isBot: f.isBot, mods: f.mods, spawn: { x: s[0], y: s[1] + 0.3, z: s[2], yaw: s[3] } };
    f.destroy();
    const nf = new Fighter(this, opt);
    this.fighters[this.fighters.indexOf(f)] = nf;
    this.emit({ type: 'respawn', slot });
  }

  statsSummary() {
    return this.fighters.map((f) => ({ slot: f.slot, ...f.stats, damageDealt: Math.round(f.stats.damageDealt) }));
  }

  // ─── 그리기/네트워크용 상태 ────────────────────────────────────────────────

  /** 모든 움직이는 물체의 위치·회전을 한 배열에 담는다: 격투가(슬롯 순서 × 11부위) 다음 맵 물체 */
  writeTransforms(out) {
    let i = 0;
    for (const f of this.fighters) {
      for (const name of PART_NAMES) {
        const b = f.bodies[name];
        const p = b.translation();
        const q = b.rotation();
        out[i++] = p.x; out[i++] = p.y; out[i++] = p.z;
        out[i++] = q.x; out[i++] = q.y; out[i++] = q.z; out[i++] = q.w;
      }
    }
    for (const o of this.map.objects) {
      const p = o.body.translation();
      const q = o.body.rotation();
      out[i++] = p.x; out[i++] = p.y; out[i++] = p.z;
      out[i++] = q.x; out[i++] = q.y; out[i++] = q.z; out[i++] = q.w;
    }
    return i;
  }

  transformCount() {
    return (this.fighters.length * PART_NAMES.length + this.map.objects.length) * 7;
  }

  statusList() {
    return this.fighters.map((f) => ({ slot: f.slot, ...f.status() }));
  }

  destroy() {
    if (this.world) {
      this.world.free();
      this.eventQueue.free();
      this.world = null;
    }
  }
}
