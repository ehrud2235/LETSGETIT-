'use strict';
// 마지막 배 서버: 정적 파일, 2인 방(만들기·참가·출발), 방장↔동료 전달, 재접속, 나가기.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('ws');
const { createLastBoatServer } = require('../server');

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const bins = [];
  const waiters = [];
  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      const b = Buffer.from(raw);
      bins.push(b);
      for (const w of [...waiters]) {
        if (w.bin) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(b);
        }
      }
      return;
    }
    const m = JSON.parse(raw);
    inbox.push(m);
    for (const w of [...waiters]) {
      if (!w.bin && w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  const waitFor = (w, timeout) => {
    const origin = new Error('timeout waiting for message');
    return new Promise((resolve, reject) => {
      w.resolve = resolve;
      waiters.push(w);
      setTimeout(() => reject(origin), timeout).unref();
    });
  };
  return {
    ws,
    inbox,
    bins,
    ready: new Promise((r) => ws.once('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    sendBin: (buf) => ws.send(buf),
    wait(pred, { fresh = true, timeout = 2000 } = {}) {
      if (!fresh) {
        const found = [...inbox].reverse().find(pred);
        if (found) return Promise.resolve(found);
      }
      return waitFor({ pred }, timeout);
    },
    waitBin: (timeout = 2000) => waitFor({ bin: true }, timeout),
    closed: () => new Promise((r) => (ws.readyState === 3 ? r() : ws.once('close', r))),
    close: () => ws.close(),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function withServer(fn) {
  const app = createLastBoatServer();
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const opened = [];
  const mk = async () => {
    const c = client(port);
    opened.push(c);
    await c.ready;
    return c;
  };
  try {
    await fn({ port, app, mk });
  } finally {
    for (const c of opened) c.ws.terminate();
    await new Promise((r) => app.close(r));
  }
}

/** 방장이 방을 만들고 동료가 들어온 상태 */
async function pair(mk) {
  const host = await mk();
  host.send({ t: 'create', name: '민수', difficulty: 'hard' });
  const hj = await host.wait((m) => m.t === 'joined');
  const guest = await mk();
  guest.send({ t: 'join', code: hj.code.toLowerCase(), name: '  지 은  ' });
  const gj = await guest.wait((m) => m.t === 'joined');
  await host.wait((m) => m.t === 'lobby' && m.room.names[1]);
  return { host, guest, code: hj.code, hostToken: hj.token, guestToken: gj.token };
}

async function started(mk) {
  const p = await pair(mk);
  p.host.send({ t: 'start' });
  const [hs, gs] = await Promise.all([p.host.wait((m) => m.t === 'start'), p.guest.wait((m) => m.t === 'start')]);
  return { ...p, hs, gs };
}

test('정적 파일: 첫 화면, 게임 코드, three.js, 건강 확인, 경로 탈출 차단', async () => {
  await withServer(async ({ port }) => {
    const index = await get(port, '/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /text\/html/);
    assert.match(index.body.toString(), /마지막 배/);

    const sim = await get(port, '/js/shared/sim.js');
    assert.equal(sim.status, 200);
    assert.match(sim.headers['content-type'], /javascript/);

    const three = await get(port, '/vendor/three/three.module.js', { 'Accept-Encoding': 'gzip' });
    assert.equal(three.status, 200);
    assert.equal(three.headers['content-encoding'], 'gzip');
    assert.match(three.headers['cache-control'], /max-age/);

    const addon = await get(port, '/vendor/three/addons/utils/BufferGeometryUtils.js');
    assert.equal(addon.status, 200);

    const again = await get(port, '/js/shared/sim.js', { 'If-None-Match': sim.headers.etag });
    assert.equal(again.status, 304);

    assert.equal((await get(port, '/healthz')).body.toString(), 'ok');
    assert.equal((await get(port, '/nope.js')).status, 404);
    assert.notEqual((await get(port, '/..%2f..%2fserver.js')).status, 200);
    assert.notEqual((await get(port, '/vendor/three/addons/..%2f..%2f..%2fpackage.json')).status, 200);
  });
});

test('다른 경로로는 웹소켓이 붙지 않는다', async () => {
  await withServer(async ({ port }) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/other`);
    const err = await new Promise((r) => {
      ws.once('error', () => r(true));
      ws.once('open', () => r(false));
    });
    assert.equal(err, true);
  });
});

test('방 만들기 → 참가 → 대기실 정보, 초대코드는 대소문자 무시', async () => {
  await withServer(async ({ mk, app }) => {
    const { host, guest, code } = await pair(mk);
    assert.match(code, /^[A-Z2-9]{5}$/);
    assert.equal(app.rooms.size, 1);
    const hl = await host.wait((m) => m.t === 'lobby', { fresh: false });
    assert.deepEqual(hl.room.names, ['민수', '지 은']);
    assert.equal(hl.room.you, 'host');
    assert.equal(hl.room.difficulty, 'hard');
    assert.equal(hl.room.guestOnline, true);
    const gl = await guest.wait((m) => m.t === 'lobby', { fresh: false });
    assert.equal(gl.room.you, 'guest');
    assert.ok(host.inbox.some((m) => m.t === 'peer' && m.online && m.name === '지 은'));
  });
});

test('없는 방, 가득 찬 방에는 들어갈 수 없다', async () => {
  await withServer(async ({ mk }) => {
    const { code } = await pair(mk);
    const third = await mk();
    third.send({ t: 'join', code, name: '셋째' });
    assert.match((await third.wait((m) => m.t === 'error')).msg, /가득/);
    const lost = await mk();
    lost.send({ t: 'join', code: 'ZZZZZ', name: '길잃음' });
    assert.match((await lost.wait((m) => m.t === 'error')).msg, /없어요/);
  });
});

test('난이도는 대기실에서 방장만 바꾼다', async () => {
  await withServer(async ({ mk }) => {
    const { host, guest } = await pair(mk);
    guest.send({ t: 'difficulty', value: 'easy' });
    host.send({ t: 'difficulty', value: 'bogus' });
    await sleep(80);
    host.send({ t: 'difficulty', value: 'easy' });
    const l = await guest.wait((m) => m.t === 'lobby' && m.room.difficulty === 'easy');
    assert.equal(l.room.difficulty, 'easy');
  });
});

test('출발: 동료가 있어야 하고, 둘 다 같은 시드·난이도·이름을 받는다', async () => {
  await withServer(async ({ mk }) => {
    const solo = await mk();
    solo.send({ t: 'create', name: '혼자' });
    await solo.wait((m) => m.t === 'joined');
    solo.send({ t: 'start' });
    assert.match((await solo.wait((m) => m.t === 'error')).msg, /동료/);

    const { host, guest, hs, gs } = await started(mk);
    assert.equal(hs.seed, gs.seed);
    assert.equal(hs.difficulty, 'hard');
    assert.deepEqual(hs.names, ['민수', '지 은']);
    assert.equal(hs.you, 'host');
    assert.equal(gs.you, 'guest');
    const l = await guest.wait((m) => m.t === 'lobby' && m.room.phase === 'game', { fresh: false });
    assert.equal(l.room.game.seed, hs.seed);

    // 동료는 출발시킬 수 없고, 출발한 방에는 새로 못 들어온다
    guest.send({ t: 'start' });
    const late = await mk();
    late.send({ t: 'join', code: l.room.code, name: '늦음' });
    assert.ok(/가득|출발/.test((await late.wait((m) => m.t === 'error')).msg));
    host.send({ t: 'end' });
    await guest.wait((m) => m.t === 'lobby' && m.room.phase === 'lobby');
  });
});

test('게임 중 방장↔동료 JSON 전달과 바이너리 스냅샷 전달', async () => {
  await withServer(async ({ mk }) => {
    const { host, guest } = await started(mk);
    host.send({ t: 'to', data: { ev: [{ t: 'door', id: 3, open: true }] } });
    const f1 = await guest.wait((m) => m.t === 'from');
    assert.deepEqual(f1.data, { ev: [{ t: 'door', id: 3, open: true }] });
    guest.send({ t: 'to', data: { req: { t: 'use', id: 7 } } });
    const f2 = await host.wait((m) => m.t === 'from');
    assert.deepEqual(f2.data, { req: { t: 'use', id: 7 } });
    // 객체가 아닌 data 는 버린다
    guest.send({ t: 'to', data: 'x' });

    const snap = Buffer.from([1, 9, 8, 7, 6]);
    host.sendBin(snap);
    assert.deepEqual(await guest.waitBin(), snap);
    const ps = Buffer.from([2, 1, 2, 3]);
    guest.sendBin(ps);
    assert.deepEqual(await host.waitBin(), ps);
    // 너무 짧은 바이너리는 버린다
    host.sendBin(Buffer.from([1]));
    await sleep(80);
    assert.equal(guest.bins.length, 1);
    assert.equal(host.inbox.filter((m) => m.t === 'from').length, 1);

    // WebRTC 신호 전달
    host.send({ t: 'rtc', data: { sdp: 'offer' } });
    assert.deepEqual((await guest.wait((m) => m.t === 'rtc')).data, { sdp: 'offer' });
  });
});

test('대기실에서는 바이너리를 전달하지 않는다', async () => {
  await withServer(async ({ mk }) => {
    const { host, guest } = await pair(mk);
    host.sendBin(Buffer.from([1, 2, 3]));
    await sleep(100);
    assert.equal(guest.bins.length, 0);
  });
});

test('끊겼다가 토큰으로 다시 들어오면 역할과 게임 정보가 유지된다', async () => {
  await withServer(async ({ mk }) => {
    const { host, guest, code, guestToken, hs } = await started(mk);
    guest.ws.terminate();
    const off = await host.wait((m) => m.t === 'peer' && !m.online);
    assert.equal(off.name, '지 은');

    const back = await mk();
    back.send({ t: 'resume', code, token: guestToken });
    const j = await back.wait((m) => m.t === 'joined');
    assert.equal(j.role, 'guest');
    assert.equal(j.resumed, true);
    const l = await back.wait((m) => m.t === 'lobby', { fresh: false });
    assert.equal(l.room.phase, 'game');
    assert.equal(l.room.game.seed, hs.seed);
    await host.wait((m) => m.t === 'peer' && m.online);

    // 다시 들어온 뒤에도 전달이 된다
    host.send({ t: 'to', data: { ev: [] } });
    await back.wait((m) => m.t === 'from');

    const bad = await mk();
    bad.send({ t: 'resume', code, token: 'nope' });
    await bad.wait((m) => m.t === 'resumeFailed');
  });
});

test('같은 토큰으로 두 번 붙으면 예전 연결은 끊긴다', async () => {
  await withServer(async ({ mk }) => {
    const { host, code, hostToken } = await pair(mk);
    const again = await mk();
    again.send({ t: 'resume', code, token: hostToken });
    assert.equal((await again.wait((m) => m.t === 'joined')).role, 'host');
    await host.closed();
  });
});

test('동료가 나가면 방장은 대기실로, 방장이 나가면 방이 닫힌다', async () => {
  await withServer(async ({ mk, app }) => {
    const { host, guest } = await started(mk);
    guest.send({ t: 'leave' });
    const l = await host.wait((m) => m.t === 'lobby' && m.notice);
    assert.equal(l.room.phase, 'lobby');
    assert.equal(l.room.names[1], null);
    assert.match(l.notice, /나갔어요/);

    const g2 = await mk();
    g2.send({ t: 'join', code: l.room.code, name: '새동료' });
    await g2.wait((m) => m.t === 'joined');
    host.send({ t: 'leave' });
    await g2.wait((m) => m.t === 'closed');
    assert.equal(app.rooms.size, 0);
  });
});
