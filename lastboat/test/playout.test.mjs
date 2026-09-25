// 지터 버퍼: 패킷이 들쭉날쭉·몰려서 와도 재생은 매끄럽게, 끊김(데이터 없음)은 드물게.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Playout, bracket } from '../public/js/shared/playout.js';

/** 보낸 쪽 30Hz, 전송 지연 = base + 지터. 화면은 60fps 로 재생 시각을 묻는다. */
function run({ jitter = 0, burst = 0, base = 0.08, seconds = 20, seed = 7, send = 1 / 30 }) {
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const P = new Playout({ min: 0.07, max: 0.45 });
  const arrivals = [];
  for (let st = 0; st < seconds; st += send) {
    let at = st + base + rnd() * jitter;
    // 몰려오기: 받는 쪽(또는 전달하는 쪽)이 burst 초마다 한꺼번에 처리
    if (burst) at = Math.ceil(at / burst) * burst;
    arrivals.push([at, st]);
  }
  arrivals.sort((a, b) => a[0] - b[0]);
  const have = [];
  let i = 0;
  let starved = 0;
  let frames = 0;
  let maxStep = 0;
  let prev = null;
  for (let now = 0; now < seconds + base; now += 1 / 60) {
    while (i < arrivals.length && arrivals[i][0] <= now) {
      const st = arrivals[i][1];
      P.push(st, now);
      have.push({ t: st });
      i++;
    }
    const pt = P.time(now);
    if (pt === null || now < 3) continue; // 처음 3초는 적응 시간
    frames++;
    if (pt > have[have.length - 1].t) starved++;
    if (prev !== null) maxStep = Math.max(maxStep, Math.abs(pt - prev - 1 / 60));
    prev = pt;
  }
  return { starvedRatio: starved / frames, maxStep, delay: P.buffer() };
}

test('고른 연결: 버퍼가 작고 끊김이 없다', () => {
  const r = run({ jitter: 0.004 });
  assert.equal(r.starvedRatio, 0);
  assert.ok(r.delay < 0.1, `delay ${r.delay}`);
});

test('들쭉날쭉한 연결(±80ms): 버퍼를 늘려 거의 끊기지 않는다', () => {
  const r = run({ jitter: 0.08 });
  assert.ok(r.starvedRatio < 0.02, `starved ${r.starvedRatio}`);
  assert.ok(r.delay > 0.1 && r.delay <= 0.45, `delay ${r.delay}`);
});

test('몰려오는 패킷(방장 화면이 20fps): 재생 속도는 고르게', () => {
  const r = run({ jitter: 0.01, burst: 0.05, send: 1 / 15 });
  assert.ok(r.starvedRatio < 0.02, `starved ${r.starvedRatio}`);
  // 한 프레임에 재생 시각이 튀는 정도 (끊김·되감기 없음)
  assert.ok(r.maxStep < 0.01, `step ${r.maxStep}`);
});

test('보낸 쪽이 처음부터 다시 시작하면 버퍼도 새로', () => {
  const P = new Playout();
  for (let k = 0; k < 60; k++) P.push(100 + k / 30, k / 30);
  P.push(0, 2.1);
  assert.equal(P.newest, 0);
});

test('bracket: 사이 찾기와 짧은 외삽', () => {
  const L = [{ t: 0 }, { t: 1 }, { t: 2 }];
  assert.deepEqual(bracket(L, 0.5), { a: L[0], b: L[1], k: 0.5 });
  assert.deepEqual(bracket(L, 1.5), { a: L[1], b: L[2], k: 0.5 });
  assert.equal(bracket(L, -1).b, null);
  const ex = bracket(L, 5, 0.1);
  assert.equal(ex.a, L[1]);
  assert.ok(Math.abs(ex.k - 1.1) < 1e-9);
});
