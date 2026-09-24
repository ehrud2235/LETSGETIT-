import { createViewer, createShowcase } from './viewer.js';
import { renderClockFace } from './clockface.js';
import { unlockAudio, sfx, playMusic, isMuted, setMuted } from './audio.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SESSION_KEY = 'otherside.session';
const NICK_KEY = 'otherside.nick';
const TOUCH = window.matchMedia('(pointer: coarse)').matches;
const DEBUG = new URLSearchParams(location.search).has('debug');
if (TOUCH) document.body.classList.add('touch');
if (DEBUG) document.body.classList.add('debug');

function store(key, val) {
  try {
    if (val == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
  } catch { /* 저장소를 쓸 수 없는 환경 */ }
}
function load(key, json = false) {
  try {
    const v = localStorage.getItem(key);
    return json ? JSON.parse(v) : v;
  } catch { return null; }
}

const S = {
  ws: null,
  retry: 0,
  kicked: false,
  session: load(SESSION_KEY, true),
  code: null,
  isHost: false,
  role: null,
  view: null,
  partner: null,
  selected: null,
  timeOffset: 0,
  panel: null,
  ending: null,
  pullUntil: 0,
  viewer: null,
  shows: [],
};

// ─── 화면 ────────────────────────────────────────────────────────────────────

function show(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === `screen-${name}`));
  S.screen = name;
}

function setRole(role) {
  S.role = role;
  if (role) document.body.dataset.role = role;
  else delete document.body.dataset.role;
}

// ─── 연결 ────────────────────────────────────────────────────────────────────

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => {
    S.retry = 0;
    $('#conn').classList.add('hidden');
    $('#conn-note').textContent = '';
    if (S.session) {
      if (S.screen === 'title') $('#conn-note').textContent = '이전 방에 다시 연결하는 중…';
      send({ t: 'resume', ...S.session });
    }
  };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMessage(m);
  };
  ws.onclose = () => {
    if (S.ws !== ws || S.kicked) return;
    if (S.session && S.screen !== 'title') $('#conn').classList.remove('hidden');
    setTimeout(connect, Math.min(8000, 400 * 2 ** S.retry++));
  };
}

function send(msg) {
  if (S.ws && S.ws.readyState === 1) {
    S.ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

const act = (action) => send({ t: 'act', action });

function saveSession(code, token) {
  S.session = { code, token };
  store(SESSION_KEY, S.session);
}
function clearSession() {
  S.session = null;
  store(SESSION_KEY, null);
}

function onMessage(m) {
  switch (m.t) {
    case 'joined':
      S.code = m.code;
      saveSession(m.code, m.token);
      history.replaceState(null, '', location.pathname + (DEBUG ? '?debug' : ''));
      break;
    case 'resumeFailed':
      clearSession();
      $('#conn-note').textContent = '';
      if (S.screen !== 'title') show('title');
      break;
    case 'lobby':
      onLobby(m);
      break;
    case 'start':
      onStart(m);
      break;
    case 'resume':
      onResume(m);
      break;
    case 'state':
      onState(m);
      break;
    case 'chat':
      addFeed({ type: 'chat', nick: m.nick, text: m.text, mine: m.mine });
      if (!m.mine) {
        sfx('message');
        if (S.viewer?.locked || TOUCH) toast(`💬 ${m.nick}: ${m.text}`);
      }
      break;
    case 'partner': {
      const was = S.partner?.online;
      S.partner = m.partner;
      renderPartner();
      if (S.screen === 'game' && m.partner && was !== m.partner.online) {
        addFeed({ type: 'system', text: m.partner.online ? `${m.partner.nick} 님이 돌아왔어요.` : `${m.partner.nick} 님의 연결이 끊어졌어요. 다시 들어올 때까지 기다려주세요.` });
      }
      break;
    }
    case 'error':
      if (S.screen === 'lobby') $('#lobby-note').textContent = m.msg;
      else $('#title-error').textContent = m.msg;
      break;
    case 'kicked':
      S.kicked = true;
      $('#conn').textContent = m.msg;
      $('#conn').classList.remove('hidden');
      break;
    default:
      break;
  }
}

// 무료 호스팅(Render 등)은 몇 분간 들어오는 메시지가 없으면 서버를 재운다.
// 창이 열려 있는 동안 1분마다 신호를 보내서, 퍼즐을 고민하는 사이 방이 사라지지 않게 한다.
setInterval(() => { if (S.session) send({ t: 'ping' }); }, 60000);

// ─── 타이틀 & 대기실 ─────────────────────────────────────────────────────────

function nickValue() {
  const nick = $('#nick').value.trim();
  store(NICK_KEY, nick);
  return nick;
}

function setupTitle() {
  $('#nick').value = load(NICK_KEY) || '';
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    $('#join-code').value = room.toUpperCase().slice(0, 5);
    setTimeout(() => $('#nick').focus(), 50);
  }

  $('#btn-create').addEventListener('click', () => {
    unlockAudio();
    $('#title-error').textContent = '';
    const nick = nickValue();
    if (!nick) { $('#title-error').textContent = '닉네임을 입력해주세요.'; $('#nick').focus(); return; }
    if (!send({ t: 'create', nick })) $('#title-error').textContent = '서버에 연결하는 중이에요. 잠시 후 다시 눌러주세요.';
  });

  const join = () => {
    unlockAudio();
    $('#title-error').textContent = '';
    const nick = nickValue();
    const code = $('#join-code').value.trim().toUpperCase();
    if (!nick) { $('#title-error').textContent = '닉네임을 입력해주세요.'; $('#nick').focus(); return; }
    if (code.length < 5) { $('#title-error').textContent = '5자리 초대코드를 입력해주세요.'; $('#join-code').focus(); return; }
    if (!send({ t: 'join', code, nick })) $('#title-error').textContent = '서버에 연결하는 중이에요. 잠시 후 다시 눌러주세요.';
  };
  $('#btn-join').addEventListener('click', join);
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('#join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  $('#btn-copy-code').addEventListener('click', () => copy(S.code, '#btn-copy-code', '코드 복사'));
  $('#btn-copy-link').addEventListener('click', () => copy(`${location.origin}/?room=${S.code}`, '#btn-copy-link', '초대 링크 복사'));
  $('#btn-start').addEventListener('click', () => { unlockAudio(); send({ t: 'start' }); });
  $('#btn-leave').addEventListener('click', leaveToTitle);
}

async function copy(text, btnSel, label) {
  const btn = $(btnSel);
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '복사됨!';
  } catch {
    window.prompt('아래 내용을 복사하세요', text);
  }
  setTimeout(() => { btn.textContent = label; }, 1400);
}

function leaveToTitle() {
  send({ t: 'leave' });
  clearSession();
  resetGameState();
  setRole(null);
  show('title');
  // 서버 쪽 연결 정보를 비우기 위해 새로 연결한다
  const old = S.ws;
  S.ws = null;
  if (old) old.close();
  connect();
}

function disposeViewer() {
  if (S.viewer) {
    S.viewer.dispose();
    S.viewer = null;
  }
}
function disposeShows() {
  for (const s of S.shows) s.dispose();
  S.shows = [];
}

function resetGameState() {
  disposeViewer();
  disposeShows();
  S.view = null;
  S.selected = null;
  S.ending = null;
  S.panel = null;
  closeModal();
  $('#feed').innerHTML = '';
  $('#ending-stage').innerHTML = '';
  $('#screen-ending').classList.remove('white');
  $('#flash').classList.remove('on');
}

function onLobby(m) {
  S.code = m.code;
  S.isHost = m.isHost;
  if (S.screen !== 'lobby') {
    resetGameState();
    setRole(null);
  }
  $('#conn-note').textContent = '';
  $('#lobby-code').textContent = m.code;
  const items = m.players.map((p) => `<li><span class="dot ${p.online ? '' : 'off'}"></span>${esc(p.nick)}${p.me ? ' <small>(나)</small>' : ''}<span class="tag">${p.isHost ? '방장' : '참가자'}</span></li>`);
  if (m.players.length < 2) items.push('<li class="empty">벽 너머의 누군가를 기다리는 중…</li>');
  $('#lobby-players').innerHTML = items.join('');
  const ready = m.players.length === 2 && m.players.every((p) => p.online);
  $('#btn-start').classList.toggle('hidden', !m.isHost);
  $('#btn-start').disabled = !ready;
  $('#lobby-note').textContent = m.isHost
    ? (ready ? '준비가 되면 게임을 시작하세요.' : '친구에게 초대코드나 링크를 보내주세요.')
    : '방장이 게임을 시작하기를 기다리는 중…';
  show('lobby');
}

// ─── 게임 시작 / 재접속 ─────────────────────────────────────────────────────

function onStart(m) {
  resetGameState();
  setRole(m.role);
  S.view = m.view;
  S.partner = m.partner;
  S.timeOffset = m.serverNow - Date.now();
  addFeed({ type: 'narrate', text: m.startText });
  S.startText = m.startText;
  show('prologue');
  $('#btn-wake').classList.add('hidden');
  typewriter($('#prologue-text'), m.prologue, 38, () => $('#btn-wake').classList.remove('hidden'));
}

function ensureViewer() {
  if (S.viewer || !S.role) return;
  try {
    S.viewer = createViewer($('#gl'), S.role, {
      onInteract: interact,
      onTarget: updatePrompt,
      onLockChange: (locked) => {
        $('#lock-overlay').classList.toggle('hidden', locked || TOUCH || !!S.panel || S.viewer?.controls.dragMode);
        if (locked) document.activeElement?.blur?.();
      },
    });
    S.viewer.attachJoystick($('#joystick'));
    $('#gl-error').classList.add('hidden');
  } catch (err) {
    console.error(err);
    $('#gl-error').classList.remove('hidden');
  }
}

function enterGame() {
  show('game');
  ensureViewer();
  renderAll();
  setDialog(S.startText || '');
  $('#lock-overlay').classList.toggle('hidden', TOUCH);
}

function onResume(m) {
  resetGameState();
  S.code = m.code;
  S.isHost = m.isHost;
  setRole(m.role);
  S.view = m.view;
  S.partner = m.partner;
  S.timeOffset = m.serverNow - Date.now();
  $('#conn-note').textContent = '';
  for (const e of m.log) addFeed(e, false);
  if (m.ending) {
    startEnding(m.ending, true);
    return;
  }
  show('game');
  ensureViewer();
  renderAll();
  setDialog('다시 연결되었다. 방은 떠나기 전 그대로다.');
  $('#lock-overlay').classList.toggle('hidden', TOUCH);
}

function onState(m) {
  S.view = m.view;
  if (m.partner) S.partner = m.partner;
  S.timeOffset = m.serverNow - Date.now();
  if (S.screen === 'game') renderAll();
  for (const o of m.outputs) handleOutput(o);
}

function handleOutput(o) {
  switch (o.kind) {
    case 'narrate':
      setDialog(o.text);
      addFeed({ type: 'narrate', text: o.text });
      if (S.panel) panelMessage(o.text);
      break;
    case 'event':
      toast(o.text);
      addFeed({ type: 'event', text: o.text });
      sfx('event');
      break;
    case 'hint':
      setDialog(`💡 ${o.text}`, 'hint');
      addFeed({ type: 'hint', text: `💡 ${o.text}` });
      break;
    case 'doc':
      addFeed({ type: 'doc', title: o.title, body: o.body, style: o.style });
      openDoc(o);
      break;
    case 'panel':
      openPanel(o);
      break;
    case 'panelResult':
      S.panel?.result?.(o.ok);
      break;
    case 'sfx':
      sfx(o.name);
      break;
    case 'music':
      playMusic(o.name);
      break;
    case 'got':
      requestAnimationFrame(() => document.querySelector(`.slot[data-item="${o.item}"]`)?.classList.add('new'));
      break;
    case 'partnerPull':
      S.pullUntil = Date.now() + o.windowMs;
      updatePullIndicator();
      break;
    case 'ending':
      startEnding(o);
      break;
    default:
      break;
  }
}

// ─── 렌더링 ─────────────────────────────────────────────────────────────────

function renderAll() {
  if (!S.view) return;
  $('#hud-room').textContent = S.view.roomName;
  S.viewer?.update(S.view);
  renderInventory();
  renderPartner();
  updateTimer();
  updatePrompt();
}

function renderPartner() {
  const p = S.partner;
  $('#hud-partner').textContent = p ? `${p.online ? '🟢' : '⚪'} ${p.nick}` : '';
  $('#hud-partner').title = p ? (p.online ? '벽 너머에 있음' : '연결 끊김') : '';
}

function renderInventory() {
  const inv = S.view.inventory;
  if (S.selected && !inv.some((i) => i.id === S.selected)) S.selected = null;
  $('#inventory').innerHTML = inv.length
    ? inv.map((it, i) => `<button class="slot ${S.selected === it.id ? 'selected' : ''}" data-item="${it.id}" title="${esc(it.name)}"><span class="num">${i + 1}</span><span class="ico">${it.icon}</span><span class="nm">${esc(it.name)}</span></button>`).join('')
    : '<div class="empty">소지품 없음</div>';
}

function updatePrompt() {
  const el = $('#prompt');
  const cross = $('#crosshair');
  const id = S.viewer?.target;
  if (!id || !S.view) {
    el.classList.remove('show');
    cross.classList.remove('active');
    return;
  }
  const seen = S.view.lit || id === 'switch' || (id === 'ceiling' && S.view.objects.stars);
  const name = seen ? S.view.labels[id] : '…?';
  const sel = S.selected && itemById(S.selected);
  const key = TOUCH ? '탭' : 'E';
  el.textContent = sel ? `${key} · ${sel.icon} ${sel.name} → ${name}` : `${key} · ${name}`;
  el.classList.add('show');
  cross.classList.add('active');
}

function updateTimer() {
  if (!S.view) return;
  const end = S.view.endedAt || Date.now() + S.timeOffset;
  $('#hud-timer').textContent = fmtTime(end - S.view.startedAt);
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ─── 대사 / 알림 ─────────────────────────────────────────────────────────────

// 요소마다 따로 타이머를 둔다 (프롤로그를 읽는 중에 대사가 도착해도 서로 끊지 않도록)
function typewriter(el, text, speed = 16, done) {
  clearInterval(el._timer);
  const chars = [...text];
  let i = 0;
  const finish = () => {
    clearInterval(el._timer);
    el._timer = null;
    el._finish = null;
    el.textContent = text;
    if (done) done();
  };
  el._finish = finish;
  el.onclick = () => el._finish?.();
  el.textContent = '';
  if (!chars.length) { finish(); return; }
  el._timer = setInterval(() => {
    i += 1;
    el.textContent = chars.slice(0, i).join('');
    if (i >= chars.length) finish();
  }, speed);
}

let fadeTimer = null;
function setDialog(text, cls = '', actions = []) {
  const d = $('#dialog');
  d.classList.toggle('hint', cls === 'hint');
  d.classList.toggle('empty', !text);
  d.classList.remove('faded');
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => d.classList.add('faded'), 12000);
  typewriter($('#dialog-text'), text, 14);
  const box = $('#dialog-actions');
  box.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = a.label;
    b.addEventListener('click', (e) => { e.stopPropagation(); a.run(); });
    box.appendChild(b);
  }
}

function toast(text) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, 6000);
}

// ─── 대화 & 기록 ─────────────────────────────────────────────────────────────

function addFeed(e, scroll = true) {
  const feed = $('#feed');
  const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
  const el = document.createElement('div');
  el.className = `entry ${e.type}`;
  if (e.type === 'chat') {
    el.classList.add(e.mine ? 'mine' : 'theirs');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = e.mine ? '나' : e.nick;
    const bubble = document.createElement('span');
    bubble.className = 'bubble';
    bubble.textContent = e.text;
    el.append(who, bubble);
  } else if (e.type === 'doc') {
    const b = document.createElement('button');
    b.textContent = `📄 ${e.title} — 다시 보기`;
    b.addEventListener('click', () => openDoc(e));
    el.appendChild(b);
  } else {
    el.textContent = e.text;
  }
  feed.appendChild(el);
  while (feed.children.length > 400) feed.firstChild.remove();
  if (!scroll || nearBottom || e.mine) feed.scrollTop = feed.scrollHeight;
}

function setupChat() {
  const input = $('#chat-input');
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text && send({ t: 'chat', text })) input.value = '';
    // 말을 마치면 다시 방으로 돌아간다
    if (!TOUCH && S.screen === 'game') {
      input.blur();
      S.viewer?.lock();
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') input.blur();
  });
  $('#chat-only').addEventListener('change', (e) => {
    $('#feed').classList.toggle('chat-only', e.target.checked);
    $('#feed').scrollTop = $('#feed').scrollHeight;
  });
}

// ─── 조작 ───────────────────────────────────────────────────────────────────

function itemById(id) {
  return S.view?.inventory.find((i) => i.id === id);
}

function interact(hotId) {
  unlockAudio();
  if (!S.view || S.panel) return;
  const action = { a: 'click', target: hotId };
  if (S.selected) action.item = S.selected;
  act(action);
  if (S.selected) selectItem(null);
}

function selectItem(id) {
  S.selected = id;
  renderInventory();
  updatePrompt();
}

function clickSlot(id) {
  unlockAudio();
  if (S.selected === id) {
    selectItem(null);
    setDialog('소지품을 내려놓았다.');
    return;
  }
  if (S.selected) {
    act({ a: 'combine', item: S.selected, with: id });
    selectItem(null);
    return;
  }
  selectItem(id);
  const it = itemById(id);
  const actions = [];
  if (it.doc) actions.push({ label: TOUCH ? '📖 읽기' : '📖 읽기 (R)', run: () => readSelected() });
  actions.push({ label: TOUCH ? '내려놓기' : '내려놓기 (Q)', run: () => { selectItem(null); setDialog('소지품을 내려놓았다.'); } });
  setDialog(`${it.icon} ${it.name}\n${it.desc}\n\n(든 채로 무언가를 조사하면 사용한다. 다른 소지품을 고르면 함께 써본다.)`, '', actions);
}

function readSelected() {
  const it = S.selected && itemById(S.selected);
  if (!it?.doc) return;
  selectItem(null);
  openDoc(it.doc);
}

function setupGameInput() {
  $('#inventory').addEventListener('click', (e) => {
    const slot = e.target.closest('.slot');
    if (slot) clickSlot(slot.dataset.item);
  });
  $('#dialog').addEventListener('click', () => $('#dialog-text')._finish?.());
  $('#lock-overlay').addEventListener('click', () => {
    unlockAudio();
    S.viewer?.lock();
    if (S.viewer?.controls.dragMode) $('#lock-overlay').classList.add('hidden');
  });
  $('#touch-act').addEventListener('click', () => S.viewer?.interactCenter());

  document.addEventListener('keydown', (e) => {
    if (S.screen !== 'game' || S.panel || !$('#modal').classList.contains('hidden')) return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const it = S.view?.inventory[Number(digit[1]) - 1];
      if (it) clickSlot(it.id);
      return;
    }
    switch (e.code) {
      case 'KeyQ':
        if (S.selected) { selectItem(null); setDialog('소지품을 내려놓았다.'); }
        break;
      case 'KeyR':
        readSelected();
        break;
      case 'KeyH':
        act({ a: 'hint' });
        break;
      case 'Enter':
      case 'KeyT':
        e.preventDefault();
        S.viewer?.unlock();
        $('#chat-input').focus();
        break;
      default:
        break;
    }
  });

  $('#btn-hint').addEventListener('click', () => act({ a: 'hint' }));
  const soundBtn = $('#btn-sound');
  const syncSound = () => { soundBtn.textContent = isMuted() ? '🔇' : '🔊'; };
  syncSound();
  soundBtn.addEventListener('click', () => { unlockAudio(); setMuted(!isMuted()); syncSound(); });
  $('#btn-wake').addEventListener('click', () => { unlockAudio(); enterGame(); });

  setInterval(updateTimer, 1000);
  setInterval(updatePullIndicator, 200);
}

// ─── 모달 / 패널 ─────────────────────────────────────────────────────────────

function openModal(html, cls = '') {
  const box = $('#modal-box');
  box.className = `modal ${cls}`;
  box.innerHTML = `<button class="modal-x" aria-label="닫기">✕</button>${html}`;
  box.querySelector('.modal-x').addEventListener('click', closeModal);
  $('#modal').classList.remove('hidden');
  S.viewer?.setPaused(true);
  $('#lock-overlay').classList.add('hidden');
}

function closeModal() {
  const wasOpen = !$('#modal').classList.contains('hidden');
  $('#modal').classList.add('hidden');
  $('#modal-box').innerHTML = '';
  S.panel = null;
  if (S.viewer && wasOpen) {
    S.viewer.setPaused(false);
    if (!TOUCH && !S.viewer.controls.dragMode) $('#lock-overlay').classList.remove('hidden');
  }
}

function openDoc(doc) {
  openModal(`<div class="doc"><h3>${esc(doc.title)}</h3><div class="doc-body">${esc(doc.body)}</div></div>`, `doc-${doc.style || 'note'}`);
  S.panel = null;
}

function panelMessage(text, cls = '') {
  const el = $('#modal-box .panel-msg');
  if (!el) return;
  el.className = `panel-msg ${cls}`;
  el.textContent = text;
}

function openPanel(o) {
  switch (o.panel) {
    case 'keypad': return openKeypad(o);
    case 'clock': return openClock(o);
    case 'radio': return openRadio(o);
    case 'door': return openDoor(o);
    default: return undefined;
  }
}

function openKeypad(o) {
  let code = '';
  openModal(`
    <h3>${esc(o.title)}</h3>
    <p class="panel-desc">${esc(o.text)}</p>
    <div class="keypad-display" id="kp-display">____</div>
    <div class="keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
      <button data-k="back">←</button><button data-k="0">0</button><button data-k="ok" class="enter">확인</button>
    </div>
    <p class="panel-msg">숫자 키보드로도 입력할 수 있다.</p>`);
  const display = $('#kp-display');
  const draw = () => { display.textContent = (code + '____').slice(0, 4); };
  const press = (k) => {
    if (k === 'back') code = code.slice(0, -1);
    else if (k === 'ok') {
      if (code.length === 4) act({ a: 'code', target: o.target, code });
      return;
    } else if (code.length < 4) code += k;
    sfx('click');
    display.classList.remove('shake');
    draw();
  };
  $('#modal-box .keypad').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) press(b.dataset.k);
  });
  S.panel = {
    key: (e) => {
      const d = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
      if (d) press(d[1]);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter' || e.code === 'NumpadEnter') press('ok');
    },
    result: (ok) => {
      if (ok) {
        display.style.color = 'var(--ok)';
        setTimeout(closeModal, 1100);
      } else {
        display.classList.remove('shake');
        void display.offsetWidth;
        display.classList.add('shake');
        code = '';
        setTimeout(draw, 400);
      }
    },
  };
}

function openClock(o) {
  let h = o.h;
  let m = o.m;
  openModal(`
    <h3>거꾸로 가는 시계</h3>
    <p class="panel-desc">${esc(o.text)}</p>
    <div class="clock-ui">
      <div id="clock-face"></div>
      <div class="clock-ctrl">
        <div class="row"><span>시침</span><button data-d="h-">−</button><button data-d="h+">+</button></div>
        <div class="row"><span>분침</span><button data-d="m-">−</button><button data-d="m+">+</button></div>
      </div>
    </div>
    <button class="btn primary wide" id="clock-set">이 시간으로 맞춘다</button>
    <p class="panel-msg"></p>`);
  const draw = () => { $('#clock-face').innerHTML = renderClockFace(h, m, true); };
  draw();
  $('#modal-box .clock-ctrl').addEventListener('click', (e) => {
    const d = e.target.closest('button')?.dataset.d;
    if (!d) return;
    if (d === 'h+') h = (h % 12) + 1;
    if (d === 'h-') h = ((h + 10) % 12) + 1;
    if (d === 'm+') { m += 5; if (m >= 60) { m = 0; h = (h % 12) + 1; } }
    if (d === 'm-') { m -= 5; if (m < 0) { m = 55; h = ((h + 10) % 12) + 1; } }
    sfx('tick');
    draw();
  });
  $('#clock-set').addEventListener('click', () => act({ a: 'clock', h, m }));
  S.panel = { result: (ok) => { if (ok) setTimeout(closeModal, 1500); } };
}

function openRadio(o) {
  let f = o.freq;
  const MIN = 875;
  const MAX = 1080;
  openModal(`
    <h3>오래된 라디오</h3>
    <p class="panel-desc">${esc(o.text)}</p>
    <div class="radio-display"><span id="rf">${(f / 10).toFixed(1)}</span> <small>MHz</small></div>
    <div class="radio-scale"><div class="needle" id="rneedle"></div></div>
    <div class="radio-btns">
      <button data-d="-10">◀◀ 1.0</button><button data-d="-1">◀ 0.1</button>
      <button data-d="1">0.1 ▶</button><button data-d="10">1.0 ▶▶</button>
    </div>
    <button class="btn primary wide" id="radio-set">이 주파수로 맞춘다</button>
    <p class="panel-msg"></p>`);
  const draw = () => {
    $('#rf').textContent = (f / 10).toFixed(1);
    $('#rneedle').style.left = `${((f - MIN) / (MAX - MIN)) * 100}%`;
  };
  draw();
  $('#modal-box .radio-btns').addEventListener('click', (e) => {
    const d = Number(e.target.closest('button')?.dataset.d);
    if (!d) return;
    f = Math.min(MAX, Math.max(MIN, f + d));
    sfx('click');
    draw();
  });
  $('#radio-set').addEventListener('click', () => act({ a: 'radio', freq: f }));
  S.panel = { result: () => {} };
}

function openDoor(o) {
  openModal(`
    <h3>문</h3>
    <p class="panel-desc">${esc(o.text)}</p>
    <div class="pull-indicator" id="pull-ind">맞은편의 기척을 기다리는 중…<div class="bar"></div></div>
    <button class="btn primary wide big" id="btn-pull">문고리를 당긴다</button>
    <p class="panel-msg">대화창으로 신호를 맞추세요. "하나, 둘, 셋!" (스페이스바로도 당길 수 있다)</p>`);
  $('#btn-pull').addEventListener('click', () => { unlockAudio(); act({ a: 'pull' }); });
  S.panel = {
    key: (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); act({ a: 'pull' }); } },
    result: () => {},
  };
  updatePullIndicator();
}

function updatePullIndicator() {
  const ind = document.getElementById('pull-ind');
  if (!ind) return;
  const left = S.pullUntil - Date.now();
  const active = left > 0;
  ind.classList.toggle('active', active);
  ind.firstChild.textContent = active ? '맞은편에서 문고리를 당기고 있다! 지금!' : '맞은편의 기척을 기다리는 중…';
  ind.querySelector('.bar').style.width = active ? `${(left / 5000) * 100}%` : '0';
}

function setupModal() {
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => {
    if ($('#modal').classList.contains('hidden')) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.target.tagName === 'INPUT') return;
    S.panel?.key?.(e);
  });
}

// ─── 엔딩 ───────────────────────────────────────────────────────────────────

function endingView(v) {
  return { ...v, lit: true, doorReady: false, objects: { ...v.objects, stars: false, door: 'unlocked' } };
}

function startEnding(o, immediate = false) {
  if (S.ending) return;
  S.ending = { pages: o.pages, views: o.views, i: -1 };
  closeModal();
  S.viewer?.unlock();
  $('#btn-ending-next').onclick = nextEndingPage;
  const begin = () => {
    disposeViewer();
    show('ending');
    nextEndingPage();
  };
  if (immediate) {
    S.ending.i = o.pages.length - 2;
    begin();
    return;
  }
  $('#flash').classList.add('on');
  setTimeout(() => {
    begin();
    $('#flash').classList.remove('on');
  }, 1800);
}

function nextEndingPage() {
  const E = S.ending;
  if (!E || E.i >= E.pages.length - 1) return;
  E.i += 1;
  const page = E.pages[E.i];
  const stage = $('#ending-stage');
  const text = $('#ending-text');
  const next = $('#btn-ending-next');
  const screen = $('#screen-ending');
  disposeShows();
  next.classList.add('hidden');
  stage.innerHTML = '';
  text.textContent = '';
  const reveal = (delay = 0) => setTimeout(() => next.classList.remove('hidden'), delay);

  switch (page.type) {
    case 'text':
    case 'epilogue':
      screen.classList.toggle('white', page.type === 'epilogue');
      typewriter(text, page.text, 45, () => reveal(600));
      break;
    case 'room':
      screen.classList.remove('white');
      stage.innerHTML = `<div class="show" id="show-one"></div><p class="caption">${esc(page.caption)}</p>`;
      S.shows.push(createShowcase($('#show-one'), endingView(E.views[page.which])));
      reveal(3000);
      break;
    case 'merge':
      screen.classList.remove('white');
      stage.innerHTML = `<div class="merge"><div class="m a" id="show-a"></div><div class="m b" id="show-b"></div></div><p class="caption">${esc(page.caption)}</p>`;
      S.shows.push(createShowcase($('#show-a'), endingView(E.views.A)));
      S.shows.push(createShowcase($('#show-b'), endingView(E.views.B)));
      playMusic('twinkle', { beat: 0.5, vol: 0.12 });
      reveal(5200);
      break;
    case 'credits':
      screen.classList.remove('white');
      renderCredits(page);
      break;
    default:
      reveal();
  }
}

function renderCredits(page) {
  $('#ending-text').innerHTML = `
    <div class="credits">
      <h1 class="logo"><span class="dawn">맞은</span><span class="dusk">편</span></h1>
      <p class="subtitle">THE OTHER SIDE</p>
      <div class="who">
        <span class="r">새벽의 방 · 서진</span><span>${esc(page.nicks.A || '?')}</span>
        <span class="r">노을의 방 · 별이</span><span>${esc(page.nicks.B || '?')}</span>
      </div>
      <p class="stat">탈출 시간 ${fmtTime(page.elapsedMs)} · 힌트 ${page.hints}회</p>
      <p class="last">두 사람은, 처음부터 한 사람이었습니다.</p>
      <div class="row">
        ${S.isHost ? '<button class="btn primary" id="btn-restart">다시 하기</button>' : ''}
        <button class="btn ghost" id="btn-home">처음 화면으로</button>
      </div>
      ${S.isHost ? '' : '<p class="stat">방장이 \'다시 하기\'를 누르면 같은 방에서 다시 시작해요.</p>'}
    </div>`;
  document.getElementById('btn-restart')?.addEventListener('click', () => send({ t: 'restart' }));
  document.getElementById('btn-home').addEventListener('click', leaveToTitle);
}

// ─── 시작 ───────────────────────────────────────────────────────────────────

setupTitle();
setupChat();
setupGameInput();
setupModal();
show('title');
connect();

if (DEBUG) {
  // 자동 테스트용: 물건 앞으로 순간이동해 바라보고, 화면 중앙으로 조사한다
  window.__os = {
    face: (id) => S.viewer?.face(id),
    interact: () => S.viewer?.interactCenter(),
    get role() { return S.role; },
    get target() { return S.viewer?.target; },
  };
}
