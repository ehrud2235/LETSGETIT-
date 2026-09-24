// 캔버스로 그리는 텍스처 모음. 외부 이미지 파일 없이 방의 모든 무늬와 글씨를 만든다.
import * as THREE from 'three';

export const THEMES = {
  A: { // 새벽: 차갑고 푸른, 텅 빈 현재
    wall: '#5d6f96', wallDeco: 'rgba(255,255,255,.06)', floor: '#46526f', ceiling: '#4a5a80', trim: '#98a8cc',
    wood: '#6d7896', woodDark: '#525c78', woodLight: '#8a96b3', paper: '#e4eaf5', ink: '#26304a',
    bedFrame: '#5d6886', mattress: '#cdd6e8', blanket: '#7c8db3', pillow: '#eef2fa', curtain: '#7584aa',
    lamp: '#e4ecff', window: '#9dbbff', skyTop: '#0e1a3d', skyMid: '#3b5a99', skyBot: '#a9bde0',
    glow: '#fff6c8', dark: '#05070d',
  },
  B: { // 노을: 따뜻하고 어지러운, 어린 날의 기억
    wall: '#d99a6c', wallDeco: 'rgba(255,255,255,.16)', floor: '#8c5a3c', ceiling: '#b07a66', trim: '#f6d2a2',
    wood: '#a8683f', woodDark: '#8a5230', woodLight: '#c98a5a', paper: '#fff4e0', ink: '#5a2f1d',
    bedFrame: '#b36b3e', mattress: '#fff0d8', blanket: '#e8795e', pillow: '#fff7ea', curtain: '#f2b45c',
    lamp: '#ffd9a8', window: '#ff9a5a', skyTop: '#40285e', skyMid: '#e46a5b', skyBot: '#ffcf7a',
    glow: '#fff6c8', dark: '#0d0604',
  },
};

const SANS = "'Gowun Dodum', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
const PEN = "'Nanum Pen Script', 'Gowun Dodum', cursive";

/** 캔버스에 그린 뒤 텍스처로 만든다. redraw(fn) 으로 다시 그릴 수 있다. */
export function canvasTex(w, h, draw, { repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.userData.redraw = (fn) => {
    g.clearRect(0, 0, w, h);
    fn(g, w, h);
    t.needsUpdate = true;
  };
  return t;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function starPath(g, cx, cy, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

// ─── 벽 / 바닥 ───────────────────────────────────────────────────────────────

export function wallTex(role, repeat) {
  const t = THEMES[role];
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = t.wall;
    g.fillRect(0, 0, w, h);
    g.fillStyle = t.wallDeco;
    if (role === 'A') {
      g.fillRect(0, 0, 32, h);
      g.fillRect(64, 0, 32, h);
    } else {
      for (const [x, y] of [[20, 20], [84, 20], [52, 64], [116, 64], [20, 108], [84, 108]]) {
        g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
      }
    }
  }, { repeat });
}

export function floorTex(role) {
  const t = THEMES[role];
  const rnd = mulberry32(role === 'A' ? 7 : 8);
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = t.floor;
    g.fillRect(0, 0, w, h);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const y = (r * h) / rows;
      let x = -rnd() * 200;
      while (x < w) {
        const len = 160 + rnd() * 200;
        const shade = (rnd() - 0.5) * 0.12;
        g.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
        g.fillRect(x, y, len, h / rows);
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.fillRect(x, y, 2, h / rows);
        x += len;
      }
      g.fillStyle = 'rgba(0,0,0,.3)';
      g.fillRect(0, y, w, 2);
    }
  }, { repeat: [2, 2] });
}

// ─── 창밖 ───────────────────────────────────────────────────────────────────

export function skyTex(role) {
  const t = THEMES[role];
  return canvasTex(512, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, t.skyTop);
    grad.addColorStop(0.6, t.skyMid);
    grad.addColorStop(1, t.skyBot);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const rnd = mulberry32(role === 'A' ? 3 : 4);
    if (role === 'A') {
      g.fillStyle = '#fff';
      for (let i = 0; i < 40; i++) {
        g.globalAlpha = 0.3 + rnd() * 0.6;
        g.fillRect(rnd() * w, rnd() * h * 0.5, 2, 2);
      }
      g.globalAlpha = 1;
      g.fillStyle = '#eef3ff';
      g.beginPath(); g.arc(380, 110, 40, 0, Math.PI * 2); g.fill();
      g.fillStyle = t.skyTop;
      g.beginPath(); g.arc(398, 98, 38, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(207,224,255,.35)';
      g.lineWidth = 2;
      for (let i = 0; i < 60; i++) {
        const x = rnd() * w, y = rnd() * h;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - 6, y + 28); g.stroke();
      }
      g.fillStyle = '#0f1830';
    } else {
      g.fillStyle = '#ffe29a';
      g.beginPath(); g.arc(200, 420, 70, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#5a2f3d';
      g.lineWidth = 4;
      for (const [x, y] of [[90, 140], [150, 110], [330, 170]]) {
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 12, y - 12, x + 24, y); g.quadraticCurveTo(x + 36, y - 12, x + 48, y); g.stroke();
      }
      g.fillStyle = '#5c2a3c';
    }
    // 건물 실루엣
    let x = 0;
    while (x < w) {
      const bw = 40 + rnd() * 60;
      const bh = 60 + rnd() * 110;
      g.fillRect(x, h - bh, bw - 4, bh);
      if (role === 'A') {
        g.fillStyle = 'rgba(255,230,160,.5)';
        for (let i = 0; i < 3; i++) if (rnd() > 0.5) g.fillRect(x + 8 + rnd() * (bw - 24), h - bh + 12 + rnd() * (bh - 30), 6, 8);
        g.fillStyle = '#0f1830';
      }
      x += bw;
    }
  });
}

// ─── 시계 ───────────────────────────────────────────────────────────────────

export function drawClockFace(g, w, h, reversed, t) {
  const cx = w / 2, cy = h / 2, r = w / 2 - 4;
  g.fillStyle = t.paper;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = t.ink;
  const dir = reversed ? -1 : 1;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const len = i % 5 ? 6 : 14;
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    g.fillRect(-1.5, -r + 6, 3, len);
    g.restore();
  }
  g.font = `bold 34px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let n = 1; n <= 12; n++) {
    const a = dir * n * (Math.PI / 6);
    const x = cx + Math.sin(a) * r * 0.72;
    const y = cy - Math.cos(a) * r * 0.72;
    g.save();
    g.translate(x, y);
    if (reversed) g.scale(-1, 1); // 숫자 자체도 거울에 비친 것처럼
    g.fillText(String(n), 0, 2);
    g.restore();
  }
}

export function clockFaceTex(role, reversed) {
  const t = THEMES[role];
  return canvasTex(256, 256, (g, w, h) => drawClockFace(g, w, h, reversed, t));
}

// ─── 액자 / 벽 장식 ─────────────────────────────────────────────────────────

export function drawPhoto(g, w, h) {
  g.fillStyle = '#f4c98f'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e9a86a'; g.fillRect(0, h * 0.62, w, h * 0.38);
  // 엄마
  g.fillStyle = '#6b3b2a'; g.beginPath(); g.arc(w * 0.42, h * 0.26, h * 0.13, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c0504d'; roundRect(g, w * 0.3, h * 0.38, w * 0.24, h * 0.62, 16); g.fill();
  // 아이
  g.fillStyle = '#6b3b2a'; g.beginPath(); g.arc(w * 0.57, h * 0.5, h * 0.1, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#4f7fbf'; roundRect(g, w * 0.49, h * 0.6, w * 0.17, h * 0.4, 12); g.fill();
  // 오르골
  g.fillStyle = '#ffe28a'; roundRect(g, w * 0.51, h * 0.66, w * 0.13, h * 0.14, 4); g.fill();
  g.fillStyle = '#fff6c8'; starPath(g, w * 0.84, h * 0.18, h * 0.08); g.fill();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function frameTex(state) {
  return canvasTex(256, 192, (g, w, h) => {
    if (state === 'photo') { drawPhoto(g, w, h); return; }
    g.fillStyle = '#cfc4a4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a99c78'; g.setLineDash([10, 8]); g.lineWidth = 3;
    g.strokeRect(20, 20, w - 40, h - 40);
  });
}

export function calendarTex() {
  return canvasTex(256, 208, (g, w, h) => {
    g.fillStyle = '#e4eaf5'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#6d7fa8'; g.fillRect(0, 0, w, 44);
    g.fillStyle = '#fff'; g.font = `bold 28px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('11월', w / 2, 23);
    g.font = `16px ${SANS}`;
    let d = 1;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 7; c++) {
        const x = 18 + c * 34, y = 64 + r * 28;
        if (r === 0 && c < 5) continue;
        if (d > 30) continue;
        g.fillStyle = c === 0 ? '#c0392b' : '#26304a';
        g.fillText(String(d), x, y);
        if (d === 7) {
          g.strokeStyle = '#d64541'; g.lineWidth = 3;
          g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.stroke();
        }
        d++;
      }
    }
    g.fillStyle = '#d64541'; g.font = `20px ${PEN}`; g.textAlign = 'left';
    g.fillText('엄마 생신 🎂', 120, 198);
  });
}

export function crayonTex() {
  return canvasTex(256, 208, (g, w, h) => {
    g.fillStyle = '#fff4e0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffc93c'; g.beginPath(); g.arc(215, 38, 22, 0, Math.PI * 2); g.fill();
    g.lineCap = 'round'; g.lineWidth = 6;
    // 키 큰 사람
    g.strokeStyle = '#e0584f';
    g.beginPath(); g.arc(80, 50, 16, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(80, 66); g.lineTo(80, 120); g.lineTo(62, 155); g.moveTo(80, 120); g.lineTo(98, 155); g.moveTo(80, 84); g.lineTo(58, 100); g.moveTo(80, 84); g.lineTo(118, 106); g.stroke();
    // 작은 아이
    g.strokeStyle = '#3f7fd0';
    g.beginPath(); g.arc(140, 92, 12, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(140, 104); g.lineTo(140, 132); g.lineTo(128, 155); g.moveTo(140, 132); g.lineTo(152, 155); g.moveTo(140, 112); g.lineTo(118, 106); g.stroke();
    g.strokeStyle = '#6cbf5a'; g.beginPath(); g.moveTo(10, 160); g.lineTo(246, 160); g.stroke();
    g.fillStyle = '#5a2f1d'; g.font = `26px ${PEN}`; g.textAlign = 'center';
    g.fillText('나중에 꼭 만나자!', w / 2, 192);
  });
}

// ─── 작은 물건 ───────────────────────────────────────────────────────────────

export function radioDisplayTex(freq) {
  return canvasTex(128, 48, (g, w, h) => drawRadioDisplay(g, w, h, freq));
}
export function drawRadioDisplay(g, w, h, freq) {
  g.fillStyle = '#e8dcb0'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#3f3228'; g.font = 'bold 30px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText((freq / 10).toFixed(1), w / 2, h / 2 + 2);
}

export function keypadTex() {
  return canvasTex(64, 96, (g, w, h) => {
    g.fillStyle = '#1b2031'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8b97b8';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) g.fillRect(8 + c * 18, 12 + r * 20, 12, 12);
  });
}

export function boxFrontTex(role) {
  return canvasTex(256, 160, (g, w, h) => {
    if (role === 'A') {
      g.fillStyle = '#86807a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#b9b3a2'; g.fillRect(w / 2 - 14, 0, 28, 30);
      g.fillStyle = '#23232b'; g.font = `48px ${PEN}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('버릴 것', w / 2, h / 2 + 12);
    } else {
      g.fillStyle = '#d9483f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd27a';
      for (const [x, y, r] of [[40, 40, 14], [216, 36, 12], [44, 124, 12], [212, 126, 14], [128, 26, 8]]) { starPath(g, x, y, r); g.fill(); }
      g.fillStyle = '#ffd45a'; g.strokeStyle = '#b8860b'; g.lineWidth = 3;
      starPath(g, w / 2, h / 2 + 10, 30); g.fill(); g.stroke();
      g.fillStyle = '#6b4a10'; g.beginPath(); g.arc(w / 2, h / 2 + 12, 5, 0, Math.PI * 2); g.fill();
    }
  });
}

export function toyBoxSideTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9433a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd27a';
    for (const [x, y] of [[30, 30], [96, 70], [40, 100]]) { starPath(g, x, y, 10); g.fill(); }
  });
}

export function blanketTex(role) {
  const t = THEMES[role];
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = t.blanket; g.fillRect(0, 0, w, h);
    if (role === 'B') {
      g.fillStyle = '#ffd27a';
      const rnd = mulberry32(12);
      for (let i = 0; i < 14; i++) { starPath(g, rnd() * w, rnd() * h, 10 + rnd() * 6); g.fill(); }
    } else {
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, 36, w, 6);
    }
  });
}

export function rugTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f2b45c'; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#e8795e'; g.lineWidth = 12; g.setLineDash([26, 16]);
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 30, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]); g.strokeStyle = '#fff0d8'; g.lineWidth = 6;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 70, 0, Math.PI * 2); g.stroke();
  });
}

export function envelopeTex() {
  return canvasTex(128, 80, (g, w, h) => {
    g.fillStyle = '#f0f3fa'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#26304a'; g.font = `14px ${SANS}`; g.textAlign = 'center';
    g.fillText('한서진 님', w / 2, 34);
    g.fillStyle = '#c0392b'; g.fillText('취침 전 1정', w / 2, 58);
  });
}

// ─── 거울 ───────────────────────────────────────────────────────────────────

export function mirrorFogTex(role) {
  return canvasTex(256, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#e9eef3'); grad.addColorStop(1, '#cfd8e2');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(60,70,90,.55)';
    g.font = `${role === 'A' ? 40 : 44}px ${PEN}`;
    g.textAlign = 'center';
    const lines = role === 'A' ? ['우리의', '시간을', '맞춰줘'] : ['시계가', '같아지면', '만날 수 있어'];
    lines.forEach((l, i) => g.fillText(l, w / 2, 190 + i * 56));
  });
}

/** 열린 거울은 맞은편 방의 빛깔로 일렁인다 */
export function mirrorGlassTex(role) {
  const other = role === 'A' ? THEMES.B : THEMES.A;
  return canvasTex(64, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, other.skyMid);
    grad.addColorStop(0.25, '#f4f6fa');
    grad.addColorStop(0.5, other.skyBot);
    grad.addColorStop(0.75, '#f4f6fa');
    grad.addColorStop(1, other.skyMid);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
}

/** 거울 속 실루엣: 새벽의 방에서는 아이가, 노을의 방에서는 어른이 비친다 */
export function silhouetteTex(role) {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = 'rgba(30,24,40,1)';
    if (role === 'A') {
      g.beginPath(); g.arc(w / 2, 150, 18, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(w / 2 - 30, 256); g.quadraticCurveTo(w / 2 - 28, 174, w / 2, 174); g.quadraticCurveTo(w / 2 + 28, 174, w / 2 + 30, 256); g.fill();
    } else {
      g.beginPath(); g.arc(w / 2, 62, 24, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(w / 2 - 50, 256); g.quadraticCurveTo(w / 2 - 48, 94, w / 2, 94); g.quadraticCurveTo(w / 2 + 48, 94, w / 2 + 50, 256); g.fill();
    }
  });
}
