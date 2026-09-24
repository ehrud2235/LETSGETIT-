// 재질과 캔버스 텍스처. 외부 이미지 없이 모두 코드로 그린다.
import * as THREE from 'three';

const cache = new Map();

/** 말랑한 젤리 느낌: 부드러운 표면 + 가장자리가 살짝 밝게 (림 라이트) */
export function jellyMaterial(color, { rim = 0.35, rough = 0.55, emissive = null } = {}) {
  const key = `jelly:${color}:${rim}:${rough}:${emissive}`;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  if (emissive) {
    m.emissive = new THREE.Color(emissive);
    m.emissiveIntensity = 0.6;
  }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = { value: rim };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float rimStrength;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
        totalEmissiveRadiance += diffuseColor.rgb * rimF * rimStrength;`);
  };
  m.customProgramCacheKey = () => `jelly${rim}`;
  cache.set(key, m);
  return m;
}

export function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function noise(g, w, h, alpha, n = 900, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${alpha * r()})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
}

const SANS = "'Black Han Sans', 'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

const TEX = {
  concrete: (color) => canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.12, 2500, 3);
    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
  }, { repeat: [3, 3] }),
  wood: (color) => canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y, w, 2);
      for (let x = 0; x < w; x += 8) {
        g.fillStyle = `rgba(0,0,0,${0.04 + ((x * 7 + y) % 13) / 200})`;
        g.fillRect(x, y + 4, 6, 24);
      }
    }
  }, { repeat: [2, 2] }),
  hazard: () => canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#e8b923'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b1b1b';
    for (let i = -h; i < w; i += 40) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 20, 0); g.lineTo(i + 20 + h, h); g.lineTo(i + h, h); g.fill();
    }
  }, { repeat: [4, 1] }),
  grate: () => canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#6d7179'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#34373c';
    for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) g.fillRect(x - 5, y - 5, 10, 10);
  }, { repeat: [3, 2] }),
  belt: () => canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#26282c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a3d42';
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 14, h);
    g.fillStyle = '#e8b923'; g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
  }, { repeat: [5, 1] }),
  crate: () => canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#b07a3c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7a4f22'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
    g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.stroke();
    noise(g, w, h, 0.1, 400, 9);
  }),
  fence: () => canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#c9ced8'; g.lineWidth = 3;
    for (let i = -h; i < w + h; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
      g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
    }
    g.fillStyle = '#22252c'; g.fillRect(0, 0, w, 8); g.fillRect(0, h - 8, w, 8);
  }, { repeat: [3, 1.2] }),
  corrugated: (color) => canvasTexture(128, 128, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const k = 0.75 + 0.25 * Math.sin((x / w) * Math.PI * 8);
      g.fillStyle = `rgba(0,0,0,${0.35 - k * 0.3})`;
      g.fillRect(x, 0, 1, h);
    }
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = color; g.fillRect(0, 0, w, h);
  }, { repeat: [10, 3] }),
  building: (color) => canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 22) {
      for (let x = 8; x < w; x += 20) {
        const on = ((x * 13 + y * 7) % 11) > 5;
        g.fillStyle = on ? '#ffd98a' : 'rgba(0,0,0,.35)';
        g.fillRect(x, y, 10, 12);
      }
    }
  }, { repeat: [3, 6] }),
};

/** 맵 조각의 재질 */
export function surfaceMaterial(mat, color) {
  const key = `surf:${mat}:${color}`;
  if (cache.has(key)) return cache.get(key);
  let m;
  switch (mat) {
    case 'concrete':
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: TEX.concrete(color), roughness: 0.9 });
      break;
    case 'wood':
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: TEX.wood(color), roughness: 0.75 });
      break;
    case 'metal':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.55 });
      break;
    case 'corrugated':
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: TEX.corrugated(color), roughness: 0.55, metalness: 0.35 });
      break;
    case 'hazard':
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: TEX.hazard(), roughness: 0.6 });
      break;
    case 'grate':
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: TEX.grate(), roughness: 0.5, metalness: 0.4 });
      break;
    case 'belt':
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: TEX.belt(), roughness: 0.8 });
      break;
    case 'crate':
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: TEX.crate(), roughness: 0.8 });
      break;
    case 'fence':
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: TEX.fence(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.6 });
      break;
    case 'building':
      m = new THREE.MeshStandardMaterial({ color: '#ffffff', map: TEX.building(color), roughness: 0.9, emissive: '#ffffff', emissiveMap: TEX.building(color), emissiveIntensity: 0.35 });
      break;
    case 'plastic':
    case 'pad':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
      break;
    case 'glass':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45 });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  }
  cache.set(key, m);
  return m;
}

/** 옥타곤 매트 윗면: 로고와 선 */
export function octagonTopTexture() {
  return canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#e9e6df'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.06, 6000, 5);
    g.save();
    g.translate(w / 2, h / 2);
    g.strokeStyle = '#c23b3b'; g.lineWidth = 16;
    g.beginPath(); g.arc(0, 0, 250, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#1d2230';
    g.font = `bold 120px ${SANS}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('물렁', 0, -60);
    g.fillStyle = '#c23b3b';
    g.fillText('난투', 0, 70);
    g.restore();
    g.fillStyle = 'rgba(30,34,48,.12)';
    g.font = `bold 60px ${SANS}`;
    g.textAlign = 'center';
    g.fillText('FIGHT NIGHT', w / 2, h * 0.86);
  });
}

/** 풋살장 잔디 */
export function pitchTexture() {
  const t = canvasTexture(1024, 640, (g, w, h) => {
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? '#3fae4f' : '#48bb58';
      g.fillRect((i * w) / 12, 0, w / 12 + 1, h);
    }
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 8;
    g.strokeRect(30, 30, w - 60, h - 60);
    g.beginPath(); g.moveTo(w / 2, 30); g.lineTo(w / 2, h - 30); g.stroke();
    g.beginPath(); g.arc(w / 2, h / 2, 80, 0, Math.PI * 2); g.stroke();
    g.strokeRect(30, h / 2 - 150, 110, 300);
    g.strokeRect(w - 140, h / 2 - 150, 110, 300);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.font = `bold 90px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('비밀 FC', w / 2, h / 2);
  });
  t.flipY = false; // 상자 윗면의 v 방향이 카메라 쪽이라 뒤집는다
  return t;
}

export function ballTexture() {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b1b1b';
    const spots = [[64, 64], [192, 64], [320, 64], [448, 64], [0, 192], [128, 192], [256, 192], [384, 192], [512, 192]];
    for (const [x, y] of spots) {
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * 34, y + Math.sin(a) * 34);
      }
      g.fill();
    }
  });
}

export function textTexture(text, { w = 1024, h = 256, color = '#ffffff', bg = null, font = SANS, size = 140, glow = null } = {}) {
  return canvasTexture(w, h, (g) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.font = `bold ${size}px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (glow) {
      g.shadowColor = glow;
      g.shadowBlur = 30;
    }
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 6);
  });
}

export const FONT = SANS;
