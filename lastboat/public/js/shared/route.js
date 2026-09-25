// 길 검사 (테스트·도구용): 격자에서 너비 우선 탐색으로 어디까지 걸어갈 수 있는지.
export function reachable(nav, from) {
  const start = nav.nearestFree(from[0], from[1], 3);
  const dist = new Int32Array(nav.N).fill(-1);
  if (start < 0) return dist;
  const q = new Int32Array(nav.N);
  let h = 0;
  let t = 0;
  q[t++] = start;
  dist[start] = 0;
  const W = nav.W;
  while (h < t) {
    const k = q[h++];
    const i = k % W;
    for (const [n, ok] of [[k - 1, i > 0], [k + 1, i < W - 1], [k - W, k >= W], [k + W, k < nav.N - W]]) {
      if (ok && dist[n] < 0 && nav.move[n] === 0) {
        dist[n] = dist[k] + 1;
        q[t++] = n;
      }
    }
  }
  return dist;
}

/** 격자 거리(m) 또는 -1 */
export function distTo(nav, dist, x, z, r = 2) {
  const k = nav.nearestFree(x, z, r);
  return k < 0 ? -1 : dist[k];
}
