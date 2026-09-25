// 게임 진행: 좀비, 감독(좀비를 어디서 얼마나 보낼지), 문·열쇠·아이템, 쓰러짐·일으키기, 전멸 → 처음부터.
// 방장 브라우저의 워커에서 30Hz 로 돈다. 각자 자기 캐릭터 움직임은 자기 화면이 정하고(반응 빠르게),
// 좀비·체력·문 같은 공유 상태는 여기서만 정한다.
import { buildMap, OBJECTIVES, UNDERGROUND_Z } from './map.js';
import { ColliderSet, F, circleVsBox } from './geom.js';
import { NavGrid, INF } from './nav.js';
import { rng } from './mapkit.js';
import { WEAPONS, SHOVE, REVIVE_TIME } from './weapons.js';
import { encodeSnapshot, PF } from './protocol.js';

export const DT = 1 / 30;
export const ZS = { IDLE: 0, WANDER: 1, CHASE: 2, ATTACK: 3, DEAD: 4 };
export const PS = { OK: 0, DOWN: 1, DEAD: 2 };
export const DIFFICULTY = {
  easy: { label: '쉬움', dmg: 3, count: 0.7, mob: [150, 210], bleed: 45, hp: 0.8 },
  normal: { label: '보통', dmg: 5, count: 1, mob: [100, 150], bleed: 30, hp: 1 },
  hard: { label: '어려움', dmg: 8, count: 1.3, mob: [70, 110], bleed: 20, hp: 1.25 },
};
export const FINALE_TIME = 180;
const ZR = 0.33;
const PR = 0.35;
const MAX_ZOMBIES = 85;
const OBJ_INDEX = Object.fromEntries(OBJECTIVES.map((o, i) => [o.id, i]));
const regionOf = (z) => (z > UNDERGROUND_Z ? 1 : 0);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export class Sim {
  /** players: [{ name, connected }], 방장이 0번 */
  constructor({ players, difficulty = 'normal', seed = 1, peace = false }) {
    this.peace = peace; // 개발용: 좀비 없음
    this.map = buildMap();
    this.nav = new NavGrid(this.map);
    this.cols = new ColliderSet(this.map.colliders);
    this.doorDef = new Map(this.map.doors.map((d) => [d.id, d]));
    this.interDef = new Map(this.map.interacts.map((d) => [d.id, d]));
    this.trigDef = new Map(this.map.triggers.map((t) => [t.id, t]));
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.diff = DIFFICULTY[this.difficulty];
    this.seed = seed >>> 0;
    this.players = players.map((p, i) => this.newPlayer(i, p.name, p.connected !== false));
    this.fields = this.players.map(() => this.nav.newField());
    this.runId = 0;
    this.attempts = 0;
    this.events = [];
    this.zhash = new Map();
    this.newRun();
  }

  newPlayer(slot, name, connected) {
    return { slot, name: name || `생존자${slot + 1}`, connected, x: 0, z: 0, yaw: 0, pitch: 0, region: 0, hp: 100, status: PS.OK, downs: 0, bleed: 0, reviveT: 0, reviving: -1, flags: PF.FLASH, weapon: 0, medkit: false, lastHurt: -9, kills: 0 };
  }

  emit(ev) {
    this.events.push(ev);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  msg(slot, text) {
    this.emit({ type: 'msg', slot, text });
  }

  // ─── 판 시작 ───────────────────────────────────────────────────────────────

  newRun() {
    this.runId += 1;
    this.attempts += 1;
    const R = (this.R = rng((this.seed * 7919 + this.runId * 104729) >>> 0));
    this.time = 0;
    this.tick = 0;
    this.ended = null;
    this.endT = 0;
    this.flags = { power: false, portGate: false };
    this.keys = new Set();
    this.objective = 'start';
    this.doors = {};
    for (const d of this.map.doors) {
      this.doors[d.id] = { open: d.open, locked: d.locked };
      this.applyDoor(d.id);
    }
    this.items = {};
    for (const it of this.map.items) {
      const s = it.spots[Math.floor(R() * it.spots.length)];
      this.items[it.id] = { id: it.id, type: it.type, x: s[0], z: s[1], y: s[2], taken: false, label: it.label || null };
    }
    this.doorHp = {};
    this.bashT = {};
    this.zombies = [];
    this.zmap = new Map();
    this.nextId = 1;
    this.dormant = this.map.groups.map((g) => ({ x: g.x, z: g.z, r: g.r, n: Math.max(1, Math.round(g.n * this.diff.count * (0.7 + R() * 0.6))), woke: false }));
    this.mobT = this.randRange(this.diff.mob);
    this.cres = null;
    this.finale = null;
    this.boat = null;
    this.kills = 0;
    this.alertCool = 0;
    this.players.forEach((p, i) => {
      const [x, z] = this.map.starts[i % this.map.starts.length];
      Object.assign(p, { x, z, yaw: this.map.startYaw, pitch: 0, region: 0, hp: 100, status: PS.OK, downs: 0, bleed: 0, reviveT: 0, reviving: -1, medkit: false, lastHurt: -9, kills: 0 });
    });
    this.emit({ type: 'run', runId: this.runId, attempts: this.attempts });
    this.emitWorld();
    this.emit({ type: 'objective', id: 'start' });
    this.emit({ type: 'radio', text: this.map.radioIntro });
  }

  randRange([a, b]) {
    return a + this.R() * (b - a);
  }

  applyDoor(id) {
    const d = this.doors[id];
    this.cols.setFlags(id, d.open ? 0 : F.ALL);
    this.nav.setDoor(id, !d.open);
  }

  worldState() {
    return {
      runId: this.runId,
      attempts: this.attempts,
      difficulty: this.difficulty,
      objective: this.objective,
      flags: { ...this.flags },
      keys: [...this.keys],
      doors: Object.fromEntries(Object.entries(this.doors).map(([k, v]) => [k, { ...v }])),
      items: Object.fromEntries(Object.entries(this.items).map(([k, v]) => [k, { ...v }])),
      cres: this.cres ? this.cres.tag : null,
      finale: this.finale ? { dur: FINALE_TIME } : null,
      boat: this.boat ? (this.boat.docked ? 'docked' : 'arriving') : null,
      ended: this.ended,
      names: this.players.map((p) => p.name),
    };
  }

  emitWorld() {
    this.emit({ type: 'world', state: this.worldState() });
  }

  setObjective(id) {
    if ((OBJ_INDEX[id] ?? -1) <= (OBJ_INDEX[this.objective] ?? -1)) return;
    this.objective = id;
    this.emit({ type: 'objective', id });
    this.emitWorld();
  }

  // ─── 입력 ──────────────────────────────────────────────────────────────────

  setPlayerState(slot, st) {
    const p = this.players[slot];
    if (!p) return;
    if (p.status === PS.OK && Number.isFinite(st.x) && Number.isFinite(st.z)) {
      p.x = st.x;
      p.z = st.z;
      p.region = regionOf(p.z);
    }
    p.yaw = st.yaw;
    p.pitch = st.pitch;
    p.flags = st.flags;
    p.weapon = st.weapon;
  }

  setConnected(slot, on) {
    const p = this.players[slot];
    if (!p) return;
    p.connected = on;
    if (!on) p.reviving = -1;
  }

  setName(slot, name) {
    if (this.players[slot]) this.players[slot].name = name;
  }

  request(slot, req) {
    if (!req || typeof req.r !== 'string') return;
    if (req.r === 'restart') {
      if (slot === 0 && this.ended) this.newRun();
      return;
    }
    if (this.ended) return;
    switch (req.r) {
      case 'use': this.use(slot, req.id); break;
      case 'hits': this.applyHits(slot, req.list); break;
      case 'shot': this.shot(slot, req); break;
      case 'shove': this.shove(slot, req); break;
      case 'heal': this.heal(slot); break;
      case 'revive': this.reviveReq(slot, req.target, !!req.on); break;
      default:
    }
  }

  use(slot, id) {
    const p = this.players[slot];
    if (!p || p.status !== PS.OK || typeof id !== 'string') return;
    const near = (x, z, r) => Math.hypot(p.x - x, p.z - z) <= r;
    const it = this.items[id];
    if (it) {
      if (!near(it.x, it.z, 3)) return;
      if (it.type === 'key') {
        if (it.taken) return;
        it.taken = true;
        this.keys.add(id);
        this.emit({ type: 'pickup', slot, id, kind: 'key', label: it.label });
        this.emitWorld();
      } else if (it.type === 'medkit') {
        if (it.taken) return;
        if (p.medkit) return this.msg(slot, '이미 구급상자를 갖고 있다.');
        it.taken = true;
        p.medkit = true;
        this.emit({ type: 'grant', slot, what: 'medkit' });
        this.emitWorld();
      } else {
        this.emit({ type: 'grant', slot, what: it.type });
      }
      return;
    }
    const def = this.doorDef.get(id);
    if (def) {
      const d = this.doors[id];
      if (!near(def.x, def.z, def.w / 2 + 2.6)) return;
      if (d.locked) {
        const ok = (def.key && this.keys.has(def.key)) || (def.flag && this.flags[def.flag]);
        if (!ok) {
          this.msg(slot, def.lockedMsg);
          if (id === 'stationShutter') this.setObjective('needPower');
          if (id === 'portGate') this.setObjective('needGate');
          return;
        }
        d.locked = false;
        d.open = true;
        this.applyDoor(id);
        this.emit({ type: 'door', id, open: true, unlocked: true, slot });
        if (id === 'backGate') {
          this.msg(slot, '열쇠로 뒷문을 열었다.');
          this.setObjective('leftComplex');
        }
        this.emitWorld();
        return;
      }
      if ((def.kind === 'gate' || def.kind === 'shutter') && d.open) return;
      if (d.broken) return this.msg(slot, '문이 부서져서 닫히지 않는다.');
      if (d.open && this.doorwayBlocked(id)) return this.msg(slot, '문 사이에 뭔가 끼어 있다.');
      d.open = !d.open;
      this.applyDoor(id);
      this.emit({ type: 'door', id, open: d.open, slot });
      this.emitWorld();
      return;
    }
    const inter = this.interDef.get(id);
    if (inter) {
      if (!near(inter.x, inter.z, inter.r + 1)) return;
      if (inter.kind === 'look') this.msg(slot, inter.msg);
      else if (inter.kind === 'power') {
        if (this.flags.power) return this.msg(slot, '이미 전원이 들어와 있다.');
        this.flags.power = true;
        this.forceOpen('stationShutter');
        this.emit({ type: 'power' });
        this.setObjective('powerOn');
        this.startCrescendo('power');
        this.emitWorld();
      } else if (inter.kind === 'gate') {
        if (this.flags.portGate) return this.msg(slot, '정문은 이미 열려 있다.');
        this.flags.portGate = true;
        this.forceOpen('portGate');
        this.setObjective('gateOpen');
        this.startCrescendo('port');
        this.emitWorld();
      } else if (inter.kind === 'radio') {
        if (this.finale) return this.msg(slot, this.boat ? '배가 왔다! 부두 끝으로!' : '구조선이 오고 있다. 버텨라!');
        this.startFinale();
      }
    }
  }

  forceOpen(id) {
    const d = this.doors[id];
    d.locked = false;
    d.open = true;
    this.applyDoor(id);
    this.emit({ type: 'door', id, open: true, unlocked: true });
  }

  doorwayBlocked(id) {
    const cols = this.cols.byId.get(id) || [];
    const bodies = [...this.players.filter((p) => p.connected && p.status !== PS.DEAD), ...this.zombies.filter((z) => z.state !== ZS.DEAD)];
    for (const c of cols) for (const b of bodies) if (Math.abs(b.x - c.cx) < 3 && Math.abs(b.z - c.cz) < 3 && circleVsBox(b.x, b.z, 0.3, c)) return true;
    return false;
  }

  applyHits(slot, list) {
    if (!Array.isArray(list)) return;
    for (const h of list.slice(0, 20)) {
      const z = this.zmap.get(h.id);
      if (!z || z.state === ZS.DEAD) continue;
      const dmg = Math.min(200, Math.max(0, Number(h.dmg) || 0));
      this.hurtZombie(z, dmg, slot, !!h.head, h);
    }
  }

  hurtZombie(z, dmg, slot, head, h = {}) {
    z.hp -= dmg;
    z.hitT = 0.15;
    z.flinch = Math.max(z.flinch, 0.12);
    this.emit({ type: 'zhit', id: z.id, slot, head, x: h.x ?? z.x, y: h.y ?? 1.3, z: h.z ?? z.z });
    if (z.hp <= 0) {
      z.state = ZS.DEAD;
      z.deadT = 0;
      this.kills += 1;
      if (this.players[slot]) this.players[slot].kills += 1;
      this.emit({ type: 'zdie', id: z.id, slot, head, x: z.x, z: z.z });
    } else if (z.state !== ZS.CHASE && z.state !== ZS.ATTACK) this.alert(z, slot);
  }

  shot(slot, req) {
    const p = this.players[slot];
    if (!p) return;
    const w = WEAPONS[req.w] || WEAPONS.pistol;
    const r = p.region;
    for (const z of this.zombies) {
      if (z.state === ZS.DEAD || z.state === ZS.CHASE || z.state === ZS.ATTACK) continue;
      if (regionOf(z.z) !== r) continue;
      if (dist(z, p) < w.noise) this.alert(z, slot, false, 0.2 + this.R() * 0.8);
    }
    this.emit({ type: 'shot', slot, w: req.w, o: req.o, d: req.d });
  }

  shove(slot, req) {
    const p = this.players[slot];
    if (!p || p.status !== PS.OK) return;
    const yaw = Number(req.yaw) || p.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (const z of this.zombies) {
      if (z.state === ZS.DEAD) continue;
      const dx = z.x - p.x;
      const dz = z.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > SHOVE.range || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < SHOVE.cone) continue;
      z.vx = (dx / d) * SHOVE.push;
      z.vz = (dz / d) * SHOVE.push;
      z.stunT = SHOVE.stun;
      z.attackT = Math.max(z.attackT, 0.6);
      if (z.state !== ZS.CHASE && z.state !== ZS.ATTACK) this.alert(z, slot);
    }
    this.emit({ type: 'shove', slot });
  }

  heal(slot) {
    const p = this.players[slot];
    if (!p || p.status !== PS.OK || !p.medkit) return;
    p.medkit = false;
    p.hp = Math.min(100, p.hp + (100 - p.hp) * 0.8);
    p.downs = 0;
    this.emit({ type: 'healed', slot });
    this.emitWorld();
  }

  reviveReq(slot, target, on) {
    const p = this.players[slot];
    if (!p) return;
    if (!on) {
      p.reviving = -1;
      return;
    }
    const t = this.players[target];
    if (!t || t === p || p.status !== PS.OK || t.status !== PS.DOWN || dist(p, t) > 2.6) return;
    p.reviving = target;
  }

  // ─── 한 틱 ─────────────────────────────────────────────────────────────────

  step() {
    this.tick += 1;
    if (this.ended) {
      if (this.ended === 'wipe') {
        this.endT -= DT;
        if (this.endT <= 0) this.newRun();
      }
      return;
    }
    this.time += DT;
    this.alertCool = Math.max(0, this.alertCool - DT);
    if (this.tick % 8 === 0) this.updateFields();
    this.updatePlayers();
    if (this.tick % 15 === 0 && !this.peace) this.wake();
    this.updateZombies();
    if (this.tick % 30 === 0 && !this.peace) this.director();
    this.updateCres();
    this.updateFinale();
    if (this.tick % 8 === 4) this.checkTriggers();
  }

  valid(p) {
    return p && p.connected && p.status !== PS.DEAD;
  }

  updateFields() {
    // 두 사람의 흐름장을 번갈아 갱신 (한 틱에 하나)
    const n = this.players.length;
    const i = Math.floor(this.tick / 8) % n;
    const p = this.players[i];
    if (this.valid(p)) this.nav.flow(this.fields[i], p.x, p.z);
    else this.fields[i].ok = false;
  }

  updatePlayers() {
    for (const p of this.players) {
      if (p.status !== PS.DOWN) continue;
      if (!p.connected) continue;
      p.bleed -= DT;
      const reviver = this.players.find((q) => q.reviving === p.slot && q.status === PS.OK && q.connected && dist(q, p) < 2.8);
      if (reviver) {
        p.reviveT += DT;
        if (p.reviveT >= REVIVE_TIME) {
          p.status = PS.OK;
          p.hp = 30;
          p.bleed = 0;
          p.reviveT = 0;
          reviver.reviving = -1;
          this.emit({ type: 'revived', slot: p.slot, by: reviver.slot });
        }
      } else p.reviveT = 0;
      if (p.status === PS.DOWN && p.bleed <= 0) this.die(p);
    }
    for (const p of this.players) if (p.reviving >= 0 && this.players[p.reviving]?.status !== PS.DOWN) p.reviving = -1;
  }

  damagePlayer(p, amount, z) {
    if (this.ended || p.status === PS.DEAD) return;
    if (p.status === PS.DOWN) {
      p.bleed -= amount * 0.4;
      this.emit({ type: 'pdmg', slot: p.slot, amount, down: true });
      return;
    }
    p.hp -= amount;
    p.lastHurt = this.time;
    this.emit({ type: 'pdmg', slot: p.slot, amount, from: z ? [z.x, z.z] : null });
    if (p.hp <= 0) this.incapacitate(p);
  }

  incapacitate(p) {
    const others = this.players.filter((q) => q !== p && q.connected && q.status === PS.OK);
    if (!others.length || p.downs >= 2) {
      this.die(p);
      return;
    }
    p.status = PS.DOWN;
    p.downs += 1;
    p.hp = 0;
    p.bleed = this.diff.bleed;
    p.reviveT = 0;
    p.reviving = -1;
    this.emit({ type: 'down', slot: p.slot, downs: p.downs });
  }

  die(p) {
    p.status = PS.DEAD;
    p.hp = 0;
    this.emit({ type: 'dead', slot: p.slot });
    this.wipe(p.slot);
  }

  /** 누군가 죽으면 처음부터 */
  wipe(slot) {
    if (this.ended) return;
    this.ended = 'wipe';
    this.endT = 7;
    this.emit({ type: 'wipe', slot, time: this.time, kills: this.kills, attempts: this.attempts, objective: this.objective });
    this.emitWorld();
  }

  escape() {
    if (this.ended) return;
    this.ended = 'escape';
    this.emit({ type: 'escape', time: this.time, kills: this.kills, attempts: this.attempts, perPlayer: this.players.map((p) => ({ name: p.name, kills: p.kills })) });
    this.emitWorld();
  }

  // ─── 좀비 ──────────────────────────────────────────────────────────────────

  spawnZombie(x, z, state, target = -1) {
    if (this.zombies.length >= MAX_ZOMBIES) return null;
    const k = this.nav.nearestFree(x, z, 6);
    if (k < 0) return null;
    const R = this.R;
    const slow = R() < 0.14;
    this.nextId = (this.nextId % 65000) + 1;
    const zb = {
      id: this.nextId, x: this.nav.cx(k) + (R() - 0.5) * 0.2, z: this.nav.cz(k) + (R() - 0.5) * 0.2, vx: 0, vz: 0,
      yaw: R() * Math.PI * 2 - Math.PI, hp: 60 * this.diff.hp, state, target, attackT: 0.4, stunT: 0, flinch: 0, swing: 0, hitT: 0, deadT: 0,
      speed: slow ? 2.4 + R() * 0.7 : 4.4 + R() * 1.2, variant: Math.floor(R() * 32), wanderT: R() * 5, wt: null, speedNow: 0, pending: null,
    };
    zb.home = [zb.x, zb.z];
    this.zombies.push(zb);
    this.zmap.set(zb.id, zb);
    return zb;
  }

  removeZombie(z) {
    const i = this.zombies.indexOf(z);
    if (i >= 0) this.zombies.splice(i, 1);
    this.zmap.delete(z.id);
  }

  alert(z, slot, spread = true, delay = 0) {
    if (z.state === ZS.DEAD) return;
    if (delay > 0) {
      if (!z.pending) z.pending = { slot, t: delay, spread };
      return;
    }
    const was = z.state;
    z.state = ZS.CHASE;
    z.target = slot;
    z.attackT = Math.max(z.attackT, 0.4);
    if (was === ZS.IDLE || was === ZS.WANDER) {
      if (this.alertCool <= 0) {
        this.alertCool = 0.5;
        this.emit({ type: 'zalert', id: z.id, x: z.x, z: z.z });
      }
      if (spread) {
        for (const o of this.zombies) {
          if (o === z || o.state === ZS.DEAD || o.state === ZS.CHASE || o.state === ZS.ATTACK || o.pending) continue;
          if (Math.abs(o.x - z.x) < 9 && Math.abs(o.z - z.z) < 9 && dist(o, z) < 9) o.pending = { slot, t: 0.25 + this.R() * 0.6, spread: false };
        }
      }
    }
  }

  nearestTarget(z) {
    let best = null;
    let bd = Infinity;
    const r = regionOf(z.z);
    for (const p of this.players) {
      if (!this.valid(p) || p.region !== r) continue;
      const d = dist(p, z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  nearestPlayerDist(z) {
    let bd = Infinity;
    const r = regionOf(z.z);
    for (const p of this.players) if (this.valid(p) && p.region === r) bd = Math.min(bd, dist(p, z));
    return bd;
  }

  perceive(z) {
    const r = regionOf(z.z);
    for (const p of this.players) {
      if (!this.valid(p) || p.region !== r) continue;
      const dx = z.x - p.x;
      const dz = z.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 30) continue;
      if (d < 3.5) return this.alert(z, p.slot);
      let range = 9;
      if (p.flags & PF.FLASH) {
        const fx = -Math.sin(p.yaw);
        const fz = -Math.cos(p.yaw);
        if ((dx * fx + dz * fz) / d > 0.86) range = 24; // 손전등에 비친 좀비는 알아챈다
      }
      if (p.flags & PF.SPRINT) range += 4;
      if (p.flags & PF.FIRING) range += 6;
      if (d < range && this.nav.los(z.x, z.z, p.x, p.z)) return this.alert(z, p.slot);
    }
  }

  wake() {
    for (const g of this.dormant) {
      if (g.woke) continue;
      const r = regionOf(g.z);
      if (!this.players.some((p) => this.valid(p) && p.region === r && Math.hypot(p.x - g.x, p.z - g.z) < 72)) continue;
      if (this.zombies.length + g.n > MAX_ZOMBIES) continue;
      g.woke = true;
      for (let i = 0; i < g.n; i++) {
        const a = this.R() * Math.PI * 2;
        const rr = this.R() * g.r;
        this.spawnZombie(g.x + Math.cos(a) * rr, g.z + Math.sin(a) * rr, this.R() < 0.35 ? ZS.WANDER : ZS.IDLE);
      }
    }
  }

  updateZombies() {
    const H = this.zhash;
    H.clear();
    const CELL = 1.5;
    const hk = (x, z) => Math.floor(x / CELL) * 65536 + Math.floor(z / CELL);
    for (const z of this.zombies) {
      if (z.state === ZS.DEAD) continue;
      const k = hk(z.x, z.z);
      let b = H.get(k);
      if (!b) H.set(k, (b = []));
      b.push(z);
    }
    const R = this.R;
    for (let n = this.zombies.length - 1; n >= 0; n--) {
      const z = this.zombies[n];
      if (z.state === ZS.DEAD) {
        z.deadT += DT;
        z.vx *= 0.85;
        z.vz *= 0.85;
        z.x += z.vx * DT;
        z.z += z.vz * DT;
        if (z.deadT > 18) this.removeZombie(z);
        continue;
      }
      z.hitT = Math.max(0, z.hitT - DT);
      z.flinch = Math.max(0, z.flinch - DT);
      z.swing = Math.max(0, z.swing - DT);
      if (z.pending) {
        z.pending.t -= DT;
        if (z.pending.t <= 0) {
          const pd = z.pending;
          z.pending = null;
          if (z.state !== ZS.CHASE && z.state !== ZS.ATTACK && this.valid(this.players[pd.slot])) this.alert(z, pd.slot, pd.spread);
        }
      }
      if ((z.state === ZS.IDLE || z.state === ZS.WANDER) && (this.tick + z.id) % 6 === 0) this.perceive(z);

      let t = null;
      if (z.state === ZS.CHASE || z.state === ZS.ATTACK) {
        t = this.players[z.target];
        if (!this.valid(t) || t.region !== regionOf(z.z)) {
          t = this.nearestTarget(z);
          if (t) z.target = t.slot;
          else {
            z.state = ZS.WANDER;
            z.home = [z.x, z.z];
          }
        } else if ((this.tick + z.id) % 30 === 0) {
          const other = this.nearestTarget(z);
          if (other && other !== t && dist(other, z) < dist(t, z) - 3) {
            t = other;
            z.target = other.slot;
          }
        }
      }

      let dvx = 0;
      let dvz = 0;
      if (z.stunT > 0) {
        z.stunT -= DT;
      } else if (t && (z.state === ZS.CHASE || z.state === ZS.ATTACK)) {
        const dx = t.x - z.x;
        const dz = t.z - z.z;
        const d = Math.hypot(dx, dz);
        const reach = t.status === PS.DOWN ? 1.25 : 1.1;
        if (d < reach) {
          z.state = ZS.ATTACK;
          z.yaw = Math.atan2(-dx, -dz);
          z.attackT -= DT;
          if (z.attackT <= 0) {
            z.attackT = 0.95 + R() * 0.35;
            z.swing = 0.4;
            this.damagePlayer(t, this.diff.dmg, z);
          }
        } else {
          if (z.state === ZS.ATTACK) z.state = ZS.CHASE;
          z.attackT = Math.max(z.attackT, 0.3);
          let tx = t.x;
          let tz = t.z;
          if (d > 2.2 && !(d < 14 && this.nav.los(z.x, z.z, t.x, t.z))) {
            const f = this.fields[t.slot];
            const nx = f.ok ? this.nav.next(f, z.x, z.z) : null;
            if (nx) {
              tx = nx[0];
              tz = nx[1];
              z.lostT = 0;
              // 다음 칸이 닫힌 문이면 두들겨 부순다
              const door = this.nav.doorAtCell(tx, tz);
              if (door && Math.hypot(tx - z.x, tz - z.z) < 1.3) this.bashDoor(door, z);
            } else if ((z.lostT = (z.lostT || 0) + DT) > 10) {
              // 길을 못 찾으면 포기하고 어슬렁거린다
              z.state = ZS.WANDER;
              z.home = [z.x, z.z];
              z.lostT = 0;
            }
          } else z.lostT = 0;
          const ddx = tx - z.x;
          const ddz = tz - z.z;
          const dl = Math.hypot(ddx, ddz) || 1;
          const sp = z.speed * (z.flinch > 0 ? 0.35 : 1);
          dvx = (ddx / dl) * sp;
          dvz = (ddz / dl) * sp;
        }
      } else if (z.state === ZS.WANDER) {
        z.wanderT -= DT;
        if (z.wanderT <= 0 || !z.wt) {
          z.wanderT = 3 + R() * 6;
          const a = R() * Math.PI * 2;
          const rr = 1 + R() * 6;
          const wx = z.home[0] + Math.cos(a) * rr;
          const wz = z.home[1] + Math.sin(a) * rr;
          z.wt = this.nav.free(wx, wz) ? [wx, wz] : null;
        }
        if (z.wt) {
          const ddx = z.wt[0] - z.x;
          const ddz = z.wt[1] - z.z;
          const dl = Math.hypot(ddx, ddz);
          if (dl > 0.4) {
            dvx = (ddx / dl) * 0.75;
            dvz = (ddz / dl) * 0.75;
          }
        }
      }
      const k = Math.min(1, DT * (z.stunT > 0 ? 2.5 : 7));
      z.vx += (dvx - z.vx) * k;
      z.vz += (dvz - z.vz) * k;
      let nx = z.x + z.vx * DT;
      let nz = z.z + z.vz * DT;
      // 좀비끼리 밀어내기
      const ci = Math.floor(z.x / CELL);
      const cj = Math.floor(z.z / CELL);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const list = H.get((ci + a) * 65536 + (cj + b));
          if (!list) continue;
          for (const o of list) {
            if (o === z) continue;
            const ex = nx - o.x;
            const ez = nz - o.z;
            const d2 = ex * ex + ez * ez;
            if (d2 < 0.36 && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const push = (0.6 - d) * 0.5;
              nx += (ex / d) * push;
              nz += (ez / d) * push;
            }
          }
        }
      }
      // 사람 몸을 뚫지 않게
      for (const p of this.players) {
        if (!this.valid(p) || p.status !== PS.OK) continue;
        const ex = nx - p.x;
        const ez = nz - p.z;
        const d = Math.hypot(ex, ez);
        if (d < ZR + PR && d > 1e-4) {
          nx = p.x + (ex / d) * (ZR + PR);
          nz = p.z + (ez / d) * (ZR + PR);
        }
      }
      [nx, nz] = this.cols.resolveCircle(nx, nz, ZR, F.MOVE, 2);
      z.x = nx;
      z.z = nz;
      const sp = Math.hypot(z.vx, z.vz);
      z.speedNow = sp;
      if (sp > 0.25 && z.state !== ZS.ATTACK && z.stunT <= 0) {
        const want = Math.atan2(-z.vx, -z.vz);
        z.yaw += angDiff(z.yaw, want) * Math.min(1, DT * 8);
      }
      if ((this.tick + z.id) % 30 === 0) {
        const nd = this.nearestPlayerDist(z);
        if (nd > (z.state === ZS.CHASE ? 130 : 100)) this.removeZombie(z);
      }
    }
  }

  // ─── 감독: 주변 좀비 수 유지, 가끔 떼 ───────────────────────────────────────

  bashDoor(id, z) {
    const d = this.doors[id];
    if (!d || d.open) return;
    this.doorHp = this.doorHp || {};
    this.doorHp[id] = (this.doorHp[id] ?? 7) - DT;
    z.swing = Math.max(z.swing, 0.2);
    this.bashT = this.bashT || {};
    if ((this.bashT[id] || 0) <= this.time) {
      this.bashT[id] = this.time + 0.7;
      const def = this.doorDef.get(id);
      this.emit({ type: 'bash', id, x: def.x, z: def.z });
    }
    if (this.doorHp[id] <= 0) {
      d.open = true;
      d.broken = true;
      this.applyDoor(id);
      this.emit({ type: 'door', id, open: true, broken: true });
      this.emitWorld();
    }
  }

  alivePlayers() {
    return this.players.filter((p) => this.valid(p));
  }

  /** 사람 눈에 안 띄고, 걸어서 갈 수 있는 곳 */
  findHidden(p, rmin, rmax) {
    const f = this.fields[p.slot];
    if (!f.ok) return null;
    const alive = this.alivePlayers();
    for (let t = 0; t < 40; t++) {
      const a = this.R() * Math.PI * 2;
      const r = rmin + this.R() * (rmax - rmin);
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (!this.nav.free(x, z) || regionOf(z) !== p.region) continue;
      if (this.nav.distAt(f, x, z) === INF) continue;
      let ok = true;
      for (const q of alive) {
        if (q.region !== p.region) continue;
        const d = Math.hypot(q.x - x, q.z - z);
        if (d < rmin * 0.75 || (d < 60 && this.nav.los(q.x, q.z, x, z))) {
          ok = false;
          break;
        }
      }
      if (ok) return [x, z];
    }
    return null;
  }

  director() {
    const alive = this.alivePlayers();
    if (!alive.length) return;
    for (const region of new Set(alive.map((p) => p.region))) {
      const ps = alive.filter((p) => p.region === region);
      let near = 0;
      for (const z of this.zombies) {
        if (z.state === ZS.DEAD || regionOf(z.z) !== region) continue;
        if (ps.some((p) => Math.abs(p.x - z.x) < 70 && Math.abs(p.z - z.z) < 70)) near++;
      }
      const want = Math.round((region === 1 ? 9 : 13) * this.diff.count + (this.finale ? 6 : 0));
      if (near < want) {
        const p = ps[Math.floor(this.R() * ps.length)];
        const s = this.findHidden(p, 30, 58);
        if (s) this.spawnZombie(s[0], s[1], this.R() < 0.5 ? ZS.WANDER : ZS.IDLE);
      }
    }
    if (!this.cres && !this.finale && this.time > 45) {
      this.mobT -= 1;
      if (this.mobT <= 0) {
        this.mobT = this.spawnMob() ? this.randRange(this.diff.mob) : 8;
      }
    }
  }

  spawnMob() {
    const alive = this.alivePlayers();
    const p = alive[Math.floor(this.R() * alive.length)];
    const s = this.findHidden(p, 28, 52);
    if (!s) return false;
    const n = Math.round((7 + this.R() * 7) * this.diff.count);
    for (let i = 0; i < n; i++) this.spawnZombie(s[0] + (this.R() - 0.5) * 4, s[1] + (this.R() - 0.5) * 4, ZS.CHASE, p.slot);
    this.emit({ type: 'mob', x: s[0], z: s[1] });
    return true;
  }

  // ─── 경보(떼 습격)와 마지막 버티기 ──────────────────────────────────────────

  startCrescendo(tag) {
    this.cres = { tag, t: 0, waves: tag === 'power' ? [2, 13, 25, 37] : [2, 14, 28], next: 0, size: tag === 'power' ? 9 : 11 };
    this.emit({ type: 'alarm', tag });
  }

  updateCres() {
    const c = this.cres;
    if (!c) return;
    c.t += DT;
    if (c.next < c.waves.length && c.t >= c.waves[c.next]) {
      this.spawnHorde(c.tag, Math.round(c.size * this.diff.count));
      c.next += 1;
    }
    if (c.t > c.waves[c.waves.length - 1] + 20) {
      this.cres = null;
      this.emit({ type: 'alarmEnd' });
      this.emitWorld();
    }
  }

  spawnHorde(tag, n) {
    if (this.peace) return;
    const alive = this.alivePlayers();
    if (!alive.length) return;
    const pts = this.map.hordes.filter((h) => h.tag === tag).filter((h) => {
      const r = regionOf(h.z);
      const ps = alive.filter((p) => p.region === r);
      if (!ps.length) return false;
      for (const p of ps) {
        const d = Math.hypot(p.x - h.x, p.z - h.z);
        if (d < 18 || (d < 55 && this.nav.los(p.x, p.z, h.x, h.z))) return false;
      }
      return ps.some((p) => this.fields[p.slot].ok && this.nav.distAt(this.fields[p.slot], h.x, h.z) !== INF);
    });
    const spots = [];
    if (pts.length) {
      const a = pts[Math.floor(this.R() * pts.length)];
      spots.push([a.x, a.z]);
      if (pts.length > 1 && n > 8) {
        const b = pts[Math.floor(this.R() * pts.length)];
        spots.push([b.x, b.z]);
      }
    } else {
      const p = alive[Math.floor(this.R() * alive.length)];
      const s = this.findHidden(p, 25, 50);
      if (s) spots.push(s);
    }
    if (!spots.length) return;
    for (let i = 0; i < n; i++) {
      const s = spots[i % spots.length];
      const zb = this.spawnZombie(s[0] + (this.R() - 0.5) * 5, s[1] + (this.R() - 0.5) * 5, ZS.CHASE, -1);
      if (zb) {
        const t = this.nearestTarget(zb);
        zb.target = t ? t.slot : 0;
      }
    }
    this.emit({ type: 'horde', tag });
  }

  startFinale() {
    this.finale = { t: 0, next: 6 };
    this.emit({ type: 'finale', dur: FINALE_TIME });
    this.setObjective('finale');
    this.emitWorld();
  }

  updateFinale() {
    const f = this.finale;
    if (!f) return;
    f.t += DT;
    if (f.t >= f.next) {
      this.spawnHorde('finale', Math.round((7 + f.t / 30) * this.diff.count));
      f.next += f.t < FINALE_TIME ? 17 : 24;
    }
    if (!this.boat && f.t >= FINALE_TIME) {
      this.boat = { t: 0, docked: false };
      this.emit({ type: 'boat', state: 'arriving' });
      this.emitWorld();
    }
    if (this.boat) {
      this.boat.t += DT;
      if (!this.boat.docked && this.boat.t >= 10) {
        this.boat.docked = true;
        this.emit({ type: 'boat', state: 'docked' });
        this.setObjective('boat');
        this.emitWorld();
      }
    }
  }

  checkTriggers() {
    const inT = (p, id) => {
      const t = this.trigDef.get(id);
      return t && p.x >= t.x0 && p.x <= t.x1 && p.z >= t.z0 && p.z <= t.z1;
    };
    for (const p of this.alivePlayers()) {
      if (inT(p, 'bridgeSeen')) this.setObjective('bridgeOut');
      if (inT(p, 'stationFront') && !this.flags.power && OBJ_INDEX[this.objective] >= OBJ_INDEX.bridgeOut) this.setObjective('needPower');
      if (p.region === 1) this.setObjective('subway');
      if (p.region === 0 && inT(p, 'eastBank')) this.setObjective('eastBank');
    }
    if (this.boat && this.boat.docked) {
      const team = this.players.filter((p) => p.connected && p.status !== PS.DEAD);
      if (team.length && team.every((p) => p.status === PS.OK && inT(p, 'boatZone'))) this.escape();
    }
  }

  // ─── 보내기 ────────────────────────────────────────────────────────────────

  snapshot() {
    return encodeSnapshot({
      tick: this.tick,
      runId: this.runId,
      time: this.time,
      finaleLeft: this.finale ? Math.max(0, FINALE_TIME - this.finale.t) : -1,
      boatT: this.boat ? this.boat.t : -1,
      players: this.players.map((p) => ({
        slot: p.slot, x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, hp: Math.max(0, p.hp), status: p.status, bleed: Math.max(0, p.bleed),
        revive: p.reviveT / REVIVE_TIME, flags: p.flags, weapon: p.weapon, downs: p.downs, conn: p.connected, medkit: p.medkit,
      })),
      zombies: this.zombies.map((z) => ({
        id: z.id, x: z.x, z: z.z, yaw: z.yaw, state: z.state, variant: z.variant, speed: z.speedNow,
        flags: (z.stunT > 0 ? 1 : 0) | (z.swing > 0 ? 2 : 0) | (z.hitT > 0 ? 4 : 0),
      })),
    });
  }
}
