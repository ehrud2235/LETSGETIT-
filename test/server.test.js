'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createGameServer } = require('../server');
const { SOLUTION } = require('../game/logic');

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    inbox.push(m);
    for (const w of [...waiters]) {
      if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m);
      }
    }
  });
  return {
    ws,
    inbox,
    ready: new Promise((r) => ws.once('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    act: (action) => ws.send(JSON.stringify({ t: 'act', action })),
    // 이미 받은 메시지 중 조건에 맞는 것이 없으면, 새로 올 때까지 기다린다
    wait(pred, { fresh = false, timeout = 2000 } = {}) {
      if (!fresh) {
        const found = inbox.find(pred);
        if (found) return Promise.resolve(found);
      }
      const origin = new Error('timeout waiting for message');
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => reject(origin), timeout);
      });
    },
    close: () => ws.close(),
  };
}

const outputs = (m) => (m.t === 'state' ? m.outputs : []);

test('방 만들기 → 초대코드 참가 → 재접속 → 끝까지 탈출', async (t) => {
  const srv = createGameServer();
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  const { port } = srv.server.address();
  t.after(() => new Promise((r) => srv.close(r)));

  const host = client(port);
  await host.ready;
  host.send({ t: 'create', nick: '  호스트  ' });
  const joined = await host.wait((m) => m.t === 'joined');
  assert.match(joined.code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(joined.nick, '호스트');

  const guest = client(port);
  await guest.ready;
  guest.send({ t: 'join', code: 'ZZZZZ', nick: '손님' });
  const err = await guest.wait((m) => m.t === 'error');
  assert.match(err.msg, /없어요/);

  guest.send({ t: 'join', code: joined.code.toLowerCase(), nick: '손님' });
  const gJoined = await guest.wait((m) => m.t === 'joined');
  const lobby = await host.wait((m) => m.t === 'lobby' && m.players.length === 2);
  assert.equal(lobby.isHost, true);

  const third = client(port);
  await third.ready;
  third.send({ t: 'join', code: joined.code, nick: '셋째' });
  assert.match((await third.wait((m) => m.t === 'error')).msg, /가득/);
  third.close();

  guest.send({ t: 'start' }); // 방장이 아니면 무시된다
  host.send({ t: 'start' });
  const hs = await host.wait((m) => m.t === 'start');
  const gs = await guest.wait((m) => m.t === 'start');
  assert.notEqual(hs.role, gs.role);
  assert.ok(hs.prologue.length > 20);

  // 역할별로 정리
  const byRole = { [hs.role]: host, [gs.role]: guest };
  const A = byRole.A;
  const B = byRole.B;

  // 각자 자기 방의 view 만 받는다
  assert.equal(hs.view.role, hs.role);
  assert.equal(gs.view.role, gs.role);

  // 채팅 전달
  A.send({ t: 'chat', text: '<b>안녕</b>' });
  const chat = await B.wait((m) => m.t === 'chat');
  assert.equal(chat.text, '<b>안녕</b>');
  assert.equal(chat.mine, false);

  // A 스위치 → B 에게 이벤트
  const evP = B.wait((m) => outputs(m).some((o) => o.kind === 'event'), { fresh: true });
  A.act({ a: 'click', target: 'switch' });
  const ev = await evP;
  assert.equal(ev.view.lit, true);
  const litP = A.wait((m) => m.t === 'state' && m.view.lit, { fresh: true });
  B.act({ a: 'click', target: 'switch' });
  await litP;

  // B 연결 끊김 → A 에게 알림 → 토큰으로 재접속하면 방 상태와 기록이 돌아온다
  const bToken = (B === guest ? gJoined : joined).token;
  const offP = A.wait((m) => m.t === 'partner' && m.partner && !m.partner.online, { fresh: true });
  B.close();
  const off = await offP;
  assert.equal(off.partner.online, false);

  const B2 = client(port);
  await B2.ready;
  const onlineP = A.wait((m) => m.t === 'partner' && m.partner.online, { fresh: true });
  B2.send({ t: 'resume', code: joined.code, token: bToken });
  const resumed = await B2.wait((m) => m.t === 'resume');
  assert.equal(resumed.role, 'B');
  assert.equal(resumed.view.lit, true);
  assert.ok(resumed.log.some((e) => e.type === 'chat' && e.text === '<b>안녕</b>'));
  await onlineP;

  // 나머지 퍼즐 풀기
  const steps = [
    [B2, { a: 'clock', h: SOLUTION.CLOCK_TARGET.h, m: SOLUTION.CLOCK_TARGET.m }],
    [A, { a: 'click', target: 'nightstand' }],
    [A, { a: 'click', target: 'mirror', item: 'water' }],
    [B2, { a: 'click', target: 'plant', item: 'water' }],
    [A, { a: 'click', target: 'plant' }],
    [A, { a: 'click', target: 'mirror', item: 'smallKey' }],
    [B2, { a: 'click', target: 'box', item: 'smallKey' }],
    [A, { a: 'code', target: 'drawer', code: SOLUTION.DRAWER_CODE }],
    [A, { a: 'click', target: 'mirror', item: 'crank' }],
    [B2, { a: 'combine', item: 'crank', with: 'musicBox' }],
    [A, { a: 'radio', freq: SOLUTION.RADIO_TARGET }],
    [A, { a: 'code', target: 'door', code: SOLUTION.DOOR_CODE }],
    [B2, { a: 'click', target: 'door', item: 'doorKey' }],
  ];
  // 액션 하나마다 서버는 두 사람 모두에게 state 를 보낸다. 둘 다 받을 때까지 기다려야 순서가 꼬이지 않는다.
  for (const [who, action] of steps) {
    const both = [A, B2].map((c) => c.wait((m) => m.t === 'state', { fresh: true }));
    who.act(action);
    await Promise.all(both);
  }
  const readyState = B2.inbox.filter((m) => m.t === 'state').at(-1);
  assert.equal(readyState.view.doorReady, true);

  const endA = A.wait((m) => outputs(m).some((o) => o.kind === 'ending'), { fresh: true });
  const endB = B2.wait((m) => outputs(m).some((o) => o.kind === 'ending'), { fresh: true });
  A.act({ a: 'pull' });
  B2.act({ a: 'pull' });
  const [ea, eb] = await Promise.all([endA, endB]);
  const endingA = outputs(ea).find((o) => o.kind === 'ending');
  const endingB = outputs(eb).find((o) => o.kind === 'ending');
  assert.equal(endingA.pages.at(-1).type, 'credits');
  assert.deepEqual(Object.keys(endingA.views).sort(), ['A', 'B']);
  assert.notDeepEqual(endingA.pages[0], endingB.pages[0], '엔딩 첫 장면은 역할마다 다르다');

  // 다시 하기 → 같은 멤버로 대기실
  // 방장이 B 였다면 재접속한 B2 가 방장의 연결이다
  const hostNow = hs.role === 'B' ? B2 : A;
  const backP = B2.wait((m) => m.t === 'lobby', { fresh: true });
  hostNow.send({ t: 'restart' });
  const back = await backP;
  assert.equal(back.players.length, 2);
  assert.equal(back.status, 'lobby');

  A.close();
  B2.close();
  host.close();
});

test('정적 파일 제공과 경로 보호', async (t) => {
  const srv = createGameServer();
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  const { port } = srv.server.address();
  t.after(() => new Promise((r) => srv.close(r)));
  const base = `http://127.0.0.1:${port}`;

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /맞은편/);
  assert.equal((await fetch(`${base}/js/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/nope.txt`)).status, 404);
  const traversal = await fetch(`${base}/..%2fserver.js`);
  assert.notEqual(traversal.status, 200);
});
