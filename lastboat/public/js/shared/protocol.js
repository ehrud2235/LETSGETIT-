// 네트워크용 이진 형식.
//  방장 → 동료: 스냅샷 (사람 2명 + 좀비 전부), 동료 → 방장: 내 캐릭터 상태, 양쪽: 핑
export const MSG = { SNAP: 1, PSTATE: 2, PING: 3, PONG: 4 };
const POS = 50; // 2cm 단위
const i16 = (v) => Math.max(-32767, Math.min(32767, Math.round(v)));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * s: { tick, runId, time, finaleLeft, boatT, players: [...], zombies: [...] }
 * 사람: { slot, x, z, yaw, pitch, hp, status, bleed, revive, flags, weapon, downs, conn }
 * 좀비: { id, x, z, yaw, state, variant, speed, flags }
 */
export function encodeSnapshot(s) {
  const nP = s.players.length;
  const nZ = Math.min(s.zombies.length, 65535);
  const buf = new ArrayBuffer(22 + nP * 15 + nZ * 10);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, MSG.SNAP); o += 1;
  v.setUint32(o, s.tick, true); o += 4;
  v.setUint16(o, s.runId & 0xffff, true); o += 2;
  v.setFloat32(o, s.time, true); o += 4;
  v.setFloat32(o, s.finaleLeft, true); o += 4;
  v.setFloat32(o, s.boatT, true); o += 4;
  v.setUint8(o, nP); o += 1;
  v.setUint16(o, nZ, true); o += 2;
  for (const p of s.players) {
    v.setUint8(o, p.slot);
    v.setInt16(o + 1, i16(p.x * POS), true);
    v.setInt16(o + 3, i16(p.z * POS), true);
    v.setInt16(o + 5, i16(wrap(p.yaw) * 10000), true);
    v.setInt8(o + 7, Math.max(-127, Math.min(127, Math.round(p.pitch * 80))));
    v.setUint8(o + 8, Math.max(0, Math.min(255, Math.round(p.hp))));
    v.setUint8(o + 9, p.status);
    v.setUint8(o + 10, Math.max(0, Math.min(255, Math.round(p.bleed * 4))));
    v.setUint8(o + 11, Math.max(0, Math.min(255, Math.round(p.revive * 255))));
    v.setUint8(o + 12, p.flags & 255);
    v.setUint8(o + 13, p.weapon & 255);
    v.setUint8(o + 14, (p.downs & 15) | (p.conn ? 16 : 0) | (p.medkit ? 32 : 0));
    o += 15;
  }
  for (let i = 0; i < nZ; i++) {
    const z = s.zombies[i];
    v.setUint16(o, z.id, true);
    v.setInt16(o + 2, i16(z.x * POS), true);
    v.setInt16(o + 4, i16(z.z * POS), true);
    v.setUint8(o + 6, Math.round(((wrap(z.yaw) + Math.PI) / (Math.PI * 2)) * 255) & 255);
    v.setUint8(o + 7, (z.state & 7) | ((z.variant & 31) << 3));
    v.setUint8(o + 8, Math.max(0, Math.min(255, Math.round(z.speed * 40))));
    v.setUint8(o + 9, z.flags & 255);
    o += 10;
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const v = new DataView(buf);
  let o = 1;
  const tick = v.getUint32(o, true); o += 4;
  const runId = v.getUint16(o, true); o += 2;
  const time = v.getFloat32(o, true); o += 4;
  const finaleLeft = v.getFloat32(o, true); o += 4;
  const boatT = v.getFloat32(o, true); o += 4;
  const nP = v.getUint8(o); o += 1;
  const nZ = v.getUint16(o, true); o += 2;
  const players = [];
  for (let i = 0; i < nP; i++) {
    const b = v.getUint8(o + 14);
    players.push({
      slot: v.getUint8(o),
      x: v.getInt16(o + 1, true) / POS,
      z: v.getInt16(o + 3, true) / POS,
      yaw: v.getInt16(o + 5, true) / 10000,
      pitch: v.getInt8(o + 7) / 80,
      hp: v.getUint8(o + 8),
      status: v.getUint8(o + 9),
      bleed: v.getUint8(o + 10) / 4,
      revive: v.getUint8(o + 11) / 255,
      flags: v.getUint8(o + 12),
      weapon: v.getUint8(o + 13),
      downs: b & 15,
      conn: !!(b & 16),
      medkit: !!(b & 32),
    });
    o += 15;
  }
  const zombies = new Array(nZ);
  for (let i = 0; i < nZ; i++) {
    const sv = v.getUint8(o + 7);
    zombies[i] = {
      id: v.getUint16(o, true),
      x: v.getInt16(o + 2, true) / POS,
      z: v.getInt16(o + 4, true) / POS,
      yaw: (v.getUint8(o + 6) / 255) * Math.PI * 2 - Math.PI,
      state: sv & 7,
      variant: sv >> 3,
      speed: v.getUint8(o + 8) / 40,
      flags: v.getUint8(o + 9),
    };
    o += 10;
  }
  return { tick, runId, time, finaleLeft, boatT, players, zombies };
}

/** 내 캐릭터 상태 (위치·시선·손전등·무기) + 보낸 시각(ms, 받는 쪽 지터 버퍼용) + 화면 번호 */
export function encodePlayerState(st) {
  const buf = new ArrayBuffer(19);
  const v = new DataView(buf);
  v.setUint8(0, MSG.PSTATE);
  v.setUint8(1, st.slot);
  v.setInt16(2, i16(st.x * POS), true);
  v.setInt16(4, i16(st.z * POS), true);
  v.setInt16(6, i16(wrap(st.yaw) * 10000), true);
  v.setInt8(8, Math.max(-127, Math.min(127, Math.round(st.pitch * 80))));
  v.setUint8(9, st.flags & 255);
  v.setUint8(10, st.weapon & 255);
  v.setUint16(11, st.seq & 0xffff, true);
  v.setUint32(13, Math.floor(st.time || 0) >>> 0, true);
  v.setUint16(17, (st.inst || 0) & 0xffff, true);
  return buf;
}

export function decodePlayerState(buf) {
  const v = new DataView(buf);
  return {
    slot: v.getUint8(1),
    x: v.getInt16(2, true) / POS,
    z: v.getInt16(4, true) / POS,
    yaw: v.getInt16(6, true) / 10000,
    pitch: v.getInt8(8) / 80,
    flags: v.getUint8(9),
    weapon: v.getUint8(10),
    seq: v.getUint16(11, true),
    time: buf.byteLength >= 17 ? v.getUint32(13, true) : 0,
    inst: buf.byteLength >= 19 ? v.getUint16(17, true) : 0,
  };
}

/** 핑: [종류][보낸 시각 ms(float64)] — 받은 쪽은 종류만 PONG 으로 바꿔 돌려준다 */
export function encodePing(ms) {
  const buf = new ArrayBuffer(9);
  const v = new DataView(buf);
  v.setUint8(0, MSG.PING);
  v.setFloat64(1, ms, true);
  return buf;
}

export function pongOf(buf) {
  const out = buf.slice(0);
  new Uint8Array(out)[0] = MSG.PONG;
  return out;
}

export function pingTime(buf) {
  return new DataView(buf).getFloat64(1, true);
}

/** 플레이어 상태 플래그 */
export const PF = { FLASH: 1, SPRINT: 2, MOVING: 4, HEALING: 8, REVIVING: 16, FIRING: 32, RELOADING: 64, CROUCH: 128 };
