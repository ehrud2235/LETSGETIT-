// 온라인 연결: 웹소켓(대기실·신호·중계) + WebRTC 데이터 채널(방장과 직접 연결, 더 빠름).
// 직접 연결이 안 되면 서버 중계로 자동으로 넘어간다.

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.binHandler = null;
    this.peers = new Map(); // 상대 id → { pc, dc, open }
    this.isHost = false;
    this.relaySet = '';
    this.retry = 0;
    this.closedByUser = false;
    this.session = null;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  onBinary(fn) {
    this.binHandler = fn;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/brawl-ws`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.retry = 0;
        this.handlers.open?.();
        resolve();
      };
      ws.onerror = () => { if (!opened) reject(new Error('서버에 연결할 수 없어요')); };
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          let m;
          try { m = JSON.parse(e.data); } catch { return; }
          if (m.t === 'rtc') this.onRtc(m.from, m.data);
          this.handlers[m.t]?.(m);
        } else {
          this.binHandler?.(e.data, 'ws');
        }
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.handlers.close?.();
        if (!this.closedByUser && this.session) {
          setTimeout(() => this.reconnect(), Math.min(5000, 300 * 2 ** this.retry++));
        }
      };
    });
  }

  async reconnect() {
    try {
      await this.connect();
      if (this.session) this.send({ t: 'resume', ...this.session });
    } catch {
      setTimeout(() => this.reconnect(), 2000);
    }
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  sendBin(buf) {
    if (this.ws && this.ws.readyState === 1 && this.ws.bufferedAmount < 128 * 1024) this.ws.send(buf);
  }

  close() {
    this.closedByUser = true;
    this.closePeers();
    if (this.ws) this.ws.close();
    this.ws = null;
  }

  // ─── WebRTC ────────────────────────────────────────────────────────────────

  closePeers() {
    for (const p of this.peers.values()) {
      try { p.dc?.close(); p.pc.close(); } catch { /* 무시 */ }
    }
    this.peers.clear();
    this.relaySet = '';
    this.clientIds = null;
  }

  /** 방장: 경기에 참가한 다른 사람들과 직접 연결을 시도한다 */
  hostConnect(clientIds) {
    this.isHost = true;
    this.closePeers();
    this.clientIds = clientIds.slice();
    for (const id of clientIds) this.hostConnectOne(id);
    this.updateRelay();
  }

  /** 방장: 한 사람과 다시 연결 (새로고침하고 돌아온 사람 등) */
  hostConnectOne(id) {
    const old = this.peers.get(id);
    if (old) {
      try { old.dc?.close(); old.pc.close(); } catch { /* 무시 */ }
      this.peers.delete(id);
    }
    if (this.clientIds && !this.clientIds.includes(id)) this.clientIds.push(id);
    if (typeof RTCPeerConnection === 'undefined') return this.updateRelay();
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const dc = pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 });
    dc.binaryType = 'arraybuffer';
    const peer = { pc, dc, open: false, id, pendingIce: [] };
    this.peers.set(id, peer);
    dc.onopen = () => { peer.open = true; this.updateRelay(); };
    dc.onclose = () => { peer.open = false; this.updateRelay(); };
    dc.onmessage = (e) => this.binHandler?.(e.data, id);
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: 'rtc', to: id, data: { ice: e.candidate } }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { peer.open = false; this.updateRelay(); }
    };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => {
      this.send({ t: 'rtc', to: id, data: { sdp: pc.localDescription } });
    }).catch(() => {});
    this.updateRelay();
  }

  /** 직접 연결이 안 된 사람에게만 서버가 스냅샷을 중계하도록 알린다 */
  updateRelay() {
    const need = (this.clientIds || []).filter((id) => !this.peers.get(id)?.open);
    const key = need.sort().join(',');
    if (key === this.relaySet) return;
    this.relaySet = key;
    this.send({ t: 'relay', ids: need });
  }

  async onRtc(from, data) {
    if (typeof RTCPeerConnection === 'undefined') return;
    let peer = this.peers.get(from);
    try {
      if (data.sdp && data.sdp.type === 'offer') {
        if (peer) try { peer.pc.close(); } catch { /* 무시 */ }
        const pc = new RTCPeerConnection({ iceServers: ICE });
        peer = { pc, dc: null, open: false, id: from, pendingIce: [] };
        this.peers.set(from, peer);
        pc.ondatachannel = (e) => {
          const dc = e.channel;
          dc.binaryType = 'arraybuffer';
          peer.dc = dc;
          dc.onopen = () => { peer.open = true; };
          dc.onclose = () => { peer.open = false; };
          dc.onmessage = (ev) => this.binHandler?.(ev.data, from);
        };
        pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: 'rtc', to: from, data: { ice: e.candidate } }); };
        await pc.setRemoteDescription(data.sdp);
        for (const c of peer.pendingIce) await pc.addIceCandidate(c).catch(() => {});
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ t: 'rtc', to: from, data: { sdp: pc.localDescription } });
      } else if (data.sdp && data.sdp.type === 'answer' && peer) {
        await peer.pc.setRemoteDescription(data.sdp);
        for (const c of peer.pendingIce || []) await peer.pc.addIceCandidate(c).catch(() => {});
        peer.pendingIce = [];
      } else if (data.ice && peer) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.ice).catch(() => {});
        else (peer.pendingIce ||= []).push(data.ice);
      }
    } catch {
      /* 직접 연결 실패 → 중계로 계속 */
    }
  }

  /** 방장 → 모두 (직접 연결된 사람은 데이터 채널, 나머지는 서버가 중계) */
  broadcastBin(buf) {
    let needRelay = false;
    for (const p of this.peers.values()) {
      if (p.open && p.dc.readyState === 'open' && p.dc.bufferedAmount < 64 * 1024) p.dc.send(buf);
      else needRelay = true;
    }
    if (needRelay || this.peers.size === 0 || this.relaySet) this.sendBin(buf);
  }

  /** 참가자 → 방장 */
  sendToHost(buf, hostId) {
    const p = this.peers.get(hostId);
    if (p && p.open && p.dc && p.dc.readyState === 'open') p.dc.send(buf);
    else this.sendBin(buf);
  }

  directCount() {
    return [...this.peers.values()].filter((p) => p.open).length;
  }
}
