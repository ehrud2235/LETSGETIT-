// 캐릭터 초상화: 3D 모델을 한 번 그려서 이미지(dataURL)로 캐시한다.
import * as THREE from 'three';
import { partLayout, PART_NAMES } from '../sim/fighter.js';
import { modsOf } from '../sim/roster.js';
import { buildCharacter } from './character.js';

let renderer = null;
let scene = null;
let camera = null;
const cache = new Map();

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(320, 320, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b99d7a', 1.5));
  const key = new THREE.DirectionalLight('#fff4e0', 2.4);
  key.position.set(2, 4, 5);
  scene.add(key);
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.35, 4.1);
  camera.lookAt(0, 1.02, 0);
}

export function portrait(charId) {
  if (cache.has(charId)) return cache.get(charId);
  try {
    if (!renderer) setup();
    const mods = modsOf(charId);
    const ch = buildCharacter(charId, mods);
    const L = partLayout(mods.reach);
    for (const name of PART_NAMES) ch.parts[name].position.set(...L[name].pos);
    // 팔을 살짝 벌리고 반쯤 돌아선 자세
    ch.parts.uArmL.rotation.z = 0.25; ch.parts.lArmL.rotation.z = 0.35;
    ch.parts.uArmR.rotation.z = -0.25; ch.parts.lArmR.rotation.z = -0.35;
    ch.parts.lArmL.position.x += 0.05; ch.parts.lArmR.position.x -= 0.05;
    ch.root.rotation.y = -0.45;
    scene.add(ch.root);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(ch.root);
    cache.set(charId, url);
    return url;
  } catch {
    return '';
  }
}
