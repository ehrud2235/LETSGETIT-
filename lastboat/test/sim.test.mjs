// 마지막 배: 맵 경로, 좀비·목표·쓰러짐·전멸·탈출, 네트워크 형식
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../public/js/shared/map.js';
import { NavGrid } from '../public/js/shared/nav.js';
import { reachable, distTo } from '../public/js/shared/route.js';
import { Sim, DT, PS, ZS, FINALE_TIME } from '../public/js/shared/sim.js';
import { REVIVE_TIME } from '../public/js/shared/weapons.js';
import { MSG, encodeSnapshot, decodeSnapshot, encodePlayerState, decodePlayerState, encodePing, pongOf, pingTime } from '../public/js/shared/protocol.js';

const steps = (sim, sec) => { for (let i = 0; i < Math.round(sec / DT); i++) sim.step(); };
const place = (sim, slot, x, z) => { const p = sim.players[slot]; p.x = x; p.z = z; p.region = z > 380 ? 1 : 0; };

test('길은 순서대로만 열린다 (열쇠 → 뒷문 → 전원 → 지하철 → 정문)', () => {
  const map = buildMap();
  const nav = new NavGrid(map);
  for (const d of map.doors) if (!d.locked) nav.setDoor(d.id, false);
  const can = (from, to) => distTo(nav, reachable(nav, from), ...to) >= 0;
  const start = map.starts[0];
  assert.ok(can(start, [73.3, 153.8]), '열쇠');
  assert.ok(!can(start, [100, 124]), '뒷문 전에는 큰길 못 감');
  nav.setDoor('backGate', false);
  assert.ok(can(start, [100, 124]), '큰길');
  assert.ok(can(start, [221.8, 37]), '변전소 스위치');
  assert.ok(!can(start, [193, 94.2]), '셔터 전에는 역 안 못 감');
  nav.setDoor('stationShutter', false);
  assert.ok(can(start, [193, 94.2]), '역 계단');
  assert.ok(can([193, 403.5], [331, 394.5]), '지하철 터널 끝까지');
  assert.ok(can([309, 149.5], [290, 14.4]), '관제탑');
  assert.ok(!can([309, 149.5], [341.4, 175]), '정문 전에는 부두 못 감');
  nav.setDoor('portGate', false);
  assert.ok(can([309, 149.5], [356, 115]), '부두');
});

test('모든 아이템·쪽지·조작 장치 자리에 걸어갈 수 있다', () => {
  const map = buildMap();
  const nav = new NavGrid(map);
  for (const d of map.doors) nav.setDoor(d.id, false);
  const fromSurface = reachable(nav, map.starts[0]);
  const fromEast = reachable(nav, [309, 149.5]);
  const fromUnder = reachable(nav, [193, 403.5]);
  const ok = (x, z) => [fromSurface, fromEast, fromUnder].some((d) => distTo(nav, d, x, z, 4) >= 0);
  for (const it of map.items) for (const s of it.spots) assert.ok(ok(s[0], s[1]), `${it.id} ${s}`);
  for (const n of map.notes) assert.ok(ok(n.x, n.z) || ok(n.x + 0.6, n.z) || ok(n.x - 0.6, n.z) || ok(n.x, n.z + 0.6) || ok(n.x, n.z - 0.6), `note ${n.id}`);
  for (const i of map.interacts) assert.ok(ok(i.x, i.z) || ok(i.x - 0.8, i.z) || ok(i.x, i.z + 0.8), `interact ${i.id}`);
});

test('열쇠 → 뒷문 → 목표 갱신, 잠긴 문은 안내만', () => {
  const sim = new Sim({ players: [{ name: 'A' }], seed: 2, peace: true });
  place(sim, 0, 82.6, 199);
  sim.request(0, { r: 'use', id: 'backGate' });
  assert.equal(sim.doors.backGate.open, false);
  assert.ok(sim.drainEvents().some((e) => e.type === 'msg' && /관리사무소/.test(e.text)));
  const key = sim.items.officeKey;
  place(sim, 0, key.x + 0.5, key.z);
  sim.request(0, { r: 'use', id: 'officeKey' });
  assert.ok(sim.keys.has('officeKey'));
  place(sim, 0, 82.6, 199);
  sim.request(0, { r: 'use', id: 'backGate' });
  assert.equal(sim.doors.backGate.open, true);
  assert.equal(sim.objective, 'leftComplex');
  // 멀리서는 못 연다
  place(sim, 0, 10, 10);
  sim.request(0, { r: 'use', id: 'officeDoor' });
  assert.equal(sim.doors.officeDoor.open, false);
});

test('변전소 스위치: 셔터가 열리고 좀비 떼가 온다', () => {
  const sim = new Sim({ players: [{ name: 'A' }, { name: 'B' }], seed: 5 });
  place(sim, 0, 221, 37);
  place(sim, 1, 219, 38);
  steps(sim, 1);
  sim.request(0, { r: 'use', id: 'powerPanel' });
  assert.equal(sim.flags.power, true);
  assert.equal(sim.doors.stationShutter.open, true);
  assert.equal(sim.objective, 'powerOn');
  const before = sim.zombies.filter((z) => z.state === ZS.CHASE).length;
  steps(sim, 16);
  const chasing = sim.zombies.filter((z) => z.state === ZS.CHASE || z.state === ZS.ATTACK).length;
  assert.ok(chasing >= before + 8, `chasing ${before} → ${chasing}`);
});

test('쓰러지면 동료가 일으키고, 죽으면 둘 다 처음부터', () => {
  const sim = new Sim({ players: [{ name: 'A' }, { name: 'B' }], seed: 7, peace: true });
  place(sim, 0, 40, 200);
  place(sim, 1, 41, 200);
  sim.damagePlayer(sim.players[0], 150);
  assert.equal(sim.players[0].status, PS.DOWN);
  sim.request(1, { r: 'revive', target: 0, on: true });
  steps(sim, REVIVE_TIME + 0.3);
  assert.equal(sim.players[0].status, PS.OK);
  assert.equal(sim.players[0].hp, 30);
  // 다시 쓰러졌다가 피 흘려 죽음 → 전멸
  sim.damagePlayer(sim.players[0], 150);
  assert.equal(sim.players[0].status, PS.DOWN);
  steps(sim, sim.diff.bleed + 0.5);
  assert.equal(sim.ended, 'wipe');
  const events = sim.drainEvents();
  assert.ok(events.some((e) => e.type === 'wipe'));
  steps(sim, 7.5);
  assert.equal(sim.ended, null);
  assert.equal(sim.attempts, 2);
  assert.deepEqual([sim.players[0].x, sim.players[0].z], sim.map.starts[0]);
  assert.equal(sim.players[0].hp, 100);
  assert.equal(sim.doors.backGate.locked, true);
});

test('혼자면 쓰러지는 순간 끝, 세 번째 쓰러짐도 끝', () => {
  const solo = new Sim({ players: [{ name: 'A' }], seed: 1, peace: true });
  solo.damagePlayer(solo.players[0], 200);
  assert.equal(solo.players[0].status, PS.DEAD);
  assert.equal(solo.ended, 'wipe');
  const duo = new Sim({ players: [{ name: 'A' }, { name: 'B' }], seed: 1, peace: true });
  duo.players[0].downs = 2;
  duo.damagePlayer(duo.players[0], 200);
  assert.equal(duo.players[0].status, PS.DEAD);
});

test('좀비는 총에 맞아 죽고, 쫓아와서 문다', () => {
  const sim = new Sim({ players: [{ name: 'A' }], seed: 9 });
  place(sim, 0, 100, 124);
  const z = sim.spawnZombie(108, 124, ZS.IDLE);
  sim.request(0, { r: 'hits', list: [{ id: z.id, dmg: 30, head: false }] });
  assert.equal(z.state, ZS.CHASE);
  steps(sim, 3);
  const bitten = sim.players[0].hp < 100;
  assert.ok(bitten, `hp ${sim.players[0].hp}`);
  sim.request(0, { r: 'hits', list: [{ id: z.id, dmg: 100, head: true }] });
  assert.equal(z.state, ZS.DEAD);
  assert.equal(sim.kills, 1);
});

test('좀비는 벽을 돌아 흐름장을 따라 쫓아온다 (시장 골목)', () => {
  const sim = new Sim({ players: [{ name: 'A' }], seed: 11, peace: true });
  sim.forceOpen('backGate');
  place(sim, 0, 122, 199); // 파출소 앞 광장
  const z = sim.spawnZombie(86.25, 199, ZS.CHASE, 0); // 직선 36m, 골목으로 돌아가면 약 90m
  const d0 = Math.hypot(z.x - 122, z.z - 199);
  steps(sim, 25);
  const d1 = Math.hypot(z.x - 122, z.z - 199);
  assert.ok(d1 < 3, `${d0.toFixed(1)} → ${d1.toFixed(1)}`);
});

test('무전 → 3분 버티기 → 배 → 둘 다 배에 타면 탈출', () => {
  const sim = new Sim({ players: [{ name: 'A' }, { name: 'B' }], seed: 13, peace: true });
  sim.forceOpen('portGate');
  sim.flags.portGate = true;
  place(sim, 0, 341, 175);
  sim.request(0, { r: 'use', id: 'radio' });
  assert.ok(sim.finale);
  steps(sim, FINALE_TIME + 11);
  assert.equal(sim.boat.docked, true);
  assert.equal(sim.objective, 'boat');
  place(sim, 0, 356, 110);
  steps(sim, 1);
  assert.equal(sim.ended, null, '한 명만 타면 안 끝남');
  place(sim, 1, 356, 116);
  steps(sim, 1);
  assert.equal(sim.ended, 'escape');
});

test('스냅샷·플레이어 상태 이진 형식', () => {
  const buf = encodeSnapshot({
    tick: 999, runId: 3, time: 12.5, finaleLeft: -1, boatT: -1,
    players: [{ slot: 0, x: 123.45, z: 456.78, yaw: 2.5, pitch: -0.4, hp: 73.6, status: 1, bleed: 22.3, revive: 0.5, flags: 5, weapon: 2, downs: 1, conn: true, medkit: true }],
    zombies: [{ id: 42, x: 300.12, z: 10.5, yaw: -1, state: 2, variant: 17, speed: 4.8, flags: 6 }],
  });
  const s = decodeSnapshot(buf);
  assert.equal(s.tick, 999);
  assert.equal(s.runId, 3);
  assert.ok(Math.abs(s.players[0].x - 123.45) < 0.02 && Math.abs(s.players[0].z - 456.78) < 0.02);
  assert.equal(s.players[0].hp, 74);
  assert.equal(s.players[0].medkit, true);
  assert.equal(s.players[0].downs, 1);
  assert.equal(s.zombies[0].id, 42);
  assert.equal(s.zombies[0].variant, 17);
  assert.equal(s.zombies[0].state, 2);
  assert.ok(Math.abs(s.zombies[0].yaw + 1) < 0.03);
  const ps = decodePlayerState(encodePlayerState({ slot: 1, x: 10.5, z: 420.25, yaw: -3, pitch: 0.7, flags: 9, weapon: 1, seq: 70000, time: 123456789.7, inst: 4242 }));
  assert.equal(ps.slot, 1);
  assert.ok(Math.abs(ps.z - 420.25) < 0.02);
  assert.equal(ps.seq, 70000 & 0xffff);
  assert.equal(ps.time, 123456789);
  assert.equal(ps.inst, 4242);
  const ping = encodePing(4321.5);
  assert.equal(new Uint8Array(ping)[0], MSG.PING);
  const pong = pongOf(ping);
  assert.equal(new Uint8Array(pong)[0], MSG.PONG);
  assert.equal(pingTime(pong), 4321.5);
});

test('좀비 80마리 근처에서도 한 틱이 가볍다', () => {
  const sim = new Sim({ players: [{ name: 'A' }, { name: 'B' }], seed: 17 });
  place(sim, 0, 120, 120);
  place(sim, 1, 124, 120);
  for (let i = 0; i < 80; i++) sim.spawnZombie(100 + (i % 20) * 2, 110 + Math.floor(i / 20) * 5, ZS.CHASE, i % 2);
  const t0 = performance.now();
  steps(sim, 5);
  const ms = (performance.now() - t0) / Math.round(5 / DT);
  assert.ok(ms < 8, `${ms.toFixed(2)}ms/step`);
});
