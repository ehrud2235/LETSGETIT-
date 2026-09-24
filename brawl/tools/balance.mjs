// 캐릭터 밸런스: 슬롯을 돌려 가며 봇 경기를 여러 번 돌리고 라운드 승수를 센다
import { Sim } from '../public/js/sim/sim.js';

const chars = ['wakgood', 'pungsin', 'dopamine', 'leedeoksu', 'bimil', 'haeruseok', 'roentgenium', 'dandap'];
const maps = ['octagon', 'rooftop', 'factory', 'pitch'];
const wins = Object.fromEntries(chars.map((c) => [c, 0]));
const played = Object.fromEntries(chars.map((c) => [c, 0]));
const n = Number(process.argv[2] || 16);
for (let k = 0; k < n; k++) {
  const picks = [0, 1, 2, 3].map((i) => chars[(k * 3 + i * 2 + Math.floor(k / 4)) % 8]);
  const sim = await Sim.create({ mapId: maps[k % 4], seed: 100 + k, winsNeeded: 3, players: picks.map((c, i) => ({ slot: i, charId: c, name: c, isBot: true, botLevel: 2 })) });
  let steps = 0;
  while (sim.phase !== 'matchEnd' && steps < 8 * 3600) {
    sim.step();
    steps++;
    for (const ev of sim.drainEvents()) {
      if (ev.type === 'roundEnd') {
        for (const p of picks) played[p] += 1;
        if (ev.winner >= 0) wins[picks[ev.winner]] += 1;
      }
    }
  }
  sim.destroy();
}
for (const c of chars) console.log(`${c.padEnd(12)} 라운드 ${String(played[c]).padStart(3)} 승 ${String(wins[c]).padStart(3)}  승률 ${((wins[c] / Math.max(1, played[c])) * 100).toFixed(0)}%`);
