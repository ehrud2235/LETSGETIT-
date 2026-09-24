// 시계 맞추기 패널에 쓰는 큰 시계 (노을의 방: 숫자와 바늘이 거꾸로 돈다)
export function renderClockFace(h, m, reversed) {
  const cx = 50, cy = 50, r = 40;
  const dir = reversed ? -1 : 1;
  const nums = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const a = (dir * n * 30 * Math.PI) / 180;
    const x = (cx + Math.sin(a) * r * 0.74).toFixed(1);
    const y = (cy - Math.cos(a) * r * 0.74).toFixed(1);
    const flip = reversed ? ` transform="translate(${x} ${y}) scale(-1 1) translate(${-x} ${-y})"` : '';
    return `<text x="${x}" y="${(+y + 3.2).toFixed(1)}" font-size="9" text-anchor="middle" fill="#5a2f1d" font-family="sans-serif"${flip}>${n}</text>`;
  }).join('');
  const hourA = dir * ((h % 12) + m / 60) * 30;
  const minA = dir * m * 6;
  const spin = reversed ? '0;-360' : '0;360';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r + 6}" fill="#8a5230"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff4e0"/>
    ${nums}
    <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r * 0.48}" stroke="#5a2f1d" stroke-width="3.4" stroke-linecap="round" transform="rotate(${hourA} ${cx} ${cy})"/>
    <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r * 0.74}" stroke="#5a2f1d" stroke-width="2.2" stroke-linecap="round" transform="rotate(${minA} ${cx} ${cy})"/>
    <line x1="${cx}" y1="${cy + 6}" x2="${cx}" y2="${cy - r * 0.82}" stroke="#c0392b" stroke-width="1">
      <animateTransform attributeName="transform" type="rotate" values="${spin.split(';').map((v) => `${v} ${cx} ${cy}`).join(';')}" dur="3s" repeatCount="indefinite"/>
    </line>
    <circle cx="${cx}" cy="${cy}" r="2.6" fill="#5a2f1d"/>
  </svg>`;
}
