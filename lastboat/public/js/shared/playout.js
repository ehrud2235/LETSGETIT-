// 네트워크로 들어오는 상태(스냅샷·동료 위치)를 부드럽게 재생하는 시계 — 지터 버퍼.
// 패킷이 들쭉날쭉 오거나 몰려와도, 최근 도착 지연을 보고 버퍼를 알맞게 두고 일정한 속도로 재생한다.
//
//   push(st, now)  보낸 쪽 시각 st(초)의 표본이 내 시각 now(초)에 도착
//   time(now)      지금 그려야 할 보낸 쪽 시각 (이 시각을 사이에 둔 두 표본을 보간한다)

export class Playout {
  /**
   * min / max: 버퍼(초) 한계, window: 도착 지연을 몇 초 동안 볼지
   */
  constructor({ min = 0.05, max = 0.4, window = 3 } = {}) {
    this.min = min;
    this.max = max;
    this.window = window;
    this.reset();
  }

  reset() {
    this.hist = []; // [도착 시각, 전송 지연]
    this.newest = null;
    this.gap = 1 / 30;
    this.delay = this.min;
    this.minTr = 0;
    this.pt = null;
    this.lastNow = 0;
    this.lastArrive = -1;
  }

  push(st, now) {
    if (this.newest !== null && st < this.newest - 2) this.reset(); // 보낸 쪽이 처음부터 다시
    if (this.newest !== null && st > this.newest) this.gap += (Math.min(0.5, st - this.newest) - this.gap) * 0.1;
    if (this.newest === null || st > this.newest) this.newest = st;
    this.lastArrive = now;
    const tr = now - st;
    const h = this.hist;
    h.push([now, tr]);
    while (h.length > 2 && h[0][0] < now - this.window) h.shift();
    let lo = Infinity;
    for (const e of h) if (e[1] < lo) lo = e[1];
    this.minTr = lo;
    // 늦게 온 정도의 상위 5% + 표본 간격 + 여유
    const late = h.map((e) => e[1] - lo).sort((a, b) => a - b);
    const p95 = late[Math.min(late.length - 1, Math.floor(late.length * 0.95))];
    const want = Math.max(this.min, Math.min(this.max, this.gap + p95 + 0.012));
    // 늘릴 때는 빨리, 줄일 때는 천천히
    this.delay += (want - this.delay) * (want > this.delay ? 0.25 : 0.02);
    if (this.pt === null) {
      this.pt = st - this.delay;
      this.lastNow = now;
    }
  }

  time(now) {
    if (this.pt === null) return null;
    const dt = Math.max(0, Math.min(0.25, now - this.lastNow));
    this.lastNow = now;
    const ideal = now - this.minTr - this.delay;
    let pt = this.pt + dt;
    const err = ideal - pt;
    // 크게 어긋나면(멈췄다 돌아옴 등) 바로 맞추고, 아니면 재생 속도를 살짝 바꿔 천천히 맞춘다
    if (Math.abs(err) > 0.3) pt = ideal;
    else pt += err * Math.min(1, dt * 2);
    this.pt = pt;
    return pt;
  }

  /** 지금 버퍼 길이(초) — 화면 표시용 */
  buffer() {
    return this.delay;
  }
}

/**
 * 시각 순으로 쌓인 표본 목록에서 t 를 사이에 둔 두 표본과 비율을 찾는다.
 * 마지막 표본을 지나면 최대 maxExtra 초까지 앞으로 내다본다(외삽).
 * list: [{ t, ... }]  →  { a, b, k }  (b 가 null 이면 a 만 쓴다)
 */
export function bracket(list, t, maxExtra = 0.1) {
  const n = list.length;
  if (!n) return null;
  if (n === 1 || t <= list[0].t) return { a: list[0], b: null, k: 0 };
  for (let i = n - 1; i >= 1; i--) {
    const a = list[i - 1];
    const b = list[i];
    if (a.t <= t) {
      const span = b.t - a.t;
      if (span <= 0) return { a: b, b: null, k: 0 };
      const tt = Math.min(t, b.t + maxExtra);
      return { a, b, k: (tt - a.t) / span };
    }
  }
  return { a: list[0], b: null, k: 0 };
}
