'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game/logic');

const texts = (outs) => outs.filter((o) => o.text).map((o) => o.text).join('\n');
const kinds = (outs) => outs.map((o) => o.kind);

function play(g, role, action, now) {
  return G.act(g, role, action, now);
}

test('두 방은 처음에 어둡고, 스위치는 맞은편 방의 불을 켠다', () => {
  const g = G.createGame(0);
  assert.equal(G.viewFor(g, 'A').lit, false);
  assert.equal(G.viewFor(g, 'B').lit, false);

  const dark = play(g, 'A', { a: 'click', target: 'clock' });
  assert.match(texts(dark.A), /어두워서/);

  const out = play(g, 'A', { a: 'click', target: 'switch' });
  assert.equal(g.light.A, false);
  assert.equal(g.light.B, true);
  assert.ok(kinds(out.B).includes('event'));

  play(g, 'B', { a: 'click', target: 'switch' });
  assert.equal(g.light.A, true);
});

test('시계를 맞추기 전에는 거울로 물건을 보낼 수 없다', () => {
  const g = G.createGame(0);
  play(g, 'A', { a: 'click', target: 'switch' });
  play(g, 'B', { a: 'click', target: 'switch' });
  play(g, 'A', { a: 'click', target: 'nightstand' });
  assert.deepEqual(g.inv.A, ['water']);
  play(g, 'A', { a: 'click', target: 'mirror', item: 'water' });
  assert.deepEqual(g.inv.A, ['water']);
  assert.deepEqual(g.inv.B, []);
});

test('틀린 코드와 12시간제 시각은 거부된다', () => {
  const g = G.createGame(0);
  play(g, 'A', { a: 'click', target: 'switch' });
  play(g, 'B', { a: 'click', target: 'switch' });
  const wrong = play(g, 'A', { a: 'code', target: 'door', code: '1140' });
  assert.equal(g.doorUnlocked.A, false);
  assert.match(texts(wrong.A), /오전이었을까/);
  play(g, 'A', { a: 'code', target: 'drawer', code: '1234' });
  assert.equal(g.drawerOpen, false);
});

test('B가 가진 적 없는 물건은 사용할 수 없다', () => {
  const g = G.createGame(0);
  play(g, 'A', { a: 'click', target: 'switch' });
  play(g, 'B', { a: 'click', target: 'switch' });
  play(g, 'B', { a: 'click', target: 'door', item: 'doorKey' });
  assert.equal(g.doorUnlocked.B, false);
});

test('야광별은 한 번 불이 켜진 뒤 어두워져야 보인다', () => {
  const g = G.createGame(0);
  const before = play(g, 'B', { a: 'click', target: 'ceiling' });
  assert.doesNotMatch(texts(before.B), /0 {2}3 {2}1 {2}4/);
  play(g, 'A', { a: 'click', target: 'switch' }); // B 불 켜짐
  play(g, 'A', { a: 'click', target: 'switch' }); // B 불 꺼짐
  assert.equal(G.viewFor(g, 'B').objects.stars, true);
  const after = play(g, 'B', { a: 'click', target: 'ceiling' });
  assert.match(texts(after.B), /0 {2}3 {2}1 {2}4/);
});

test('처음부터 끝까지 탈출할 수 있다', () => {
  const g = G.createGame(0);
  const { DRAWER_CODE, DOOR_CODE, RADIO_TARGET, CLOCK_TARGET } = G.SOLUTION;

  // 1. 불
  play(g, 'A', { a: 'click', target: 'switch' });
  play(g, 'B', { a: 'click', target: 'switch' });

  // 2. 시계
  play(g, 'B', { a: 'clock', h: 3, m: 15 });
  assert.equal(g.clocksSynced, false);
  play(g, 'B', { a: 'clock', h: CLOCK_TARGET.h, m: CLOCK_TARGET.m });
  assert.equal(g.clocksSynced, true);
  assert.equal(G.viewFor(g, 'A').objects.mirror, 'open');

  // 3. 물 → 새싹 → 꽃 → 별 열쇠 → 장난감 상자 → 오르골
  play(g, 'A', { a: 'click', target: 'nightstand' });
  play(g, 'A', { a: 'click', target: 'mirror', item: 'water' });
  assert.deepEqual(g.inv.B, ['water']);
  play(g, 'B', { a: 'click', target: 'plant', item: 'water' });
  assert.equal(G.viewFor(g, 'A').objects.plant, 'bloomKey');
  play(g, 'A', { a: 'click', target: 'plant' });
  assert.ok(g.inv.A.includes('smallKey'));
  play(g, 'A', { a: 'click', target: 'mirror', item: 'smallKey' });
  play(g, 'B', { a: 'click', target: 'box', item: 'smallKey' });
  assert.ok(g.inv.B.includes('musicBox'));

  // 4. 야광별 → 서랍 → 태엽
  play(g, 'A', { a: 'click', target: 'switch' }); // B 불 끄기
  play(g, 'B', { a: 'click', target: 'ceiling' });
  play(g, 'A', { a: 'code', target: 'drawer', code: DRAWER_CODE });
  assert.ok(g.inv.A.includes('crank') && g.inv.A.includes('diary'));
  play(g, 'A', { a: 'click', target: 'switch' }); // B 불 다시 켜기

  // 5. 태엽 + 오르골 → 커다란 열쇠
  play(g, 'A', { a: 'click', target: 'mirror', item: 'crank' });
  const music = play(g, 'B', { a: 'combine', item: 'musicBox', with: 'crank' });
  assert.ok(kinds(music.A).includes('music') && kinds(music.B).includes('music'));
  assert.ok(g.inv.B.includes('doorKey'));
  assert.equal(G.viewFor(g, 'A').objects.frame, 'photo');

  // 6. 라디오 → 뉴스 → 문 코드
  const radio = play(g, 'A', { a: 'radio', freq: RADIO_TARGET });
  assert.ok(radio.B.some((o) => o.kind === 'doc' && /11시 40분/.test(o.body)));
  play(g, 'A', { a: 'code', target: 'door', code: DOOR_CODE });
  play(g, 'B', { a: 'click', target: 'door', item: 'doorKey' });
  assert.equal(G.viewFor(g, 'A').doorReady, true);

  // 7. 혼자 당기면 안 열리고, 둘이 5초 안에 당기면 열린다
  play(g, 'A', { a: 'pull' }, 10_000);
  assert.equal(g.ended, false);
  const late = play(g, 'B', { a: 'pull' }, 10_000 + G.PULL_WINDOW_MS + 1);
  assert.equal(g.ended, false);
  assert.ok(kinds(late.A).includes('partnerPull'));
  const end = play(g, 'A', { a: 'pull' }, 10_000 + G.PULL_WINDOW_MS + 500);
  assert.equal(g.ended, true);
  assert.ok(kinds(end.A).includes('ending') && kinds(end.B).includes('ending'));

  const pages = G.endingFor(g, 'A', { A: '가', B: '나' });
  assert.equal(pages.at(-1).type, 'credits');
});

test('오르골은 새벽의 방에서 조립해도 열쇠가 나온다', () => {
  const g = G.createGame(0);
  Object.assign(g, { light: { A: true, B: true }, clocksSynced: true });
  g.inv.A = ['crank', 'musicBox'];
  play(g, 'A', { a: 'combine', item: 'crank', with: 'musicBox' });
  assert.deepEqual(g.inv.A, ['doorKey']);
  play(g, 'A', { a: 'click', target: 'door', item: 'doorKey' });
  assert.equal(g.doorUnlocked.A, false, '새벽의 방 문엔 열쇠 구멍이 없다');
});

test('힌트는 항상 문자열을 돌려준다', () => {
  const g = G.createGame(0);
  for (const role of G.ROLES) {
    const out = play(g, role, { a: 'hint' });
    assert.equal(out[role][0].kind, 'hint');
    assert.ok(out[role][0].text.length > 5);
  }
});
