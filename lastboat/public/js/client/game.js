// 한 판 진행: 화면(three.js), 내 캐릭터, 좀비·동료 보간, 사건 처리, 소리·HUD.
import * as THREE from 'three';
import { buildMap, UNDERGROUND_Z } from '../shared/map.js';
import { ColliderSet, F } from '../shared/geom.js';
import { WEAPONS } from '../shared/weapons.js';
import { Playout, bracket } from '../shared/playout.js';
import { World } from './world.js';
import { ZombieRenderer } from './zombies.js';
import { Survivor } from './survivor.js';
import { ViewModel } from './viewmodel.js';
import { Effects } from './fx.js';
import { Hud, fmtTime, esc } from './hud.js';
import { Player } from './player.js';
import * as audio from './audio.js';

const SNAP_RATE = 30;
// 해상도 배율 한계 (그래픽 설정별). 느리면 자동으로 이 아래까지 내린다.
const PR_MAX = { low: 0.75, medium: 1, high: 1.5 };
const PR_MIN = 0.5;

export class Game {
  /**
   * opts: { canvas, slot, names, solo, isHost, link, quality, onExit, onRestart }
   * link: { request(req), sendState(st), setHandlers({ snapshot, events }) }
   */
  constructor(opts) {
    Object.assign(this, { slot: opts.slot, names: opts.names.slice(), solo: opts.solo, isHost: opts.isHost, link: opts.link, onExit: opts.onExit, onRestart: opts.onRestart });
    this.canvas = opts.canvas;
    this.quality = opts.quality || 'medium';
    this.dragLook = false;
    const T0 = performance.now();
    this.map = buildMap();
    this.cols = new ColliderSet(this.map.colliders);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    this.prMax = Math.min(window.devicePixelRatio || 1, PR_MAX[this.quality] || 1);
    this.pr = this.prMax;
    this.renderer.setPixelRatio(this.pr);
    this.perf = { frames: 0, time: 0, fps: 0, good: 0, cool: 0, backoff: 8, lastDrop: -99, clock: 0 };
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070c');
    this.scene.fog = new THREE.FogExp2('#0b1120', 0.021);
    this.camera = new THREE.PerspectiveCamera(74, 1, 0.08, 700);
    this.camera.rotation.order = 'YXZ';
    // 조명
    this.hemi = new THREE.HemisphereLight('#3a4a70', '#0b0d12', 0.75);
    this.scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight('#9fb4e8', 0.55);
    this.moonLight.position.set(-45, 60, -70);
    this.scene.add(this.moonLight);
    this.flash = new THREE.SpotLight('#fff4de', 0, 45, 0.5, 0.6, 1.35);
    this.flash.castShadow = this.quality !== 'low';
    this.flash.shadow.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
    this.flash.shadow.camera.near = 0.3;
    this.flash.shadow.camera.far = 40;
    this.flash.shadow.bias = -0.0008;
    this.scene.add(this.flash, this.flash.target);
    const T1 = performance.now();
    this.world = new World(this.scene, this.map, { quality: this.quality });
    console.info(`[lastboat] map ${(T1 - T0).toFixed(0)}ms, world ${(performance.now() - T1).toFixed(0)}ms`);
    this.zombies = new ZombieRenderer(this.scene);
    this.fx = new Effects(this.scene);
    this.view = new ViewModel();
    this.hud = new Hud();
    this.mateModel = this.solo ? null : new Survivor(this.scene, 1 - this.slot, this.names[1 - this.slot] || '동료');
    this.player = new Player(this);
    const st = this.map.starts[this.slot] || this.map.starts[0];
    this.player.reset(st[0], st[1], this.map.startYaw);
    this.snaps = [];
    // 받은 스냅샷을 일정한 속도로 재생하는 시계 (방장은 같은 컴퓨터라 버퍼가 작다)
    this.snapPlay = new Playout({ min: this.isHost ? 0.04 : 0.07, max: 0.45 });
    // 방장 화면의 동료: 동료가 보낸 위치를 직접 버퍼에 쌓아 부드럽게
    this.mateBuf = [];
    this.matePlay = new Playout({ min: 0.06, max: 0.45 });
    this.zombieView = [];
    this.me = null;
    this.mate = null;
    this.worldState = null;
    this.ended = null;
    this.kills = 0;
    this.runTime = 0;
    this.finaleLeft = -1;
    this.boatT = -1;
    this.region = 0;
    this.groanT = 0;
    this.distantT = 15;
    this.heartT = 0;
    this.stateT = 0;
    this.seq = 0;
    this.link.setHandlers({ snapshot: (s) => this.onSnapshot(s), events: (list) => this.onEvents(list), mate: (st, now) => this.onMateState(st, now) });
    this.resize();
    // 셰이더를 미리 만들어 둔다 (처음 보는 물건·첫 총소리 때 멈칫하지 않게)
    try {
      this.renderer.compile(this.scene, this.camera);
      this.renderer.compile(this.view.scene, this.view.camera);
    } catch (err) {
      console.warn(err);
    }
    this.perfEl = document.getElementById('perf');
    this.perfOn = false;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    audio.unlock();
    audio.ambient(0);
    this.last = performance.now();
    this.running = true;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.view.resize(w / h);
  }

  setEnabled(on) {
    this.player.enabled = on;
    // 혼자 할 때는 메뉴가 열리면 멈춘다
    if (this.solo && this.link.worker) this.link.worker.postMessage({ type: 'pause', on: !on });
    if (!on) {
      this.player.keys.clear();
      this.player.mouse.L = false;
      this.player.releaseUse();
    }
  }

  request(req) {
    this.link.request(req);
  }

  eye() {
    return [this.player.x, this.player.eyeHeight(), this.player.z];
  }

  forward() {
    const p = this.player;
    return [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)];
  }

  /** 총알: 벽과 좀비 중 먼저 맞는 것 */
  raycastShot(o, d, range) {
    const wall = this.cols.raycast(o[0], o[1], o[2], d[0], d[1], d[2], range, F.SHOT);
    let best = wall ? { kind: 'wall', t: wall.t } : null;
    let bestT = wall ? wall.t : range;
    const hl = Math.hypot(d[0], d[2]);
    for (const z of this.zombieView) {
      if (z.state === 4) continue;
      const cx = z.x - o[0];
      const cz = z.z - o[2];
      if (Math.abs(cx) > bestT + 1 || Math.abs(cz) > bestT + 1) continue;
      const s = z.scale || 1;
      // 머리 (구)
      const hy = 1.62 * s - o[1];
      const tc = cx * d[0] + hy * d[1] + cz * d[2];
      if (tc > 0 && tc < bestT) {
        const dd = cx * cx + hy * hy + cz * cz - tc * tc;
        if (dd < 0.18 * 0.18) {
          const th = tc - Math.sqrt(0.18 * 0.18 - dd);
          if (th < bestT) {
            bestT = th;
            best = { kind: 'zombie', id: z.id, head: true, t: th };
          }
        }
      }
      // 몸통 (세운 원기둥)
      if (hl > 1e-6) {
        const ux = d[0] / hl;
        const uz = d[2] / hl;
        const proj = cx * ux + cz * uz;
        const perp2 = cx * cx + cz * cz - proj * proj;
        const r = 0.3 * s;
        if (perp2 < r * r && proj > 0) {
          const tIn = (proj - Math.sqrt(r * r - perp2)) / hl;
          const y = o[1] + d[1] * tIn;
          if (tIn > 0 && tIn < bestT && y > 0.05 && y < 1.48 * s) {
            bestT = tIn;
            best = { kind: 'zombie', id: z.id, head: false, t: tIn };
          }
        }
      }
    }
    if (!best) return null;
    best.point = [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t];
    return best;
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const e = this.eye();
    const dx = x - e[0];
    const dy = y - e[1];
    const dz = z - e[2];
    const d = Math.hypot(dx, dy, dz) || 1;
    const hit = this.cols.raycast(e[0], e[1], e[2], dx / d, dy / d, dz / d, d, F.SIGHT);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, visible: v.z < 1, occluded: !!hit };
  }

  teleport(to) {
    this.hud.fade(true);
    setTimeout(() => {
      this.player.x = to.x;
      this.player.z = to.z;
      this.player.yaw = to.yaw;
      this.player.pitch = 0;
      this.player.vx = this.player.vz = 0;
      setTimeout(() => this.hud.fade(false), 120);
    }, 260);
  }

  // ─── 네트워크/워커에서 온 것 ────────────────────────────────────────────────

  onSnapshot(s) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && (s.runId !== last.runId || s.tick < last.tick - 30)) {
      this.snaps = [];
      this.snapPlay.reset();
    } else if (last && s.tick <= last.tick) return;
    s.t = s.tick / SNAP_RATE;
    this.snapPlay.push(s.t, performance.now() / 1000);
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
    this.me = s.players[this.slot] || null;
    this.runTime = s.time;
    this.finaleLeft = s.finaleLeft;
    this.boatT = s.boatT;
  }

  /** 방장: 동료가 보낸 위치 (동료 컴퓨터 시각 포함) */
  onMateState(st, now) {
    if (!st.time) return;
    const t = st.time / 1000;
    const buf = this.mateBuf;
    const last = buf[buf.length - 1];
    if (last && t <= last.t) {
      if (t > last.t - 2) return; // 늦게 온 것
      buf.length = 0; // 동료가 새로고침함
      this.matePlay.reset();
    }
    this.matePlay.push(t, now);
    buf.push({ t, x: st.x, z: st.z, yaw: st.yaw, pitch: st.pitch });
    if (buf.length > 60) buf.shift();
  }

  interpolate() {
    const snaps = this.snaps;
    if (!snaps.length) return;
    const now = performance.now() / 1000;
    const pt = this.snapPlay.time(now);
    const br = bracket(snaps, pt ?? snaps[snaps.length - 1].t, 0.07);
    const { a, b } = br;
    const k = b ? Math.max(0, br.k) : 0;
    const kr = Math.min(1, k);
    const src = b || a;
    const amap = new Map(a.zombies.map((z) => [z.id, z]));
    const out = [];
    for (const zb of src.zombies) {
      const za = amap.get(zb.id);
      if (!za || !b) {
        out.push({ ...zb, scale: 0.93 + ((zb.variant * 13) % 10) / 70 });
        continue;
      }
      const dy = Math.atan2(Math.sin(zb.yaw - za.yaw), Math.cos(zb.yaw - za.yaw));
      out.push({
        id: zb.id, x: za.x + (zb.x - za.x) * k, z: za.z + (zb.z - za.z) * k, yaw: za.yaw + dy * kr,
        state: k < 0.5 && zb.state !== 4 ? za.state : zb.state, variant: zb.variant, speed: za.speed + (zb.speed - za.speed) * kr,
        flags: k < 0.5 ? za.flags : zb.flags, scale: 0.93 + ((zb.variant * 13) % 10) / 70,
      });
    }
    this.zombieView = out;
    // 동료
    if (!this.solo) {
      const ms = src.players[1 - this.slot];
      const ma = a.players[1 - this.slot];
      if (ms && ma && b) {
        const dy = Math.atan2(Math.sin(ms.yaw - ma.yaw), Math.cos(ms.yaw - ma.yaw));
        this.mate = { ...ms, x: ma.x + (ms.x - ma.x) * kr, z: ma.z + (ms.z - ma.z) * kr, yaw: ma.yaw + dy * kr, pitch: ma.pitch + (ms.pitch - ma.pitch) * kr };
      } else this.mate = ms ? { ...ms } : null;
      // 방장: 동료 위치는 동료가 직접 보낸 것을 재생 (시뮬레이션 틱에 맞춰 끊기지 않게)
      if (this.isHost && this.mate && this.mateBuf.length && now - this.matePlay.lastArrive < 1) {
        const r = bracket(this.mateBuf, this.matePlay.time(now), 0.1);
        if (r) {
          const m = this.mate;
          if (r.b) {
            const q = Math.max(0, r.k);
            const q1 = Math.min(1, q);
            const dy = Math.atan2(Math.sin(r.b.yaw - r.a.yaw), Math.cos(r.b.yaw - r.a.yaw));
            m.x = r.a.x + (r.b.x - r.a.x) * q;
            m.z = r.a.z + (r.b.z - r.a.z) * q;
            m.yaw = r.a.yaw + dy * q1;
            m.pitch = r.a.pitch + (r.b.pitch - r.a.pitch) * q1;
          } else Object.assign(m, { x: r.a.x, z: r.a.z, yaw: r.a.yaw, pitch: r.a.pitch });
        }
      }
      if (this.mate && this.snaps.length) this.mate.revive = this.snaps[this.snaps.length - 1].players[1 - this.slot]?.revive || 0;
    }
  }

  onEvents(list) {
    for (const ev of list) {
      try {
        this.onEvent(ev);
      } catch (err) {
        console.error('event', ev.type, err);
      }
    }
  }

  onEvent(ev) {
    const mine = ev.slot === this.slot;
    const p = this.player;
    switch (ev.type) {
      case 'world':
        this.applyWorld(ev.state);
        break;
      case 'run':
        this.newRun(ev);
        break;
      case 'objective':
        this.hud.objective(ev.id);
        audio.play('radio', { vol: 0.4 });
        break;
      case 'radio':
        this.hud.radio(ev.text, 10);
        audio.play('radio');
        break;
      case 'msg':
        if (mine) {
          this.hud.message(ev.text);
          if (/잠겨|안 한다|못/.test(ev.text)) audio.play('locked');
        }
        break;
      case 'grant':
        if (mine) p.grant(ev.what);
        break;
      case 'pickup':
        this.hud.toast(`${mine ? '내가' : `${this.names[ev.slot] || '동료'}가`} ${ev.label || '물건'}을 챙겼다`);
        audio.play('pickup');
        break;
      case 'door': {
        const d = this.map.doors.find((x) => x.id === ev.id);
        if (d) audio.play(d.kind === 'shutter' ? 'shutter' : d.kind === 'gate' ? 'gate' : 'door', { pos: [d.x, 1.5, d.z] });
        break;
      }
      case 'zhit':
        if (!mine) this.fx.blood(ev.x, ev.y, ev.z, ev.head ? 12 : 6, null, ev.head);
        break;
      case 'zdie':
        this.fx.bloodDecal(ev.x, ev.z, ev.head ? 1.4 : 1);
        audio.play('die', { pos: [ev.x, 1, ev.z], vol: 0.8 });
        if (mine) this.kills += 1;
        break;
      case 'zalert':
        audio.play('scream', { pos: [ev.x, 1.6, ev.z], reverb: 0.5 });
        break;
      case 'pdmg':
        if (mine) {
          let ang = null;
          if (ev.from) {
            const a = Math.atan2(ev.from[0] - p.x, ev.from[1] - p.z);
            ang = -(a - (p.yaw + Math.PI));
          }
          this.hud.hurt(ev.amount, ang);
          audio.play('hurt');
        } else if (this.mate) audio.play('thud', { pos: [this.mate.x, 1.2, this.mate.z], vol: 0.6 });
        break;
      case 'down':
        if (mine) this.hud.message('쓰러졌다! 권총으로 버텨라!', 4);
        else this.hud.message(`${this.names[ev.slot] || '동료'}가 쓰러졌다! 가까이 가서 E 를 꾹 눌러 일으켜라!`, 5);
        break;
      case 'revived':
        this.hud.message(mine ? '다시 일어났다.' : `${this.names[ev.slot] || '동료'}를 일으켜 세웠다.`);
        break;
      case 'healed':
        if (mine) this.hud.toast('치료했다');
        break;
      case 'shot':
        if (!mine && ev.o && ev.d) {
          const w = WEAPONS[ev.w] ? ev.w : 'pistol';
          audio.play(w, { pos: ev.o, reverb: 0.8, vol: 0.9 });
          this.fx.flashAt(ev.o[0] + ev.d[0] * 0.6, ev.o[1] - 0.1, ev.o[2] + ev.d[2] * 0.6);
          const hit = this.raycastShot(ev.o, ev.d, WEAPONS[w].range);
          const end = hit ? hit.point : ev.o.map((v, i) => v + ev.d[i] * 40);
          if (w !== 'shotgun') this.fx.tracer([ev.o[0] + ev.d[0] * 0.6, ev.o[1] - 0.12, ev.o[2] + ev.d[2] * 0.6], end);
        }
        break;
      case 'shove':
        if (!mine && this.mate) audio.play('shove', { pos: [this.mate.x, 1.2, this.mate.z] });
        break;
      case 'alarm':
        audio.alarm(true);
        this.hud.message(ev.tag === 'power' ? '경보가 울린다! 좀비 떼가 몰려온다!' : '정문 모터 소리가 요란하다… 몰려온다!', 5);
        break;
      case 'alarmEnd':
        audio.alarm(false);
        break;
      case 'mob':
      case 'horde':
        audio.play('mob', { vol: 0.9 });
        break;
      case 'power':
        audio.play('power');
        this.hud.message('전원이 돌아왔다! 멀리서 셔터 올라가는 소리가 들린다.', 5);
        break;
      case 'finale':
        audio.play('radio');
        this.hud.radio('…치직… 은하항, 여기는 구조선 하나호. 생존자 확인. 3분 뒤 부두에 댄다. 버텨라… 치직…', 10);
        break;
      case 'boat':
        audio.play('horn', { vol: 1 });
        if (ev.state === 'docked') this.hud.message('배가 닿았다! 부두 끝으로 가라!', 5);
        break;
      case 'wipe':
        this.onWipe(ev);
        break;
      case 'escape':
        this.onEscape(ev);
        break;
      default:
    }
  }

  applyWorld(ws) {
    const prev = this.worldState;
    this.worldState = ws;
    if (ws.names) this.names = ws.names.slice();
    for (const [id, d] of Object.entries(ws.doors)) {
      this.cols.setFlags(id, d.open ? 0 : F.ALL);
      this.world.setDoor(id, d.open);
    }
    this.world.setItems(ws.items);
    this.world.setFlags({ ...ws.flags, radio: !!ws.finale });
    if (!prev || prev.objective !== ws.objective) this.hud.objective(ws.objective, !!prev);
    if (!ws.cres) audio.alarm(false);
  }

  newRun(ev) {
    this.ended = null;
    this.hud.hideEnd();
    this.kills = 0;
    const st = this.map.starts[this.slot] || this.map.starts[0];
    this.player.reset(st[0], st[1], this.map.startYaw);
    this.snaps = [];
    this.snapPlay.reset();
    this.fx.decals.count = 0;
    this.fx.decalN = 0;
    audio.alarm(false);
    audio.ambient(0);
    this.region = 0;
    if (ev.attempts > 1) this.hud.message(`처음부터 다시 — ${ev.attempts}번째 시도`, 4);
    this.hud.fade(false);
  }

  onWipe(ev) {
    this.ended = 'wipe';
    audio.alarm(false);
    const who = ev.slot === this.slot ? '당신이' : `${this.names[ev.slot] || '동료'}가`;
    this.hud.endScreen(`<div class="end wipe"><h2>전멸</h2><p>${esc(who)} 쓰러져 일어나지 못했다.</p>
      <p class="stats">버틴 시간 ${fmtTime(ev.time)} · 처치 ${ev.kills} · ${ev.attempts}번째 시도</p>
      <p class="sm">잠시 뒤 처음부터 다시 시작합니다…</p></div>`);
  }

  onEscape(ev) {
    this.ended = 'escape';
    audio.alarm(false);
    this.setEnabled(false);
    document.exitPointerLock?.();
    const rows = (ev.perPlayer || []).map((p) => `<li>${esc(p.name)} — 처치 ${p.kills}</li>`).join('');
    this.hud.endScreen(`<div class="end win"><h2>탈출 성공!</h2><p>새벽 5시, 마지막 배가 은하항을 떠났다.</p>
      <p class="stats">걸린 시간 ${fmtTime(ev.time)} · 총 처치 ${ev.kills} · ${ev.attempts}번째 시도에서 성공</p><ul>${rows}</ul>
      <div class="acts">${this.isHost ? '<button class="btn primary" id="end-again">처음부터 다시</button>' : ''}<button class="btn" id="end-exit">나가기</button></div></div>`);
    document.getElementById('end-again')?.addEventListener('click', () => this.onRestart?.());
    document.getElementById('end-exit')?.addEventListener('click', () => this.onExit?.());
  }

  // ─── 매 프레임 ─────────────────────────────────────────────────────────────

  frame(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const raw = (now - this.last) / 1000;
    const dt = Math.min(0.05, Math.max(0.001, raw));
    this.last = now;
    this.adaptResolution(raw);
    const t = now / 1000;
    const p = this.player;
    p.update(dt);
    // 내 상태 보내기: 방장은 매 프레임(같은 컴퓨터의 워커로), 동료는 초당 30번 고르게
    this.stateT -= dt;
    if (this.isHost || this.stateT <= 0) {
      this.stateT = this.isHost ? 0 : Math.max(-0.05, this.stateT) + 1 / 30;
      this.link.sendState({ slot: this.slot, x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, flags: p.flags(), weapon: p.weaponId(), seq: this.seq++, time: performance.now() });
    }
    this.interpolate();
    // 지하/지상 전환
    const region = p.z > UNDERGROUND_Z ? 1 : 0;
    if (region !== this.region) {
      this.region = region;
      audio.ambient(region);
      this.scene.fog.density = region ? 0.04 : 0.021;
      this.scene.fog.color.set(region ? '#050608' : '#0b1120');
      this.hemi.intensity = region ? 0.22 : 0.75;
      this.moonLight.intensity = region ? 0 : 0.55;
      this.view.setAmbient(region ? 0.3 : 1);
    }
    // 카메라와 손전등
    const eyeY = p.eyeHeight();
    this.camera.position.set(p.x, eyeY, p.z);
    this.camera.rotation.set(p.pitch, p.yaw, p.downed ? 0.35 : 0);
    const f = this.forward();
    this.flash.position.set(p.x + Math.cos(p.yaw) * 0.18, eyeY - 0.2, p.z - Math.sin(p.yaw) * 0.18);
    this.flash.target.position.set(p.x + f[0] * 10, eyeY + f[1] * 10, p.z + f[2] * 10);
    this.flash.intensity = p.flash && this.me?.status !== 2 ? 42 : 0;
    // 세상
    const cam = { x: p.x, y: eyeY, z: p.z };
    this.world.update(dt, t, this.camera.position);
    this.world.updateBoat(this.boatT);
    this.zombies.update(this.zombieView, dt, t);
    if (this.mateModel) this.mateModel.update(this.mate && this.mate.conn ? this.mate : null, dt, t);
    this.fx.update(dt);
    this.hud.update(dt, this);
    audio.setListener(p.x, eyeY, p.z, f[0], f[2]);
    this.ambientSounds(dt, cam);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    if (this.me?.status !== 2) this.renderer.render(this.view.scene, this.view.camera);
    if (this.perfOn) this.updatePerf();
  }

  /**
   * 프레임이 모자라면 해상도를 조금씩 내리고, 넉넉하면 다시 올린다.
   * (그래픽 카드가 약한 컴퓨터에서 끊김 없이 돌게. 오르내림이 반복되면 올리는 간격을 늘린다)
   */
  adaptResolution(raw) {
    const P = this.perf;
    if (raw > 0 && raw < 2) P.show = P.show ? P.show * 0.95 + raw * 0.05 : raw; // 표시용
    // 탭 전환·메뉴·한 번 멈칫한 것은 빼고 잰다 (느린 프레임이 계속되면 그건 센다)
    P.slowRun = raw > 0.25 ? (P.slowRun || 0) + 1 : 0;
    if (!(raw > 0) || raw > 2 || (raw > 0.25 && P.slowRun < 3) || !this.player.enabled) return;
    P.frames++;
    P.time += raw;
    if (P.time < 1) return;
    P.fps = P.frames / P.time;
    P.clock += P.time;
    P.frames = 0;
    P.time = 0;
    P.cool = Math.max(0, P.cool - 1);
    let next = this.pr;
    if (P.fps < 45 && this.pr > PR_MIN) {
      next = Math.max(PR_MIN, this.pr * 0.85);
      if (P.clock - P.lastDrop < 20) P.backoff = Math.min(120, P.backoff * 2);
      P.lastDrop = P.clock;
      P.cool = P.backoff;
      P.good = 0;
    } else if (P.fps > 56 && this.pr < this.prMax) {
      P.good++;
      if (P.good >= 4 && P.cool <= 0) {
        next = Math.min(this.prMax, this.pr * 1.1);
        P.good = 0;
      }
    } else P.good = 0;
    if (Math.abs(next - this.pr) > 0.01) {
      this.pr = next;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }

  togglePerf() {
    this.perfOn = !this.perfOn;
    this.perfEl?.classList.toggle('hidden', !this.perfOn);
    if (this.perfOn) this.updatePerf(true);
  }

  updatePerf(force = false) {
    const now = performance.now();
    if (!force && now - (this.perfT || 0) < 500) return;
    this.perfT = now;
    const parts = [`FPS ${this.perf.show ? Math.round(1 / this.perf.show) : '-'}`, `해상도 ${Math.round((this.pr / (window.devicePixelRatio || 1)) * 100)}%`];
    const st = this.link.stats?.();
    if (st) {
      parts.push(st.direct ? '직접 연결' : '서버 경유');
      parts.push(st.rtt >= 0 ? `핑 ${Math.round(st.rtt)}ms` : '핑 -');
      parts.push(`버퍼 ${Math.round(this.snapPlay.buffer() * 1000)}ms`);
    }
    parts.push(`좀비 ${this.zombieView.length}`);
    if (this.perfEl) this.perfEl.textContent = parts.join(' · ');
  }

  ambientSounds(dt, cam) {
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = 0.35 + Math.random() * 0.5;
      const near = this.zombieView.filter((z) => z.state !== 4 && Math.abs(z.x - cam.x) < 28 && Math.abs(z.z - cam.z) < 28);
      if (near.length) {
        const z = near[Math.floor(Math.random() * near.length)];
        const chase = z.state === 2 || z.state === 3;
        if (Math.random() < (chase ? 0.7 : 0.25)) audio.play('groan', { pos: [z.x, 1.6, z.z], vol: chase ? 1 : 0.6 });
      }
    }
    this.distantT -= dt;
    if (this.distantT <= 0) {
      this.distantT = 18 + Math.random() * 30;
      if (this.region === 0) audio.distant();
    }
    const me = this.me;
    if (me && me.status === 0 && me.hp < 30) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.9;
        audio.play('heart', { vol: 0.8 });
      }
    }
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.player.dispose();
    audio.stopAll();
    this.renderer.dispose();
  }
}
