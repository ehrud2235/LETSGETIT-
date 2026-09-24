'use strict';
/**
 * 맞은편 (THE OTHER SIDE) — 게임 서버.
 * - public/ 폴더의 HTML/JS/CSS 를 제공한다.
 * - /ws 웹소켓으로 방 만들기, 초대코드 참가, 실시간 게임 동기화를 처리한다.
 * - 게임 상태는 서버에만 있고, 각 플레이어는 자기 방의 모습만 받는다.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const G = require('./game/logic');

const PUBLIC_DIR = path.join(__dirname, 'public');
// 3D 렌더링용 Three.js 는 npm 패키지에서 바로 제공한다 (CDN 없이 LAN 에서도 동작)
const THREE_DIR = path.join(path.dirname(require.resolve('three')), '..', 'build');
const VENDOR_FILES = {
  '/vendor/three/three.module.js': path.join(THREE_DIR, 'three.module.js'),
  '/vendor/three/three.core.js': path.join(THREE_DIR, 'three.core.js'),
};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 O/0, I/1 제외
const CODE_LEN = 5;
const ROOM_IDLE_TTL_MS = 3 * 60 * 60 * 1000;
const LOBBY_DROP_MS = 2 * 60 * 1000;
const LOG_LIMIT = 300;
const CHAT_MAX_LEN = 200;
const NICK_MAX_LEN = 12;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = VENDOR_FILES[pathname] || path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!VENDOR_FILES[pathname] && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : VENDOR_FILES[pathname] ? 'public, max-age=86400' : 'public, max-age=300',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function cleanNick(nick) {
  const s = String(nick || '').replace(/\s+/g, ' ').trim().slice(0, NICK_MAX_LEN);
  return s || '이름 없는 누군가';
}

function createGameServer() {
  const rooms = new Map();

  function newCode() {
    for (;;) {
      let code = '';
      const bytes = crypto.randomBytes(CODE_LEN);
      for (let i = 0; i < CODE_LEN; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
      if (!rooms.has(code)) return code;
    }
  }

  const send = (ws, msg) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  };

  const partnerOf = (room, player) => room.players.find((p) => p !== player) || null;

  function lobbyPayload(room, me) {
    return {
      t: 'lobby',
      code: room.code,
      status: room.status,
      isHost: me.isHost,
      players: room.players.map((p) => ({ nick: p.nick, isHost: p.isHost, online: !!p.ws, me: p === me })),
    };
  }

  function broadcastLobby(room) {
    for (const p of room.players) send(p.ws, lobbyPayload(room, p));
  }

  function partnerInfo(room, player) {
    const partner = partnerOf(room, player);
    return partner ? { nick: partner.nick, online: !!partner.ws } : null;
  }

  function log(room, role, entry) {
    const arr = room.logs[role];
    arr.push({ ...entry, ts: Date.now() });
    if (arr.length > LOG_LIMIT) arr.splice(0, arr.length - LOG_LIMIT);
  }

  function endingPayload(room, role) {
    const nicks = {};
    for (const p of room.players) nicks[p.role] = p.nick;
    return {
      kind: 'ending',
      pages: G.endingFor(room.game, role, nicks),
      views: { A: G.viewFor(room.game, 'A'), B: G.viewFor(room.game, 'B') },
    };
  }

  function deliverOutputs(room, outputs) {
    for (const p of room.players) {
      const role = p.role;
      const list = (outputs[role] || []).map((o) => (o.kind === 'ending' ? endingPayload(room, role) : o));
      for (const o of list) {
        if (o.kind === 'narrate' || o.kind === 'event' || o.kind === 'hint') log(room, role, { type: o.kind, text: o.text });
        if (o.kind === 'doc') log(room, role, { type: 'doc', title: o.title, body: o.body, style: o.style });
      }
      send(p.ws, {
        t: 'state',
        view: G.viewFor(room.game, role),
        outputs: list,
        partner: partnerInfo(room, p),
        serverNow: Date.now(),
      });
    }
    if (room.game.ended) room.status = 'ended';
  }

  function sendResume(room, player) {
    if (room.status === 'lobby') {
      send(player.ws, lobbyPayload(room, player));
      return;
    }
    const role = player.role;
    send(player.ws, {
      t: 'resume',
      code: room.code,
      isHost: player.isHost,
      role,
      view: G.viewFor(room.game, role),
      log: room.logs[role].map((e) => (e.type === 'chat' ? { ...e, mine: e.from === player.id } : e)),
      partner: partnerInfo(room, player),
      ending: room.status === 'ended' ? endingPayload(room, role) : null,
      serverNow: Date.now(),
    });
  }

  function attach(ws, room, player) {
    if (player.ws && player.ws !== ws) {
      send(player.ws, { t: 'kicked', msg: '다른 창에서 같은 자리로 접속했어요.' });
      player.ws.ctx = null;
      player.ws.close();
    }
    player.ws = ws;
    player.lastSeen = Date.now();
    ws.ctx = { room, player };
    room.lastActive = Date.now();
    const partner = partnerOf(room, player);
    if (partner && room.status !== 'lobby') send(partner.ws, { t: 'partner', partner: partnerInfo(room, partner) });
  }

  function addPlayer(room, nick, isHost) {
    const player = {
      id: crypto.randomBytes(6).toString('hex'),
      token: crypto.randomBytes(16).toString('hex'),
      nick: cleanNick(nick),
      ws: null,
      role: null,
      isHost,
      lastSeen: Date.now(),
    };
    room.players.push(player);
    return player;
  }

  function removePlayer(room, player) {
    room.players = room.players.filter((p) => p !== player);
    if (!room.players.length) {
      rooms.delete(room.code);
      return;
    }
    if (!room.players.some((p) => p.isHost)) room.players[0].isHost = true;
    broadcastLobby(room);
  }

  function startGame(room) {
    const roles = Math.random() < 0.5 ? ['A', 'B'] : ['B', 'A'];
    room.players.forEach((p, i) => { p.role = roles[i]; });
    room.game = G.createGame();
    room.status = 'playing';
    room.logs = { A: [], B: [] };
    for (const p of room.players) {
      log(room, p.role, { type: 'narrate', text: G.START_TEXT[p.role] });
      send(p.ws, {
        t: 'start',
        role: p.role,
        prologue: G.PROLOGUE[p.role],
        startText: G.START_TEXT[p.role],
        view: G.viewFor(room.game, p.role),
        partner: partnerInfo(room, p),
        serverNow: Date.now(),
      });
    }
  }

  function handle(ws, msg) {
    const ctx = ws.ctx;
    switch (msg.t) {
      case 'ping':
        send(ws, { t: 'pong' });
        return;

      case 'create': {
        if (ctx) return;
        const room = { code: newCode(), players: [], status: 'lobby', game: null, logs: { A: [], B: [] }, lastActive: Date.now() };
        rooms.set(room.code, room);
        const player = addPlayer(room, msg.nick, true);
        attach(ws, room, player);
        send(ws, { t: 'joined', code: room.code, token: player.token, nick: player.nick });
        broadcastLobby(room);
        return;
      }

      case 'join': {
        if (ctx) return;
        const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const room = rooms.get(code);
        if (!room) return send(ws, { t: 'error', msg: '그런 초대코드의 방이 없어요. 코드를 다시 확인해주세요.' });
        const nick = cleanNick(msg.nick);
        if (room.status !== 'lobby') {
          // 진행 중인 방: 연결이 끊긴 같은 닉네임 자리가 있으면 이어서 하기
          const slot = room.players.find((p) => !p.ws && p.nick === nick);
          if (!slot) return send(ws, { t: 'error', msg: '이미 게임이 진행 중인 방이에요.' });
          attach(ws, room, slot);
          send(ws, { t: 'joined', code: room.code, token: slot.token, nick: slot.nick });
          sendResume(room, slot);
          return;
        }
        if (room.players.length >= 2) return send(ws, { t: 'error', msg: '방이 가득 찼어요. (2인용)' });
        const player = addPlayer(room, nick, false);
        attach(ws, room, player);
        send(ws, { t: 'joined', code: room.code, token: player.token, nick: player.nick });
        broadcastLobby(room);
        return;
      }

      case 'resume': {
        if (ctx) return;
        const room = rooms.get(String(msg.code || '').toUpperCase());
        const player = room && room.players.find((p) => p.token === msg.token);
        if (!player) return send(ws, { t: 'resumeFailed' });
        attach(ws, room, player);
        send(ws, { t: 'joined', code: room.code, token: player.token, nick: player.nick, resumed: true });
        sendResume(room, player);
        if (room.status === 'lobby') broadcastLobby(room);
        return;
      }

      default:
        break;
    }

    if (!ctx) return;
    const { room, player } = ctx;
    room.lastActive = Date.now();
    player.lastSeen = Date.now();

    switch (msg.t) {
      case 'start':
        if (!player.isHost || room.status !== 'lobby') return;
        if (room.players.length < 2) return send(ws, { t: 'error', msg: '두 사람이 모여야 시작할 수 있어요.' });
        if (room.players.some((p) => !p.ws)) return send(ws, { t: 'error', msg: '상대방의 연결이 끊겨 있어요. 잠시만 기다려주세요.' });
        startGame(room);
        return;

      case 'chat': {
        if (room.status === 'lobby') return;
        const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
        if (!text) return;
        const now = Date.now();
        if (now - (player.lastChat || 0) < 250) return;
        player.lastChat = now;
        for (const p of room.players) {
          log(room, p.role, { type: 'chat', from: player.id, nick: player.nick, text });
          send(p.ws, { t: 'chat', nick: player.nick, text, mine: p === player, ts: now });
        }
        return;
      }

      case 'act': {
        if (room.status !== 'playing' || !room.game) return;
        const outputs = G.act(room.game, player.role, msg.action);
        deliverOutputs(room, outputs);
        return;
      }

      case 'leave':
        ws.ctx = null;
        player.ws = null;
        if (room.status === 'lobby') {
          removePlayer(room, player);
        } else {
          const partner = partnerOf(room, player);
          if (partner) send(partner.ws, { t: 'partner', partner: partnerInfo(room, partner) });
        }
        return;

      case 'restart':
        if (!player.isHost || room.status !== 'ended') return;
        room.status = 'lobby';
        room.game = null;
        room.logs = { A: [], B: [] };
        for (const p of room.players) p.role = null;
        broadcastLobby(room);
        return;

      default:
        break;
    }
  }

  function onConnection(ws) {
    ws.ctx = null;
    ws.isAlive = true;
    let windowStart = Date.now();
    let count = 0;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > 30) return; // 과도한 메시지 무시
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      try {
        handle(ws, msg);
      } catch (err) {
        console.error('[ws] handler error', err);
      }
    });
    ws.on('close', () => {
      const ctx = ws.ctx;
      if (!ctx) return;
      const { room, player } = ctx;
      if (player.ws !== ws) return;
      player.ws = null;
      player.lastSeen = Date.now();
      if (room.status === 'lobby') broadcastLobby(room);
      else {
        const partner = partnerOf(room, player);
        if (partner) send(partner.ws, { t: 'partner', partner: partnerInfo(room, partner) });
      }
    });
  }

  function sweep() {
    const now = Date.now();
    for (const room of [...rooms.values()]) {
      if (room.status === 'lobby') {
        for (const p of [...room.players]) {
          if (!p.ws && now - p.lastSeen > LOBBY_DROP_MS) removePlayer(room, p);
        }
      } else if (room.players.every((p) => !p.ws) && now - room.lastActive > ROOM_IDLE_TTL_MS) {
        rooms.delete(room.code);
      }
    }
  }

  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
  wss.on('connection', onConnection);

  // 끊긴 연결 감지 + 오래된 방 정리
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
    sweep();
  }, 30000);
  heartbeat.unref();

  return {
    server,
    wss,
    rooms,
    close(cb) {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close(cb);
    },
  };
}

module.exports = { createGameServer };

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const { server } = createGameServer();
  server.listen(PORT, HOST, () => {
    console.log(`맞은편 서버 실행 중 → http://localhost:${PORT}`);
  });
}
