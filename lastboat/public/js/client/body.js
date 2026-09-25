// 사람 모양 몸 (좀비·동료 공통): 부위별 상자와 관절 각도로 자세를 계산한다.
import * as THREE from 'three';

export const PARTS = [
  { name: 'pelvis', size: [0.34, 0.2, 0.2], kind: 'pants' },
  { name: 'torso', size: [0.42, 0.52, 0.25], kind: 'shirt' },
  { name: 'head', size: [0.23, 0.26, 0.24], kind: 'skin', face: true },
  { name: 'uArmL', size: [0.12, 0.32, 0.12], kind: 'sleeve' },
  { name: 'uArmR', size: [0.12, 0.32, 0.12], kind: 'sleeve' },
  { name: 'lArmL', size: [0.1, 0.3, 0.1], kind: 'skin' },
  { name: 'lArmR', size: [0.1, 0.3, 0.1], kind: 'skin' },
  { name: 'thighL', size: [0.15, 0.42, 0.15], kind: 'pants' },
  { name: 'thighR', size: [0.15, 0.42, 0.15], kind: 'pants' },
  { name: 'shinL', size: [0.13, 0.44, 0.13], kind: 'shoes' },
  { name: 'shinR', size: [0.13, 0.44, 0.13], kind: 'shoes' },
];

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);

function child(out, parent, tx, ty, tz, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz, 'XYZ');
  _q.setFromEuler(_e);
  _m.compose(_v.set(tx, ty, tz), _q, ONE);
  return out.multiplyMatrices(parent, _m);
}

const F = {
  root: new THREE.Matrix4(), pelvis: new THREE.Matrix4(), chest: new THREE.Matrix4(), neck: new THREE.Matrix4(),
  shL: new THREE.Matrix4(), shR: new THREE.Matrix4(), elL: new THREE.Matrix4(), elR: new THREE.Matrix4(),
  hipL: new THREE.Matrix4(), hipR: new THREE.Matrix4(), knL: new THREE.Matrix4(), knR: new THREE.Matrix4(),
};

/**
 * 자세 → 부위 행렬 11개 (out 배열에 채움)
 * p: { x, y, z, yaw, scale, fall, lean, twist, sway, bob, head: [rx, ry, rz],
 *      armL: [pitch, roll], armR, elbowL, elbowR, legL, legR, kneeL, kneeR }
 */
export function poseMatrices(p, out) {
  const s = p.scale || 1;
  _e.set(0, p.yaw, 0, 'YXZ');
  _q.setFromEuler(_e);
  F.root.compose(_v.set(p.x, p.y || 0, p.z), _q, _v.clone().set(s, s, s));
  if (p.fall) child(F.root, F.root.clone(), 0, 0, 0, p.fall, 0, p.fallRoll || 0);
  if (p.roll) child(F.root, F.root.clone(), 0, 0, 0, 0, 0, p.roll);
  const H = 0.9 + (p.bob || 0) - (p.crouch || 0);
  child(F.pelvis, F.root, 0, H, 0, (p.lean || 0) * 0.3, 0, p.sway || 0);
  child(out[0], F.pelvis, 0, 0.02, 0);
  child(F.chest, F.pelvis, 0, 0.1, 0, p.lean || 0, p.twist || 0, 0);
  child(out[1], F.chest, 0, 0.26, 0);
  const h = p.head || [0, 0, 0];
  child(F.neck, F.chest, 0, 0.52, 0, h[0], h[1], h[2]);
  child(out[2], F.neck, 0, 0.13, 0);
  const aL = p.armL || [0.1, 0.1];
  const aR = p.armR || [0.1, -0.1];
  child(F.shL, F.chest, 0.27, 0.46, 0, aL[0], 0, aL[1]);
  child(F.shR, F.chest, -0.27, 0.46, 0, aR[0], 0, aR[1]);
  child(out[3], F.shL, 0, -0.16, 0);
  child(out[4], F.shR, 0, -0.16, 0);
  child(F.elL, F.shL, 0, -0.32, 0, p.elbowL || 0, 0, 0);
  child(F.elR, F.shR, 0, -0.32, 0, p.elbowR || 0, 0, 0);
  child(out[5], F.elL, 0, -0.15, 0);
  child(out[6], F.elR, 0, -0.15, 0);
  child(F.hipL, F.root, 0.1, H, 0, p.legL || 0, 0, 0.03);
  child(F.hipR, F.root, -0.1, H, 0, p.legR || 0, 0, -0.03);
  child(out[7], F.hipL, 0, -0.21, 0);
  child(out[8], F.hipR, 0, -0.21, 0);
  child(F.knL, F.hipL, 0, -0.42, 0, p.kneeL || 0, 0, 0);
  child(F.knR, F.hipR, 0, -0.42, 0, p.kneeR || 0, 0, 0);
  child(out[9], F.knL, 0, -0.22, 0);
  child(out[10], F.knR, 0, -0.22, 0);
  return out;
}

/** 오른손 끝 행렬 (총 붙이는 곳) */
export function rightHand(out) {
  return child(out, F.elR, 0, -0.32, 0);
}

export function headMatrix() {
  return F.neck;
}

/** 머리 상자의 UV: 앞면(-z)만 얼굴(왼쪽 절반), 나머지 면은 오른쪽 절반 */
export function headGeometry(size) {
  const g = new THREE.BoxGeometry(...size);
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const u = uv.getX(i);
      uv.setX(i, f === 5 ? u * 0.5 : 0.5 + u * 0.5);
    }
  }
  return g;
}
