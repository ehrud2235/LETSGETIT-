// 방장(또는 혼자 하기)의 시뮬레이션 워커. 30Hz 로 돌리고 스냅샷·사건을 메인으로 보낸다.
import { Sim, DT } from '../shared/sim.js';

let sim = null;
let running = false;
let acc = 0;
let last = 0;
let paused = false;

function flush() {
  const ev = sim.drainEvents();
  if (ev.length) self.postMessage({ type: 'ev', list: ev });
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'start':
        sim = new Sim({ players: m.players, difficulty: m.difficulty, seed: m.seed, peace: !!m.peace });
        running = true;
        acc = 0;
        last = performance.now();
        self.postMessage({ type: 'ready' });
        flush();
        {
          const snap = sim.snapshot();
          self.postMessage({ type: 'snap', buf: snap, tick: sim.tick }, [snap]);
        }
        loop();
        break;
      case 'pstate':
        sim?.setPlayerState(m.slot, m.st);
        break;
      case 'req':
        sim?.request(m.slot, m.req);
        break;
      case 'conn':
        if (sim) {
          sim.setConnected(m.slot, m.on);
          if (m.name) sim.setName(m.slot, m.name);
          sim.emitWorld();
        }
        break;
      case 'pause':
        paused = !!m.on;
        last = performance.now();
        break;
      case 'resync':
        sim?.emitWorld();
        break;
      case 'stop':
        running = false;
        sim = null;
        break;
      default:
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};

function loop() {
  if (!running || !sim) return;
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  if (paused) acc = 0;
  let n = 0;
  while (acc >= DT && n < 5) {
    sim.step();
    acc -= DT;
    n++;
    const snap = sim.snapshot();
    self.postMessage({ type: 'snap', buf: snap, tick: sim.tick }, [snap]);
    flush();
  }
  setTimeout(loop, 6);
}
