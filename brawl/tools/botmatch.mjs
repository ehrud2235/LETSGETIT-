// 봇 4명이 한 경기를 끝까지: node brawl/tools/botmatch.mjs [맵] [최대 분]
import { Sim } from '../public/js/sim/sim.js';

const mapId = process.argv[2] || 'octagon';
const maxMin = Number(process.argv[3] || 6);
const chars = ['wakgood', 'pungsin', 'dopamine', 'leedeoksu', 'bimil', 'haeruseok', 'roentgenium', 'dandap'];
const off = Number(process.argv[4] || 0);
const sim = await Sim.create({
  mapId,
  seed: 7 + off,
  winsNeeded: 3,
  players: [0, 1, 2, 3].map((i) => ({ slot: i, charId: chars[(i + off) % 8], name: chars[(i + off) % 8], isBot: true, botLevel: 2 })),
});
const counts = {};
const t0 = performance.now();
let steps = 0;
let roundStartT = 0;
const lines = [];
while (sim.phase !== 'matchEnd' && steps < maxMin * 60 * 60) {
  sim.step();
  steps++;
  for (const ev of sim.drainEvents()) {
    counts[ev.type] = (counts[ev.type] || 0) + 1;
    if (ev.type === 'roundStart') roundStartT = steps / 60;
    if (['out', 'roundEnd', 'matchEnd', 'suddenDeath', 'submitWin', 'takedown', 'suplex'].includes(ev.type)) {
      const who = ev.slot !== undefined ? sim.fighters.find((f) => f.slot === ev.slot)?.charId : '';
      lines.push(`[${(steps / 60).toFixed(1)}s r${sim.round} +${(steps / 60 - roundStartT).toFixed(1)}] ${ev.type} ${who || ''} ${ev.by !== undefined && ev.by >= 0 ? 'by ' + sim.fighters.find((f) => f.slot === ev.by)?.charId : ''} ${ev.winner !== undefined ? 'winner=' + ev.winner : ''}`);
    }
  }
}
const ms = performance.now() - t0;
console.log(lines.join('\n'));
console.log('events:', JSON.stringify(counts));
console.log(`phase=${sim.phase} scores=${JSON.stringify(sim.scores)} simTime=${(steps / 60).toFixed(0)}s wall=${ms.toFixed(0)}ms (${(ms / steps).toFixed(2)}ms/step)`);
console.log('stats:', JSON.stringify(sim.statsSummary()));
