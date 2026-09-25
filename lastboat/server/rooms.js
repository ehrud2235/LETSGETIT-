'use strict';
/**
 * 마지막 배 방 서버: 2인 협동 (방장 + 동료).
 * - 방장 브라우저가 게임을 계산하고, 서버는 둘 사이의 메시지와 스냅샷을 그대로 전달한다.
 * - 새로고침·끊김은 토큰으로 다시 들어온다. 방장이 오래 끊기면 방을 닫는다.
 */
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DIFFS = ['easy', 'normal', 'hard'];
const HOST_GRACE_MS = 30000;
const IDLE_MS = 30 * 60 * 1000;
const clean = (s, n = 10) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function createRooms() {
  const rooms = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

  function newCode() {
    for (;;) {
      const b = crypto.randomBytes(5);
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[b[i] % CODE_CHARS.length];
      if (!rooms.has(c)) return c;
    }
  }

  const member = (name) => ({ id: crypto.randomBytes(4).toString('hex'), token: crypto.randomBytes(16).toString('hex'), name: clean(name) || '생존자', ws: null, lastSeen: Date.now() });

  function state(room, who) {
    return {
      code: room.code,
      you: who,
      phase: room.phase,
      difficulty: room.difficulty,
      names: [room.host.name, room.guest ? room.guest.name : null],
      hostOnline: !!room.host.ws,
      guestOnline: !!(room.guest && room.guest.ws),
      game: room.phase === 'game' ? room.game : null,
    };
  }

  function broadcast(room, extra = {}) {
    send(room.host.ws, { t: 'lobby', room: state(room, 'host'), ...extra });
    if (room.guest) send(room.guest.ws, { t: 'lobby', room: state(room, 'guest'), ...extra });
  }

  function attach(ws, room, m, role) {
    if (m.ws && m.ws !== ws) {
      m.ws.ctx = null;
      m.ws.close();
    }
    m.ws = ws;
    m.lastSeen = Date.now();
    ws.ctx = { room, m, role };
    room.lastActive = Date.now();
  }

  const other = (ctx) => (ctx.role === 'host' ? ctx.room.guest : ctx.room.host);

  function handle(ws, msg) {
    if (msg.t === 'ping') return send(ws, { t: 'pong' });
    const ctx = ws.ctx;
    if (!ctx) {
      if (msg.t === 'create') {
        const room = { code: newCode(), host: member(msg.name), guest: null, phase: 'lobby', difficulty: DIFFS.includes(msg.difficulty) ? msg.difficulty : 'normal', game: null, lastActive: Date.now() };
        rooms.set(room.code, room);
        attach(ws, room, room.host, 'host');
        send(ws, { t: 'joined', code: room.code, token: room.host.token, role: 'host' });
        return broadcast(room);
      }
      if (msg.t === 'join') {
        const room = rooms.get(clean(msg.code, 5).toUpperCase());
        if (!room) return send(ws, { t: 'error', msg: '그런 초대코드의 방이 없어요.' });
        if (room.guest) return send(ws, { t: 'error', msg: '방이 가득 찼어요. (2인용)' });
        if (room.phase !== 'lobby') return send(ws, { t: 'error', msg: '이미 출발한 방이에요.' });
        room.guest = member(msg.name);
        attach(ws, room, room.guest, 'guest');
        send(ws, { t: 'joined', code: room.code, token: room.guest.token, role: 'guest' });
        send(room.host.ws, { t: 'peer', online: true, name: room.guest.name });
        return broadcast(room);
      }
      if (msg.t === 'resume') {
        const room = rooms.get(clean(msg.code, 5).toUpperCase());
        const m = room && [room.host, room.guest].find((x) => x && x.token === msg.token);
        if (!m) return send(ws, { t: 'resumeFailed' });
        const role = m === room.host ? 'host' : 'guest';
        attach(ws, room, m, role);
        send(ws, { t: 'joined', code: room.code, token: m.token, role, resumed: true });
        const o = other(ws.ctx);
        if (o) send(o.ws, { t: 'peer', online: true, name: m.name });
        send(ws, { t: 'lobby', room: state(room, role) });
        return;
      }
      return;
    }
    const { room, role } = ctx;
    room.lastActive = Date.now();
    ctx.m.lastSeen = Date.now();
    const isHost = role === 'host';
    switch (msg.t) {
      case 'difficulty':
        if (!isHost || room.phase !== 'lobby' || !DIFFS.includes(msg.value)) return;
        room.difficulty = msg.value;
        return broadcast(room);
      case 'start':
        if (!isHost || room.phase !== 'lobby') return;
        if (!room.guest || !room.guest.ws) return send(ws, { t: 'error', msg: '동료가 들어와야 출발할 수 있어요.' });
        room.phase = 'game';
        room.game = { seed: Math.floor(Math.random() * 1e9) };
        for (const [m, who] of [[room.host, 'host'], [room.guest, 'guest']]) send(m.ws, { t: 'start', seed: room.game.seed, difficulty: room.difficulty, names: [room.host.name, room.guest.name], you: who });
        return broadcast(room);
      case 'end':
        if (!isHost || room.phase !== 'game') return;
        room.phase = 'lobby';
        room.game = null;
        return broadcast(room);
      case 'to': {
        // 방장 ↔ 동료 JSON 전달 (사건·요청)
        const o = other(ctx);
        if (o && msg.data && typeof msg.data === 'object') send(o.ws, { t: 'from', data: msg.data });
        return;
      }
      case 'rtc': {
        const o = other(ctx);
        if (o) send(o.ws, { t: 'rtc', data: msg.data });
        return;
      }
      case 'leave': {
        ws.ctx = null;
        ctx.m.ws = null;
        if (isHost) {
          if (room.guest) send(room.guest.ws, { t: 'closed' });
          rooms.delete(room.code);
        } else {
          room.guest = null;
          if (room.phase === 'game') {
            room.phase = 'lobby';
            room.game = null;
          }
          send(room.host.ws, { t: 'peer', online: false, name: ctx.m.name });
          broadcast(room, { notice: `${ctx.m.name} 님이 나갔어요.` });
        }
        return;
      }
      default:
    }
  }

  function handleBinary(ws, data) {
    const ctx = ws.ctx;
    if (!ctx || ctx.room.phase !== 'game' || data.length < 2) return;
    const o = other(ctx);
    if (o && o.ws && o.ws.readyState === 1 && o.ws.bufferedAmount < 512 * 1024) o.ws.send(data, { binary: true });
  }

  wss.on('connection', (ws) => {
    ws.ctx = null;
    ws.isAlive = true;
    let windowStart = Date.now();
    let count = 0;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > 240) return;
      try {
        if (isBinary) handleBinary(ws, data);
        else {
          const msg = JSON.parse(data);
          if (msg && typeof msg.t === 'string') handle(ws, msg);
        }
      } catch (err) {
        if (!(err instanceof SyntaxError)) console.error('[lastboat]', err);
      }
    });
    ws.on('close', () => {
      const ctx = ws.ctx;
      if (!ctx || ctx.m.ws !== ws) return;
      ctx.m.ws = null;
      ctx.m.lastSeen = Date.now();
      const o = other(ctx);
      if (o) send(o.ws, { t: 'peer', online: false, name: ctx.m.name });
      if (ctx.room.phase === 'lobby') broadcast(ctx.room);
    });
  });

  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      if (!room.host.ws && now - room.host.lastSeen > HOST_GRACE_MS) {
        if (room.guest) send(room.guest.ws, { t: 'closed' });
        rooms.delete(room.code);
        continue;
      }
      if (room.guest && !room.guest.ws && room.phase === 'lobby' && now - room.guest.lastSeen > 60000) {
        room.guest = null;
        broadcast(room);
      }
      if (now - room.lastActive > IDLE_MS && !room.host.ws) rooms.delete(room.code);
    }
  }, 5000);
  timer.unref();

  return {
    wss,
    rooms,
    close() {
      clearInterval(timer);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}

module.exports = { createRooms };
