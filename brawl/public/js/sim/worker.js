// 시뮬레이션 워커: 물리는 여기서 60Hz 로 돌고, 화면·네트워크는 메인 스레드가 맡는다.
// (탭이 뒤로 가도 워커 타이머는 거의 느려지지 않아서 방장이 잠깐 다른 창을 봐도 경기가 멈추지 않는다)
import { Sim } from './sim.js';
import { DT } from './fighter.js';
import { encodeSnapshot } from './snapshot.js';

let sim = null;
let running = false;
let acc = 0;
let last = 0;
let tick = 0;
let net = false;
let paused = false;
const buf = new Float32Array(16384);

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'start') {
      running = false;
      if (sim) sim.destroy();
      sim = await Sim.create(m.opts);
      net = !!m.net;
      tick = 0;
      acc = 0;
      paused = false;
      last = performance.now();
      running = true;
      self.postMessage({ type: 'ready' });
      loop();
    } else if (m.type === 'input') {
      if (sim) sim.setInput(m.slot, m.input);
    } else if (m.type === 'bot') {
      if (sim) sim.setBotControl(m.slot, m.on);
    } else if (m.type === 'pause') {
      paused = !!m.on;
      last = performance.now();
    } else if (m.type === 'stop') {
      running = false;
      if (sim) sim.destroy();
      sim = null;
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};

function loop() {
  if (!running || !sim) return;
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  if (paused) acc = 0;
  let stepped = 0;
  while (acc >= DT && stepped < 6) {
    sim.step();
    acc -= DT;
    stepped += 1;
    tick += 1;
    if (net && tick % 2 === 0) {
      const n = sim.writeTransforms(buf);
      const snap = encodeSnapshot({
        tick, time: sim.time, phase: sim.phase, phaseT: sim.phaseT || 0, roundTime: sim.roundTime, round: sim.round,
        statuses: sim.statusList(), transforms: buf, nBodies: n / 7,
      });
      self.postMessage({ type: 'snap', buf: snap }, [snap]);
    }
  }
  if (stepped) {
    const n = sim.writeTransforms(buf);
    const transforms = buf.slice(0, n);
    self.postMessage({
      type: 'frame',
      tick,
      time: sim.time,
      phase: sim.phase,
      phaseT: sim.phaseT || 0,
      roundTime: sim.roundTime,
      round: sim.round,
      mapId: sim.map.id,
      scores: sim.scores,
      statuses: sim.statusList(),
      events: sim.drainEvents(),
    }, []);
    self.postMessage({ type: 'transforms', transforms }, [transforms.buffer]);
  }
  setTimeout(loop, 4);
}
