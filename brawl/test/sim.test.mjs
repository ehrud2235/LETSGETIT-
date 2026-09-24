// 물렁 난투 시뮬레이션: 서 있기, 맵마다 NaN 없이 돌아가기, 봇 경기 끝나기, 결정성, 네트워크 형식.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../public/js/sim/sim.js';
import { MAP_LIST } from '../public/js/sim/maps.js';
import { ROSTER, modsOf } from '../public/js/sim/roster.js';
import { encodeSnapshot, decodeSnapshot, encodeInputs, decodeInputs, lerpTransforms } from '../public/js/sim/snapshot.js';
import { qRotate } from '../public/js/sim/math.js';

const CHARS = ROSTER.map((c) => c.id);
const players = (n, bot, off = 0) => Array.from({ length: n }, (_, i) => ({ slot: i, charId: CHARS[(i + off) % CHARS.length], name: `p${i}`, isBot: bot, botLevel: 2 }));
const upY = (f) => qRotate(f.bodies.torso.rotation(), { x: 0, y: 1, z: 0 }).y;

function finite(sim) {
  const buf = new Float32Array(sim.transformCount());
  const n = sim.writeTransforms(buf);
  assert.equal(n, sim.transformCount());
  return buf.every(Number.isFinite);
}

test('패시브는 한 가지 능력만, 크지 않게', () => {
  assert.equal(ROSTER.length, 8);
  for (const c of ROSTER) {
    const mods = modsOf(c.id);
    for (const [k, v] of Object.entries(mods)) {
      assert.ok(v >= 0.7 && v <= 1.6, `${c.id}.${k}=${v}`);
    }
    assert.ok(Object.keys(c.mods).length <= 2, c.id);
    assert.ok(c.passive.name && c.passive.desc);
  }
});

test('모든 맵에서 네 명이 똑바로 서 있고, 봇끼리 싸워도 숫자가 망가지지 않는다', async () => {
  for (const def of MAP_LIST) {
    const sim = await Sim.create({ mapId: def.id, seed: 3, players: players(4, false) });
    for (let i = 0; i < 150; i++) sim.step(); // 카운트다운 동안 가만히
    for (const f of sim.fighters) {
      assert.ok(upY(f) > 0.9, `${def.id} ${f.charId} 기울어짐 ${upY(f).toFixed(2)}`);
      assert.ok(!f.out, `${def.id} ${f.charId} 떨어짐`);
    }
    for (const p of sim.players) sim.setBotControl(p.slot, true);
    for (let i = 0; i < 60 * 25; i++) sim.step();
    assert.ok(finite(sim), `${def.id} NaN`);
    assert.equal(sim.phase === 'fight' || sim.phase === 'roundEnd' || sim.phase === 'countdown', true);
    sim.destroy();
  }
});

test('봇 네 명 경기는 끝까지 가고, 우승자는 필요한 승수를 채운다', async () => {
  const sim = await Sim.create({ mapId: 'octagon', seed: 11, winsNeeded: 2, players: players(4, true, 2) });
  const seen = new Set();
  let end = null;
  for (let i = 0; i < 60 * 60 * 8 && !end; i++) {
    sim.step();
    for (const ev of sim.drainEvents()) {
      seen.add(ev.type);
      if (ev.type === 'matchEnd') end = ev;
    }
  }
  assert.ok(end, '8분 안에 경기가 안 끝남');
  assert.equal(end.scores[end.winner], 2);
  for (const t of ['roundStart', 'fight', 'hit', 'out', 'roundEnd']) assert.ok(seen.has(t), `${t} 이벤트 없음`);
  assert.ok(!seen.has('ko'), '기절(KO)은 없어야 한다');
  assert.equal(end.stats.length, 4);
  sim.destroy();
});

test('같은 시드와 같은 입력이면 같은 결과 (방장 재현성)', async () => {
  const run = async () => {
    const sim = await Sim.create({ mapId: 'rooftop', seed: 5, players: players(3, true) });
    for (let i = 0; i < 900; i++) sim.step();
    const buf = new Float32Array(sim.transformCount());
    sim.writeTransforms(buf);
    sim.destroy();
    return buf;
  };
  const a = await run();
  const b = await run();
  assert.deepEqual(a, b);
});

test('혼자면 연습 모드: 떨어져도 다시 나온다', async () => {
  const sim = await Sim.create({ mapId: 'octagon', seed: 1, players: players(1, false) });
  for (let i = 0; i < 200; i++) sim.step();
  assert.equal(sim.phase, 'fight');
  const f = sim.fighters[0];
  f.forEachBody((b) => b.setTranslation({ x: b.translation().x, y: b.translation().y - 30, z: b.translation().z }, true));
  let respawned = false;
  for (let i = 0; i < 60 * 4; i++) {
    sim.step();
    if (sim.drainEvents().some((e) => e.type === 'respawn')) respawned = true;
  }
  assert.ok(respawned);
  assert.ok(!sim.fighters[0].out);
  assert.equal(sim.phase, 'fight');
  sim.destroy();
});

test('걷기·주먹: 입력대로 움직이고 가까운 상대를 때리면 피해가 들어간다', async () => {
  const sim = await Sim.create({ mapId: 'octagon', seed: 2, players: players(2, false) });
  for (let i = 0; i < 190; i++) sim.step();
  const [a, b] = sim.fighters;
  const start = a.pos();
  // b 쪽으로 걸어가며 주먹 연타
  let taps = 0;
  for (let i = 0; i < 60 * 4; i++) {
    const d = { x: b.pos().x - a.pos().x, z: b.pos().z - a.pos().z };
    const l = Math.hypot(d.x, d.z) || 1;
    if (i % 12 === 0) taps += 1;
    sim.setInput(a.slot, { mx: d.x / l, mz: d.z / l, btn: 0, taps: { handL: taps, handR: taps, jump: 0, kick: 0, head: 0, grapple: 0 } });
    sim.step();
  }
  const moved = Math.hypot(a.pos().x - start.x, a.pos().z - start.z);
  assert.ok(moved > 1, `moved ${moved}`);
  assert.ok(a.stats.damageDealt > 5, `damage ${a.stats.damageDealt}`);
  sim.destroy();
});

test('% 가 높을수록 같은 공격에 더 멀리 날아가고, 맞기만 해서는 탈락하지 않는다', async () => {
  const sim = await Sim.create({ mapId: 'octagon', seed: 4, players: players(2, false) });
  for (let i = 0; i < 190; i++) sim.step();
  const f = sim.fighters[1];
  const speedAfter = (pct) => {
    f.pct = pct;
    f.forEachBody((b) => b.setLinvel({ x: 0, y: 0, z: 0 }, true));
    f.launch({ x: 1, y: 0, z: 0 }, 2, 'torso');
    const v = f.bodies.torso.linvel();
    return Math.hypot(v.x, v.z);
  };
  const low = speedAfter(0);
  const high = speedAfter(150);
  assert.ok(high > low * 2, `0%: ${low.toFixed(2)} 150%: ${high.toFixed(2)}`);
  // 아무리 맞아도 경기장 안에 있으면 살아 있다
  for (let i = 0; i < 40; i++) f.damage(25, sim.fighters[0]);
  for (let i = 0; i < 30; i++) sim.step();
  assert.equal(f.out, false);
  assert.ok(f.pct >= 999);
  sim.destroy();
});

test('여럿이면 떨어진 사람은 다시 나오지 않는다 (관전)', async () => {
  const sim = await Sim.create({ mapId: 'octagon', seed: 6, players: players(3, false) });
  for (let i = 0; i < 200; i++) sim.step();
  const f = sim.fighters[2];
  f.forEachBody((b) => b.setTranslation({ x: b.translation().x, y: b.translation().y - 30, z: b.translation().z }, true));
  const evs = [];
  for (let i = 0; i < 60 * 6; i++) {
    sim.step();
    evs.push(...sim.drainEvents());
  }
  assert.ok(evs.some((e) => e.type === 'out' && e.slot === 2));
  assert.ok(!evs.some((e) => e.type === 'respawn'));
  assert.equal(sim.fighter(2).out, true);
  assert.equal(sim.phase, 'fight'); // 두 명이 남아 있으니 계속
  sim.destroy();
});

test('스냅샷·입력 이진 형식 왕복', () => {
  const transforms = new Float32Array([1.234, -2.5, 3.001, 0, 0.7071, 0, 0.7071, -10, 0.5, 20, 0.5, 0.5, 0.5, 0.5]);
  const buf = encodeSnapshot({
    tick: 12345, time: 3.5, phase: 'fight', phaseT: 0, roundTime: 44.5, round: 3, nBodies: 2, transforms,
    statuses: [{ slot: 2, flags: 18, pct: 137.4, grab: 'submit', grabProgress: 0.25, victimOf: null, victimProgress: 0, escape: 3.3 }],
  });
  assert.equal(buf.byteLength, 22 + 9 + 2 * 14);
  const s = decodeSnapshot(buf);
  assert.equal(s.tick, 12345);
  assert.equal(s.phase, 'fight');
  assert.equal(s.round, 3);
  assert.equal(s.statuses[0].slot, 2);
  assert.equal(s.statuses[0].grab, 'submit');
  assert.equal(s.statuses[0].victimOf, null);
  assert.equal(s.statuses[0].pct, 137);
  for (let i = 0; i < transforms.length; i++) assert.ok(Math.abs(s.transforms[i] - transforms[i]) < 0.002, `i=${i}`);
  const mid = lerpTransforms(s.transforms, s.transforms, 0.5, new Float32Array(14));
  assert.ok(Math.abs(Math.hypot(mid[3], mid[4], mid[5], mid[6]) - 1) < 1e-4);

  const inp = encodeInputs([{ slot: 1, mx: -1, mz: 0.5, btn: 0b1010, taps: { jump: 3, handL: 300, handR: 0, kick: 1, head: 2, grapple: 255 } }]);
  assert.equal(inp.byteLength, 12);
  const [p] = decodeInputs(inp);
  assert.equal(p.slot, 1);
  assert.equal(p.mx, -1);
  assert.ok(Math.abs(p.mz - 0.5) < 0.01);
  assert.equal(p.btn, 10);
  assert.equal(p.taps.handL, 300 & 255);
  assert.equal(p.taps.grapple, 255);
});
