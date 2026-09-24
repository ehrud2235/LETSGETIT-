// 등장 캐릭터와 패시브. 비공식 팬게임이며, 이름과 설정은 각 방송인에게 있습니다.
// 패시브는 한 가지 능력만 조금 올려서 밸런스를 크게 해치지 않게 했다.
// mods 기본값은 모두 1 (DEFAULT_MODS 참고).

export const DEFAULT_MODS = {
  punchPower: 1, // 주먹 위력
  punchSpeed: 1, // 주먹 연타 속도
  kickPower: 1, // 발차기 위력
  headPower: 1, // 박치기 위력
  jump: 1, // 점프 높이
  airGravity: 1, // 공중에서 받는 중력 (작을수록 천천히 떨어짐)
  maxHp: 1, // 기절 게이지 크기
  regen: 1, // 기절 게이지 회복 속도
  grip: 1, // 잡기 유지력 (상대가 빠져나가기 어려움)
  submit: 1, // 서브미션 조르는 속도
  recover: 1, // 넘어짐·기절에서 일어나는 속도
  reach: 1, // 팔 길이
  speed: 1, // 이동 속도
};

export const ROSTER = [
  {
    id: 'wakgood',
    name: '우왁굳',
    tagline: '왁타버스의 주인장',
    passive: { name: '왁두 박치기', desc: '길쭉한 머리로 박는 박치기 위력 +50%' },
    mods: { headPower: 1.5 },
    look: {
      skin: '#f2cf2f', top: '#f7f7f2', sleeves: 'skin', pants: '#3f8f3a', shoes: '#6b4a2b',
      head: { sy: 1.32, sz: 1.12 }, nose: { color: '#e8b21f', size: 0.13 }, eyes: 'dots',
      extras: ['tanktop'],
    },
  },
  {
    id: 'pungsin',
    name: '풍신',
    tagline: '600살 먹은 바람의 마법사',
    passive: { name: '바람 풍!', desc: '점프력 +30%, 공중에서 천천히 떨어진다' },
    mods: { jump: 1.3, airGravity: 0.72 },
    look: {
      skin: '#f3d9c4', top: '#23252e', sleeves: '#23252e', pants: '#23252e', shoes: '#111111',
      hair: { color: '#e9e9ef', style: 'long' }, eyes: 'sunglasses',
      extras: ['tie'],
    },
  },
  {
    id: 'dopamine',
    name: '도파민박사',
    tagline: '초월적인 내구도의 강화인간',
    passive: { name: '강화인간', desc: '기절 게이지 +40%, 게이지 회복 +30%' },
    mods: { maxHp: 1.4, regen: 1.3 },
    look: {
      skin: '#f6dfd2', top: '#f4f6fb', sleeves: '#f4f6fb', pants: '#4b3f6b', shoes: '#2a2238',
      hair: { color: '#c9ccd6', style: 'bob' }, eyes: 'blue',
      extras: ['labcoat'],
    },
  },
  {
    id: 'leedeoksu',
    name: '이덕수 할아바이',
    tagline: '야상 입은 해병대 출신 할아버지',
    passive: { name: '해병대 악력', desc: '잡기 유지력 +40%, 서브미션 속도 +20%' },
    mods: { grip: 1.4, submit: 1.2 },
    look: {
      skin: '#e2b894', top: '#5c6b3a', sleeves: '#5c6b3a', pants: '#6d6552', shoes: '#2d2a22',
      hair: { color: '#f2f2f2', style: 'short' }, eyes: 'dots',
      extras: ['cap', 'mustache'],
      cap: '#c8262b',
    },
  },
  {
    id: 'bimil',
    name: '비밀소녀',
    tagline: '비밀 FC 구단주 마법소녀',
    passive: { name: '비밀 FC', desc: '발차기 위력 +50%' },
    mods: { kickPower: 1.5 },
    look: {
      skin: '#fbe3d8', top: '#f58fb8', sleeves: '#fbe3d8', pants: '#ffffff', shoes: '#f58fb8',
      hair: { color: '#b9a3f0', style: 'twin' }, eyes: 'big',
      extras: ['skirt', 'ribbon'],
    },
  },
  {
    id: 'haeruseok',
    name: '해루석',
    tagline: '루석바의 미성 바텐더',
    passive: { name: '칵테일 셰이킹', desc: '주먹 연타 속도 +35%' },
    mods: { punchSpeed: 1.35 },
    look: {
      skin: '#f3d5bf', top: '#1c1c22', sleeves: '#f4f4f4', pants: '#1c1c22', shoes: '#0d0d0f',
      hair: { color: '#2b2230', style: 'slick' }, eyes: 'dots',
      extras: ['vest', 'bowtie'],
    },
  },
  {
    id: 'roentgenium',
    name: '뢴트게늄',
    tagline: '곡예하는 광대',
    passive: { name: '광대 곡예', desc: '넘어지거나 기절해도 60% 빨리 일어난다' },
    mods: { recover: 1.6 },
    look: {
      skin: '#f7f4f0', top: '#e8413a', sleeves: '#f3c623', pants: '#2f6fd6', shoes: '#e8413a',
      hair: { color: '#ff7a1a', style: 'curly' }, eyes: 'clown', nose: { color: '#e02424', size: 0.09 },
      extras: ['dots'],
    },
  },
  {
    id: 'dandap',
    name: '단답벌레',
    tagline: '피자와 음악만 좋아하는 단답충',
    passive: { name: '벌레 팔', desc: '팔 길이(리치) +20%' },
    mods: { reach: 1.2 },
    look: {
      skin: '#e9d8c4', top: '#3fae6a', sleeves: '#3fae6a', pants: '#2c3b33', shoes: '#1d1d1d',
      hair: { color: '#3b2a21', style: 'short' }, eyes: 'dots',
      extras: ['antenna', 'headphones', 'pizza'],
    },
  },
];

export const ROSTER_BY_ID = Object.fromEntries(ROSTER.map((c) => [c.id, c]));

export function modsOf(charId) {
  const c = ROSTER_BY_ID[charId];
  return { ...DEFAULT_MODS, ...(c ? c.mods : {}) };
}

/** 슬롯(플레이어 번호)별 색 — 이름표와 인디케이터 */
export const SLOT_COLORS = ['#ff5a5f', '#3fa7ff', '#4fd67a', '#ffc93c'];
