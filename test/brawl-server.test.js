'use strict';
// 물렁 난투 방 서버: 대기실 규칙, 경기 시작, 스냅샷·입력 중계와 그 검증, 재접속.
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createGameServer } = require('../server');

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/brawl-ws`);
  const inbox = [];
  const bins = [];
  const waiters = [];
  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      bins.push(Buffer.from(raw));
      return;
    }
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
    bins,
    ready: new Promise((r) => ws.once('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    sendBin: (buf) => ws.send(buf),
    wait(pred, { fresh = true, timeout = 2000 } = {}) {
      if (!fresh) {
        const found = [...inbox].reverse().find(pred);
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

const lobby = (m) => m.t === 'lobby';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 입력 패킷: [1][개수] + 사람마다 [슬롯][mx][mz][btn][탭 6개] */
function inputPacket(slot) {
  const b = Buffer.alloc(12);
  b[0] = 1;
  b[1] = 1;
  b[2] = slot;
  b[3] = 127;
  return b;
}

test('대기실 → 경기 시작 → 스냅샷/입력 중계 → 경기 끝 → 재접속', async (t) => {
  const srv = createGameServer();
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  const { port } = srv.server.address();
  t.after(() => new Promise((r) => srv.close(r)));

  const host = client(port);
  await host.ready;
  const hostLobby = host.wait(lobby);
  host.send({ t: 'create', name: '  방장님  ', devices: ['kbA'] });
  const joined = await host.wait((m) => m.t === 'joined', { fresh: false });
  assert.match(joined.code, /^[A-HJ-NP-Z2-9]{5}$/);
  let st = (await hostLobby).room;
  assert.equal(st.hostId, joined.id);
  assert.equal(st.slots[0].name, '방장님');
  assert.equal(st.slots[0].owner, joined.id);

  // 없는 방
  const stray = client(port);
  await stray.ready;
  stray.send({ t: 'join', code: 'ZZZZZ', name: 'x' });
  assert.equal((await stray.wait((m) => m.t === 'error')).msg.includes('없어요'), true);
  stray.close();

  const guest = client(port);
  await guest.ready;
  guest.send({ t: 'join', code: joined.code.toLowerCase(), name: '손님' });
  const gJoined = await guest.wait((m) => m.t === 'joined');
  st = (await guest.wait(lobby, { fresh: false })).room;
  assert.equal(st.slots[1].owner, gJoined.id);
  assert.equal(st.you, gJoined.id);

  // 손님은 방장 권한이 없다
  guest.send({ t: 'addBot' });
  guest.send({ t: 'setMap', mapId: 'factory' });
  guest.send({ t: 'setChar', slot: 0, charId: 'dandap' });
  await sleep(150);
  // 방장: 봇 추가, 맵·승수 설정 / 손님: 자기 캐릭터 변경
  host.send({ t: 'addBot', level: 3 });
  host.send({ t: 'setMap', mapId: 'pitch' });
  host.send({ t: 'setWins', n: 2 });
  host.send({ t: 'setMap', mapId: 'nowhere' });
  guest.send({ t: 'setChar', slot: 1, charId: 'leedeoksu' });
  await sleep(200);
  st = [...host.inbox].reverse().find(lobby).room;
  assert.equal(st.settings.mapId, 'pitch');
  assert.equal(st.settings.winsNeeded, 2);
  assert.equal(st.slots[0].charId !== 'dandap', true);
  assert.equal(st.slots[1].charId, 'leedeoksu');
  assert.equal(st.slots[2].bot, true);
  assert.equal(st.slots[2].botLevel, 3);
  assert.equal(st.slots.filter(Boolean).length, 3);

  // 경기 시작 (방장만)
  guest.send({ t: 'start' });
  await sleep(100);
  assert.equal(guest.inbox.some((m) => m.t === 'start'), false);
  const gStart = guest.wait((m) => m.t === 'start');
  host.send({ t: 'start' });
  const start = await gStart;
  assert.equal(start.match.mapId, 'pitch');
  assert.equal(start.match.hostId, joined.id);
  assert.equal(start.match.slots[1].owner, gJoined.id);
  const matchLobby = await guest.wait((m) => lobby(m) && m.room.phase === 'match', { fresh: false });
  assert.deepEqual(matchLobby.room.match.slots, start.match.slots); // 새로고침한 사람이 경기에 다시 들어올 수 있게

  // 경기 중에는 새 사람이 못 들어온다
  const late = client(port);
  await late.ready;
  late.send({ t: 'join', code: joined.code, name: '늦은' });
  assert.match((await late.wait((m) => m.t === 'error')).msg, /진행 중/);
  late.close();

  // 스냅샷: 방장 → 손님
  const snap = Buffer.from([2, 9, 9, 9, 9]);
  host.sendBin(snap);
  await sleep(100);
  assert.equal(guest.bins.length, 1);
  assert.deepEqual(guest.bins[0], snap);
  // 손님이 보낸 스냅샷은 무시
  guest.sendBin(Buffer.from([2, 1, 1]));
  await sleep(100);
  assert.equal(host.bins.length, 0);

  // 입력: 자기 슬롯만 방장에게 전달
  guest.sendBin(inputPacket(1));
  guest.sendBin(inputPacket(0)); // 방장 자리 → 버림
  guest.sendBin(inputPacket(2)); // 봇 자리 → 버림
  await sleep(150);
  assert.equal(host.bins.length, 1);
  assert.equal(host.bins[0][2], 1);

  // 직접 연결(WebRTC)이 된 사람에게는 서버가 스냅샷을 중계하지 않는다
  host.send({ t: 'relay', ids: [] });
  await sleep(50);
  host.sendBin(snap);
  await sleep(100);
  assert.equal(guest.bins.length, 1);
  host.send({ t: 'relay', ids: [gJoined.id] });
  await sleep(50);
  host.sendBin(snap);
  await sleep(100);
  assert.equal(guest.bins.length, 2);

  // WebRTC 신호 중계
  host.send({ t: 'rtc', to: gJoined.id, data: { sdp: { type: 'offer', sdp: 'x' } } });
  const rtc = await guest.wait((m) => m.t === 'rtc');
  assert.equal(rtc.from, joined.id);

  // 이벤트 중계
  host.send({ t: 'ev', list: [{ type: 'hit', slot: 1 }] });
  assert.equal((await guest.wait((m) => m.t === 'ev')).list[0].type, 'hit');

  // 경기 끝 → 모두 대기실
  const gEnd = guest.wait((m) => m.t === 'matchEnd');
  host.send({ t: 'matchEnd', result: { winner: 0, scores: { 0: 2 } } });
  assert.equal((await gEnd).result.winner, 0);
  const back = await guest.wait((m) => lobby(m) && m.room.phase === 'lobby', { fresh: false });
  assert.equal(back.room.match, null);

  // 끊겼다가 토큰으로 재접속
  guest.close();
  const peerOff = await host.wait((m) => m.t === 'peer' && !m.online);
  assert.equal(peerOff.id, gJoined.id);
  const again = client(port);
  await again.ready;
  again.send({ t: 'resume', code: joined.code, token: gJoined.token });
  const re = await again.wait((m) => m.t === 'joined');
  assert.equal(re.id, gJoined.id);
  assert.equal(re.resumed, true);
  const reLobby = await again.wait(lobby, { fresh: false });
  assert.equal(reLobby.room.slots[1].owner, gJoined.id);
  assert.equal((await host.wait((m) => m.t === 'peer' && m.online)).id, gJoined.id);

  // 틀린 토큰
  const bad = client(port);
  await bad.ready;
  bad.send({ t: 'resume', code: joined.code, token: 'nope' });
  await bad.wait((m) => m.t === 'resumeFailed');
  bad.close();

  // 방장이 봇을 빼고, 손님이 나가면 자리도 빠진다
  host.send({ t: 'removeSlot', slot: 2 });
  again.send({ t: 'leave' });
  await sleep(200);
  st = [...host.inbox].reverse().find(lobby).room;
  assert.equal(st.slots.filter(Boolean).length, 1);
  assert.equal(st.clients.length, 1);
  again.close();
  host.close();
});

test('방이 차면 더 못 들어오고, 입력 패킷 모양이 틀리면 버린다', async (t) => {
  const srv = createGameServer();
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  const { port } = srv.server.address();
  t.after(() => new Promise((r) => srv.close(r)));
  const host = client(port);
  await host.ready;
  host.send({ t: 'create', name: 'A', devices: ['kbA', 'kbB'] });
  const joined = await host.wait((m) => m.t === 'joined');
  host.send({ t: 'addBot' });
  const g = client(port);
  await g.ready;
  g.send({ t: 'join', code: joined.code, name: 'B' });
  await g.wait((m) => m.t === 'joined');
  const full = client(port);
  await full.ready;
  full.send({ t: 'join', code: joined.code, name: 'C' });
  assert.match((await full.wait((m) => m.t === 'error')).msg, /가득/);
  full.close();

  host.send({ t: 'start' });
  await g.wait((m) => m.t === 'start');
  g.sendBin(Buffer.from([1, 1, 3, 0])); // 길이가 틀림
  g.sendBin(Buffer.from([1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])); // 개수와 길이가 안 맞음
  await sleep(150);
  assert.equal(host.bins.length, 0);
  g.close();
  host.close();
});
