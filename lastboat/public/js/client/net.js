// 온라인: 웹소켓(방·신호) + WebRTC 데이터 채널 두 개로 서버를 거치지 않고 직접 주고받는다.
//  'g': 순서·재전송 없음 (위치·스냅샷·핑 — 늦게 온 건 버린다)
//  'r': 순서·재전송 있음 (사건·요청 — 문 열기, 명중 같은 건 꼭 도착해야 한다)
// 직접 연결이 안 되면 서버(웹소켓)가 그대로 전달한다.
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.binHandler = null;
    this.peer = null;
    this.session = null;
    this.closedByUser = false;
    this.retry = 0;
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
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.retry = 0;
        resolve();
      };
      ws.onerror = () => { if (!opened) reject(new Error('서버에 연결할 수 없어요')); };
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          let m;
          try { m = JSON.parse(e.data); } catch { return; }
          if (m.t === 'rtc') this.onRtc(m.data);
          this.handlers[m.t]?.(m);
        } else this.binHandler?.(e.data);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.handlers.close?.();
        if (!this.closedByUser && this.session) setTimeout(() => this.reconnect(), Math.min(5000, 400 * 2 ** this.retry++));
      };
    });
  }

  async reconnect() {
    try {
      await this.connect();
      if (this.session) this.send({ t: 'resume', ...this.session });
    } catch {
      setTimeout(() => this.reconnect(), 2500);
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
    if (this.ws && this.ws.readyState === 1 && this.ws.bufferedAmount < 256 * 1024) this.ws.send(buf);
  }

  /** 빠른 길(직접 연결)이 있으면 그걸로, 없으면 서버로 */
  sendFast(buf) {
    const p = this.peer;
    if (this.peerOk() && p.open && p.dc && p.dc.readyState === 'open' && p.dc.bufferedAmount < 128 * 1024) p.dc.send(buf);
    else this.sendBin(buf);
  }

  /** 직접 연결이 살아 있나 (끊기는 중이면 채널이 한동안 'open' 으로 남아 있어서 따로 본다) */
  peerOk() {
    const p = this.peer;
    if (!p) return false;
    const s = p.pc.iceConnectionState;
    return s === 'connected' || s === 'completed';
  }

  /** 상대에게 JSON (사건·요청). 직접 연결이 있으면 그걸로, 없으면 서버로 */
  sendTo(data) {
    const r = this.peer && this.peer.rel;
    if (this.peerOk() && r && r.readyState === 'open' && r.bufferedAmount < 1024 * 1024) {
      r.send(JSON.stringify(data));
      return true;
    }
    return this.send({ t: 'to', data });
  }

  direct() {
    return !!(this.peer && this.peer.open && this.peerOk());
  }

  relOpen(ch) {
    ch.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      this.handlers.from?.({ t: 'from', data });
    };
  }

  close() {
    this.closedByUser = true;
    this.closePeer();
    if (this.ws) this.ws.close();
    this.ws = null;
  }

  closePeer() {
    if (this.peer) {
      try { this.peer.dc?.close(); this.peer.rel?.close(); this.peer.pc.close(); } catch { /* 무시 */ }
    }
    this.peer = null;
  }

  /** 방장이 먼저 연결을 제안한다 */
  rtcStart() {
    this.closePeer();
    if (typeof RTCPeerConnection === 'undefined') return;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const dc = pc.createDataChannel('g', { ordered: false, maxRetransmits: 0 });
    dc.binaryType = 'arraybuffer';
    const rel = pc.createDataChannel('r', { ordered: true });
    this.relOpen(rel);
    const peer = { pc, dc, rel, open: false, pending: [] };
    this.peer = peer;
    dc.onopen = () => { peer.open = true; };
    dc.onclose = () => { peer.open = false; };
    dc.onmessage = (e) => this.binHandler?.(e.data);
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: 'rtc', data: { ice: e.candidate } }); };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => this.send({ t: 'rtc', data: { sdp: pc.localDescription } })).catch(() => {});
  }

  async onRtc(data) {
    if (typeof RTCPeerConnection === 'undefined' || !data) return;
    try {
      if (data.sdp && data.sdp.type === 'offer') {
        this.closePeer();
        const pc = new RTCPeerConnection({ iceServers: ICE });
        const peer = { pc, dc: null, rel: null, open: false, pending: [] };
        this.peer = peer;
        pc.ondatachannel = (e) => {
          if (e.channel.label === 'r') {
            peer.rel = e.channel;
            this.relOpen(e.channel);
            return;
          }
          const dc = e.channel;
          dc.binaryType = 'arraybuffer';
          peer.dc = dc;
          dc.onopen = () => { peer.open = true; };
          dc.onclose = () => { peer.open = false; };
          dc.onmessage = (ev) => this.binHandler?.(ev.data);
        };
        pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: 'rtc', data: { ice: e.candidate } }); };
        await pc.setRemoteDescription(data.sdp);
        for (const c of peer.pending) await pc.addIceCandidate(c).catch(() => {});
        peer.pending = [];
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        this.send({ t: 'rtc', data: { sdp: pc.localDescription } });
      } else if (data.sdp && data.sdp.type === 'answer' && this.peer) {
        await this.peer.pc.setRemoteDescription(data.sdp);
        for (const c of this.peer.pending) await this.peer.pc.addIceCandidate(c).catch(() => {});
        this.peer.pending = [];
      } else if (data.ice && this.peer) {
        if (this.peer.pc.remoteDescription) await this.peer.pc.addIceCandidate(data.ice).catch(() => {});
        else this.peer.pending.push(data.ice);
      }
    } catch {
      /* 직접 연결 실패 → 서버 전달로 계속 */
    }
  }
}
