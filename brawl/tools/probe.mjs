// 물리 튜닝용 측정 도구: node brawl/tools/probe.mjs [시나리오]
import { Sim } from '../public/js/sim/sim.js';
import { BTN } from '../public/js/sim/fighter.js';
import * as M from '../public/js/sim/math.js';

const scenario = process.argv[2] || 'stand';
const upY = (f) => M.qRotate(f.bodies.torso.rotation(), { x: 0, y: 1, z: 0 }).y;
const fmt = (v) => `(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`;

async function run() {
  const players = ['duel', 'grab', 'throw', 'tackle', 'suplex'].includes(scenario)
    ? [{ slot: 0, charId: 'wakgood', name: 'A' }, { slot: 1, charId: 'pungsin', name: 'B' }]
    : [{ slot: 0, charId: 'wakgood', name: 'A' }];
  const sim = await Sim.create({ mapId: process.argv[3] || 'octagon', players, seed: 1 });
  const A = sim.fighter(0);
  const B = sim.fighter(1);
  let taps = { jump: 0, handL: 0, handR: 0, kick: 0, head: 0, grapple: 0 };
  const t0 = performance.now();
  let minUp = 1;
  const log = [];
  for (let i = 0; i < 60 * 10; i++) {
    const t = i / 60;
    let inA = { mx: 0, mz: 0, btn: 0, taps };
    if (scenario === 'walk' && t > 3.2 && t < 6.2) inA = { mx: 0, mz: -1, btn: 0, taps };
    if (scenario === 'walk' && t >= 6.2 && t < 8) inA = { mx: 1, mz: 0, btn: BTN.SPRINT, taps };
    if (scenario === 'jump' && t > 3.5 && i % 90 === 0) { taps = { ...taps, jump: taps.jump + 1 }; inA = { ...inA, taps }; }
    if (scenario === 'duel' && t > 3.2) {
      // A 가 B 쪽으로 걸어가며 계속 주먹
      const d = M.sub(B.pos(), A.pos());
      const n = M.norm({ x: d.x, y: 0, z: d.z });
      const far = M.lenXZ(d) > 1.1;
      inA = { mx: far ? n.x : n.x * 0.2, mz: far ? n.z : n.z * 0.2, btn: 0, taps };
      if (!far && i % 20 === 0) { taps = { ...taps, [i % 40 === 0 ? 'handL' : 'handR']: taps[i % 40 === 0 ? 'handL' : 'handR'] + 1 }; inA.taps = taps; }
    }
    if (scenario === 'grab' || scenario === 'throw') {
      // A 가 B 에게 다가가 양손으로 잡는다. throw 면 들어 올려 던진다.
      const d = M.sub(B.pos(), A.pos());
      const n = M.norm({ x: d.x, y: 0, z: d.z });
      const far = M.lenXZ(d) > 0.95;
      let btn = t > 3.2 ? BTN.HAND_L | BTN.HAND_R : 0;
      if (scenario === 'throw' && t > 6 && t < 7.4) btn |= BTN.JUMP;
      if (scenario === 'throw' && t >= 7.4) btn = 0;
      inA = { mx: t > 3.2 && far ? n.x : 0, mz: t > 3.2 && far ? n.z : 0, btn, taps };
      if (scenario === 'throw' && t > 7 && t < 8) inA.mx = inA.mz = 0;
    }
    if (scenario === 'tackle' || scenario === 'suplex') {
      const d = M.sub(B.pos(), A.pos());
      const n = M.norm({ x: d.x, y: 0, z: d.z });
      const dd = M.lenXZ(d);
      let btn = 0;
      let mx = 0;
      let mz = 0;
      if (scenario === 'tackle') {
        if (t > 3.2 && t < 4.2 && dd > 1.8) { mx = n.x; mz = n.z; btn |= BTN.SPRINT; }
        if (t > 3.6 && dd < 2.2 && !A.grab && t < 4.6 && i % 6 === 0) { taps = { ...taps, grapple: taps.grapple + 1 }; }
        if (A.grab && A.grab.kind === 'mount' && A.grab.t > 0.6 && i % 6 === 0) taps = { ...taps, grapple: taps.grapple + 1 };
        if (A.grab && A.grab.kind === 'submit') btn |= BTN.GRAPPLE;
      } else {
        if (t > 3.2 && dd > 0.95) { mx = n.x; mz = n.z; }
        if (t > 3.2) btn |= BTN.HAND_L | BTN.HAND_R;
        if (t > 5.2 && t < 5.25) taps = { ...taps, grapple: taps.grapple + 1 };
      }
      inA = { mx, mz, btn, taps };
    }
    sim.setInput(0, inA);
    sim.step();
    if (sim.phase === 'fight' || t > 3) minUp = Math.min(minUp, upY(A));
    if (i % 30 === 0) {
      const s = `t=${t.toFixed(1)} A pel=${fmt(A.pos())} up=${upY(A).toFixed(2)} grd=${A.grounded ? 1 : 0} hands=${A.hands.L.mode[0]}${A.hands.R.mode[0]} lift=${A.lift ? 1 : 0} grab=${A.grab ? A.grab.kind + ':' + (A.grab.progress || 0).toFixed(2) : '-'} hp=${A.hp.toFixed(0)}` +
        (B ? ` | B pel=${fmt(B.pos())} up=${upY(B).toFixed(2)} hp=${B.hp.toFixed(0)} ko=${B.koT.toFixed(1)}` : '');
      log.push(s);
    }
    for (const ev of sim.drainEvents()) if (!['swing', 'jump'].includes(ev.type)) log.push(`   ev t=${t.toFixed(2)} ${ev.type} ${JSON.stringify({ ...ev, t: undefined, pos: undefined, type: undefined })}`);
  }
  const ms = performance.now() - t0;
  console.log(log.join('\n'));
  console.log(`minUp(after start)=${minUp.toFixed(2)}  sim 10s took ${ms.toFixed(0)}ms (${(ms / 600).toFixed(2)}ms/step)`);
}
run().catch((e) => { console.error(e); process.exit(1); });
