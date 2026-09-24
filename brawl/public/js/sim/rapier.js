// Rapier 물리엔진 로더.
// 브라우저: WASM SIMD 를 지원하면 SIMD 빌드(더 빠름), 아니면 일반 빌드를 서버에서 받아온다.
// Node(테스트): npm 패키지를 그대로 쓴다.

let RAPIER = null;

function simdSupported() {
  try {
    // v128.const 를 쓰는 최소 WASM 모듈
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 22, 1, 20, 0, 253, 12,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11,
    ]));
  } catch {
    return false;
  }
}

export async function loadRapier() {
  if (RAPIER) return RAPIER;
  let mod;
  // 브라우저(창·워커 모두)인지 Node 인지
  const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);
  if (!isNode) {
    const url = simdSupported() ? '/vendor/rapier-simd/rapier.mjs' : '/vendor/rapier/rapier.mjs';
    mod = await import(url);
  } else {
    mod = await import('@dimforge/rapier3d-simd-compat');
  }
  const R = mod.default || mod;
  await R.init();
  RAPIER = R;
  return R;
}

export function rapier() {
  if (!RAPIER) throw new Error('loadRapier() 를 먼저 호출해야 합니다');
  return RAPIER;
}
