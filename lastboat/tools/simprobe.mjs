// 시뮬레이션 점검: node tools/simprobe.mjs
import { Sim, DT, ZS, PS } from '../public/js/shared/sim.js';

const sim = new Sim({ players: [{ name: 'A' }, { name: 'B' }], difficulty: 'normal', seed: 3 });
const count = () => {
  const s = [0, 0, 0, 0, 0];
  for (const z of sim.zombies) s[z.state]++;
  return `zombies=${sim.zombies.length} idle=${s[0]} wander=${s[1]} chase=${s[2]} atk=${s[3]} dead=${s[4]}`;
};
const run = (sec, label, fn) => {
  const t0 = performance.now();
  const evc = {};
  const steps = Math.round(sec / DT);
  for (let i = 0; i < steps; i++) {
    fn?.(i);
    sim.step();
    for (const e of sim.drainEvents()) evc[e.type] = (evc[e.type] || 0) + 1;
  }
  const ms = (performance.now() - t0) / steps;
  console.log(`[${label}] t=${sim.time.toFixed(1)} ${count()} hp=${sim.players.map((p) => `${p.hp.toFixed(0)}/${p.status}`).join(',')} ${ms.toFixed(3)}ms/step ev=${JSON.stringify(evc)}`);
};
run(10, 'start idle');
// 큰길로 순간이동해서 가만히 서 있기
for (const p of sim.players) Object.assign(p, { x: 100 + p.slot * 2, z: 118, region: 0 });
run(20, 'boulevard stand');
run(20, 'boulevard stand 2');
// 총소리
sim.request(0, { r: 'shot', w: 'rifle', o: [100, 1.5, 118], d: [1, 0, 0] });
run(10, 'after shot');
console.log('objective', sim.objective, 'ended', sim.ended, 'attempts', sim.attempts);
