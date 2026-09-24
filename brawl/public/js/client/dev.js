// 개발용: 브라우저에서 시뮬레이션을 돌리고 그대로 그린다. ?map=octagon&chars=wakgood,pungsin,...
import { Sim } from '../sim/sim.js';
import { GameRenderer } from './render.js';

const q = new URLSearchParams(location.search);
const mapId = q.get('map') || 'octagon';
const chars = (q.get('chars') || 'wakgood,pungsin,dopamine,leedeoksu').split(',');
const bots = q.has('bots');

const sim = await Sim.create({
  mapId,
  players: chars.map((c, i) => ({ slot: i, charId: c, name: c, isBot: bots })),
  seed: 1,
});
const view = new GameRenderer(document.getElementById('view'), { quality: q.get('q') || 'medium' });
const buf = new Float32Array(4096);
let round = -1;
let acc = 0;
let last = performance.now();
let paused = q.has('paused');

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt;
    while (acc >= 1 / 60) {
      sim.step();
      acc -= 1 / 60;
    }
  }
  if (round !== sim.round) {
    round = sim.round;
    view.setupRound(sim.map.id, sim.fighters.map((f) => ({ slot: f.slot, charId: f.charId })));
  }
  const n = sim.writeTransforms(buf);
  view.applyFrame(buf.subarray(0, n), sim.statusList());
  view.onEvents(sim.drainEvents());
  view.render(dt);
  document.getElementById('info').textContent = `${sim.map.id} r${sim.round} ${sim.phase} t=${sim.roundTime.toFixed(1)}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 자동 테스트용 조작 창구
window.__dev = {
  sim,
  view,
  step(n = 1) { for (let i = 0; i < n; i++) sim.step(); },
  pause(v = true) { paused = v; },
  input(slot, inp) { sim.setInput(slot, inp); },
};
