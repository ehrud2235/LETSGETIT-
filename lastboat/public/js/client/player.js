// 내 캐릭터: 조작(마우스·키보드), 이동과 충돌, 사격·장전·무기 바꾸기·밀치기·구급상자·동료 일으키기, 상호작용.
import { F } from '../shared/geom.js';
import { WEAPONS, MEDKIT_TIME, SHOVE } from '../shared/weapons.js';
import { PF } from '../shared/protocol.js';
import { play } from './audio.js';

const WID = { pistol: 0, shotgun: 1, rifle: 2, medkit: 3 };
const EYE = 1.62;
const PR = 0.35;

export class Player {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this.mouse = { L: false, R: false };
    this.look = { dx: 0, dy: 0 };
    this.sens = 0.0022;
    try {
      const s = parseFloat(localStorage.getItem('lastboat.sens'));
      if (Number.isFinite(s)) this.sens = s;
    } catch { /* 무시 */ }
    this.enabled = false;
    this.listeners = [];
    this.bind();
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = 0;
    this.vx = 0;
    this.vz = 0;
    this.stamina = 1;
    this.flash = true;
    this.primary = null;
    this.pistol = { mag: WEAPONS.pistol.mag };
    this.cur = 'pistol';
    this.last = 'pistol';
    this.fireT = 0;
    this.reloadT = 0;
    this.switchT = 0;
    this.shoveT = 0;
    this.healT = 0;
    this.firingT = 0;
    this.bob = 0;
    this.stepT = 0;
    this.useHeld = false;
    this.reviving = -1;
    this.target = null;
    this.bloom = 0;
    this.portalCool = 1;
    this.game.view?.setWeapon('pistol');
  }

  on(t, type, fn, o) {
    t.addEventListener(type, fn, o);
    this.listeners.push(() => t.removeEventListener(type, fn, o));
  }

  bind() {
    const canvas = this.game.canvas;
    this.on(window, 'keydown', (e) => {
      if (!this.enabled || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (['Tab', 'Space', 'KeyF', 'KeyQ'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.press(e.code);
      this.keys.add(e.code);
    });
    this.on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE') this.releaseUse();
    });
    this.on(window, 'blur', () => {
      this.keys.clear();
      this.mouse.L = this.mouse.R = false;
      this.releaseUse();
    });
    this.on(canvas, 'mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas && !this.game.dragLook) {
        canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) this.mouse.L = true;
      if (e.button === 2) {
        this.mouse.R = true;
        this.shove();
      }
      if (this.game.dragLook) this.dragging = true;
    });
    this.on(window, 'mouseup', (e) => {
      if (e.button === 0) this.mouse.L = false;
      if (e.button === 2) this.mouse.R = false;
      this.dragging = false;
      this.semiReady = true;
    });
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(window, 'mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === canvas || (this.game.dragLook && this.dragging)) {
        this.look.dx += e.movementX;
        this.look.dy += e.movementY;
      }
    });
    this.on(window, 'wheel', (e) => {
      if (!this.enabled) return;
      this.switchTo(this.cur === 'pistol' ? (this.primary ? 'primary' : 'pistol') : 'pistol');
    }, { passive: true });
    this.semiReady = true;
  }

  dispose() {
    for (const off of this.listeners) off();
  }

  get me() {
    return this.game.me;
  }

  get downed() {
    return this.me && this.me.status === 1;
  }

  get alive() {
    return this.me && this.me.status !== 2 && !this.game.ended;
  }

  weaponType() {
    if (this.cur === 'primary' && this.primary) return this.primary.type;
    if (this.cur === 'medkit') return 'medkit';
    return 'pistol';
  }

  press(code) {
    if (!this.alive) return;
    switch (code) {
      case 'KeyR': this.reload(); break;
      case 'Digit1': if (this.primary) this.switchTo('primary'); break;
      case 'Digit2': this.switchTo('pistol'); break;
      case 'Digit3':
      case 'Digit4': if (this.me?.medkit) this.switchTo('medkit'); else this.game.hud.toast('구급상자가 없다'); break;
      case 'KeyQ': this.switchTo(this.last); break;
      case 'KeyF':
        this.flash = !this.flash;
        play('ui');
        break;
      case 'KeyV': this.shove(); break;
      case 'KeyP': this.game.togglePerf(); break;
      case 'KeyE': this.use(); break;
      default:
    }
  }

  switchTo(slot) {
    if (this.downed && slot !== 'pistol') return;
    if (slot === 'primary' && !this.primary) return;
    if (slot === 'medkit' && !this.me?.medkit) return;
    if (slot === this.cur) return;
    this.last = this.cur;
    this.cur = slot;
    this.switchT = 0.35;
    this.reloadT = 0;
    this.healT = 0;
    this.game.view.setWeapon(this.weaponType());
    play('magIn', { vol: 0.5 });
  }

  /** 서버에서 받은 아이템 */
  grant(what) {
    if (what === 'shotgun' || what === 'rifle') {
      const w = WEAPONS[what];
      const had = this.primary && this.primary.type === what;
      this.primary = { type: what, mag: w.mag, reserve: had ? Math.max(this.primary.reserve, w.reserve) : w.reserve };
      this.cur = 'pistol';
      this.switchTo('primary');
      this.game.hud.toast(`${w.name}을 들었다`);
      play('pickup');
    } else if (what === 'ammo') {
      if (!this.primary) {
        this.game.hud.toast('주무기가 없어서 탄약을 챙길 수 없다');
        return;
      }
      this.primary.reserve = WEAPONS[this.primary.type].maxReserve;
      this.game.hud.toast('탄약을 채웠다');
      play('magIn');
    } else if (what === 'medkit') {
      this.game.hud.toast('구급상자를 챙겼다 (4번으로 꺼내기)');
      play('pickup');
    }
  }

  reload() {
    if (this.reloadT > 0 || this.switchT > 0) return;
    const t = this.weaponType();
    if (t === 'medkit') return;
    const w = WEAPONS[t];
    if (t === 'pistol') {
      if (this.pistol.mag >= w.mag) return;
    } else if (this.primary.mag >= w.mag || this.primary.reserve <= 0) return;
    this.reloadT = w.reload;
    this.game.view.reload(w.shellReload ? Math.max(0.5, w.reload * (w.mag - this.primary.mag)) : w.reload);
    play(w.shellReload ? 'shell' : 'magOut');
  }

  finishReload() {
    const t = this.weaponType();
    const w = WEAPONS[t];
    if (t === 'pistol') {
      this.pistol.mag = w.mag;
      play('magIn');
      return;
    }
    const p = this.primary;
    if (w.shellReload) {
      if (p.reserve > 0 && p.mag < w.mag) {
        p.mag += 1;
        p.reserve -= 1;
        play('shell');
      }
      if (p.mag < w.mag && p.reserve > 0) this.reloadT = w.reload;
      else play('pump');
      return;
    }
    const take = Math.min(w.mag - p.mag, p.reserve);
    p.mag += take;
    p.reserve -= take;
    play('magIn');
  }

  mag() {
    return this.weaponType() === 'pistol' ? this.pistol : this.primary;
  }

  fire() {
    const t = this.weaponType();
    if (t === 'medkit' || this.switchT > 0 || this.shoveT > SHOVE.cooldown - 0.3 || this.fireT > 0) return;
    const w = WEAPONS[t];
    const m = this.mag();
    if (this.reloadT > 0) {
      if (w.shellReload && m.mag > 0) this.reloadT = 0;
      else return;
    }
    if (m.mag <= 0) {
      play('empty');
      this.fireT = 0.25;
      this.reload();
      return;
    }
    m.mag -= 1;
    this.fireT = w.interval;
    this.firingT = 0.4;
    const g = this.game;
    const eye = g.eye();
    const fwd = g.forward();
    const moving = Math.hypot(this.vx, this.vz) > 1;
    const spread = w.spread + (moving ? w.moveSpread : 0) + this.bloom + (this.downed ? 0.02 : 0);
    const hits = new Map();
    let firstEnd = null;
    for (let i = 0; i < w.pellets; i++) {
      const d = jitter(fwd, spread);
      const hit = g.raycastShot(eye, d, w.range);
      const end = hit ? hit.point : [eye[0] + d[0] * w.range, eye[1] + d[1] * w.range, eye[2] + d[2] * w.range];
      if (!firstEnd) firstEnd = end;
      if (!hit) continue;
      if (hit.kind === 'zombie') {
        let dmg = w.dmg * (hit.head ? w.head : 1);
        if (w.pellets > 1 && hit.t > 8) dmg *= Math.max(0.3, 1 - (hit.t - 8) / 26);
        const h = hits.get(hit.id) || { id: hit.id, dmg: 0, head: false, x: hit.point[0], y: hit.point[1], z: hit.point[2] };
        h.dmg += dmg;
        h.head = h.head || hit.head;
        hits.set(hit.id, h);
        g.fx.blood(hit.point[0], hit.point[1], hit.point[2], hit.head ? 14 : 7, d, hit.head);
      } else {
        g.fx.dust(hit.point[0], hit.point[1], hit.point[2]);
      }
    }
    if (hits.size) {
      const list = [...hits.values()].map((h) => ({ ...h, dmg: Math.round(h.dmg) }));
      g.request({ r: 'hits', list });
      g.hud.hitmarker(list.some((h) => h.head));
      play('flesh', { vol: 0.6 });
    }
    if (t === 'rifle' || t === 'pistol') g.fx.tracer([eye[0] + fwd[0] * 0.6, eye[1] - 0.12, eye[2] + fwd[2] * 0.6], firstEnd);
    g.request({ r: 'shot', w: t, o: eye.map((v) => Math.round(v * 100) / 100), d: fwd.map((v) => Math.round(v * 1000) / 1000) });
    this.pitch = Math.min(1.45, this.pitch + w.recoil * (0.6 + Math.random() * 0.5));
    this.yaw += (Math.random() - 0.5) * w.recoil * 0.4;
    this.bloom = Math.min(0.05, this.bloom + w.recoil * 0.25);
    g.view.fire(t === 'shotgun' ? 1.4 : t === 'rifle' ? 0.45 : 0.8);
    play(t, { reverb: 0.8 });
    if (t === 'shotgun') setTimeout(() => play('pump', { vol: 0.8 }), 350);
    if (m.mag === 0 && (t === 'pistol' || this.primary.reserve > 0)) setTimeout(() => this.reload(), 250);
  }

  shove() {
    if (!this.alive || this.downed || this.shoveT > 0 || this.cur === 'medkit') return;
    this.shoveT = SHOVE.cooldown;
    this.reloadT = 0;
    this.game.view.shove();
    this.game.request({ r: 'shove', yaw: this.yaw });
    play('shove');
  }

  use() {
    const t = this.target;
    if (!t) return;
    if (t.kind === 'note') {
      this.game.hud.showNote(t.note);
      play('pickup');
      return;
    }
    if (t.kind === 'revive') {
      this.reviving = t.slot;
      this.game.request({ r: 'revive', target: t.slot, on: true });
      return;
    }
    this.game.request({ r: 'use', id: t.id });
  }

  releaseUse() {
    if (this.reviving >= 0) {
      this.game.request({ r: 'revive', target: this.reviving, on: false });
      this.reviving = -1;
    }
  }

  /** 바라보는 곳의 상호작용 대상 */
  findTarget() {
    const g = this.game;
    const eye = g.eye();
    const fwd = g.forward();
    let best = null;
    let bestScore = Infinity;
    const consider = (kind, x, y, z, extra, maxD = 2.4) => {
      const dx = x - eye[0];
      const dy = y - eye[1];
      const dz = z - eye[2];
      const d = Math.hypot(dx, dy, dz);
      const flat = Math.hypot(x - this.x, z - this.z);
      if (flat > maxD) return;
      const cos = (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / (d || 1);
      const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (ang > (flat < 1.2 ? 0.9 : 0.42)) return;
      const hit = g.cols.raycast(eye[0], eye[1], eye[2], dx / d, dy / d, dz / d, d, F.SIGHT | F.SHOT);
      if (hit && hit.t < d - 0.35 && !(extra.id && hit.collider.id === extra.id)) return;
      const score = ang * 3 + flat * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = { kind, ...extra };
      }
    };
    const ws = g.world.items;
    for (const [id, it] of ws) {
      if (!it.g.visible || !it.state) continue;
      const label = { medkit: '구급상자', key: it.state.label || '열쇠', ammo: '탄약', shotgun: '산탄총', rifle: '소총' }[it.state.type];
      consider('item', it.state.x, it.state.y + 0.1, it.state.z, { id, label: `${label} ${it.state.type === 'ammo' ? '채우기' : '줍기'}` });
    }
    for (const d of g.map.doors) {
      // 문 중 가장 가까운 점
      const half = d.w / 2;
      const px = d.axis === 'x' ? Math.max(d.x - half, Math.min(d.x + half, this.x)) : d.x;
      const pz = d.axis === 'z' ? Math.max(d.z - half, Math.min(d.z + half, this.z)) : d.z;
      const st = g.worldState?.doors?.[d.id];
      if (!st) continue;
      if ((d.kind === 'gate' || d.kind === 'shutter') && st.open) continue;
      const label = st.locked ? `${d.label} 열어 보기` : st.open ? `${d.label} 닫기` : `${d.label} 열기`;
      consider('door', px, 1.2, pz, { id: d.id, label }, 2.2);
    }
    for (const i of g.map.interacts) consider('inter', i.x, i.y, i.z, { id: i.id, label: i.label }, i.r + 0.4);
    for (const n of g.map.notes) consider('note', n.x, n.y, n.z, { note: n, label: `${n.title} 읽기` });
    const mate = g.mate;
    if (mate && mate.status === 1 && !this.downed) consider('revive', mate.x, 0.5, mate.z, { slot: mate.slot, label: `${g.names[mate.slot] || '동료'} 일으켜 세우기 (꾹)` }, 2.2);
    return best;
  }

  update(dt) {
    const g = this.game;
    const me = this.me;
    const alive = this.alive && this.enabled;
    // 시선
    const lx = this.look.dx;
    const ly = this.look.dy;
    this.look.dx = 0;
    this.look.dy = 0;
    if (this.enabled && me && me.status !== 2) {
      this.yaw -= lx * this.sens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - ly * this.sens));
    }
    this.fireT = Math.max(0, this.fireT - dt);
    this.switchT = Math.max(0, this.switchT - dt);
    this.shoveT = Math.max(0, this.shoveT - dt);
    this.firingT = Math.max(0, this.firingT - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    this.portalCool = Math.max(0, this.portalCool - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        this.finishReload();
      }
    }
    if (this.downed && this.cur !== 'pistol') {
      this.cur = 'pistol';
      g.view.setWeapon('pistol');
    }
    if (this.cur === 'medkit' && !me?.medkit && this.healT === 0) this.switchTo(this.last === 'medkit' ? 'pistol' : this.last);
    // 이동
    let ix = 0;
    let iz = 0;
    const k = this.keys;
    if (alive && !this.downed) {
      if (k.has('KeyW')) iz += 1;
      if (k.has('KeyS')) iz -= 1;
      if (k.has('KeyA')) ix -= 1;
      if (k.has('KeyD')) ix += 1;
    }
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    const crouch = alive && (k.has('ControlLeft') || k.has('KeyC'));
    const healing = this.healT > 0;
    const reviving = this.reviving >= 0;
    let sprint = alive && k.has('ShiftLeft') && iz > 0 && this.stamina > 0.05 && !crouch && !healing;
    if (sprint) this.stamina = Math.max(0, this.stamina - dt / 5);
    else this.stamina = Math.min(1, this.stamina + dt / 4);
    if (this.stamina <= 0.05) sprint = false;
    const speed = healing || reviving ? 0 : crouch ? 2.3 : sprint ? 6.4 : 4.6;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const wx = (fx * iz + rx * ix) * speed;
    const wz = (fz * iz + rz * ix) * speed;
    const acc = Math.min(1, dt * 12);
    this.vx += (wx - this.vx) * acc;
    this.vz += (wz - this.vz) * acc;
    if (this.downed || !alive) {
      this.vx = 0;
      this.vz = 0;
    }
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    // 좀비 몸에 막힘
    for (const zb of g.zombieView) {
      if (zb.state === 4) continue;
      const ex = nx - zb.x;
      const ez = nz - zb.z;
      const d = Math.hypot(ex, ez);
      if (d < 0.62 && d > 1e-4) {
        nx = zb.x + (ex / d) * 0.62;
        nz = zb.z + (ez / d) * 0.62;
      }
    }
    [nx, nz] = g.cols.resolveCircle(nx, nz, PR, F.MOVE, 3);
    this.x = nx;
    this.z = nz;
    const moving = Math.hypot(this.vx, this.vz) > 0.5;
    if (moving) {
      this.bob += dt * (sprint ? 12 : 8.5);
      this.stepT -= dt * (sprint ? 1.5 : 1);
      if (this.stepT <= 0) {
        this.stepT = 0.42;
        play('step', { vol: crouch ? 0.4 : 1 });
      }
    }
    // 계단 이동
    if (alive && !this.downed && this.portalCool <= 0) {
      for (const p of g.map.portals) {
        if (this.x >= p.x0 && this.x <= p.x1 && this.z >= p.z0 && this.z <= p.z1) {
          this.portalCool = 1.5;
          g.teleport(p.to);
          break;
        }
      }
    }
    // 무기
    if (alive) {
      const t = this.weaponType();
      if (t === 'medkit') {
        if (this.mouse.L && me?.medkit && this.switchT <= 0) {
          this.healT += dt;
          if (this.healT >= MEDKIT_TIME) {
            this.healT = 0;
            g.request({ r: 'heal' });
            play('heal');
            this.mouse.L = false;
          }
        } else this.healT = 0;
      } else if (this.mouse.L) {
        const w = WEAPONS[t];
        if (w.auto || this.semiReady) {
          if (this.fireT <= 0) {
            this.fire();
            this.semiReady = false;
          }
        }
      }
    }
    // 상호작용 대상
    this.target = alive ? this.findTarget() : null;
    if (this.reviving >= 0 && (!g.mate || g.mate.status !== 1 || Math.hypot(g.mate.x - this.x, g.mate.z - this.z) > 2.5 || !k.has('KeyE'))) this.releaseUse();
    // 1인칭 무기
    g.view.update(dt, { moving, sprint, lookDX: lx, lookDY: ly, heal: this.healT / MEDKIT_TIME, downed: this.downed });
    this.sprinting = sprint;
    this.crouching = crouch;
    this.moving = moving;
  }

  flags() {
    let f = 0;
    if (this.flash) f |= PF.FLASH;
    if (this.sprinting) f |= PF.SPRINT;
    if (this.moving) f |= PF.MOVING;
    if (this.healT > 0) f |= PF.HEALING;
    if (this.reviving >= 0) f |= PF.REVIVING;
    if (this.firingT > 0) f |= PF.FIRING;
    if (this.reloadT > 0) f |= PF.RELOADING;
    if (this.crouching) f |= PF.CROUCH;
    return f;
  }

  eyeHeight() {
    if (this.downed) return 0.45;
    return (this.crouching ? 1.12 : EYE) + (this.moving ? Math.abs(Math.sin(this.bob)) * 0.04 : 0);
  }

  weaponId() {
    return WID[this.weaponType()];
  }
}

function jitter(f, s) {
  // 원뿔 안에서 무작위 방향: u 는 수평으로 f 에 수직, v = f × u
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * s;
  let ux = -f[2];
  let uz = f[0];
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul;
  uz /= ul;
  const vx = f[1] * uz;
  const vy = f[2] * ux - f[0] * uz;
  const vz = -f[1] * ux;
  const ca = Math.cos(a) * r;
  const sa = Math.sin(a) * r;
  const dx = f[0] + ux * ca + vx * sa;
  const dy = f[1] + vy * sa;
  const dz = f[2] + uz * ca + vz * sa;
  const l = Math.hypot(dx, dy, dz);
  return [dx / l, dy / l, dz / l];
}
