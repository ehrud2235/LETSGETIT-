'use strict';
/**
 * 물렁 난투 방 서버.
 * - 대기실(슬롯 4개: 사람/봇, 캐릭터, 맵, 승수)을 관리한다.
 * - 경기 중 물리는 방장 브라우저가 계산하고, 서버는 스냅샷(방장→모두)과 입력(모두→방장)을 전달만 한다.
 * - 입력을 전달할 때 그 슬롯의 주인이 보낸 것인지 확인한다.
 * - WebRTC 직접 연결을 위한 신호(offer/answer/ICE)도 중계한다.
 */
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_SLOTS = 4;
const MAPS = ['octagon', 'rooftop', 'factory', 'pitch'];
const CHARS = ['wakgood', 'pungsin', 'dopamine', 'leedeoksu', 'bimil', 'haeruseok', 'roentgenium', 'dandap'];
const DEVICES = ['kbA', 'kbB', 'touch', 'pad0', 'pad1', 'pad2', 'pad3'];
const HOST_GRACE_MS = 15000;
const ROOM_IDLE_MS = 10 * 60 * 1000;
const MSG_INPUT = 1;
const MSG_SNAPSHOT = 2;

const clean = (s, n = 12) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function createBrawlRooms() {
  const rooms = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  const send = (ws, msg) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  };
  const sendBin = (ws, data) => {
    if (ws && ws.readyState === 1 && ws.bufferedAmount < 256 * 1024) ws.send(data, { binary: true });
  };

  function newCode() {
    for (;;) {
      const b = crypto.randomBytes(5);
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[b[i] % CODE_CHARS.length];
      if (!rooms.has(c)) return c;
    }
  }

  function roomState(room, forId) {
    return {
      code: room.code,
      hostId: room.hostId,
      you: forId,
      phase: room.phase,
      settings: room.settings,
      clients: [...room.clients.values()].map((c) => ({ id: c.id, name: c.name, online: !!c.ws })),
      slots: room.slots.map((s) => (s ? { ...s } : null)),
      match: room.phase === 'match' ? room.match : null,
    };
  }

  function broadcastLobby(room, extra = {}) {
    for (const c of room.clients.values()) send(c.ws, { t: 'lobby', room: roomState(room, c.id), ...extra });
  }

  function freeSlot(room) {
    return room.slots.findIndex((s) => !s);
  }

  function addHumanSlot(room, client, device, name) {
    const i = freeSlot(room);
    if (i < 0) return -1;
    const used = new Set(room.slots.filter(Boolean).map((s) => s.charId));
    const charId = CHARS.find((c) => !used.has(c)) || CHARS[i];
    room.slots[i] = { owner: client.id, device, name: clean(name) || client.name, charId, bot: false };
    return i;
  }

  function addClient(room, name) {
    const client = { id: crypto.randomBytes(4).toString('hex'), token: crypto.randomBytes(16).toString('hex'), name: clean(name) || '누군가', ws: null, lastSeen: Date.now() };
    room.clients.set(client.id, client);
    return client;
  }

  function attach(ws, room, client) {
    if (client.ws && client.ws !== ws) {
      client.ws.ctx = null;
      client.ws.close();
    }
    client.ws = ws;
    client.lastSeen = Date.now();
    ws.ctx = { room, client };
    room.lastActive = Date.now();
  }

  function removeClient(room, client) {
    room.clients.delete(client.id);
    room.slots = room.slots.map((s) => (s && s.owner === client.id ? null : s));
    if (!room.clients.size) {
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === client.id) room.hostId = [...room.clients.values()].find((c) => c.ws)?.id || [...room.clients.keys()][0];
    broadcastLobby(room);
  }

  function abortMatch(room, reason) {
    room.phase = 'lobby';
    room.relayIds = null;
    broadcastLobby(room, { notice: reason });
  }

  function isHost(ctx) {
    return ctx.room.hostId === ctx.client.id;
  }

  function handleJson(ws, msg) {
    const ctx = ws.ctx;
    if (msg.t === 'ping') return send(ws, { t: 'pong', at: msg.at });

    if (!ctx) {
      if (msg.t === 'create') {
        const room = {
          code: newCode(), hostId: null, clients: new Map(), slots: Array(MAX_SLOTS).fill(null),
          settings: { mapId: 'octagon', winsNeeded: 3 }, phase: 'lobby', lastActive: Date.now(), relayIds: null,
        };
        rooms.set(room.code, room);
        const client = addClient(room, msg.name);
        room.hostId = client.id;
        attach(ws, room, client);
        const devices = Array.isArray(msg.devices) ? msg.devices.filter((d) => DEVICES.includes(d)).slice(0, 2) : ['kbA'];
        for (const d of devices.length ? devices : ['kbA']) addHumanSlot(room, client, d, client.name);
        send(ws, { t: 'joined', code: room.code, id: client.id, token: client.token });
        broadcastLobby(room);
        return;
      }
      if (msg.t === 'join') {
        const room = rooms.get(clean(msg.code, 5).toUpperCase());
        if (!room) return send(ws, { t: 'error', msg: '그런 초대코드의 방이 없어요.' });
        if (room.phase !== 'lobby') return send(ws, { t: 'error', msg: '이미 경기가 진행 중이에요. 끝나면 다시 들어와 주세요.' });
        if (freeSlot(room) < 0) return send(ws, { t: 'error', msg: '방이 가득 찼어요. (최대 4명)' });
        const client = addClient(room, msg.name);
        attach(ws, room, client);
        const devices = Array.isArray(msg.devices) ? msg.devices.filter((d) => DEVICES.includes(d)).slice(0, 2) : ['kbA'];
        for (const d of devices.length ? devices : ['kbA']) addHumanSlot(room, client, d, client.name);
        send(ws, { t: 'joined', code: room.code, id: client.id, token: client.token });
        broadcastLobby(room);
        for (const c of room.clients.values()) if (c !== client) send(c.ws, { t: 'peer', id: client.id, online: true, name: client.name });
        return;
      }
      if (msg.t === 'resume') {
        const room = rooms.get(clean(msg.code, 5).toUpperCase());
        const client = room && [...room.clients.values()].find((c) => c.token === msg.token);
        if (!client) return send(ws, { t: 'resumeFailed' });
        attach(ws, room, client);
        send(ws, { t: 'joined', code: room.code, id: client.id, token: client.token, resumed: true });
        send(ws, { t: 'lobby', room: roomState(room, client.id) });
        for (const c of room.clients.values()) if (c !== client) send(c.ws, { t: 'peer', id: client.id, online: true, name: client.name });
        return;
      }
      return;
    }

    const { room, client } = ctx;
    room.lastActive = Date.now();
    client.lastSeen = Date.now();
    const lobby = room.phase === 'lobby';
    const slot = Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < MAX_SLOTS ? msg.slot : -1;
    const s = slot >= 0 ? room.slots[slot] : null;
    const mine = s && (s.owner === client.id || (s.bot && isHost(ctx)));

    switch (msg.t) {
      case 'addLocal':
        if (!lobby || !DEVICES.includes(msg.device)) return;
        if (room.slots.some((x) => x && x.owner === client.id && x.device === msg.device)) return;
        if (addHumanSlot(room, client, msg.device, `${client.name}${room.slots.filter((x) => x && x.owner === client.id).length + 1}`) < 0) {
          return send(ws, { t: 'error', msg: '빈 자리가 없어요.' });
        }
        return broadcastLobby(room);
      case 'setChar':
        if (!lobby || !mine || !CHARS.includes(msg.charId)) return;
        s.charId = msg.charId;
        return broadcastLobby(room);
      case 'setDevice':
        if (!lobby || !mine || s.bot || !DEVICES.includes(msg.device)) return;
        s.device = msg.device;
        return broadcastLobby(room);
      case 'removeSlot':
        if (!lobby || !(mine || isHost(ctx))) return;
        // 방장은 봇·다른 사람의 추가 로컬 자리를 뺄 수 있다. 사람의 첫 자리는 그 사람이 나가야 빠진다.
        if (s && !s.bot && room.slots.filter((x) => x && x.owner === s.owner).length <= 1 && s.owner !== client.id) return;
        room.slots[slot] = null;
        return broadcastLobby(room);
      case 'addBot': {
        if (!lobby || !isHost(ctx)) return;
        const i = freeSlot(room);
        if (i < 0) return send(ws, { t: 'error', msg: '빈 자리가 없어요.' });
        const used = new Set(room.slots.filter(Boolean).map((x) => x.charId));
        const charId = CHARS.find((c) => !used.has(c)) || CHARS[i];
        const level = [1, 2, 3].includes(msg.level) ? msg.level : 2;
        room.slots[i] = { owner: null, device: 'bot', name: `봇 ${['', '초보', '보통', '고수'][level]}`, charId, bot: true, botLevel: level };
        return broadcastLobby(room);
      }
      case 'setBotLevel':
        if (!lobby || !isHost(ctx) || !s || !s.bot || ![1, 2, 3].includes(msg.level)) return;
        s.botLevel = msg.level;
        s.name = `봇 ${['', '초보', '보통', '고수'][msg.level]}`;
        return broadcastLobby(room);
      case 'setMap':
        if (!lobby || !isHost(ctx) || !(MAPS.includes(msg.mapId) || msg.mapId === 'random')) return;
        room.settings.mapId = msg.mapId;
        return broadcastLobby(room);
      case 'setWins':
        if (!lobby || !isHost(ctx) || ![1, 2, 3, 5].includes(msg.n)) return;
        room.settings.winsNeeded = msg.n;
        return broadcastLobby(room);
      case 'start': {
        if (!lobby || !isHost(ctx)) return;
        const filled = room.slots.filter(Boolean);
        if (filled.length < 2) return send(ws, { t: 'error', msg: '두 명 이상(봇 포함) 있어야 시작할 수 있어요.' });
        if ([...room.clients.values()].some((c) => !c.ws)) return send(ws, { t: 'error', msg: '연결이 끊긴 사람이 있어요. 잠시만 기다려 주세요.' });
        room.phase = 'match';
        room.relayIds = null;
        const mapId = room.settings.mapId === 'random' ? MAPS[Math.floor(Math.random() * MAPS.length)] : room.settings.mapId;
        const match = { mapId, winsNeeded: room.settings.winsNeeded, seed: Math.floor(Math.random() * 1e9), hostId: room.hostId, slots: room.slots.map((x) => (x ? { ...x } : null)) };
        room.match = match;
        for (const c of room.clients.values()) send(c.ws, { t: 'start', match, you: c.id });
        return broadcastLobby(room);
      }
      case 'ev':
        if (lobby || !isHost(ctx) || !Array.isArray(msg.list)) return;
        for (const c of room.clients.values()) if (c !== client) send(c.ws, { t: 'ev', list: msg.list });
        return;
      case 'matchEnd':
        if (lobby || !isHost(ctx)) return;
        for (const c of room.clients.values()) if (c !== client) send(c.ws, { t: 'matchEnd', result: msg.result });
        room.phase = 'lobby';
        room.relayIds = null;
        return broadcastLobby(room);
      case 'backToLobby':
        if (lobby || !isHost(ctx)) return;
        return abortMatch(room, '방장이 경기를 끝냈어요.');
      case 'relay':
        if (!isHost(ctx) || !Array.isArray(msg.ids)) return;
        room.relayIds = new Set(msg.ids.map(String));
        return;
      case 'rtc': {
        const to = room.clients.get(String(msg.to));
        if (to) send(to.ws, { t: 'rtc', from: client.id, data: msg.data });
        return;
      }
      case 'chat': {
        const text = clean(msg.text, 120);
        if (!text) return;
        for (const c of room.clients.values()) send(c.ws, { t: 'chat', name: client.name, text, mine: c === client });
        return;
      }
      case 'leave':
        ws.ctx = null;
        client.ws = null;
        return removeClient(room, client);
      default:
    }
  }

  function handleBinary(ws, data) {
    const ctx = ws.ctx;
    if (!ctx || ctx.room.phase !== 'match' || data.length < 2) return;
    const { room, client } = ctx;
    const type = data[0];
    if (type === MSG_SNAPSHOT && room.hostId === client.id) {
      for (const c of room.clients.values()) {
        if (c === client) continue;
        if (room.relayIds && !room.relayIds.has(c.id)) continue;
        sendBin(c.ws, data);
      }
      return;
    }
    if (type === MSG_INPUT) {
      // 자기 슬롯의 입력만 방장에게 전달
      const n = data[1];
      if (data.length !== 2 + n * 10) return;
      for (let i = 0; i < n; i++) {
        const slot = data[2 + i * 10];
        const s = room.slots[slot];
        if (!s || s.owner !== client.id) return;
      }
      const host = room.clients.get(room.hostId);
      if (host) sendBin(host.ws, data);
    }
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
      if (++count > 200) return;
      try {
        if (isBinary) handleBinary(ws, data);
        else {
          const msg = JSON.parse(data);
          if (msg && typeof msg.t === 'string') handleJson(ws, msg);
        }
      } catch (err) {
        if (!(err instanceof SyntaxError)) console.error('[brawl] handler error', err);
      }
    });
    ws.on('close', () => {
      const ctx = ws.ctx;
      if (!ctx || ctx.client.ws !== ws) return;
      const { room, client } = ctx;
      client.ws = null;
      client.lastSeen = Date.now();
      for (const c of room.clients.values()) if (c !== client) send(c.ws, { t: 'peer', id: client.id, online: false, name: client.name });
      if (room.phase === 'lobby') broadcastLobby(room);
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
      const host = room.clients.get(room.hostId);
      // 방장이 오래 끊기면: 경기 중단, 다른 사람이 방장
      if (host && !host.ws && now - host.lastSeen > HOST_GRACE_MS) {
        const next = [...room.clients.values()].find((c) => c.ws);
        if (room.phase === 'match') abortMatch(room, '방장의 연결이 끊겨 경기를 중단했어요.');
        if (next) {
          removeClient(room, host);
          room.hostId = next.id;
          broadcastLobby(room, { notice: `${next.name} 님이 새 방장이에요.` });
        }
      }
      // 대기실에서 오래 끊긴 사람은 내보낸다
      if (room.phase === 'lobby') {
        for (const c of [...room.clients.values()]) if (!c.ws && now - c.lastSeen > 60000) removeClient(room, c);
      }
      if (rooms.has(room.code) && [...room.clients.values()].every((c) => !c.ws) && now - room.lastActive > ROOM_IDLE_MS) rooms.delete(room.code);
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

module.exports = { createBrawlRooms };
