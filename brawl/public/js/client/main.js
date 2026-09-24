// 물렁 난투 — 화면 흐름(타이틀·대기실·경기·결과)과 경기 진행.
// 방장(오프라인이면 나)은 워커에서 물리를 돌리고, 온라인 참가자는 방장이 보낸 스냅샷을 보간해서 그린다.
import { ROSTER, ROSTER_BY_ID, SLOT_COLORS } from '../sim/roster.js';
import { MAP_LIST, MAPS } from '../sim/maps.js';
import { MSG, decodeSnapshot, encodeInputs, decodeInputs, lerpTransforms } from '../sim/snapshot.js';
import { GameRenderer } from './render.js';
import { Input, DEVICE_LABELS, CONTROLS_HELP } from './input.js';
import { Hud, esc } from './hud.js';
import { Net } from './net.js';
import { portrait } from './portrait.js';
import { unlockAudio, sfx, soundForEvent, startMusic, stopMusic, setMuted, setMusic, isMuted, isMusicOn } from './audio.js';

const $ = (id) => document.getElementById(id);

// ─── 저장소 (막혀 있어도 동작) ────────────────────────────────────────────────
const store = (area) => ({
  get(k, d = null) {
    try { const v = area().getItem(k); return v === null ? d : v; } catch { return d; }
  },
  set(k, v) {
    try { area().setItem(k, v); } catch { /* 무시 */ }
  },
  del(k) {
    try { area().removeItem(k); } catch { /* 무시 */ }
  },
});
const LS = store(() => localStorage);
const SS = store(() => sessionStorage);

const HAS_TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const TOUCH_ONLY = HAS_TOUCH && !matchMedia('(pointer: fine)').matches;
const DEFAULT_DEVICE = TOUCH_ONLY ? 'touch' : 'kbA';
const LEVEL_NAMES = ['', '초보', '보통', '고수'];
const INTERP_DELAY = 0.1; // 참가자 화면은 방장보다 0.1초 뒤를 그린다 (끊김 없이 보간)

const settings = { quality: LS.get('brawl.quality', TOUCH_ONLY ? 'low' : 'medium') };

const S = {
  mode: null, // 'offline' | 'online'
  room: null, // 대기실 상태 (온라인이면 서버가 준 것과 같은 모양)
  net: null,
  game: null,
  screen: 'title',
  ping: null,
  pingTimer: null,
};

const input = new Input($('view'));
input.enabled = false;
const hud = new Hud();
let view = null;

function getView() {
  if (view && view.quality !== settings.quality) {
    view.dispose();
    view = null;
  }
  if (!view) view = new GameRenderer($('view'), { quality: settings.quality });
  return view;
}

// ─── 공통 UI ─────────────────────────────────────────────────────────────────

function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === `scr-${name}`);
  S.screen = name;
}

function toast(msg, ms = 2800) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function loading(on, text = '불러오는 중…') {
  $('loading').classList.toggle('hidden', !on);
  $('loading-text').textContent = text;
}

let modalClose = null;
function modal(html, { onClose = null } = {}) {
  const box = $('modal-box');
  modalClose = null;
  box.innerHTML = `<button class="btn tiny x" data-close aria-label="닫기">✕</button>${html}`;
  $('modal').classList.remove('hidden');
  modalClose = onClose;
  box.querySelector('[data-close]').onclick = closeModal;
  return box;
}

function closeModal() {
  if ($('modal').classList.contains('hidden')) return;
  $('modal').classList.add('hidden');
  $('modal-box').innerHTML = '';
  const fn = modalClose;
  modalClose = null;
  fn?.();
}
const modalOpen = () => !$('modal').classList.contains('hidden');

$('modal').addEventListener('pointerdown', (e) => { if (e.target === $('modal')) closeModal(); });

function myName() {
  const v = $('name').value.trim() || LS.get('brawl.name') || '';
  return (v || '플레이어').slice(0, 10);
}

function copy(text, done) {
  const ok = () => toast(done);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, () => prompt('복사해서 보내 주세요', text));
  else prompt('복사해서 보내 주세요', text);
}

// ─── 도움말·캐릭터·설정 창 ─────────────────────────────────────────────────

function helpHtml() {
  return `<h3>조작법</h3>
  <table class="help-table"><tr><th>동작</th><th>키보드 1</th><th>키보드 2</th><th>게임패드</th></tr>
  ${CONTROLS_HELP.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</table>
  <ul class="help-tips">
    <li><b>주먹 버튼을 꾹</b> 누르면 그 손으로 붙잡아요. 잡은 채로 <b>점프</b>를 누르고 있으면 들어 올리고, 떼면 던져요.</li>
    <li>맞을수록 <b>%</b> 가 쌓이고, % 가 높을수록 <b>더 멀리 날아가요</b>. 경기장 <b>밖으로 떨어지면 탈락</b> — 다시 살아나지 않아요.</li>
    <li>떨어진 사람은 남은 사람들의 싸움을 <b>관전</b>해요. 마지막 한 명이 남으면 라운드 끝!</li>
    <li>% 가 높은 상대는 잡혀도 잘 못 빠져나오고, 던지면 멀리 날아가요.</li>
    <li><b>MMA 버튼</b> 하나로 상황에 맞는 기술이 나가요: 가까운 상대에게 <b>태클</b> → 넘어진 상대 위에서 <b>마운트</b> (주먹 1.5배) → 한 번 더 누르고 꾹 누르면 <b>초크</b>.
      상대를 잡은 채 앞에서 누르면 <b>수플렉스</b>, 등 뒤에서 누르면 <b>리어 네이키드 초크</b>.</li>
    <li>잡히거나 깔리면 <b>아무 버튼이나 연타</b>해서 빠져나와요. 초크는 연타로 게이지를 밀어내야 해요.</li>
    <li>난간·턱·크레인에 손을 뻗어 잡으면 매달리고, 점프를 누르면 기어 올라가요.</li>
    <li>75초가 지나면 <b>서든데스</b> — 맵이 더 위험해져요.</li>
    <li>한 컴퓨터에서 여럿이: 키보드 1 + 키보드 2 + 게임패드 최대 4개. 휴대폰은 터치 버튼으로.</li>
  </ul>`;
}

function rosterHtml() {
  return `<h3>캐릭터 소개</h3><p class="modal-note">패시브는 한 가지 능력만 조금 올려서 누가 골라도 비슷하게 싸울 수 있어요.</p>
  <div class="pick-grid">${ROSTER.map((c) => `<div class="pick static"><img alt="" src="${portrait(c.id)}"><b>${esc(c.name)}</b><small>${esc(c.tagline)}</small>
  <span class="pv"><b>${esc(c.passive.name)}</b><br>${esc(c.passive.desc)}</span></div>`).join('')}</div>`;
}

function openSettings() {
  const box = modal(`<h3>설정</h3><div class="menu-list">
    <div class="toggle-row"><span>그래픽 품질</span><div class="chips" id="set-q">
      ${[['low', '낮음'], ['medium', '보통'], ['high', '높음']].map(([k, n]) => `<button class="chip dark ${settings.quality === k ? 'on' : ''}" data-q="${k}">${n}</button>`).join('')}
    </div></div>
    <div class="toggle-row"><span>효과음</span><button class="btn small" id="set-mute">${isMuted() ? '꺼짐' : '켜짐'}</button></div>
    <div class="toggle-row"><span>배경음악</span><button class="btn small" id="set-music">${isMusicOn() ? '켜짐' : '꺼짐'}</button></div>
    <p class="modal-note">느리면 품질을 낮춰 보세요. 그림자가 꺼지고 해상도가 줄어요.</p>
  </div>`);
  box.querySelectorAll('[data-q]').forEach((b) => {
    b.onclick = () => {
      settings.quality = b.dataset.q;
      LS.set('brawl.quality', settings.quality);
      box.querySelectorAll('[data-q]').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  box.querySelector('#set-mute').onclick = (e) => { setMuted(!isMuted()); e.target.textContent = isMuted() ? '꺼짐' : '켜짐'; };
  box.querySelector('#set-music').onclick = (e) => { setMusic(!isMusicOn()); e.target.textContent = isMusicOn() ? '켜짐' : '꺼짐'; };
}

// ─── 대기실 ──────────────────────────────────────────────────────────────────

const isHost = () => !!S.room && S.room.hostId === S.room.you;
const canEdit = (s) => !!s && (s.owner === S.room.you || (s.bot && isHost()));

function usedChars(room) {
  return new Set(room.slots.filter(Boolean).map((x) => x.charId));
}

function freshOfflineRoom(restore = true) {
  const room = {
    code: null, hostId: 'me', you: 'me', phase: 'lobby',
    settings: { mapId: 'octagon', winsNeeded: 3 },
    clients: [{ id: 'me', name: myName(), online: true }],
    slots: [null, null, null, null],
  };
  let saved = null;
  if (restore) {
    try { saved = JSON.parse(LS.get('brawl.offline') || 'null'); } catch { saved = null; }
  }
  if (saved && Array.isArray(saved.slots) && saved.slots.length === 4) {
    room.settings = { mapId: MAPS[saved.settings?.mapId] || saved.settings?.mapId === 'random' ? saved.settings.mapId : 'octagon', winsNeeded: [1, 2, 3, 5].includes(saved.settings?.winsNeeded) ? saved.settings.winsNeeded : 3 };
    room.slots = saved.slots.map((s) => (s && ROSTER_BY_ID[s.charId] ? { ...s, owner: s.bot ? null : 'me' } : null));
    const first = room.slots.find((s) => s && !s.bot);
    if (first) first.name = myName();
  }
  if (!room.slots.some(Boolean)) {
    room.slots[0] = { owner: 'me', device: DEFAULT_DEVICE, name: myName(), charId: LS.get('brawl.char', 'wakgood'), bot: false };
    if (!ROSTER_BY_ID[room.slots[0].charId]) room.slots[0].charId = 'wakgood';
  }
  return room;
}

function saveOffline() {
  if (S.mode !== 'offline' || !S.room) return;
  LS.set('brawl.offline', JSON.stringify({ settings: S.room.settings, slots: S.room.slots }));
}

function offlineAction(msg) {
  const room = S.room;
  const i = Number.isInteger(msg.slot) ? msg.slot : -1;
  const s = i >= 0 ? room.slots[i] : null;
  const free = room.slots.findIndex((x) => !x);
  const used = usedChars(room);
  const nextChar = (ROSTER.find((c) => !used.has(c.id)) || ROSTER[0]).id;
  switch (msg.t) {
    case 'addLocal': {
      if (free < 0) return toast('빈 자리가 없어요.');
      if (room.slots.some((x) => x && !x.bot && x.device === msg.device)) return;
      const n = room.slots.filter((x) => x && !x.bot).length;
      room.slots[free] = { owner: 'me', device: msg.device, name: n ? `플레이어${free + 1}` : myName(), charId: nextChar, bot: false };
      toast(`P${free + 1} 추가 — ${DEVICE_LABELS[msg.device]}`);
      break;
    }
    case 'setChar':
      if (s && ROSTER_BY_ID[msg.charId]) s.charId = msg.charId;
      break;
    case 'setDevice':
      if (s && !s.bot) {
        const other = room.slots.find((x) => x && x !== s && !x.bot && x.device === msg.device);
        if (other) other.device = s.device;
        s.device = msg.device;
      }
      break;
    case 'removeSlot':
      if (s) room.slots[i] = null;
      break;
    case 'addBot': {
      if (free < 0) return toast('빈 자리가 없어요.');
      const lvl = [1, 2, 3].includes(msg.level) ? msg.level : 2;
      room.slots[free] = { owner: null, device: 'bot', name: `봇 ${LEVEL_NAMES[lvl]}`, charId: nextChar, bot: true, botLevel: lvl };
      break;
    }
    case 'setBotLevel':
      if (s && s.bot && [1, 2, 3].includes(msg.level)) {
        s.botLevel = msg.level;
        s.name = `봇 ${LEVEL_NAMES[msg.level]}`;
      }
      break;
    case 'setMap':
      room.settings.mapId = msg.mapId;
      break;
    case 'setWins':
      room.settings.winsNeeded = msg.n;
      break;
    case 'start':
      saveOffline();
      startOfflineMatch();
      return;
    default:
  }
  saveOffline();
  renderLobby();
}

function lobbyAction(msg) {
  if (S.mode === 'offline') offlineAction(msg);
  else if (S.net) S.net.send(msg);
}

function localDevices() {
  return ['kbA', 'kbB', ...input.connectedPads(), ...(HAS_TOUCH ? ['touch'] : [])];
}

function addLocalPlayer(device) {
  const used = new Set(S.room.slots.filter((s) => s && s.owner === S.room.you && !s.bot).map((s) => s.device));
  const d = device ? (used.has(device) ? null : device) : localDevices().find((x) => !used.has(x));
  if (!d) {
    if (!device) toast('남은 조작 장치가 없어요. 게임패드를 연결해 보세요!');
    return;
  }
  lobbyAction({ t: 'addLocal', device: d });
}

function cycleDevice(slot) {
  const s = S.room.slots[slot];
  const opts = localDevices();
  const next = opts[(opts.indexOf(s.device) + 1) % opts.length];
  lobbyAction({ t: 'setDevice', slot, device: next });
}

function openCharPicker(slot) {
  const s = S.room.slots[slot];
  if (!s) return;
  const takenBy = new Map();
  S.room.slots.forEach((x, i) => { if (x && i !== slot) takenBy.set(x.charId, i); });
  const box = modal(`<h3>P${slot + 1} 캐릭터 고르기</h3>
    <div class="pick-grid">${ROSTER.map((c) => `<button class="pick ${c.id === s.charId ? 'on' : ''}" data-id="${c.id}">
      <img alt="" src="${portrait(c.id)}"><b>${esc(c.name)}</b><small>${esc(c.tagline)}</small>
      <span class="pv"><b>${esc(c.passive.name)}</b><br>${esc(c.passive.desc)}</span>
      ${takenBy.has(c.id) ? `<span class="taken" style="background:${SLOT_COLORS[takenBy.get(c.id)]}">P${takenBy.get(c.id) + 1}</span>` : ''}
    </button>`).join('')}</div>
    <div class="modal-foot"><button class="btn" id="pick-rand">🎲 아무거나</button></div>`);
  const choose = (id) => {
    lobbyAction({ t: 'setChar', slot, charId: id });
    const firstMine = S.room.slots.findIndex((x) => x && x.owner === S.room.you && !x.bot);
    if (firstMine === slot) LS.set('brawl.char', id);
    sfx('grab');
    closeModal();
  };
  box.querySelectorAll('.pick').forEach((b) => { b.onclick = () => choose(b.dataset.id); });
  box.querySelector('#pick-rand').onclick = () => choose(ROSTER[Math.floor(Math.random() * ROSTER.length)].id);
}

function button(label, cls, fn) {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.innerHTML = label;
  b.onclick = fn;
  return b;
}

function slotCard(s, i, host) {
  const d = document.createElement('div');
  d.style.setProperty('--slot', SLOT_COLORS[i]);
  const room = S.room;
  if (!s) {
    d.className = 'slot empty';
    d.innerHTML = `<span class="pnum">P${i + 1}</span><div class="empty-txt">빈 자리</div><div class="row"></div>`;
    const row = d.querySelector('.row');
    if (host) row.append(button('🤖 봇', 'small', () => lobbyAction({ t: 'addBot', level: 2 })));
    row.append(button('➕ 여기서 같이', 'small', () => addLocalPlayer()));
    if (S.mode === 'online' && !host) d.querySelector('.empty-txt').textContent = '친구를 기다리는 중…';
    return d;
  }
  const ch = ROSTER_BY_ID[s.charId] || ROSTER[0];
  const mine = canEdit(s);
  const owner = room.clients.find((c) => c.id === s.owner);
  d.className = `slot${mine ? ' mine' : ''}`;
  let who;
  let dev = '';
  if (s.bot) who = `🤖 ${esc(s.name)}`;
  else {
    who = `${esc(s.name)}${s.owner === room.you ? ' <em>(나)</em>' : ''}${s.owner === room.hostId && S.mode === 'online' ? ' 👑' : ''}`;
    if (s.owner === room.you) dev = DEVICE_LABELS[s.device] || s.device;
    else if (owner && !owner.online) dev = '⚠ 연결 끊김';
    else dev = '🌐 온라인';
  }
  d.innerHTML = `<span class="pnum">P${i + 1}</span>
    <div class="pic" ${mine ? 'title="캐릭터 바꾸기"' : ''}><img alt="${esc(ch.name)}" src="${portrait(ch.id)}"></div>
    <div class="cname">${esc(ch.name)}</div>
    <div class="pname">${who}</div>
    <div class="passive"><b>${esc(ch.passive.name)}</b> · ${esc(ch.passive.desc)}</div>
    <div class="row"></div>`;
  const row = d.querySelector('.row');
  if (mine) {
    d.querySelector('.pic').onclick = () => openCharPicker(i);
    row.append(button('캐릭터 변경', 'small', () => openCharPicker(i)));
  }
  if (!s.bot && s.owner === room.you) row.append(button(`🎮 ${esc(dev)}`, 'small dev-btn', () => cycleDevice(i)));
  else if (dev) row.insertAdjacentHTML('beforeend', `<span class="dev">${dev}</span>`);
  if (s.bot) {
    const lv = document.createElement('div');
    lv.className = 'chips mini';
    for (const l of [1, 2, 3]) {
      const c = document.createElement('button');
      c.className = `chip dark ${s.botLevel === l ? 'on' : ''}`;
      c.textContent = LEVEL_NAMES[l];
      c.disabled = !host;
      c.onclick = () => lobbyAction({ t: 'setBotLevel', slot: i, level: l });
      lv.append(c);
    }
    row.append(lv);
  }
  // 빼기: 오프라인이면 아무 자리나, 온라인이면 방장(봇·추가 자리) 또는 자기 자리
  const humanFirst = !s.bot && room.slots.filter((x) => x && x.owner === s.owner).length <= 1 && s.owner !== room.you;
  const canRemove = S.mode === 'offline' ? room.slots.filter(Boolean).length > 1 : (mine || host) && !humanFirst;
  if (canRemove) {
    const x = button('✕', 'tiny x', () => lobbyAction({ t: 'removeSlot', slot: i }));
    x.title = '자리 빼기';
    d.append(x);
  }
  return d;
}

function renderLobby() {
  const room = S.room;
  if (!room) return;
  const online = S.mode === 'online';
  const host = isHost();
  $('lobby-kind').textContent = online ? '온라인 대기실' : '오프라인 대기실';
  $('code-box').classList.toggle('hidden', !online);
  if (online) $('lobby-code').textContent = room.code;

  const box = $('slots');
  box.innerHTML = '';
  room.slots.forEach((s, i) => box.appendChild(slotCard(s, i, host)));

  const mc = $('map-chips');
  mc.innerHTML = '';
  const maps = [...MAP_LIST.map((m) => ({ id: m.id, name: m.name, desc: m.desc })), { id: 'random', name: '🎲 랜덤', desc: '경기마다 무작위 맵' }];
  for (const m of maps) {
    const c = document.createElement('button');
    c.className = `chip ${room.settings.mapId === m.id ? 'on' : ''}`;
    c.textContent = m.name;
    c.title = m.desc;
    c.disabled = !host;
    c.onclick = () => lobbyAction({ t: 'setMap', mapId: m.id });
    mc.append(c);
  }
  let desc = $('map-desc');
  if (!desc) {
    desc = document.createElement('p');
    desc.id = 'map-desc';
    desc.className = 'map-desc';
    mc.parentElement.after(desc);
  }
  desc.textContent = (maps.find((m) => m.id === room.settings.mapId) || maps[0]).desc;

  const wc = $('wins-chips');
  wc.innerHTML = '';
  for (const n of [1, 2, 3, 5]) {
    const c = document.createElement('button');
    c.className = `chip ${room.settings.winsNeeded === n ? 'on' : ''}`;
    c.textContent = `${n}승 선취`;
    c.disabled = !host;
    c.onclick = () => lobbyAction({ t: 'setWins', n });
    wc.append(c);
  }

  const filled = room.slots.filter(Boolean).length;
  const humans = room.slots.filter((s) => s && !s.bot).length;
  $('btn-add-bot').classList.toggle('hidden', !host);
  $('btn-add-bot').disabled = filled >= 4;
  $('btn-add-local').disabled = filled >= 4;
  const start = $('btn-start');
  let note = '';
  if (!host) {
    start.disabled = true;
    start.textContent = '방장이 시작하길 기다리는 중…';
    note = '맵과 승리 조건은 방장이 정해요.';
  } else if (online) {
    start.disabled = filled < 2;
    start.textContent = '경기 시작!';
    note = filled < 2 ? '초대코드를 친구에게 보내거나 봇을 추가하세요.' : room.clients.some((c) => !c.online) ? '연결이 끊긴 사람이 있어요.' : '';
  } else {
    start.disabled = filled < 1 || (humans === 0 && filled < 2);
    start.textContent = filled === 1 ? '연습 시작!' : humans === 0 ? '봇끼리 싸움 구경!' : '경기 시작!';
    note = filled === 1 ? '혼자면 연습 모드예요 (떨어져도 다시 나와요). 봇을 넣어 보세요!' : '';
  }
  $('lobby-note').textContent = note;
  const pads = input.connectedPads().length;
  $('pad-hint').textContent = pads
    ? `🎮 게임패드 ${pads}개 연결됨 — 아무 버튼이나 누르면 플레이어로 추가돼요.`
    : '🎮 게임패드를 연결하고 아무 버튼이나 누르면 플레이어로 추가돼요. (한 키보드로 둘이서도 가능)';
}

function pollLobbyPads() {
  for (const d of input.pollJoin()) {
    const mine = S.room.slots.some((s) => s && s.owner === S.room.you && !s.bot && s.device === d);
    if (!mine) addLocalPlayer(d);
  }
  const n = input.connectedPads().length;
  if (n !== S.padCount) {
    S.padCount = n;
    renderLobby();
  }
}

// ─── 온라인 연결 ─────────────────────────────────────────────────────────────

function startPing() {
  clearInterval(S.pingTimer);
  S.pingTimer = setInterval(() => S.net?.send({ t: 'ping', at: performance.now() }), 2500);
}

function bindNet(net) {
  net.on('joined', (m) => {
    net.session = { code: m.code, token: m.token };
    SS.set('brawl.session', JSON.stringify(net.session));
    S.mode = 'online';
    loading(false);
    try { history.replaceState(null, '', `${location.pathname}?room=${m.code}`); } catch { /* 무시 */ }
  });
  net.on('lobby', (m) => onLobby(m.room, m.notice));
  net.on('error', (m) => {
    if (!S.room) {
      loading(false);
      $('title-error').textContent = m.msg;
      net.session = null;
      net.close();
      if (S.net === net) S.net = null;
      S.mode = null;
    } else toast(m.msg);
  });
  net.on('start', (m) => startMatch(m.match));
  net.on('ev', (m) => S.game?.remoteEvents(m.list));
  net.on('matchEnd', (m) => { if (S.game && !S.game.isHost) S.game.finish(m.result); });
  net.on('peer', (m) => {
    if (S.game && S.game.isHost) S.game.peerChanged(m.id, m.online);
    if (m.id !== S.room?.you) toast(m.online ? `${m.name} 님 접속` : `${m.name} 님 연결 끊김${S.game ? ' — 봇이 대신 싸워요' : ''}`);
  });
  net.on('resumeFailed', () => {
    SS.del('brawl.session');
    if (S.room) toast('방이 사라졌어요.');
    leaveToTitle();
  });
  net.on('pong', (m) => { S.ping = performance.now() - m.at; });
  net.on('close', () => { if (S.net === net && !net.closedByUser) toast('서버 연결이 끊겼어요. 다시 연결하는 중…', 2000); });
  net.onBinary((data, src) => S.game?.onBinary(data, src));
}

async function goOnline(first) {
  unlockAudio();
  LS.set('brawl.name', myName());
  $('title-error').textContent = '';
  loading(true, '서버에 연결하는 중…');
  if (S.net) { S.net.close(); S.net = null; }
  const net = new Net();
  bindNet(net);
  try {
    await net.connect();
  } catch {
    loading(false);
    $('title-error').textContent = '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';
    return;
  }
  S.net = net;
  net.send({ ...first, name: myName(), devices: [DEFAULT_DEVICE] });
  startPing();
}

function onLobby(room, notice) {
  S.room = room;
  if (notice) toast(notice, 3500);
  if (S.game) {
    if (room.phase === 'lobby' && !S.game.ended) {
      S.game.destroy();
      S.game = null;
      show('lobby');
      renderLobby();
    }
    return;
  }
  if (room.phase === 'match' && room.match) {
    startMatch(room.match);
    return;
  }
  if (S.screen === 'result') return; // 결과를 보는 중이면 그대로 (버튼으로 대기실에 감)
  if (S.screen !== 'lobby') show('lobby');
  renderLobby();
}

function leaveToTitle() {
  if (S.game) { S.game.destroy(); S.game = null; }
  if (S.net) {
    S.net.send({ t: 'leave' });
    S.net.session = null;
    S.net.close();
    S.net = null;
  }
  clearInterval(S.pingTimer);
  SS.del('brawl.session');
  S.room = null;
  S.mode = null;
  loading(false);
  closeModal();
  try { history.replaceState(null, '', location.pathname); } catch { /* 무시 */ }
  show('title');
}

// ─── 경기 ────────────────────────────────────────────────────────────────────

const DEVICE_HINT = {
  kbA: 'WASD 이동 · J/K(마우스) 주먹, 꾹=잡기 · Space 점프 · L 발차기 · U 박치기 · F MMA · Shift 달리기',
  kbB: '방향키 이동 · 1/2 주먹 · 0 점프 · 3 발차기 · 4 박치기 · 5 MMA (숫자패드)',
  pad: 'LT/RT 주먹·잡기 · A 점프 · B 발차기 · X 박치기 · Y MMA · RB 달리기',
  touch: '왼쪽 스틱 이동 · 주먹 버튼 꾹 = 잡기 · MMA = 태클/수플렉스/초크',
};

function startOfflineMatch() {
  const room = S.room;
  const mapId = room.settings.mapId === 'random' ? MAP_LIST[Math.floor(Math.random() * MAP_LIST.length)].id : room.settings.mapId;
  startMatch({
    mapId,
    winsNeeded: room.settings.winsNeeded,
    seed: Math.floor(Math.random() * 1e9),
    hostId: 'me',
    slots: room.slots.map((s) => (s ? { ...s } : null)),
  });
}

function startMatch(match) {
  closeModal();
  unlockAudio();
  if (S.game) { S.game.destroy(); S.game = null; }
  const online = S.mode === 'online';
  const me = S.room.you;
  try {
    S.game = new Game({ match, myId: me, online, isHost: !online || match.hostId === me });
  } catch (err) {
    console.error(err);
    loading(false);
    S.game = null;
    modal(`<h3>앗, 시작할 수 없어요</h3><p>이 브라우저에서 3D(WebGL)를 켤 수 없어요. 최신 크롬·엣지·사파리로 열어 주세요.</p><pre class="err">${esc(err.message || err)}</pre>`);
    show(online || S.room ? 'lobby' : 'title');
  }
}

function compactEvent(ev, tick) {
  const out = { ...ev, k: tick };
  delete out.t;
  if (ev.pos) out.pos = { x: +ev.pos.x.toFixed(2), y: +ev.pos.y.toFixed(2), z: +ev.pos.z.toFixed(2) };
  if (ev.dir && typeof ev.dir === 'object') out.dir = { x: +ev.dir.x.toFixed(2), y: +(ev.dir.y || 0).toFixed(2), z: +ev.dir.z.toFixed(2) };
  if (ev.type === 'matchEnd') delete out.stats;
  return out;
}

class Game {
  constructor({ match, myId, online, isHost }) {
    this.match = match;
    this.myId = myId;
    this.online = online;
    this.isHost = isHost;
    this.roster = match.slots
      .map((s, i) => s && { slot: i, charId: s.charId, name: s.bot ? (ROSTER_BY_ID[s.charId]?.name || s.name) : s.name, bot: !!s.bot, botLevel: s.botLevel || 2, owner: s.owner, device: s.device, local: !s.bot && s.owner === myId })
      .filter(Boolean);
    this.locals = this.roster.filter((r) => r.local);
    this.sandbox = this.roster.length < 2;
    this.mapId = MAPS[match.mapId] ? match.mapId : 'octagon';
    this.yaw = MAPS[this.mapId].camera.yaw || 0;
    this.round = -1;
    this.meta = null;
    this.transforms = null;
    this.ended = false;
    this.dead = false;
    this.botSlots = new Set();
    this.badgeAt = 0;

    this.view = getView();
    show('game');
    input.enabled = true;
    hud.setup({ roster: this.roster, winsNeeded: match.winsNeeded, mapId: this.mapId, sandbox: this.sandbox });
    $('touch-ui').classList.toggle('hidden', !this.locals.some((r) => r.device === 'touch'));
    $('net-badge').classList.toggle('hidden', !online);
    const hints = this.locals.map((r) => {
      const h = DEVICE_HINT[r.device.startsWith('pad') ? 'pad' : r.device];
      return h ? `<span style="color:${SLOT_COLORS[r.slot]}">P${r.slot + 1}</span> ${h}` : '';
    }).filter(Boolean);
    const mapDef = MAPS[this.mapId];
    hud.hint(`<b>${esc(mapDef.name)}</b> — ${esc(mapDef.desc)}${hints.length ? `<br>${hints.join('<br>')}` : this.locals.length ? '' : '<br>관전 중'}`, 8000);
    startMusic();

    if (isHost) this.startHost();
    else this.startClient();
  }

  // ─── 방장: 워커에서 물리 ──────────────────────────────────────────────────

  startHost() {
    loading(true, '경기장을 준비하는 중…');
    this.worker = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.worker.onerror = (e) => this.fail(e.message || '물리 엔진을 불러오지 못했어요.');
    const players = this.roster.map((r) => ({ slot: r.slot, charId: r.charId, name: r.name, isBot: r.bot, botLevel: r.botLevel }));
    this.worker.postMessage({
      type: 'start',
      opts: { mapId: this.mapId, winsNeeded: this.match.winsNeeded, seed: this.match.seed, players },
      net: this.online,
    });
    if (this.online) {
      this.evBuf = [];
      this.evFlushAt = 0;
      this.scoresAt = 0;
      const others = S.room.clients.filter((c) => c.id !== this.myId);
      S.net.hostConnect(others.map((c) => c.id));
      for (const c of others) if (!c.online) this.peerChanged(c.id, false);
    }
  }

  onWorker(m) {
    if (this.dead) return;
    switch (m.type) {
      case 'ready':
        loading(false);
        this.ready = true;
        for (const s of this.botSlots) this.worker.postMessage({ type: 'bot', slot: s, on: true });
        break;
      case 'frame':
        this.onMeta(m);
        if (m.events.length) this.handleEvents(m.events);
        if (this.online) this.forwardEvents(m);
        break;
      case 'transforms':
        this.transforms = m.transforms;
        break;
      case 'snap':
        S.net?.broadcastBin(m.buf);
        break;
      case 'error':
        this.fail(m.message);
        break;
      default:
    }
  }

  onMeta(m) {
    if (m.round !== this.round) {
      this.round = m.round;
      this.view.setupRound(this.mapId, this.roster);
    }
    this.meta = m;
  }

  forwardEvents(m) {
    for (const ev of m.events) this.evBuf.push(compactEvent(ev, m.tick));
    const now = performance.now();
    if (now - this.scoresAt > 2000) {
      this.scoresAt = now;
      this.evBuf.push({ type: 'scores', scores: m.scores, k: m.tick });
    }
    if (this.evBuf.length && now - this.evFlushAt > 50) {
      this.evFlushAt = now;
      S.net.send({ t: 'ev', list: this.evBuf });
      this.evBuf = [];
    }
  }

  onRemoteInput(data, src) {
    let list;
    try { list = decodeInputs(data); } catch { return; }
    for (const p of list) {
      const s = this.match.slots[p.slot];
      if (!s || s.bot || s.owner === this.myId) continue;
      if (src !== 'ws' && s.owner !== src) continue; // 직접 연결: 자기 자리만
      this.worker?.postMessage({ type: 'input', slot: p.slot, input: { mx: p.mx, mz: p.mz, btn: p.btn, taps: p.taps } });
    }
  }

  /** 온라인 방장: 누가 끊기면 그 캐릭터는 봇이 대신 싸운다 */
  peerChanged(id, online) {
    if (!this.isHost || this.dead) return;
    for (const r of this.roster) {
      if (r.bot || r.owner !== id) continue;
      if (online) this.botSlots.delete(r.slot);
      else this.botSlots.add(r.slot);
      if (this.ready) this.worker.postMessage({ type: 'bot', slot: r.slot, on: !online });
    }
    if (online && this.online) S.net.hostConnectOne(id);
  }

  // ─── 참가자: 스냅샷 보간 ─────────────────────────────────────────────────

  startClient() {
    this.snaps = [];
    this.off = null;
    this.evQueue = [];
    this.buf = null;
    this.lastSend = 0;
    this.lastKey = '';
    loading(true, '방장의 경기장에 들어가는 중…');
    this.waitTimer = setTimeout(() => {
      if (!this.snaps.length && !this.dead) loading(true, '연결이 느려요… 조금만 기다려 주세요');
    }, 5000);
  }

  onBinary(data, src) {
    if (this.dead || !(data instanceof ArrayBuffer) || data.byteLength < 2) return;
    const type = new Uint8Array(data, 0, 1)[0];
    if (type === MSG.SNAPSHOT && !this.isHost) this.onSnapshot(data);
    else if (type === MSG.INPUT && this.isHost) this.onRemoteInput(data, src);
  }

  onSnapshot(buf) {
    let s;
    try { s = decodeSnapshot(buf); } catch { return; }
    let last = this.snaps[this.snaps.length - 1];
    if (last && s.tick <= last.tick) {
      if (last.tick - s.tick < 120) return; // 늦게 온 것 버림 (순서 없는 채널)
      // 방장이 새로고침해서 경기를 처음부터 다시 돌리는 중
      this.snaps = [];
      this.off = null;
      last = null;
    }
    const now = performance.now() / 1000;
    const o = s.tick / 60 - now;
    if (this.off === null || (last && s.tick - last.tick > 600)) {
      this.off = o;
      this.snaps = [];
    } else if (o > this.off) this.off = o;
    else this.off += (o - this.off) * 0.02;
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
    if (!this.gotFirst) {
      this.gotFirst = true;
      clearTimeout(this.waitTimer);
      loading(false);
    }
  }

  remoteEvents(list) {
    if (this.dead || this.isHost) return;
    for (const ev of list) this.evQueue.push(ev);
  }

  clientFrame() {
    const snaps = this.snaps;
    if (!snaps.length) return;
    const rt = performance.now() / 1000 + this.off - INTERP_DELAY;
    let a = snaps[0];
    let b = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].tick / 60 <= rt) {
        a = snaps[i];
        b = snaps[i + 1] || null;
        break;
      }
    }
    let tr = a.transforms;
    let meta = a;
    if (b && b.round === a.round && b.transforms.length === a.transforms.length) {
      const k = Math.max(0, Math.min(1, (rt - a.tick / 60) / ((b.tick - a.tick) / 60)));
      if (!this.buf || this.buf.length !== a.transforms.length) this.buf = new Float32Array(a.transforms.length);
      tr = lerpTransforms(a.transforms, b.transforms, k, this.buf);
      if (k > 0.5) meta = b;
    }
    if (meta.round !== this.round) {
      this.round = meta.round;
      this.view.setupRound(this.mapId, this.roster);
    }
    this.view.applyFrame(tr, meta.statuses);
    hud.frame(meta);
    // 오래된 스냅샷 정리
    while (snaps.length > 3 && snaps[1].tick / 60 < rt - 0.5) snaps.shift();
    // 화면 시간에 맞춰 이벤트(소리·효과) 내보내기
    if (this.evQueue.length) {
      const ready = [];
      while (this.evQueue.length && (this.evQueue[0].k === undefined || this.evQueue[0].k / 60 <= rt + 0.02 || this.evQueue.length > 60)) ready.push(this.evQueue.shift());
      if (ready.length) this.handleEvents(ready);
    }
  }

  // ─── 공통 ────────────────────────────────────────────────────────────────

  handleEvents(list) {
    const visual = [];
    for (const ev of list) {
      if (ev.type === 'scores') {
        hud.setScores(ev.scores);
        continue;
      }
      soundForEvent(ev);
      hud.event(ev);
      visual.push(ev);
      if (ev.type === 'matchEnd' && this.isHost) this.onMatchEnd(ev);
    }
    if (this.round >= 0) this.view.onEvents(visual);
  }

  onMatchEnd(ev) {
    if (this.endTimer) return;
    const result = { winner: ev.winner, scores: ev.scores, stats: ev.stats };
    this.endTimer = setTimeout(() => {
      if (this.online) S.net?.send({ t: 'matchEnd', result });
      this.finish(result);
    }, 1200);
  }

  readLocal() {
    return this.locals.map((r) => ({ slot: r.slot, ...input.read(r.device, this.yaw) }));
  }

  sendInputs(now) {
    if (!this.locals.length) return;
    const list = this.readLocal();
    if (this.isHost) {
      if (!this.worker) return;
      for (const p of list) this.worker.postMessage({ type: 'input', slot: p.slot, input: { mx: p.mx, mz: p.mz, btn: p.btn, taps: p.taps } });
      return;
    }
    // 바뀌었으면 바로(최대 60번/초), 아니어도 20번/초는 보낸다 (순서 없는 채널이라 잃어버려도 곧 다시 감)
    const key = list.map((p) => `${p.mx.toFixed(2)},${p.mz.toFixed(2)},${p.btn},${Object.values(p.taps).join('.')}`).join('|');
    const since = now - this.lastSend;
    if ((key !== this.lastKey && since >= 15) || since >= 50) {
      S.net?.sendToHost(encodeInputs(list), this.match.hostId);
      this.lastSend = now;
      this.lastKey = key;
    }
  }

  neutralInputs() {
    if (!this.isHost || !this.worker) return;
    for (const r of this.locals) this.worker.postMessage({ type: 'input', slot: r.slot, input: { mx: 0, mz: 0, btn: 0, taps: input.counter(r.device) } });
  }

  setPaused(on) {
    if (!this.online && this.worker) this.worker.postMessage({ type: 'pause', on });
  }

  updateBadge(now) {
    if (!this.online || now - this.badgeAt < 1000) return;
    this.badgeAt = now;
    const b = $('net-badge');
    const ping = S.ping !== null ? ` · ${Math.round(S.ping)}ms` : '';
    if (!S.net || !S.net.ws || S.net.ws.readyState !== 1) b.textContent = '⚠ 재연결 중…';
    else if (this.isHost) {
      const n = S.room.clients.length - 1;
      b.textContent = n ? `👑 방장 · 직접 연결 ${S.net.directCount()}/${n}${ping}` : `👑 방장${ping}`;
    } else {
      const direct = S.net.peers.get(this.match.hostId)?.open;
      b.textContent = `${direct ? '⚡ 직접 연결' : '🛰 서버 중계'}${ping}`;
    }
  }

  tick(dt, now) {
    if (this.dead) return;
    this.sendInputs(now);
    if (this.isHost) {
      if (this.transforms && this.meta && this.round >= 0) {
        this.view.applyFrame(this.transforms, this.meta.statuses);
        hud.frame(this.meta);
      }
    } else this.clientFrame();
    if (this.round < 0) return;
    this.view.render(dt);
    hud.nameplates(this.view);
    this.updateBadge(now);
  }

  finish(result) {
    if (this.ended) return;
    this.ended = true;
    const roster = this.roster;
    const online = this.online;
    this.destroy();
    if (S.game === this) S.game = null;
    showResult(result, roster, online);
  }

  fail(message) {
    console.error('[brawl]', message);
    const online = this.online;
    const host = this.isHost;
    this.destroy();
    if (S.game === this) S.game = null;
    if (online && host) S.net?.send({ t: 'backToLobby' });
    show(S.room ? 'lobby' : 'title');
    renderLobby();
    modal(`<h3>앗, 문제가 생겼어요</h3><p>물리 엔진을 돌리다가 오류가 났어요. 다시 시작해 주세요.</p><pre class="err">${esc(String(message).slice(0, 600))}</pre>`);
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    clearTimeout(this.endTimer);
    clearTimeout(this.waitTimer);
    if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
      const w = this.worker;
      setTimeout(() => w.terminate(), 100);
      this.worker = null;
    }
    if (this.online && S.net) S.net.closePeers();
    input.enabled = false;
    hud.clear();
    this.view.disposeScene();
    stopMusic();
    $('touch-ui').classList.add('hidden');
    $('net-badge').classList.add('hidden');
    if (modalOpen()) closeModal();
    loading(false);
  }
}

// ─── 메뉴 (경기 중) ─────────────────────────────────────────────────────────

function openMenu() {
  const g = S.game;
  if (!g || modalOpen()) return;
  g.setPaused(true);
  g.neutralInputs();
  input.enabled = false;
  const resume = () => {
    if (S.game !== g || g.dead) return;
    g.setPaused(false);
    input.enabled = true;
  };
  const offline = !g.online;
  const box = modal(`<h3>${offline ? '일시정지' : '메뉴'}</h3><div class="menu-list">
    <button class="btn big primary" data-a="resume">계속하기</button>
    <button class="btn" data-a="help">조작법</button>
    <div class="toggle-row"><span>효과음</span><button class="btn small" data-a="mute">${isMuted() ? '꺼짐' : '켜짐'}</button></div>
    <div class="toggle-row"><span>배경음악</span><button class="btn small" data-a="music">${isMusicOn() ? '켜짐' : '꺼짐'}</button></div>
    ${g.isHost ? `<button class="btn" data-a="lobby">${offline ? '대기실로 돌아가기' : '경기 끝내고 모두 대기실로'}</button>` : ''}
    <button class="btn" data-a="title">${offline ? '타이틀로' : '방 나가기'}</button>
    ${offline ? '' : '<p class="modal-note">온라인 경기는 멈추지 않아요!</p>'}
  </div>`, { onClose: resume });
  box.querySelectorAll('[data-a]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'resume') closeModal();
      else if (a === 'help') modal(helpHtml(), { onClose: resume });
      else if (a === 'mute') { setMuted(!isMuted()); b.textContent = isMuted() ? '꺼짐' : '켜짐'; }
      else if (a === 'music') { setMusic(!isMusicOn()); b.textContent = isMusicOn() ? '켜짐' : '꺼짐'; }
      else if (a === 'lobby') {
        modalClose = null;
        closeModal();
        if (offline) {
          g.destroy();
          S.game = null;
          show('lobby');
          renderLobby();
        } else S.net?.send({ t: 'backToLobby' });
      } else if (a === 'title') {
        modalClose = null;
        closeModal();
        if (offline) {
          g.destroy();
          S.game = null;
          S.room = null;
          S.mode = null;
          show('title');
        } else leaveToTitle();
      }
    };
  });
}

// ─── 결과 ────────────────────────────────────────────────────────────────────

function showResult(result, roster, online) {
  show('result');
  sfx('win');
  const w = roster.find((r) => r.slot === result.winner);
  const ch = w && ROSTER_BY_ID[w.charId];
  const rows = roster.map((r) => {
    const st = (result.stats || []).find((x) => x.slot === r.slot) || {};
    return { ...r, wins: result.scores?.[r.slot] || 0, dmg: st.damageDealt || 0, elim: st.eliminations || 0 };
  }).sort((a, b) => b.wins - a.wins || b.elim - a.elim || b.dmg - a.dmg);
  const award = (key, title) => {
    const best = rows.reduce((m, r) => (r[key] > (m ? m[key] : 0) ? r : m), null);
    return best ? `<div class="award"><span>${title}</span><b style="color:${SLOT_COLORS[best.slot]}">${esc(best.name)}</b></div>` : '';
  };
  $('result').innerHTML = `
    <h2>${w ? `🏆 ${esc(w.name)} 우승!` : '경기 끝!'}</h2>
    ${w ? `<div class="champ"><img alt="" src="${portrait(w.charId)}"><div><b>${esc(ch.name)}</b><p>${esc(ch.passive.name)} · ${esc(ch.passive.desc)}</p></div></div>` : ''}
    <table><tr><th>플레이어</th><th>승</th><th>준 피해 (%)</th><th>떨어뜨림</th></tr>
    ${rows.map((r) => `<tr><td class="nm"><span class="dot" style="background:${SLOT_COLORS[r.slot]}"></span>${esc(r.name)} <small>${r.bot ? '🤖' : esc(ROSTER_BY_ID[r.charId]?.name || '')}</small></td>
      <td>${r.wins}</td><td>${r.dmg}</td><td>${r.elim}</td></tr>`).join('')}</table>
    <div class="awards">${award('dmg', '💥 파괴왕')}${award('elim', '🪂 장외 전문가')}</div>
    <div class="acts">
      ${online ? '' : '<button class="btn big primary" id="r-again">한 판 더!</button>'}
      <button class="btn" id="r-lobby">대기실로</button>
      <button class="btn" id="r-title">${online ? '방 나가기' : '타이틀로'}</button>
    </div>`;
  $('r-again')?.addEventListener('click', () => startOfflineMatch());
  $('r-lobby').onclick = () => {
    if (!S.room) return show('title');
    if (S.room.phase === 'match' && S.room.match) return startMatch(S.room.match);
    show('lobby');
    renderLobby();
  };
  $('r-title').onclick = () => {
    if (online) leaveToTitle();
    else {
      S.room = null;
      S.mode = null;
      show('title');
    }
  };
}

// ─── 터치 조작 ───────────────────────────────────────────────────────────────

function setupTouch() {
  const stick = $('stick');
  const knob = stick.querySelector('.knob');
  let id = null;
  let cx = 0;
  let cy = 0;
  const R = 58;
  const move = (e) => {
    let dx = (e.clientX - cx) / R;
    let dy = (e.clientY - cy) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    input.touch.mx = dx;
    input.touch.mz = -dy;
    knob.style.transform = `translate(${dx * R * 0.7}px, ${dy * R * 0.7}px)`;
  };
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    id = e.pointerId;
    stick.setPointerCapture(id);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    move(e);
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  const up = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    input.touch.mx = 0;
    input.touch.mz = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerup', up);
  stick.addEventListener('pointercancel', up);
  for (const b of document.querySelectorAll('.tbtns button')) {
    const name = b.dataset.b;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('on');
      input.touchPress(name, true);
    });
    const rel = () => {
      b.classList.remove('on');
      input.touchPress(name, false);
    };
    b.addEventListener('pointerup', rel);
    b.addEventListener('pointercancel', rel);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

// ─── 시작 ────────────────────────────────────────────────────────────────────

function bindUi() {
  $('name').value = LS.get('brawl.name', '');
  $('name').addEventListener('change', () => LS.set('brawl.name', myName()));

  $('btn-quick').onclick = () => {
    unlockAudio();
    LS.set('brawl.name', myName());
    S.mode = 'offline';
    const room = freshOfflineRoom(false);
    const mine = room.slots[0].charId;
    const others = ROSTER.map((c) => c.id).filter((c) => c !== mine).sort(() => Math.random() - 0.5);
    for (let i = 1; i < 4; i++) room.slots[i] = { owner: null, device: 'bot', name: `봇 ${LEVEL_NAMES[2]}`, charId: others[i - 1], bot: true, botLevel: 2 };
    room.settings.mapId = 'random';
    S.room = room;
    startOfflineMatch();
  };
  $('btn-offline').onclick = () => {
    unlockAudio();
    LS.set('brawl.name', myName());
    S.mode = 'offline';
    S.room = freshOfflineRoom(true);
    show('lobby');
    renderLobby();
  };
  $('btn-create').onclick = () => goOnline({ t: 'create' });
  const join = () => {
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 5) {
      $('title-error').textContent = '초대코드 5자리를 입력해 주세요.';
      return;
    }
    goOnline({ t: 'join', code });
  };
  $('btn-join').onclick = join;
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('btn-help').onclick = () => modal(helpHtml());
  $('btn-lobby-help').onclick = () => modal(helpHtml());
  $('btn-roster').onclick = () => modal(rosterHtml());
  $('btn-settings').onclick = openSettings;

  $('btn-lobby-leave').onclick = () => {
    if (S.mode === 'online') leaveToTitle();
    else {
      S.room = null;
      S.mode = null;
      show('title');
    }
  };
  $('btn-copy-code').onclick = () => copy(S.room?.code || '', '초대코드를 복사했어요!');
  $('btn-copy-link').onclick = () => copy(`${location.origin}${location.pathname}?room=${S.room?.code || ''}`, '초대 링크를 복사했어요!');
  $('btn-add-bot').onclick = () => lobbyAction({ t: 'addBot', level: 2 });
  $('btn-add-local').onclick = () => addLocalPlayer();
  $('btn-start').onclick = () => { unlockAudio(); lobbyAction({ t: 'start' }); };
  $('btn-menu').onclick = openMenu;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (modalOpen()) closeModal();
      else if (S.game) openMenu();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) S.game?.neutralInputs(); });
  window.addEventListener('blur', () => S.game?.neutralInputs());
  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  document.addEventListener('click', (e) => { if (e.target.closest('.btn, .chip, .pick')) sfx('click'); });
  setupTouch();
}

let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  if (S.game) S.game.tick(dt, now);
  else if (S.screen === 'lobby' && S.room) pollLobbyPads();
}

function boot() {
  bindUi();
  const q = new URLSearchParams(location.search);
  const code = (q.get('room') || '').toUpperCase().slice(0, 5);
  let session = null;
  try { session = JSON.parse(SS.get('brawl.session') || 'null'); } catch { session = null; }
  if (session && session.code && session.token && (!code || code === session.code)) {
    // 새로고침: 같은 방으로 돌아간다
    goOnline({ t: 'resume', code: session.code, token: session.token });
  } else if (code) {
    $('code').value = code;
    $('title-error').textContent = '';
    toast(`초대받은 방 ${code} — 닉네임을 쓰고 참가를 누르세요!`, 5000);
    $('name').focus();
  }
  requestAnimationFrame(frame);
  window.__brawl = { S, input, hud, getView };
}

boot();
