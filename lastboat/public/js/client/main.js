// 화면 흐름: 타이틀 → (혼자 / 방 만들기 / 참가) → 대기실 → 게임 → 메뉴·끝.
import { Game } from './game.js';
import { Net } from './net.js';
import { MSG, decodeSnapshot, encodePlayerState, decodePlayerState, encodePing, pongOf, pingTime } from '../shared/protocol.js';
import { DIFFICULTY } from '../shared/sim.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);
const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
};
const SS = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* 무시 */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* 무시 */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = { screen: 'title', net: null, room: null, game: null, worker: null, mode: null, difficulty: LS.get('lastboat.diff', 'normal'), quality: LS.get('lastboat.quality', 'medium') };

function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === `scr-${name}`);
  S.screen = name;
}

function toast(text) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = text;
  $('toasts').appendChild(d);
  setTimeout(() => d.classList.add('out'), 2600);
  setTimeout(() => d.remove(), 3200);
}

function loading(on, text = '불러오는 중…') {
  $('loading').classList.toggle('hidden', !on);
  $('loading-text').textContent = text;
}

function myName() {
  return ($('name').value.trim() || LS.get('lastboat.name') || '생존자').slice(0, 10);
}

function modal(html) {
  $('modal-box').innerHTML = `<button class="btn tiny x" id="modal-x">✕</button>${html}`;
  $('modal').classList.remove('hidden');
  $('modal-x').onclick = closeModal;
  return $('modal-box');
}
function closeModal() {
  $('modal').classList.add('hidden');
}

function helpHtml() {
  return `<h3>조작법</h3>
  <table class="help"><tr><td>이동 / 달리기 / 숙이기</td><td>W A S D / 왼쪽 Shift / C·Ctrl</td></tr>
  <tr><td>둘러보기</td><td>마우스 (화면을 클릭하면 커서가 잠김)</td></tr>
  <tr><td>쏘기 / 밀쳐내기</td><td>마우스 왼쪽 / 마우스 오른쪽 · V</td></tr>
  <tr><td>장전</td><td>R</td></tr>
  <tr><td>무기 바꾸기</td><td>1 주무기 · 2 권총 · 4 구급상자 · Q 직전 무기 · 휠</td></tr>
  <tr><td>줍기·열기·읽기</td><td>E (동료 일으키기는 E 꾹)</td></tr>
  <tr><td>손전등</td><td>F</td></tr>
  <tr><td>목표·상태 보기</td><td>Tab (꾹)</td></tr>
  <tr><td>성능·연결 정보</td><td>P</td></tr>
  <tr><td>메뉴</td><td>Esc</td></tr></table>
  <ul class="tips">
    <li>길 안내는 없습니다. 표지판·게시판·쪽지·멀리 보이는 불빛을 보고 항구로 가는 길을 찾으세요.</li>
    <li>총소리는 좀비를 부릅니다. 손전등에 비친 좀비는 당신을 알아챕니다.</li>
    <li>좀비에게 둘러싸이면 오른쪽 버튼으로 밀쳐내세요.</li>
    <li>쓰러지면 동료가 E 를 꾹 눌러 일으켜 줄 수 있어요. 세 번째 쓰러지면 끝입니다.</li>
    <li><b>한 명이라도 죽으면 처음부터 다시</b> 시작합니다.</li>
  </ul>`;
}

function settingsHtml() {
  const sens = parseFloat(LS.get('lastboat.sens', '0.0022'));
  return `<h3>설정</h3>
  <div class="set"><span>마우스 감도</span><input type="range" id="set-sens" min="0.0008" max="0.006" step="0.0002" value="${sens}"></div>
  <div class="set"><span>소리 크기</span><input type="range" id="set-vol" min="0" max="1" step="0.05" value="${audio.getVolume()}"></div>
  <div class="set"><span>그래픽</span><div class="chips" id="set-q">${[['low', '낮음'], ['medium', '보통'], ['high', '높음']].map(([k, n]) => `<button class="chip ${S.quality === k ? 'on' : ''}" data-q="${k}">${n}</button>`).join('')}</div></div>
  <p class="sm">그래픽은 다음 판부터 적용돼요. 느리면 '낮음'으로.</p>`;
}

function openSettings() {
  const box = modal(settingsHtml());
  box.querySelector('#set-sens').oninput = (e) => {
    LS.set('lastboat.sens', e.target.value);
    if (S.game) S.game.player.sens = parseFloat(e.target.value);
  };
  box.querySelector('#set-vol').oninput = (e) => audio.setVolume(parseFloat(e.target.value));
  box.querySelectorAll('[data-q]').forEach((b) => {
    b.onclick = () => {
      S.quality = b.dataset.q;
      LS.set('lastboat.quality', S.quality);
      box.querySelectorAll('[data-q]').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
}

// ─── 방장 쪽: 워커 연결 ──────────────────────────────────────────────────────

/** 양쪽 공통: 1초마다 핑을 보내 왕복 시간을 잰다 (직접 연결이면 그 길로, 아니면 서버 경유) */
function pinger(net) {
  const st = { rtt: -1 };
  const timer = setInterval(() => net.sendFast(encodePing(performance.now())), 1000);
  return {
    st,
    handle(u, data) {
      if (u === MSG.PING) net.sendFast(pongOf(data));
      else if (u === MSG.PONG) st.rtt = st.rtt < 0 ? performance.now() - pingTime(data) : st.rtt * 0.7 + (performance.now() - pingTime(data)) * 0.3;
      else return false;
      return true;
    },
    stats: () => ({ direct: net.direct(), rtt: st.rtt }),
    stop: () => clearInterval(timer),
  };
}

function hostLink(net) {
  const worker = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
  S.worker = worker;
  let handlers = { snapshot() {}, events() {}, mate() {} };
  const ping = net ? pinger(net) : null;
  let guestInst = 0;
  const oldInst = new Set();
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'snap') {
      const s = decodeSnapshot(m.buf);
      handlers.snapshot(s);
      // 직접 연결이면 매 틱(30Hz), 서버 경유면 두 틱마다
      if (net && (m.tick % 2 === 0 || net.direct())) net.sendFast(m.buf);
    } else if (m.type === 'ev') {
      handlers.events(m.list);
      if (net) net.sendTo({ ev: m.list });
    } else if (m.type === 'error') {
      console.error(m.message);
      toast('시뮬레이션 오류가 났어요');
    }
  };
  worker.onerror = (e) => { console.error(e); toast('게임을 불러오지 못했어요'); };
  if (net) {
    net.onBinary((data) => {
      const u = new Uint8Array(data, 0, 1)[0];
      if (u === MSG.PSTATE) {
        const st = decodePlayerState(data);
        if (st.slot === 1) {
          // 동료 화면이 둘(옛 탭 등)이어도 가장 새 화면의 위치만 쓴다
          if (st.inst) {
            if (oldInst.has(st.inst)) return;
            if (st.inst !== guestInst) {
              if (guestInst) oldInst.add(guestInst);
              guestInst = st.inst;
            }
          }
          worker.postMessage({ type: 'pstate', slot: 1, st });
          handlers.mate(st, performance.now() / 1000);
        }
      } else ping.handle(u, data);
    });
    net.on('from', (m) => {
      const d = m.data || {};
      if (d.req) worker.postMessage({ type: 'req', slot: 1, req: d.req });
    });
  }
  return {
    worker,
    request(req) { worker.postMessage({ type: 'req', slot: 0, req }); },
    sendState(st) { worker.postMessage({ type: 'pstate', slot: 0, st }); },
    setHandlers(h) { handlers = { ...handlers, ...h }; },
    stats: () => (ping ? ping.stats() : null),
    dispose() { ping?.stop(); },
  };
}

function guestLink(net) {
  let handlers = { snapshot() {}, events() {} };
  const ping = pinger(net);
  net.onBinary((data) => {
    const u = new Uint8Array(data, 0, 1)[0];
    if (u === MSG.SNAP) handlers.snapshot(decodeSnapshot(data));
    else ping.handle(u, data);
  });
  net.on('from', (m) => {
    const d = m.data || {};
    if (d.ev) handlers.events(d.ev);
  });
  return {
    request(req) { net.sendTo({ req }); },
    sendState(st) { net.sendFast(encodePlayerState(st)); },
    setHandlers(h) { handlers = { ...handlers, ...h }; },
    stats: ping.stats,
    dispose() { ping.stop(); },
  };
}

// ─── 게임 시작·끝 ────────────────────────────────────────────────────────────

function startGame({ solo, isHost, names, difficulty, seed }) {
  // 서버는 출발할 때 'start' 와 '게임 중' 대기실 소식을 연달아 보낸다.
  // 게임은 한 번만 만든다 (두 번 만들면 보이지 않는 두 번째 내가 출발점에 서서 위치를 계속 보낸다)
  if (S.game || S.starting) return;
  S.starting = true;
  closeModal();
  loading(true, '도시를 만드는 중…');
  audio.unlock();
  setTimeout(() => {
    S.starting = false;
    if (S.game) return;
    try {
      const net = solo ? null : S.net;
      const link = isHost ? hostLink(net) : guestLink(net);
      show('game');
      const game = new Game({
        canvas: $('view'), slot: isHost ? 0 : 1, names, solo, isHost, link, quality: S.quality,
        onExit: () => exitGame(),
        onRestart: () => link.request({ r: 'restart' }),
      });
      S.game = game;
      S.link = link;
      if (isHost) {
        const players = solo ? [{ name: names[0] }] : [{ name: names[0] }, { name: names[1], connected: !!S.room?.guestOnline }];
        link.worker.postMessage({ type: 'start', players, difficulty, seed, peace: solo && new URLSearchParams(location.search).has('peace') });
        if (net) setTimeout(() => net.rtcStart(), 500);
      }
      loading(false);
      $('click-to-play').classList.remove('hidden');
      game.setEnabled(false);
    } catch (err) {
      console.error(err);
      loading(false);
      modal(`<h3>시작할 수 없어요</h3><p>이 브라우저에서 3D(WebGL)를 켤 수 없어요. 최신 크롬·엣지로 열어 주세요.</p><pre class="err">${esc(err.message)}</pre>`);
      show(solo ? 'title' : 'lobby');
    }
  }, 30);
}

function exitGame() {
  if (S.game) {
    S.game.dispose();
    S.game = null;
  }
  S.link?.dispose?.();
  S.link = null;
  if (S.worker) {
    S.worker.postMessage({ type: 'stop' });
    S.worker.terminate();
    S.worker = null;
  }
  document.exitPointerLock?.();
  $('pause').classList.add('hidden');
  $('click-to-play').classList.add('hidden');
  if (S.mode === 'online' && S.net) {
    if (S.room?.you === 'host') S.net.send({ t: 'end' });
    show('lobby');
    renderLobby();
  } else {
    S.mode = null;
    show('title');
  }
}

// ─── 포인터 잠금 / 일시정지 ──────────────────────────────────────────────────

function lockPointer() {
  const c = $('view');
  audio.unlock();
  const p = c.requestPointerLock?.();
  if (p && p.catch) p.catch(() => useDragLook());
}

function useDragLook() {
  if (!S.game) return;
  S.game.dragLook = true;
  $('click-to-play').classList.add('hidden');
  S.game.setEnabled(true);
  toast('마우스를 누른 채 끌어서 둘러보세요');
}

document.addEventListener('pointerlockchange', () => {
  if (!S.game) return;
  const locked = document.pointerLockElement === $('view');
  if (locked) {
    $('click-to-play').classList.add('hidden');
    $('pause').classList.add('hidden');
    S.game.setEnabled(true);
  } else if (!S.game.dragLook && !S.game.ended) {
    S.game.setEnabled(false);
    $('pause').classList.remove('hidden');
    $('pause-note').textContent = S.mode === 'online' ? '온라인에서는 게임이 멈추지 않아요!' : '';
  }
});
document.addEventListener('pointerlockerror', () => useDragLook());

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && S.game) {
    if (S.game.hud.noteOpen) {
      S.game.hud.closeNote();
      return;
    }
    if (S.game.dragLook) {
      const open = $('pause').classList.contains('hidden');
      $('pause').classList.toggle('hidden', !open);
      S.game.setEnabled(!open);
    }
  }
  if (e.code === 'KeyE' && S.game?.hud.noteOpen) S.game.hud.closeNote();
});

// ─── 온라인 ──────────────────────────────────────────────────────────────────

function bindNet(net) {
  net.on('joined', (m) => {
    net.session = { code: m.code, token: m.token };
    SS.set('lastboat.session', JSON.stringify(net.session));
    try { history.replaceState(null, '', `${location.pathname}?room=${m.code}`); } catch { /* 무시 */ }
  });
  net.on('lobby', (m) => {
    S.room = m.room;
    loading(false);
    if (m.notice) toast(m.notice);
    if (S.game || S.starting) {
      if (m.room.phase === 'lobby' && S.room.you === 'guest' && S.game) {
        toast('방장이 게임을 끝냈어요');
        exitGame();
      }
      return;
    }
    if (m.room.phase === 'game' && m.room.you === 'guest' && m.room.game) {
      startGame({ solo: false, isHost: false, names: m.room.names, difficulty: m.room.difficulty, seed: m.room.game.seed });
      return;
    }
    if (S.screen !== 'lobby') show('lobby');
    renderLobby();
  });
  net.on('error', (m) => {
    loading(false);
    if (!S.room) {
      $('title-error').textContent = m.msg;
      net.session = null;
      net.close();
      S.net = null;
      S.mode = null;
    } else toast(m.msg);
  });
  net.on('start', (m) => {
    if (S.game) return;
    startGame({ solo: false, isHost: S.room.you === 'host', names: m.names, difficulty: m.difficulty, seed: m.seed });
  });
  net.on('peer', (m) => {
    toast(m.online ? `${m.name} 님이 들어왔어요` : `${m.name} 님의 연결이 끊겼어요`);
    if (S.game && S.room?.you === 'host' && S.worker) {
      S.worker.postMessage({ type: 'conn', slot: 1, on: m.online, name: m.name });
      // 끊긴 쪽 직접 연결은 버리고, 돌아오면 새로 잇는다 (그 사이 사건은 서버로 → 돌아오면 전체 상태를 다시 보냄)
      S.net?.closePeer();
      if (m.online) {
        S.worker.postMessage({ type: 'resync' });
        setTimeout(() => S.net?.rtcStart(), 400);
      }
    }
  });
  net.on('closed', () => {
    toast('방이 닫혔어요');
    leaveOnline();
  });
  net.on('resumeFailed', () => {
    SS.del('lastboat.session');
    leaveOnline();
  });
  net.on('pong', () => {});
}

async function goOnline(first) {
  audio.unlock();
  LS.set('lastboat.name', myName());
  $('title-error').textContent = '';
  loading(true, '서버에 연결하는 중…');
  const net = new Net();
  bindNet(net);
  try {
    await net.connect();
  } catch {
    loading(false);
    $('title-error').textContent = '서버에 연결할 수 없어요.';
    return;
  }
  S.net = net;
  S.mode = 'online';
  net.send({ ...first, name: myName(), difficulty: S.difficulty });
  clearInterval(S.ping);
  S.ping = setInterval(() => net.send({ t: 'ping' }), 20000);
}

function leaveOnline() {
  if (S.game) exitGame();
  if (S.net) {
    S.net.send({ t: 'leave' });
    S.net.session = null;
    S.net.close();
    S.net = null;
  }
  clearInterval(S.ping);
  SS.del('lastboat.session');
  S.room = null;
  S.mode = null;
  loading(false);
  try { history.replaceState(null, '', location.pathname); } catch { /* 무시 */ }
  show('title');
}

function renderLobby() {
  const r = S.room;
  if (!r) return;
  const host = r.you === 'host';
  $('lobby-code').textContent = r.code;
  $('slot-host').innerHTML = `<b>${esc(r.names[0])}</b><small>방장 ${r.hostOnline ? '' : '· 연결 끊김'}</small>`;
  $('slot-guest').innerHTML = r.names[1] ? `<b>${esc(r.names[1])}</b><small>${r.guestOnline ? '동료' : '연결 끊김'}</small>` : '<b class="dim">빈 자리</b><small>초대코드를 친구에게 보내세요</small>';
  $('slot-guest').classList.toggle('empty', !r.names[1]);
  const dc = $('diff-chips');
  dc.innerHTML = '';
  for (const [k, d] of Object.entries(DIFFICULTY)) {
    const b = document.createElement('button');
    b.className = `chip ${r.difficulty === k ? 'on' : ''}`;
    b.textContent = d.label;
    b.disabled = !host;
    b.onclick = () => S.net.send({ t: 'difficulty', value: k });
    dc.appendChild(b);
  }
  $('btn-start').disabled = !host || !r.names[1] || !r.guestOnline;
  $('btn-start').textContent = host ? (r.names[1] ? '출발!' : '동료를 기다리는 중…') : '방장이 출발하길 기다리는 중…';
}

// ─── 타이틀 ──────────────────────────────────────────────────────────────────

function renderTitleDiff() {
  const dc = $('solo-diff');
  dc.innerHTML = '';
  for (const [k, d] of Object.entries(DIFFICULTY)) {
    const b = document.createElement('button');
    b.className = `chip ${S.difficulty === k ? 'on' : ''}`;
    b.textContent = d.label;
    b.onclick = () => {
      S.difficulty = k;
      LS.set('lastboat.diff', k);
      renderTitleDiff();
    };
    dc.appendChild(b);
  }
}

function boot() {
  $('name').value = LS.get('lastboat.name', '');
  renderTitleDiff();
  $('btn-solo').onclick = () => {
    LS.set('lastboat.name', myName());
    S.mode = 'solo';
    startGame({ solo: true, isHost: true, names: [myName()], difficulty: S.difficulty, seed: Math.floor(Math.random() * 1e9) });
  };
  $('btn-create').onclick = () => goOnline({ t: 'create' });
  const join = () => {
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 5) {
      $('title-error').textContent = '초대코드 5자리를 입력하세요.';
      return;
    }
    goOnline({ t: 'join', code });
  };
  $('btn-join').onclick = join;
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('btn-help').onclick = () => modal(helpHtml());
  $('btn-help2').onclick = () => modal(helpHtml());
  $('btn-settings').onclick = openSettings;
  $('btn-leave').onclick = leaveOnline;
  $('btn-copy').onclick = () => {
    const link = `${location.origin}${location.pathname}?room=${S.room?.code || ''}`;
    navigator.clipboard?.writeText(link).then(() => toast('초대 링크를 복사했어요'), () => prompt('복사해서 보내세요', link));
  };
  $('btn-start').onclick = () => S.net?.send({ t: 'start' });
  $('click-to-play').onclick = lockPointer;
  $('btn-resume').onclick = () => {
    $('pause').classList.add('hidden');
    if (S.game?.dragLook) S.game.setEnabled(true);
    else lockPointer();
  };
  $('btn-pause-help').onclick = () => modal(helpHtml());
  $('btn-pause-settings').onclick = openSettings;
  $('btn-quit').onclick = () => {
    if (S.mode === 'online') {
      if (S.room?.you === 'host') exitGame();
      else leaveOnline();
    } else exitGame();
  };
  $('modal').addEventListener('pointerdown', (e) => { if (e.target === $('modal')) closeModal(); });
  const q = new URLSearchParams(location.search);
  const code = (q.get('room') || '').toUpperCase().slice(0, 5);
  let sess = null;
  try { sess = JSON.parse(SS.get('lastboat.session') || 'null'); } catch { sess = null; }
  if (sess && sess.code && (!code || code === sess.code)) goOnline({ t: 'resume', code: sess.code, token: sess.token });
  else if (code) {
    $('code').value = code;
    toast(`초대받은 방 ${code} — 이름을 쓰고 참가를 누르세요`);
  }
  window.__lastboat = S;
}

boot();
