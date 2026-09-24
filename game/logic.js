'use strict';
/**
 * 맞은편 (THE OTHER SIDE) — 게임 규칙, 퍼즐 상태, 스토리 텍스트.
 *
 * 서버만 이 모듈을 사용한다. 클라이언트는 자기 역할(A: 새벽의 방 / B: 노을의 방)의
 * view 와 출력(outputs)만 받기 때문에, 상대 방의 텍스트나 정답을 미리 볼 수 없다.
 *
 * 스포일러 주의: 정답과 결말이 이 파일에 모두 들어 있다.
 */

const DRAWER_CODE = '0314';
const DOOR_CODE = '2340';
const RADIO_TARGET = 973; // 97.3MHz (0.1MHz 단위 정수)
const RADIO_MIN = 875;
const RADIO_MAX = 1080;
const CLOCK_TARGET = { h: 11, m: 40 };
const PULL_WINDOW_MS = 5000;

const ROLES = ['A', 'B'];
const other = (r) => (r === 'A' ? 'B' : 'A');

const ROOM_NAME = { A: '새벽의 방', B: '노을의 방' };

const HOTSPOTS = [
  'switch', 'door', 'window', 'clock', 'mirror', 'desk', 'radio', 'plant',
  'frame', 'bed', 'nightstand', 'shelf', 'ceiling', 'box', 'wallart',
];

const LABELS = {
  A: {
    switch: '전등 스위치', door: '문', window: '창문', clock: '벽시계', mirror: '거울',
    desk: '책상 서랍', radio: '라디오', plant: '화분', frame: '액자', bed: '침대',
    nightstand: '협탁', shelf: '책장', ceiling: '천장', box: '상자', wallart: '달력',
  },
  B: {
    switch: '전등 스위치', door: '문', window: '창문', clock: '벽시계', mirror: '거울',
    desk: '책상', radio: '라디오', plant: '화분', frame: '가족사진', bed: '침대',
    nightstand: '토끼 인형', shelf: '책장', ceiling: '천장', box: '장난감 상자', wallart: '크레파스 그림',
  },
};

const DOCS = {
  diary: {
    title: '낡은 일기장',
    style: 'diary',
    body:
      '10월 2일\n야근. 엄마한테 부재중 전화 세 통. 내일 해야지.\n\n' +
      '10월 19일\n본가에 들러 내 옛날 방을 정리했다.\n천장에 붙어 있던 야광별을 전부 떼어냈다. 끈적한 자국만 남았다.\n' +
      '엄마는 그걸 왜 떼냐고, 조금 서운한 얼굴이었다.\n어른이 되려면 이런 건 버려야 하는 거라고, 나는 말했다.\n\n' +
      '11월 7일\n엄마 생신. 올해는 꼭 가겠다고 약속했다.\n회의가 늦게 끝났다. 케이크는 겨우 샀다.\n' +
      '비가 많이 온다. 지금 출발하면 자정 전엔 도착할 수 있다—\n\n(그 뒤로는 비어 있다.)',
  },
  pictureDiary: {
    title: '그림일기',
    style: 'crayon',
    body:
      '3월 14일 맑음 ☀\n\n오늘은 내 여덟 살 생일이다!\n엄마랑 천장에 야광별을 붙였다. 내 생일 숫자 모양으로!\n' +
      '불을 끄면 반짝반짝 빛난다.\n\n엄마가 오르골도 사줬다. \'반짝반짝 작은 별\' 노래가 나온다.\n' +
      '이제 나는 밤이 하나도 안 무섭다.\n\n엄마가 그랬다.\n별이는 커서 멋진 어른이 될 거라고.',
  },
  broadcast: {
    title: 'FM 97.3',
    style: 'radio',
    body:
      '치지직……\n\n…네, 11월 7일 밤 뉴스 이어서 전해드립니다.\n\n' +
      '오늘 밤 11시 40분쯤, 비가 쏟아지던 강변도로에서\n승용차 한 대가 미끄러지는 사고가 있었습니다.\n' +
      '운전자 30대 한 모 씨는 병원으로 옮겨졌지만,\n아직 의식을 되찾지 못하고 있습니다.\n\n' +
      '사고 차량 안에서는 리본이 묶인 케이크 상자가 발견됐다고 합니다……\n\n치지직……\n\n' +
      '…이어서 신청곡 보내드립니다. 오늘 생일을 맞은 모든 어머님들께……\n♪ 반짝반짝 작은 별……',
  },
};

const ITEMS = {
  water: { name: '물 한 컵', icon: '💧', desc: '맑은 물이 찰랑이는 유리컵. 어딘가에 부어줄 수 있을 것 같다.' },
  smallKey: { name: '별 열쇠', icon: '⭐', desc: '손가락만 한 작은 열쇠. 손잡이가 별 모양이다. 어린아이 물건 같다.' },
  crank: { name: '태엽 손잡이', icon: '🔩', desc: '작은 L자 모양 금속 손잡이. 무언가의 태엽을 감는 데 쓰는 것 같다.' },
  diary: { name: '낡은 일기장', icon: '📓', desc: '표지에 "서진"이라고 적힌 일기장. 마지막 몇 장에만 글씨가 있다.', doc: 'diary' },
  musicBox: { name: '오르골', icon: '🎠', desc: '작은 회전목마 모양 오르골. 태엽 손잡이가 빠져 있어서 소리가 나지 않는다.' },
  doorKey: { name: '커다란 열쇠', icon: '🗝️', desc: '묵직하고 오래된 열쇠. 문 열쇠처럼 생겼다.' },
};

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function hasFinal(word) {
  const code = word.trim().slice(-1).charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}
const eul = (w) => w + (hasFinal(w) ? '을' : '를');

const freqLabel = (f) => (f / 10).toFixed(1);

function makeOut() {
  const out = { A: [], B: [] };
  const push = (to, o) => {
    for (const r of to === 'both' ? ROLES : [to]) out[r].push(o);
  };
  return {
    out,
    narr: (to, text) => push(to, { kind: 'narrate', text }),
    event: (to, text) => push(to, { kind: 'event', text }),
    doc: (to, key) => push(to, { kind: 'doc', ...DOCS[key] }),
    panel: (to, panel, data = {}) => push(to, { kind: 'panel', panel, ...data }),
    result: (to, ok) => push(to, { kind: 'panelResult', ok }),
    sfx: (to, name) => push(to, { kind: 'sfx', name }),
    music: (to, name) => push(to, { kind: 'music', name }),
    got: (to, item) => push(to, { kind: 'got', item }),
    push,
  };
}

// ─── 상태 ────────────────────────────────────────────────────────────────────

function createGame(now = Date.now()) {
  return {
    startedAt: now,
    endedAt: null,
    ended: false,
    light: { A: false, B: false },
    everLitB: false, // 야광별은 한 번 빛을 받아야 어둠 속에서 빛난다
    bothLitAnnounced: false,
    clockB: { h: 4, m: 20 },
    clocksSynced: false,
    radioFreq: 881,
    broadcastHeard: false,
    waterTaken: false,
    plantWatered: false,
    flowerKeyTaken: false,
    toyboxOpen: false,
    drawerOpen: false,
    musicPlayed: false,
    doorUnlocked: { A: false, B: false },
    doorPull: { A: 0, B: 0 },
    inv: { A: [], B: [] },
    hintsUsed: { A: 0, B: 0 },
  };
}

function viewFor(g, role) {
  const objects =
    role === 'A'
      ? {
          clock: { h: CLOCK_TARGET.h, m: CLOCK_TARGET.m, running: g.clocksSynced, reversed: false },
          plant: g.plantWatered ? (g.flowerKeyTaken ? 'bloom' : 'bloomKey') : 'dead',
          glass: !g.waterTaken,
          drawer: g.drawerOpen ? 'open' : 'locked',
          frame: g.musicPlayed ? 'photo' : 'empty',
          radioFreq: g.radioFreq,
        }
      : {
          clock: g.clocksSynced
            ? { h: CLOCK_TARGET.h, m: CLOCK_TARGET.m, running: true, reversed: false }
            : { h: g.clockB.h, m: g.clockB.m, running: false, reversed: true },
          plant: g.plantWatered ? 'watered' : 'sprout',
          toybox: g.toyboxOpen ? 'open' : 'locked',
          frame: 'photo',
          stars: !g.light.B && g.everLitB,
          radioOn: g.radioFreq === RADIO_TARGET,
        };
  objects.door = g.doorUnlocked[role] ? 'unlocked' : 'locked';
  objects.mirror = g.clocksSynced ? 'open' : 'fog';
  return {
    role,
    roomName: ROOM_NAME[role],
    lit: g.light[role],
    labels: LABELS[role],
    objects,
    doorReady: g.doorUnlocked.A && g.doorUnlocked.B,
    inventory: g.inv[role].map((id) => ({ id, ...ITEMS[id], doc: ITEMS[id].doc ? DOCS[ITEMS[id].doc] : undefined })),
    startedAt: g.startedAt,
    endedAt: g.endedAt,
    ended: g.ended,
    hintsUsed: g.hintsUsed[role],
  };
}

// ─── 인벤토리 ────────────────────────────────────────────────────────────────

function give(g, o, role, id) {
  g.inv[role].push(id);
  o.got(role, id);
}
function take(g, role, id) {
  const i = g.inv[role].indexOf(id);
  if (i >= 0) g.inv[role].splice(i, 1);
}

// ─── 핫스팟 핸들러 ──────────────────────────────────────────────────────────
// ctx = { g, role, item, o, now }. item 이 있으면 "그 물건을 여기에 사용".

const CANT_USE = { A: '여기에는 쓸 수 없을 것 같다.', B: '여기엔 못 쓸 것 같다.' };

function toggleSwitch({ g, role, o }) {
  const t = other(role);
  const on = !g.light[t];
  g.light[t] = on;
  if (t === 'B' && on) g.everLitB = true;
  o.sfx(role, 'switch');
  o.sfx(t, 'switch');
  if (role === 'A') {
    o.narr('A', on
      ? '딸깍. …이 방의 불은 켜지지 않는다. 대신 벽 너머 어딘가에서, 딸깍 하고 불이 들어오는 소리가 들린 것 같다.'
      : '딸깍. 벽 너머 어딘가의 불이 꺼지는 기척이 느껴진다.');
    o.event('B', on
      ? '갑자기 방에 불이 켜졌다! 누가 켜준 걸까?'
      : '갑자기 불이 꺼졌다!' + (g.everLitB ? ' …어? 천장에서 뭔가 반짝반짝 빛나기 시작했다!' : ''));
  } else {
    o.narr('B', on
      ? '딸깍! …어? 우리 방 불은 안 켜진다. 벽 너머에서 딸깍 소리가 난 것 같다.'
      : '딸깍! 벽 너머에서 불이 꺼지는 소리가 났다.');
    o.event('A', on
      ? '갑자기 방에 불이 들어왔다. 누군가 켜준 것 같다.'
      : '갑자기 불이 꺼졌다. 누군가 꺼버린 것 같다.');
  }
  if (g.light.A && g.light.B && !g.bothLitAnnounced) {
    g.bothLitAnnounced = true;
    o.event('both', '두 방에 모두 불이 켜졌다. 이제 방 안을 둘러볼 수 있다.');
  }
}

function sendThroughMirror({ g, role, item, o }) {
  const t = other(role);
  const name = ITEMS[item].name;
  take(g, role, item);
  g.inv[t].push(item);
  o.sfx('both', 'whoosh');
  o.narr(role, role === 'A'
    ? `${eul(name)} 거울 속으로 밀어 넣었다. 물건이 수면 아래로 가라앉듯 천천히 사라졌다.`
    : `${eul(name)} 거울에 쏙 밀어 넣었다. 물건이 물속으로 가라앉듯 사라졌다!`);
  o.event(t, t === 'A'
    ? `거울 표면이 일렁이더니, 무언가가 떠올랐다. ${eul(name)} 손에 넣었다.`
    : `거울에서 뭔가 퐁 튀어나왔다! ${eul(name)} 받았다.`);
  o.got(t, item);
}

function syncClocks(g, o) {
  g.clocksSynced = true;
  o.sfx('both', 'chime');
  o.event('A', '댕— 댕— 멈춰 있던 시계가 울리며 다시 움직이기 시작했다. 거울의 김이 스르르 걷히더니, 표면이 물결처럼 일렁이기 시작한다.');
  o.event('B', '댕— 댕— 거꾸로 돌던 시계가 멈칫하더니 똑바로 가기 시작했다! 거울에 서렸던 김이 사라지고, 거울이 물처럼 출렁거린다.');
}

function playMusicBox(g, role, o) {
  take(g, role, 'crank');
  take(g, role, 'musicBox');
  g.musicPlayed = true;
  o.music('both', 'twinkle');
  if (role === 'B') {
    o.narr('B', '태엽 손잡이를 끼우고 끼릭끼릭 감았다.\n♪ 반짝반짝 작은 별, 아름답게 비치네…\n노래가 끝나자 오르골 바닥이 톡 열리면서, 커다란 열쇠가 떨어졌다!');
    o.event('A', '어디선가 오르골 소리가 들려온다. ♪ 반짝반짝 작은 별…\n나도 모르게 가사를 따라 흥얼거리고 있었다. 어떻게 이 노래를 알고 있지?\n…빈 액자 쪽에서 무언가 달라진 것 같다.');
  } else {
    o.narr('A', '태엽을 끼워 감자, 오르골이 노래하기 시작했다. ♪ 반짝반짝 작은 별…\n처음 듣는 노래가 아니다. 노래가 끝나자 바닥이 열리며 묵직한 열쇠가 떨어졌다.\n…빈 액자 쪽에서도 무언가 달라진 것 같다.');
    o.event('B', '벽 너머에서 오르골 소리가 들린다! ♪ 반짝반짝 작은 별…\n내 오르골이랑 똑같은 노래다.');
  }
  give(g, o, role, 'doorKey');
}

function announceDoorsIfBoth(g, o) {
  if (g.doorUnlocked.A && g.doorUnlocked.B) {
    o.sfx('both', 'unlock');
    o.event('both', '두 개의 자물쇠가 모두 풀렸다. 문 바로 너머에 누군가 있다.\n함께, 동시에 문을 당겨야 한다.');
  }
}

function doorClick({ g, role, item, o }) {
  if (g.doorUnlocked.A && g.doorUnlocked.B) {
    o.panel(role, 'door', {
      text: role === 'A'
        ? '문고리를 잡았다. 문 너머에서도 누군가 같은 문고리를 잡고 있는 게 느껴진다.\n동시에 당겨야 열릴 것 같다.'
        : '문고리를 꽉 잡았다. 반대편에서도 누가 문고리를 잡고 있다!\n같이 당겨야 열릴 것 같다.',
    });
    return;
  }
  if (role === 'A') {
    if (item) {
      o.narr('A', '이 문에는 열쇠 구멍이 없다. 숫자 키패드뿐이다.');
      return;
    }
    if (g.doorUnlocked.A) {
      o.narr('A', '잠금은 풀렸지만 문이 꿈쩍도 하지 않는다. 문 너머에 또 하나의 자물쇠가 걸려 있는 것 같다.');
      return;
    }
    o.panel('A', 'keypad', {
      target: 'door',
      title: '문 키패드',
      text: '굳게 잠긴 문. 문고리 위에 숫자 키패드가 달려 있다.\n키패드 위에 긁힌 글씨: "모든 것이 멈춘 시각"',
    });
    return;
  }
  // B
  if (item === 'doorKey') {
    take(g, 'B', 'doorKey');
    g.doorUnlocked.B = true;
    o.sfx('B', 'unlock');
    o.narr('B', '커다란 열쇠를 꽂고 돌렸다. 철커덕!\n…근데 문이 안 열린다. 누가 반대쪽에서 꽉 잡고 있는 것 같다.');
    o.event('A', '문 바로 너머에서 "철커덕" 하고 자물쇠가 풀리는 소리가 들렸다.');
    announceDoorsIfBoth(g, o);
    return;
  }
  if (item === 'smallKey') {
    o.narr('B', '별 열쇠는 너무 작다. 이 구멍엔 안 맞는다.');
    return;
  }
  if (item) {
    o.narr('B', CANT_USE.B);
    return;
  }
  o.narr('B', g.doorUnlocked.B
    ? '열쇠로 열었는데도 안 열린다. 저쪽에 자물쇠가 또 있나 보다.'
    : '문이 잠겨 있다. 커다란 열쇠 구멍이 있다. 내 장난감 열쇠로는 어림도 없을 것 같다.');
}

function mirrorClick({ g, role, item, o }) {
  if (!g.clocksSynced) {
    if (item) {
      o.narr(role, role === 'A' ? '거울은 그저 차가운 유리일 뿐이다.' : '거울에 김이 서려서 아무 일도 안 일어난다.');
      return;
    }
    o.narr(role, role === 'A'
      ? '김이 서린 거울. 누군가 손가락으로 쓴 글씨가 남아 있다.\n\n"우리의 시간을 맞춰줘."'
      : '거울에 김이 잔뜩 서려 있다. 삐뚤빼뚤한 글씨가 쓰여 있다.\n\n"시계가 같아지면 만날 수 있어."');
    return;
  }
  if (item) {
    sendThroughMirror({ g, role, item, o });
    return;
  }
  o.narr(role, role === 'A'
    ? '거울 표면이 물결처럼 일렁인다. 비친 얼굴은 흐릿해서 잘 보이지 않는다.\n…한순간, 거울 속 얼굴이 아주 어린아이처럼 보였다. 눈을 깜빡이자 다시 흐려졌다.\n\n(소지품을 든 채로 거울을 조사하면 맞은편으로 보낼 수 있을 것 같다.)'
    : '거울이 물처럼 출렁출렁한다. 거울 속 내 얼굴이… 좀 이상하다. 키가 크고, 어른처럼 피곤한 얼굴.\n눈을 비비니까 다시 흐릿해졌다.\n\n(물건을 든 채로 거울을 만지면 저쪽으로 보낼 수 있을 것 같다.)');
}

const HANDLERS = {
  A: {
    switch: toggleSwitch,
    door: doorClick,
    mirror: mirrorClick,
    window: ({ o }) => o.narr('A', '창밖은 푸르스름한 새벽. 가로등 불빛 아래로 빗물이 번들거린다. 거리엔 아무도 없다.'),
    clock: ({ g, o }) => o.narr('A', g.clocksSynced
      ? '멈춰 있던 시계가 다시 움직인다. 째깍, 째깍. 11시 40분에서 조금씩 멀어지고 있다.'
      : '벽시계가 11시 40분에 멈춰 있다. 초침만 제자리에서 파르르 떨고 있다.'),
    desk: ({ g, item, o }) => {
      if (item) return o.narr('A', '서랍에는 번호 자물쇠가 걸려 있다. 물건으로는 열 수 없다.');
      if (g.drawerOpen) return o.narr('A', '텅 빈 서랍. 바닥에 별 모양 스티커 자국이 하나 남아 있다.');
      o.panel('A', 'keypad', {
        target: 'drawer',
        title: '서랍 자물쇠',
        text: '책상 서랍에 4자리 번호 자물쇠가 걸려 있다.\n자물쇠에 붙은 메모: "밤하늘을 올려다봐."',
      });
    },
    radio: ({ g, item, o }) => {
      if (item) return o.narr('A', CANT_USE.A);
      o.panel('A', 'radio', {
        freq: g.radioFreq,
        text: '오래된 나무 라디오. 전원은 켜져 있는데 스피커에서 아무 소리도 나지 않는다.\n주파수 다이얼만 돌아간다.',
      });
    },
    plant: ({ g, item, o }) => {
      if (!g.plantWatered) {
        if (item === 'water') return o.narr('A', '물을 부어볼까 했지만… 이미 뿌리까지 말라 죽었다. 이 화분은 너무 늦었다.\n(물은 아껴두자.)');
        if (item) return o.narr('A', CANT_USE.A);
        return o.narr('A', '바싹 말라 죽은 화분. 흙이 돌처럼 굳어 있다.');
      }
      if (!g.flowerKeyTaken) {
        g.flowerKeyTaken = true;
        o.sfx('A', 'pickup');
        o.narr('A', '죽어 있던 화분에서 새하얀 꽃이 피어났다!\n굵어진 뿌리가 흙을 밀어 올리자, 흙 속에 묻혀 있던 작은 열쇠가 드러났다. 별 모양 손잡이가 달린 열쇠다.');
        give(g, o, 'A', 'smallKey');
        return;
      }
      o.narr('A', item ? CANT_USE.A : '하얀 꽃이 피어 있다. 어딘가 그리운 향기가 난다.');
    },
    frame: ({ g, o }) => o.narr('A', g.musicPlayed
      ? '액자 속에 사진이 떠올라 있다. 회전목마 오르골을 꼭 안은 아이와, 그 아이를 뒤에서 안아주는 엄마.\n사진 뒷면에 적힌 글씨: "우리 별이, 여덟 번째 생일에."'
      : '빈 액자. 사진이 있던 자리만 네모나게 누렇다. 무슨 사진이 들어 있었더라?'),
    bed: ({ o }) => o.narr('A', '각 잡힌 침대. 이불이 너무 반듯해서, 아무도 누워본 적 없는 것 같다.'),
    nightstand: ({ g, item, o }) => {
      if (item) return o.narr('A', CANT_USE.A);
      if (!g.waterTaken) {
        g.waterTaken = true;
        o.sfx('A', 'pickup');
        o.narr('A', '협탁 위에 물이 담긴 유리컵이 있다. 챙겨두자.\n컵 아래에 약봉투가 깔려 있다: "한서진 님 — 수면유도제, 취침 전 1정."');
        give(g, o, 'A', 'water');
        return;
      }
      o.narr('A', '협탁 위엔 약봉투만 남아 있다. "한서진 님 — 수면유도제, 취침 전 1정."');
    },
    shelf: ({ o }) => o.narr('A', '책장. 업무 매뉴얼, 재테크 책, 자기계발서… 동화책은 한 권도 없다.\n맨 아래 칸에만 무언가를 빼낸 듯 먼지 자국이 네모나게 남아 있다.'),
    ceiling: ({ o }) => o.narr('A', '천장에 별 모양의 끈끈한 자국들이 잔뜩 남아 있다. 예전엔 여기에 무언가 붙어 있었나 보다.'),
    box: ({ o }) => o.narr('A', '"버릴 것"이라고 적힌 상자. 안에는 몽당 크레파스 몇 자루와, 빛을 잃은 별 모양 스티커들이 뭉쳐 있다.'),
    wallart: ({ o }) => o.narr('A', '11월 달력. 7일에 빨간 동그라미가 쳐져 있다.\n작은 글씨: "엄마 생신 🎂 — 올해는 꼭!"'),
  },
  B: {
    switch: toggleSwitch,
    door: doorClick,
    mirror: mirrorClick,
    window: ({ o }) => o.narr('B', '창밖으로 해가 지고 있다. 하늘이 주황색이랑 보라색이다. 어디선가 저녁밥 냄새가 날 것 같다.'),
    clock: ({ g, o }) => {
      if (g.clocksSynced) return o.narr('B', '시계가 이제 똑바로 간다. 째깍째깍.');
      o.panel('B', 'clock', {
        h: g.clockB.h,
        m: g.clockB.m,
        text: '시계가 이상하다. 숫자가 거꾸로 적혀 있고, 바늘도 거꾸로 돈다.\n뒤에 동그란 태엽이 있어서 시간을 맞출 수 있을 것 같다.',
      });
    },
    desk: ({ o }) => o.narr('B', '작은 책상. 서랍 안에 몽당 크레파스랑 스티커가 굴러다닌다. 별 모양, 하트 모양…'),
    radio: ({ g, item, o }) => {
      if (item) return o.narr('B', CANT_USE.B);
      if (g.radioFreq === RADIO_TARGET) {
        g.broadcastHeard = true;
        o.sfx('B', 'static');
        o.doc('B', 'broadcast');
        o.narr('B', g.clocksSynced
          ? '무서운 뉴스다. 밤 11시 40분… 아까 맞춘 시계랑 같은 시간이다.'
          : '무서운 뉴스다. 밤 11시 40분이라고 했다.');
        return;
      }
      o.sfx('B', 'static');
      o.narr('B', '라디오에서 치지직 소리만 난다. 다이얼도 없고 버튼도 없다.\n뒷면에 스티커가 붙어 있다: "♥ 엄마 채널 FM 97.3 ♥"');
    },
    plant: ({ g, item, o }) => {
      if (!g.plantWatered) {
        if (item === 'water') {
          take(g, 'B', 'water');
          g.plantWatered = true;
          o.sfx('both', 'grow');
          o.narr('B', '새싹에 물을 쪼르르 줬다. 새싹이 기지개를 켜듯 파르르 떨었다. 무럭무럭 자라라!');
          o.event('A', '창가 쪽에서 사각사각… 무언가 자라나는 소리가 들린다.');
          return;
        }
        if (item) return o.narr('B', CANT_USE.B);
        return o.narr('B', '화분에 조그만 새싹이 났다. 흙이 바싹 말라 있다.\n물을 주고 싶은데… 이 방엔 물이 없다.');
      }
      o.narr('B', item ? CANT_USE.B : '물을 먹은 새싹이 반짝반짝하다. 쑥쑥 크면 좋겠다.');
    },
    frame: ({ o }) => o.narr('B', '가족사진. 회전목마 오르골을 안은 나랑, 나를 뒤에서 안아주는 엄마.\n여덟 살 생일날 찍은 사진이다.'),
    bed: ({ o }) => {
      o.narr('B', '폭신한 이불. 베개 밑에 그림일기가 있다.');
      o.doc('B', 'pictureDiary');
    },
    nightstand: ({ o }) => o.narr('B', '귀 한쪽이 떨어진 토끼 인형. 목에 걸린 이름표: "별이 꺼"'),
    shelf: ({ o }) => o.narr('B', '그림책이 빼곡하다. 《별을 삼킨 아이》, 《엄마 곰과 아기 곰》, 《어른이 되면 뭐 할까?》…\n맨 아래 칸은 내가 제일 좋아하는 책들 자리다.'),
    ceiling: ({ g, o }) => {
      if (g.light.B) {
        return o.narr('B', '천장에 야광별 스티커가 잔뜩 붙어 있다! 근데 불이 켜져 있어서 잘 안 보인다.\n불을 끄면 반짝반짝할 텐데.');
      }
      if (!g.everLitB) return o.narr('B', '천장에 뭔가 붙어 있는 것 같은데, 깜깜해서 모르겠다.');
      o.narr('B', '캄캄한 천장에서 야광별들이 반짝반짝 빛난다!\n별들이 숫자 모양으로 붙어 있다.\n\n✦  0  3  1  4  ✦');
    },
    box: ({ g, item, o }) => {
      if (g.toyboxOpen) return o.narr('B', item ? CANT_USE.B : '장난감이 가득한 상자. 블록, 팽이, 인형 옷…');
      if (item === 'smallKey') {
        take(g, 'B', 'smallKey');
        g.toyboxOpen = true;
        o.sfx('B', 'unlock');
        o.narr('B', '별 열쇠를 꽂고 돌렸다. 딸깍! 상자가 열렸다.\n블록이랑 인형 사이에 회전목마 오르골이 있다! …근데 태엽 손잡이가 없어서 소리가 안 난다.');
        give(g, o, 'B', 'musicBox');
        return;
      }
      if (item) return o.narr('B', '이걸로는 안 열린다.');
      o.narr('B', '내 장난감 상자. 자물쇠가 걸려 있다. 열쇠 구멍 옆에 별 모양이 새겨져 있다.');
    },
    wallart: ({ o }) => o.narr('B', '내가 그린 크레파스 그림. 키 큰 사람이랑 작은 아이가 손을 잡고 있다.\n아래에 삐뚤빼뚤한 글씨: "나중에 꼭 만나자!"'),
  },
};

// ─── 액션 ───────────────────────────────────────────────────────────────────

function click(g, role, target, item, o, now) {
  if (!HOTSPOTS.includes(target)) return;
  if (item && !g.inv[role].includes(item)) item = undefined;
  if (!g.light[role] && target !== 'switch') {
    if (role === 'B' && target === 'ceiling') return HANDLERS.B.ceiling({ g, role, o });
    o.narr(role, role === 'A'
      ? '너무 어두워서 아무것도 보이지 않는다. 벽의 스위치만 희미하게 빛나고 있다.'
      : '깜깜해서 아무것도 안 보인다. 스위치만 반짝거린다.');
    return;
  }
  if (target === 'switch' && item) {
    o.narr(role, CANT_USE[role]);
    return;
  }
  HANDLERS[role][target]({ g, role, item, o, now });
}

function combine(g, role, a, b, o) {
  const inv = g.inv[role];
  if (!inv.includes(a) || !inv.includes(b) || a === b) return;
  const pair = [a, b].sort().join('+');
  if (pair === 'crank+musicBox') {
    if (!g.light[role]) {
      o.narr(role, role === 'A' ? '너무 어두워서 태엽 구멍을 찾을 수 없다.' : '깜깜해서 태엽 구멍이 안 보인다.');
      return;
    }
    playMusicBox(g, role, o);
    return;
  }
  o.narr(role, role === 'A' ? '두 물건은 함께 쓸 수 없을 것 같다.' : '이 둘은 같이 못 쓸 것 같다.');
}

function tooDarkForPanel(g, role, o) {
  if (g.light[role]) return false;
  o.result(role, false);
  o.narr(role, role === 'A' ? '갑자기 어두워져서 아무것도 보이지 않는다.' : '불이 꺼져서 하나도 안 보인다!');
  return true;
}

function enterCode(g, role, target, code, o) {
  code = String(code || '').replace(/\D/g, '').slice(0, 4);
  if (role !== 'A' || tooDarkForPanel(g, role, o)) return;
  if (target === 'drawer' && !g.drawerOpen) {
    if (code === DRAWER_CODE) {
      g.drawerOpen = true;
      o.result('A', true);
      o.sfx('A', 'unlock');
      o.narr('A', '딸깍. 서랍이 열렸다. 안에는 작은 금속 태엽 손잡이와, 낡은 일기장이 들어 있다.');
      give(g, o, 'A', 'crank');
      give(g, o, 'A', 'diary');
    } else {
      o.result('A', false);
      o.sfx('A', 'fail');
      o.narr('A', '철컥, 철컥. 열리지 않는다.');
    }
    return;
  }
  if (target === 'door' && !g.doorUnlocked.A) {
    if (code === DOOR_CODE) {
      g.doorUnlocked.A = true;
      o.result('A', true);
      o.sfx('A', 'unlock');
      o.narr('A', '삐빅— 철컥. 잠금이 풀렸다.\n…그런데 문이 꿈쩍도 하지 않는다. 반대편에서 누군가 붙잡고 있는 것처럼.');
      o.event('B', '문 바로 너머에서 "철컥" 하고 뭔가 풀리는 소리가 났다!');
      announceDoorsIfBoth(g, o);
    } else {
      o.result('A', false);
      o.sfx('A', 'fail');
      o.narr('A', code === '1140'
        ? '삐빅—. 틀렸다. 숫자는 맞는 것 같은데… 그게 오전이었을까, 밤이었을까?'
        : '삐빅—. 틀린 번호다.');
    }
  }
}

function setClock(g, role, h, m, o) {
  if (role !== 'B' || g.clocksSynced || tooDarkForPanel(g, role, o)) return;
  h = Math.round(Number(h));
  m = Math.round(Number(m));
  if (!(h >= 1 && h <= 12) || !(m >= 0 && m <= 55) || m % 5 !== 0) return;
  g.clockB = { h, m };
  if (h === CLOCK_TARGET.h && m === CLOCK_TARGET.m) {
    o.result('B', true);
    o.narr('B', '끼릭끼릭, 시간을 맞췄다.');
    syncClocks(g, o);
  } else {
    o.result('B', false);
    o.sfx('B', 'tick');
    o.narr('B', '끼릭끼릭 시간을 맞췄다. …아무 일도 안 일어난다. 이 시간이 아닌가 보다.');
  }
}

function tuneRadio(g, role, freq, o) {
  if (role !== 'A' || tooDarkForPanel(g, role, o)) return;
  freq = Math.round(Number(freq));
  if (!(freq >= RADIO_MIN && freq <= RADIO_MAX)) return;
  const was = g.radioFreq;
  g.radioFreq = freq;
  o.result('A', true);
  if (freq === RADIO_TARGET) {
    o.narr('A', '다이얼을 97.3에 맞췄다. 이 라디오에선 여전히 아무 소리도 나지 않는다.\n…그런데 벽 너머에서 희미하게 사람 목소리가 새어 나오는 것 같다.');
    if (was !== RADIO_TARGET) {
      o.event('B', '라디오가 갑자기 지지직거리더니, 사람 목소리가 나오기 시작했다!');
      g.broadcastHeard = true;
      o.sfx('B', 'static');
      o.doc('B', 'broadcast');
    }
  } else {
    o.narr('A', `다이얼을 ${freqLabel(freq)}MHz에 맞췄다. …이 라디오에서는 잡음조차 나지 않는다.`);
    if (was === RADIO_TARGET) o.event('B', '라디오 목소리가 뚝 끊겼다. 다시 치지직 소리만 난다.');
  }
}

function pull(g, role, o, now) {
  if (!(g.doorUnlocked.A && g.doorUnlocked.B) || g.ended) return;
  const t = other(role);
  g.doorPull[role] = now;
  if (now - g.doorPull[t] <= PULL_WINDOW_MS) {
    g.ended = true;
    g.endedAt = now;
    o.sfx('both', 'door');
    o.push('both', { kind: 'ending' });
    return;
  }
  o.sfx(role, 'thud');
  o.narr(role, role === 'A'
    ? '힘껏 당겼다. 문이 조금 움직였다가 다시 닫힌다. 혼자 힘으로는 안 된다.\n맞은편과 동시에 당겨야 한다!'
    : '끄응—! 문이 조금 열렸다가 다시 닫혔다. 혼자서는 안 된다.\n저쪽이랑 동시에 당겨야 한다!');
  o.event(t, t === 'A'
    ? '문 너머에서 누군가 문고리를 힘껏 당겼다! 지금 같이 당기면 열릴 것 같다.'
    : '문 너머에서 누가 문을 확 당겼다! 지금 같이 당기면 열릴 것 같다!');
  o.push(t, { kind: 'partnerPull', windowMs: PULL_WINDOW_MS });
}

function hint(g, role, o) {
  const text = hintFor(g, role);
  g.hintsUsed[role] += 1;
  o.push(role, { kind: 'hint', text });
}

/**
 * 플레이어 액션을 처리한다.
 * @returns {{A: object[], B: object[]}} 각 플레이어에게 보낼 출력 목록
 */
function act(g, role, msg, now = Date.now()) {
  const o = makeOut();
  if (!msg || typeof msg !== 'object' || g.ended || !ROLES.includes(role)) return o.out;
  switch (msg.a) {
    case 'click': click(g, role, msg.target, msg.item, o, now); break;
    case 'combine': combine(g, role, msg.item, msg.with, o); break;
    case 'code': enterCode(g, role, msg.target, msg.code, o); break;
    case 'clock': setClock(g, role, msg.h, msg.m, o); break;
    case 'radio': tuneRadio(g, role, msg.freq, o); break;
    case 'pull': pull(g, role, o, now); break;
    case 'hint': hint(g, role, o); break;
    default: break;
  }
  return o.out;
}

// ─── 힌트 ───────────────────────────────────────────────────────────────────

function hintFor(g, role) {
  const o = other(role);
  const has = (r, id) => g.inv[r].includes(id);

  if (!g.light[role]) {
    if (role === 'B' && g.everLitB && !g.drawerOpen) return '어둠 속에서 고개를 들어 천장을 올려다보세요. 무언가 빛나고 있을지도 몰라요.';
    if (!g.light[o]) return '벽에서 희미하게 빛나는 스위치를 눌러보세요. 그 스위치는 이 방이 아닌 다른 곳의 불을 켤지도 몰라요.';
    return '당신 방의 불은 당신 손으로 켤 수 없는 것 같아요. 벽 너머의 누군가에게 스위치를 눌러달라고 부탁해보세요.';
  }
  if (!g.light[o] && !g.clocksSynced) return '벽 너머의 방은 아직 어두워요. 당신의 스위치가 그 방의 불을 켤 수 있어요.';
  if (!g.clocksSynced) {
    return role === 'A'
      ? '거울의 글씨를 읽어보세요. 이 방의 시계는 몇 시에 멈춰 있나요? 맞은편 시계는 어떤지 물어보세요.'
      : '거울의 글씨를 읽어보세요. 이 방 시계는 시간을 맞출 수 있어요. 맞은편 시계가 몇 시인지 물어보세요.';
  }
  if (g.doorUnlocked.A && g.doorUnlocked.B) {
    return '두 자물쇠가 모두 풀렸어요. 문을 조사해 문고리를 잡고, 맞은편과 신호를 맞춰 동시에 당기세요. "하나, 둘, 셋!"';
  }

  const c = [];
  if (has(role, 'crank') && has(role, 'musicBox')) c.push('오르골과 태엽 손잡이를 함께 써보세요. 소지품 하나를 고른 뒤 다른 하나를 고르면 돼요.');
  if (role === 'A') {
    if (!g.waterTaken) c.push('협탁 위를 살펴보세요. 쓸 만한 게 있어요.');
    else if (!g.plantWatered) {
      if (has('A', 'water')) c.push('이 방의 화분은 너무 늦었어요. 이제 거울로 물건을 건너보낼 수 있어요 — 숫자키로 소지품을 든 채 거울을 조사하세요. 맞은편엔 물이 필요한 게 있을지도.');
      else if (has('B', 'water')) c.push('맞은편 사람이 물을 가지고 있어요. 그쪽 방에 물을 줄 만한 게 있는지 물어보세요.');
    } else if (!g.flowerKeyTaken) c.push('창가의 화분에 무슨 일이 일어난 것 같아요.');
    else if (!g.toyboxOpen && has('A', 'smallKey')) c.push('별 열쇠는 이 방의 어떤 자물쇠에도 맞지 않아요. 맞은편에 별 모양 열쇠 구멍이 있는지 물어보세요.');
    if (!g.drawerOpen) {
      c.push(g.light.B
        ? '서랍 메모: "밤하늘을 올려다봐". 이 방 천장엔 자국만 남았죠. 맞은편 천장엔 뭐가 있나요? 야광별은 불이 꺼져야 빛나요 — 그 방의 불은 누가 끌 수 있을까요?'
        : '맞은편 방이 지금 어두워요. 그쪽 천장에 무엇이 보이는지 물어보세요.');
    }
    if (!g.broadcastHeard) c.push('이 방 라디오는 다이얼만 돌아가고 소리가 나지 않아요. 맞은편 라디오에 주파수 단서가 있는지 물어보세요.');
    if (has('A', 'crank') && !has('A', 'musicBox') && !g.musicPlayed) c.push('태엽 손잡이로 감을 만한 물건이 이 방에는 없어요. 맞은편에는 있을지도?');
    if (has('A', 'doorKey')) c.push('이 방 문에는 열쇠 구멍이 없어요. 커다란 열쇠가 맞는 문은 맞은편에 있을지도.');
    if (!g.doorUnlocked.A) {
      c.push(g.broadcastHeard
        ? '"모든 것이 멈춘 시각". 시계는 11시 40분에 멈춰 있었죠. 그런데 뉴스에서는 낮이라고 했나요, 밤이라고 했나요? 네 자리 24시간제로 생각해보세요.'
        : '문 키패드의 "모든 것이 멈춘 시각". 이 방에서 멈춰 있던 게 있었죠. 정확히 언제였는지는 맞은편 라디오가 알려줄지도.');
    }
  } else {
    if (!g.plantWatered) {
      c.push(has('B', 'water')
        ? '새싹에 물을 줘보세요. 물을 든 채로 화분을 조사하면 돼요.'
        : '창가의 새싹이 목말라 보여요. 맞은편에 물이 있는지 물어보세요. 이제 거울로 물건을 주고받을 수 있어요.');
    }
    if (!g.toyboxOpen) {
      c.push(has('B', 'smallKey')
        ? '별 열쇠로 장난감 상자를 열어보세요.'
        : g.plantWatered
          ? '장난감 상자에는 별 모양 열쇠가 필요해요. 새싹이 자라면서 맞은편에 무슨 일이 생겼는지 물어보세요.'
          : '장난감 상자에는 별 모양 열쇠가 필요해요. 새싹을 키우면 무슨 일이 일어날지도.');
    }
    if (!g.drawerOpen) c.push('천장의 야광별은 불이 켜져 있으면 안 보여요. 맞은편 사람이 이 방의 불을 꺼줄 수 있어요. 별이 만드는 모양을 맞은편에 알려주세요.');
    if (!g.broadcastHeard) c.push('라디오 뒷면의 스티커를 보세요. 이 라디오엔 다이얼이 없지만, 맞은편 라디오엔 있을지도.');
    else if (!g.doorUnlocked.A) c.push('뉴스에서 들은 시각을 맞은편에 알려주세요. 그쪽 문에 필요한 숫자일지도 몰라요.');
    if (has('B', 'musicBox') && !has('B', 'crank')) c.push('오르골엔 태엽 손잡이가 필요해요. 맞은편 서랍에 뭔가 있을지도.');
    if (has('B', 'doorKey')) c.push('커다란 열쇠를 든 채로 문을 조사해보세요.');
    else if (!g.doorUnlocked.B && !g.musicPlayed) c.push('문 열쇠 구멍이 커요. 오르골이 무언가를 숨기고 있을지도.');
  }
  if (!c.length) return '맞은편 사람과 서로 무엇을 발견했는지 이야기해보세요. 두 사람의 퍼즐 조각이 맞물려야 해요.';
  return c[g.hintsUsed[role] % c.length];
}

// ─── 프롤로그 / 엔딩 ─────────────────────────────────────────────────────────

const PROLOGUE = {
  A:
    '…차가운 공기에 눈을 떴다.\n\n푸르스름한 어둠. 새벽 네 시쯤일까.\n' +
    '여기가 어디인지, 내가 왜 여기 있는지 기억나지 않는다.\n\n' +
    '손을 더듬어 문고리를 잡아보았지만, 잠겨 있다.\n\n그때, 벽 너머에서 누군가의 기척이 느껴졌다.',
  B:
    '…따뜻한 냄새에 눈을 떴다.\n\n주황빛이 스며드는 어둠. 해가 막 진 것 같다.\n' +
    '여기가 어디지? 엄마는 어디 갔지?\n\n' +
    '문고리를 당겨봤는데, 안 열린다.\n\n그때, 벽 너머에서 누군가의 기척이 느껴졌다.',
};

const START_TEXT = {
  A: '어둠 속이다. 벽의 스위치만 희미하게 빛나고 있다.\n(WASD로 걷고 마우스로 둘러본다. 스위치를 바라보고 E를 누르거나 클릭해보자. 벽 너머의 누군가와는 대화창으로 이야기할 수 있다.)',
  B: '깜깜하다. 벽에 붙은 스위치만 반짝반짝 빛난다.\n(WASD로 걷고 마우스로 둘러본다. 스위치를 바라보고 E를 누르거나 클릭해보자. 벽 너머의 누군가와는 대화창으로 이야기할 수 있다.)',
};

function endingFor(g, role, nicks) {
  const own = role === 'A'
    ? [
        { type: 'text', text: '하나, 둘, 셋.\n\n문이 열렸다.\n\n문 너머에는 복도가 없었다.\n노을빛이 쏟아지는 방이 있었다.\n천장 가득한 야광별, 장난감 상자, 크레파스 그림.\n\n그리고 그 한가운데에,\n작은 아이 하나가 서 있었다.' },
        { type: 'room', which: 'B', caption: '문 너머의 방' },
        { type: 'text', text: '아이가 나를 올려다보며 웃었다.\n\n"찾았다."\n\n나는 그 얼굴을 안다.\n매일 아침 거울 속에서 보던 얼굴의,\n아주 오래전 모습.' },
      ]
    : [
        { type: 'text', text: '하나, 둘, 셋.\n\n문이 열렸다.\n\n문 너머에는 복도가 없었다.\n새벽빛이 가득한 방이 있었다.\n텅 빈 천장, 반듯한 침대, 11시 40분에 멈춰 있던 시계.\n\n그리고 거기에,\n어른 한 명이 서 있었다.' },
        { type: 'room', which: 'A', caption: '문 너머의 방' },
        { type: 'text', text: '어른은 울 것 같은 얼굴로 나를 보았다.\n나는 그 얼굴을 알 것 같았다.\n\n엄마가 그랬다.\n"별이는 커서 멋진 어른이 될 거야."\n\n…이 사람이, 나구나.' },
      ];
  const shared = [
    { type: 'merge', caption: '두 개의 방은, 처음부터 하나의 방이었다.' },
    { type: 'text', text: '한서진의 방.\n\n어린 서진이 천장에 별을 붙이던 방이자,\n어른 서진이 그 별을 모두 떼어낸 방.\n\n11월 7일 밤 11시 40분.\n엄마의 생일 케이크를 싣고 달리던 빗길 위에서,\n서진의 시간은 멈췄다.' },
    { type: 'text', text: '그날 이후 서진의 마음은 둘로 나뉘었다.\n\n따뜻했던 기억 속에 머물고 싶은 마음과,\n모든 걸 잊고 떠나버리고 싶은 마음으로.\n\n맞은편에서 들려오던 목소리는\n처음부터 나의 목소리였다.\n\n"별이"는 엄마만 부르던, 서진의 어릴 적 이름이었다.' },
    { type: 'epilogue', text: '삐— 삐— 삐—\n\n"…서진아. 서진아, 엄마 목소리 들려?"\n"선생님! 환자분 손가락이 움직였어요!"\n\n눈을 떴다.\n창문 너머로, 새벽과 노을 사이 어딘가의 빛이 쏟아지고 있었다.\n\n"…엄마. 생일 축하해."' },
    {
      type: 'credits',
      nicks,
      elapsedMs: (g.endedAt || Date.now()) - g.startedAt,
      hints: g.hintsUsed.A + g.hintsUsed.B,
    },
  ];
  return [...own, ...shared];
}

module.exports = {
  ROLES,
  ROOM_NAME,
  HOTSPOTS,
  ITEMS,
  PROLOGUE,
  START_TEXT,
  PULL_WINDOW_MS,
  SOLUTION: { DRAWER_CODE, DOOR_CODE, RADIO_TARGET, CLOCK_TARGET },
  other,
  createGame,
  viewFor,
  act,
  hintFor,
  endingFor,
};
