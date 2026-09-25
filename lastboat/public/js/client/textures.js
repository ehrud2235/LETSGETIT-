// 캔버스로 그리는 텍스처 (이미지 파일 없음). 모두 한 번 만들어 재사용한다.
import * as THREE from 'three';
import { rng } from '../shared/mapkit.js';

const cache = new Map();

export function canvasTex(key, w, h, draw, { srgb = true, repeat = true, aniso = 4 } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  cache.set(key, t);
  return t;
}

function noise(g, w, h, R, n, color, a0, a1, s0 = 1, s1 = 3) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = a0 + R() * (a1 - a0);
    g.fillStyle = color;
    const s = s0 + R() * (s1 - s0);
    g.fillRect(R() * w, R() * h, s, s);
  }
  g.globalAlpha = 1;
}

function stains(g, w, h, R, n, color, rmax) {
  for (let i = 0; i < n; i++) {
    const x = R() * w;
    const y = R() * h;
    const r = 6 + R() * rmax;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

const T = {
  asphalt: (g, w, h) => {
    const R = rng(1);
    g.fillStyle = '#2d2e31';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 5000, '#55565a', 0.15, 0.5, 1, 2);
    noise(g, w, h, R, 3000, '#1a1b1d', 0.2, 0.6, 1, 3);
    stains(g, w, h, R, 8, 'rgba(0,0,0,0.35)', 60);
    g.strokeStyle = 'rgba(10,10,12,0.7)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      let x = R() * w;
      let y = R() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (R() - 0.5) * 40;
        y += (R() - 0.5) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  },
  sidewalk: (g, w, h) => {
    const R = rng(2);
    g.fillStyle = '#6b6e72';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 2500, '#8a8d91', 0.1, 0.35);
    noise(g, w, h, R, 1500, '#3e4043', 0.15, 0.4);
    g.strokeStyle = 'rgba(30,30,34,0.8)';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(0, (i * h) / 4); g.lineTo(w, (i * h) / 4); g.stroke();
      g.beginPath(); g.moveTo((i * w) / 4, 0); g.lineTo((i * w) / 4, h); g.stroke();
    }
    stains(g, w, h, R, 5, 'rgba(0,0,0,0.25)', 40);
  },
  paving: (g, w, h) => {
    const R = rng(3);
    g.fillStyle = '#5a5552';
    g.fillRect(0, 0, w, h);
    const rows = 8;
    const bh = h / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (w / 8);
      for (let c = -1; c < 4; c++) {
        const shade = 70 + Math.floor(R() * 30);
        g.fillStyle = `rgb(${shade + 8},${shade},${shade - 4})`;
        g.fillRect(off + c * (w / 4) + 2, r * bh + 2, w / 4 - 4, bh - 4);
      }
    }
    noise(g, w, h, R, 2000, '#222', 0.1, 0.3);
  },
  brick: (g, w, h) => {
    const R = rng(4);
    g.fillStyle = '#5b5550';
    g.fillRect(0, 0, w, h);
    const rows = 16;
    const bh = h / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (w / 16);
      for (let c = -1; c < 8; c++) {
        const v = 0.8 + R() * 0.25;
        g.fillStyle = `rgb(${Math.floor(200 * v)},${Math.floor(200 * v)},${Math.floor(200 * v)})`;
        g.fillRect(off + c * (w / 8) + 1.5, r * bh + 1.5, w / 8 - 3, bh - 3);
      }
    }
    noise(g, w, h, R, 3000, '#000', 0.05, 0.2);
    stains(g, w, h, R, 6, 'rgba(0,0,0,0.25)', 50);
  },
  concrete: (g, w, h) => {
    const R = rng(5);
    g.fillStyle = '#8a8c8e';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 4000, '#a9abad', 0.1, 0.3);
    noise(g, w, h, R, 3000, '#5c5e61', 0.1, 0.35);
    stains(g, w, h, R, 10, 'rgba(40,36,30,0.25)', 60);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 12; i++) g.fillRect(R() * w, 0, 1 + R() * 2, h * (0.2 + R() * 0.6));
  },
  plaster: (g, w, h) => {
    const R = rng(6);
    g.fillStyle = '#c9c4b8';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 3000, '#e0dccf', 0.1, 0.3);
    noise(g, w, h, R, 2000, '#8f8a7e', 0.08, 0.25);
    stains(g, w, h, R, 8, 'rgba(80,70,50,0.18)', 60);
  },
  granite: (g, w, h) => {
    const R = rng(7);
    g.fillStyle = '#77797d';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 6000, '#9a9ca0', 0.2, 0.5, 1, 2);
    noise(g, w, h, R, 3000, '#3f4145', 0.2, 0.5, 1, 2);
    g.strokeStyle = 'rgba(20,20,24,0.6)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w / 2 - 2, h / 2 - 2);
    g.strokeRect(w / 2 + 1, 1, w / 2 - 2, h / 2 - 2);
    g.strokeRect(1, h / 2 + 1, w / 2 - 2, h / 2 - 2);
    g.strokeRect(w / 2 + 1, h / 2 + 1, w / 2 - 2, h / 2 - 2);
  },
  corrugated: (g, w, h) => {
    const R = rng(8);
    for (let x = 0; x < w; x++) {
      const v = 0.6 + 0.4 * Math.sin((x / w) * Math.PI * 16);
      g.fillStyle = `rgb(${Math.floor(140 * v + 30)},${Math.floor(146 * v + 30)},${Math.floor(152 * v + 30)})`;
      g.fillRect(x, 0, 1, h);
    }
    stains(g, w, h, R, 14, 'rgba(90,50,20,0.35)', 50);
    noise(g, w, h, R, 1500, '#222', 0.05, 0.2);
  },
  wood: (g, w, h) => {
    const R = rng(9);
    g.fillStyle = '#7a5a3c';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += h / 8) {
      g.fillStyle = `rgba(0,0,0,${0.15 + R() * 0.2})`;
      g.fillRect(0, y, w, 2);
      for (let k = 0; k < 30; k++) {
        g.fillStyle = `rgba(40,25,10,${0.1 + R() * 0.2})`;
        g.fillRect(R() * w, y + R() * (h / 8), 20 + R() * 60, 1);
      }
    }
  },
  tile: (g, w, h) => {
    const R = rng(10);
    g.fillStyle = '#9a9690';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const v = 150 + Math.floor(R() * 25);
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(i * (w / 4) + 2, j * (h / 4) + 2, w / 4 - 4, h / 4 - 4);
    }
    stains(g, w, h, R, 5, 'rgba(60,50,30,0.2)', 40);
  },
  metal: (g, w, h) => {
    const R = rng(11);
    g.fillStyle = '#b8bcc2';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      g.fillStyle = `rgba(255,255,255,${R() * 0.08})`;
      g.fillRect(0, y, w, 1);
    }
    stains(g, w, h, R, 10, 'rgba(70,40,20,0.3)', 40);
    noise(g, w, h, R, 800, '#333', 0.05, 0.2);
  },
  painted: (g, w, h) => {
    const R = rng(12);
    g.fillStyle = '#e8e8e8';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 2000, '#bbb', 0.1, 0.3);
    stains(g, w, h, R, 8, 'rgba(60,40,20,0.2)', 40);
  },
  board: (g, w, h) => {
    const R = rng(13);
    g.fillStyle = '#6b4a2e';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      g.save();
      g.translate(20 + R() * (w - 80), 20 + R() * (h - 80));
      g.rotate((R() - 0.5) * 0.3);
      g.fillStyle = ['#efe9d8', '#f4f0e0', '#e6dcc0', '#dfe6ee'][i % 4];
      g.fillRect(0, 0, 60 + R() * 30, 70 + R() * 30);
      g.fillStyle = 'rgba(40,40,40,0.5)';
      for (let l = 0; l < 6; l++) g.fillRect(8, 14 + l * 9, 40 + R() * 20, 2);
      g.restore();
    }
  },
  shelf: (g, w, h) => {
    const R = rng(14);
    g.fillStyle = '#2d3238';
    g.fillRect(0, 0, w, h);
    for (let s = 0; s < 4; s++) {
      const y = (s * h) / 4;
      g.fillStyle = '#c46a2a';
      g.fillRect(0, y + h / 4 - 8, w, 8);
      for (let b = 0; b < 6; b++) {
        const bw = 20 + R() * 30;
        g.fillStyle = ['#a88a5a', '#8a7048', '#c0a070', '#6a7a8a'][Math.floor(R() * 4)];
        g.fillRect(b * (w / 6) + 4, y + 10 + R() * 12, bw, h / 4 - 22);
      }
    }
  },
  canvas: (g, w, h) => {
    const R = rng(15);
    g.fillStyle = '#4c5638';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 4000, '#2e3522', 0.15, 0.4);
    noise(g, w, h, R, 2000, '#6c7650', 0.1, 0.3);
  },
  tunnel: (g, w, h) => {
    const R = rng(16);
    g.fillStyle = '#4d4f52';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 4000, '#6a6c70', 0.1, 0.3);
    noise(g, w, h, R, 3000, '#2b2c2e', 0.15, 0.4);
    stains(g, w, h, R, 16, 'rgba(20,18,14,0.45)', 60);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (let x = 0; x < w; x += w / 4) g.fillRect(x, 0, 3, h);
  },
  ballast: (g, w, h) => {
    const R = rng(17);
    g.fillStyle = '#3a3836';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      const v = 40 + Math.floor(R() * 70);
      g.fillStyle = `rgb(${v},${v - 3},${v - 6})`;
      const s = 2 + R() * 5;
      g.fillRect(R() * w, R() * h, s, s * (0.6 + R() * 0.6));
    }
  },
  platform: (g, w, h) => {
    const R = rng(18);
    g.fillStyle = '#8c8a86';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 3000, '#6a6864', 0.1, 0.3);
    g.strokeStyle = 'rgba(30,30,30,0.5)';
    g.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo(0, (i * h) / 2); g.lineTo(w, (i * h) / 2); g.stroke();
      g.beginPath(); g.moveTo((i * w) / 2, 0); g.lineTo((i * w) / 2, h); g.stroke();
    }
  },
  grass: (g, w, h) => {
    const R = rng(19);
    g.fillStyle = '#26351f';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 8000, '#3b5230', 0.2, 0.6, 1, 3);
    noise(g, w, h, R, 4000, '#18220f', 0.2, 0.6, 1, 3);
  },
  sand: (g, w, h) => {
    const R = rng(20);
    g.fillStyle = '#8a7a5c';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 6000, '#a8977a', 0.2, 0.5, 1, 2);
    noise(g, w, h, R, 3000, '#6a5c42', 0.2, 0.5, 1, 2);
  },
  gravel: (g, w, h) => {
    const R = rng(21);
    g.fillStyle = '#5a5a58';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      const v = 60 + Math.floor(R() * 80);
      g.fillStyle = `rgb(${v},${v},${v - 4})`;
      g.fillRect(R() * w, R() * h, 2 + R() * 3, 2 + R() * 3);
    }
  },
  roof: (g, w, h) => {
    const R = rng(22);
    g.fillStyle = '#3a3c3f';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 3000, '#56585b', 0.1, 0.3);
    stains(g, w, h, R, 8, 'rgba(0,0,0,0.3)', 60);
  },
  shutter: (g, w, h) => {
    const R = rng(23);
    for (let y = 0; y < h; y++) {
      const v = 0.7 + 0.3 * Math.sin((y / h) * Math.PI * 40);
      g.fillStyle = `rgb(${Math.floor(150 * v)},${Math.floor(154 * v)},${Math.floor(158 * v)})`;
      g.fillRect(0, y, w, 1);
    }
    stains(g, w, h, R, 10, 'rgba(80,40,20,0.3)', 40);
    g.font = 'bold 40px sans-serif';
    g.fillStyle = 'rgba(200,30,40,0.55)';
    g.fillText(['임대', 'X', '출입금지', '살려줘'][Math.floor(R() * 4)], 20 + R() * 60, 60 + R() * 120);
  },
  trainHull: (g, w, h) => {
    g.fillStyle = '#c8ccd0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2f8a4a';
    g.fillRect(0, h * 0.62, w, h * 0.08);
    g.fillStyle = '#1b2530';
    for (let x = 10; x < w; x += w / 4) g.fillRect(x, h * 0.25, w / 4 - 20, h * 0.28);
  },
  seat: (g, w, h) => {
    const R = rng(24);
    g.fillStyle = '#3f5f8a';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, R, 3000, '#2a4468', 0.2, 0.5);
  },
  rubber: (g, w, h) => {
    g.fillStyle = '#18181a';
    g.fillRect(0, 0, w, h);
  },
  glass: (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#1a2430');
    gr.addColorStop(0.5, '#2c3a4c');
    gr.addColorStop(1, '#141a22');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  },
};

export function surfaceTex(name) {
  const draw = T[name] || T.concrete;
  return canvasTex(`s:${name}`, 256, 256, draw);
}

/**
 * 건물 외벽: 창문 격자 (8x8 칸 = 24m x 24m). 불 켜진 창문은 발광 텍스처에 따로 그린다.
 * style: 0~2 아파트·사무실, 3~5 상가, 7 주택
 */
export function facadeTex(style) {
  const key = `f:${style}`;
  if (cache.has(key)) return cache.get(key);
  const R = rng(100 + style);
  const W = 512;
  const cols = style >= 3 && style <= 5 ? 6 : 8;
  const rows = 8;
  const bases = ['#6f6a64', '#5d6670', '#7a6f63', '#7c5e50', '#6a6f60', '#7a7068', '#555', '#9a8f7c'];
  const cMap = document.createElement('canvas');
  cMap.width = cMap.height = W;
  const cEm = document.createElement('canvas');
  cEm.width = cEm.height = W;
  const g = cMap.getContext('2d');
  const e = cEm.getContext('2d');
  g.fillStyle = bases[style] || '#666';
  g.fillRect(0, 0, W, W);
  noise(g, W, W, R, 6000, '#000', 0.04, 0.15);
  noise(g, W, W, R, 3000, '#fff', 0.03, 0.08);
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, W);
  const cw = W / cols;
  const rh = W / rows;
  for (let r = 0; r < rows; r++) {
    // 층 구분선
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, r * rh, W, 3);
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.18;
      const y = r * rh + rh * 0.22;
      const ww = cw * 0.64;
      const wh = rh * 0.52;
      const shop = style >= 3 && style <= 5 && r === rows - 1;
      if (shop) {
        // 1층 가게: 셔터 또는 유리
        const lit = R() < 0.2;
        g.fillStyle = lit ? '#2a2a26' : '#5a5e62';
        g.fillRect(c * cw + 4, r * rh + rh * 0.12, cw - 8, rh * 0.88);
        if (!lit) for (let k = 0; k < 12; k++) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(c * cw + 4, r * rh + rh * 0.12 + k * rh * 0.07, cw - 8, 2); }
        if (lit) {
          e.fillStyle = ['#ffd9a0', '#bfe0ff', '#ffb0b0'][Math.floor(R() * 3)];
          e.globalAlpha = 0.55;
          e.fillRect(c * cw + 6, r * rh + rh * 0.15, cw - 12, rh * 0.8);
          e.globalAlpha = 1;
        }
        continue;
      }
      g.fillStyle = '#11151b';
      g.fillRect(x, y, ww, wh);
      g.fillStyle = 'rgba(160,180,200,0.12)';
      g.fillRect(x, y, ww, wh * 0.4);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(x - 2, y + wh, ww + 4, 4);
      const lit = R() < (style === 7 ? 0.22 : 0.14);
      if (lit) {
        const col = ['#ffcf8a', '#ffe0b0', '#cfe0ff', '#ffd09a', '#ff9a6a'][Math.floor(R() * 5)];
        e.fillStyle = col;
        e.globalAlpha = 0.5 + R() * 0.5;
        e.fillRect(x, y, ww, wh);
        // 커튼 그림자
        e.globalAlpha = 1;
        e.fillStyle = 'rgba(0,0,0,0.6)';
        if (R() < 0.6) e.fillRect(x + ww * (0.3 + R() * 0.5), y, ww * 0.25, wh);
        e.globalAlpha = 1;
        g.fillStyle = col;
        g.globalAlpha = 0.3;
        g.fillRect(x, y, ww, wh);
        g.globalAlpha = 1;
      }
    }
  }
  const map = new THREE.CanvasTexture(cMap);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  const em = new THREE.CanvasTexture(cEm);
  em.colorSpace = THREE.SRGBColorSpace;
  em.wrapS = em.wrapT = THREE.RepeatWrapping;
  const out = { map, em };
  cache.set(key, out);
  return out;
}

/** 부드러운 원 (빛 웅덩이, 불꽃 입자) */
export function glowTex() {
  return canvasTex('glow', 128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }, { repeat: false });
}

export function bloodTex() {
  return canvasTex('blood', 128, 128, (g, w, h) => {
    const R = rng(55);
    for (let i = 0; i < 40; i++) {
      const x = w / 2 + (R() - 0.5) * w * 0.6;
      const y = h / 2 + (R() - 0.5) * h * 0.6;
      const r = 3 + R() * 16;
      g.fillStyle = `rgba(${90 + Math.floor(R() * 40)},0,0,${0.5 + R() * 0.5})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }, { repeat: false });
}

export function chainTex() {
  return canvasTex('chain', 128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(170,176,182,1)';
    g.lineWidth = 3;
    for (let i = -w; i < w * 2; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
      g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
    }
  }, { srgb: true });
}

export function textTex(text, { w = 512, h = 128, color = '#fff', bg = '#1c3f7a', size = 0.62, font = 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif' } = {}) {
  return canvasTex(`t:${text}:${w}:${h}:${color}:${bg}:${size}`, w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = color;
    g.font = `bold ${Math.floor(h * size)}px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2, w - 20);
  }, { repeat: false });
}

/** 좀비 얼굴: 왼쪽 절반은 얼굴, 오른쪽 절반은 민 피부 */
export function faceTex() {
  return canvasTex('zface', 128, 64, (g) => {
    g.fillStyle = '#cfcfcf';
    g.fillRect(0, 0, 128, 64);
    const R = rng(66);
    noise(g, 128, 64, R, 500, '#888', 0.1, 0.4);
    g.fillStyle = '#1a0a0a';
    g.fillRect(14, 20, 12, 9);
    g.fillRect(38, 20, 12, 9);
    g.fillStyle = '#e8d060';
    g.fillRect(18, 23, 4, 3);
    g.fillRect(42, 23, 4, 3);
    g.fillStyle = '#2a0808';
    g.fillRect(20, 42, 24, 9);
    g.fillStyle = '#ccc';
    for (let x = 22; x < 42; x += 5) g.fillRect(x, 42, 3, 4);
    g.fillStyle = 'rgba(120,0,0,0.7)';
    g.fillRect(24, 50, 4, 12);
  }, { repeat: false });
}
