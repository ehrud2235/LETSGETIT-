// 은하시 — 한밤의 도시. 서쪽 아파트 단지에서 시작해 동쪽 은하항의 마지막 구조선까지.
// 길 안내 표시는 없다. 표지판·쪽지·불빛을 보고 직접 길을 찾는다.
//
//   x →(동)   z ↓(남)      지상: x 0..360, z 0..240   /   지하철: z 392..460 (지상과 떨어진 곳에 따로 만든다)
//
//   [북서 주택가]   [창고·주유소]   [변전소]   |강|  [컨테이너 야적장·관제탑]  |항구·부두|
//   ─────────────── 은하대로 (다리 붕괴) ──────|강|  항구로 ─ 정문 ─
//   [아파트 단지]   [은하시장 골목]  [공원]    |강|  [사무실·항구역 출구]
import { F } from './geom.js';
import { MapBuilder, rng } from './mapkit.js';

export const UNDERGROUND_Z = 380;
export const BOUNDS = { x0: -4, z0: -4, x1: 364, z1: 474 };

const CAR_COLORS = ['#8a1c1c', '#1f3f73', '#d9d9d9', '#2a2a2e', '#6b6f75', '#9a7b2d', '#3e5b3a', '#5a2a4a', '#b8b3a6', '#274a5e'];

export const OBJECTIVES = [
  { id: 'start', text: '새벽 5시, 은하항에서 마지막 구조선이 떠난다. 항구로 가는 길을 찾아라.' },
  { id: 'leftComplex', text: '단지를 빠져나왔다. 시장 골목을 지나 큰길로 나가자.' },
  { id: 'bridgeOut', text: '은하대교가 무너졌다. 강을 건널 다른 길을 찾아라.' },
  { id: 'needPower', text: '지하철역 셔터가 정전으로 닫혀 있다. 비상전원을 살릴 방법을 찾아라.' },
  { id: 'powerOn', text: '전원이 들어왔다! 은하역 셔터가 열린다. 역으로 달려라!' },
  { id: 'subway', text: '지하철 터널을 따라 강 건너 항구역으로 가자.' },
  { id: 'eastBank', text: '강을 건넜다. 은하항 정문을 찾아라.' },
  { id: 'needGate', text: '항구 정문이 잠겨 있다. 관제탑에서 열 수 있을 것 같다.' },
  { id: 'gateOpen', text: '정문이 열렸다! 부두의 항만사무소에서 구조선을 불러라.' },
  { id: 'finale', text: '구조선이 오고 있다! 배가 닿을 때까지 버텨라!' },
  { id: 'boat', text: '배가 도착했다! 부두 끝으로 가서 배에 타라!' },
];

export const RADIO_INTRO = '…치직… 은하시 재난 방송입니다. 생존자는 새벽 5시까지 은하항 부두로 오십시오. 마지막 구조선이 출항합니다. 은하대교는 통제 중… 치직…';

export function buildMap() {
  const M = new MapBuilder();

  // ─── 경계: 바깥 건물, 강, 바다 ─────────────────────────────────────────────
  M.building(-16, -16, 0, 256, 34, 1, { lit: 0.12 });
  M.building(0, -16, 232, 0, 30, 0, { lit: 0.12 });
  M.building(264, -16, 360, 0, 26, 2, { lit: 0.1 });
  M.building(84, 236, 232, 252, 24, 2, { lit: 0.1 });
  M.building(0, 234.25, 84.75, 252, 28, 0, { lit: 0.12 });
  M.building(264, 236, 322, 252, 20, 1, { lit: 0.1 });
  M.building(322, 240, 360, 252, 12, 6, { lit: 0 });
  M.colRect(232, -30, 264, 270, { h: 0.5, flags: F.MOVE }); // 강
  M.colRect(360, -30, 430, 270, { h: 0.5, flags: F.MOVE }); // 바다
  M.visuals.push({ k: 'water', x0: 232, z0: -200, x1: 264, z1: 440, y: -1.6 });
  M.visuals.push({ k: 'water', x0: 360, z0: -200, x1: 900, z1: 440, y: -1.8 });
  M.visuals.push({ k: 'skyline', x0: -200, z0: -200, x1: 560, z1: 440 });
  M.railing(231.6, 0, 231.6, 106);
  M.railing(231.6, 132, 231.6, 236);
  M.railing(264.4, 0, 264.4, 106);
  M.railing(264.4, 132, 264.4, 236);
  M.visuals.push({ k: 'embank', x: 232, z0: -40, z1: 280, side: -1 });
  M.visuals.push({ k: 'embank', x: 264, z0: -40, z1: 280, side: 1 });
  M.visuals.push({ k: 'embank', x: 360, z0: -40, z1: 280, side: -1 });
  M.regions.push({ name: 'surface', x0: -20, z0: -20, x1: 440, z1: UNDERGROUND_Z, underground: false });
  M.regions.push({ name: 'subway', x0: 100, z0: UNDERGROUND_Z, x1: 380, z1: 480, underground: true });

  complex(M);
  market(M);
  boulevard(M);
  park(M);
  industrial(M);
  residential(M);
  subway(M);
  eastBank(M);
  containerYard(M);
  port(M);

  return M.finish({
    bounds: BOUNDS,
    undergroundZ: UNDERGROUND_Z,
    starts: [[21.5, 201.5], [24.5, 201.5]],
    startYaw: 0,
    objectives: OBJECTIVES,
    radioIntro: RADIO_INTRO,
    boat: { from: [420, 115], to: [364.5, 115], zone: [352, 104, 360, 126] },
  });
}

// ─── A. 아파트 단지 (출발) ───────────────────────────────────────────────────
function complex(M) {
  M.ground(8, 146, 84.5, 234, 'paving');
  M.ground(0, 128, 84.5, 146, 'sidewalk');
  const WH = 2.6;
  const W = { mat: 'brick', color: '#8a5a48' };
  M.wall(8, 146, 40, 146, WH, 0.5, W);
  M.wall(48, 146, 84.5, 146, WH, 0.5, W);
  M.wall(8, 146, 8, 234, WH, 0.5, W);
  M.wall(84.5, 146, 84.5, 196, WH, 0.5, W);
  M.wall(84.5, 202, 84.5, 234.25, WH, 0.5, W);
  M.wall(84.5, 146, 87.75, 146, WH, 0.5, W); // 시장 골목 북쪽 끝 막음
  M.door('backGate', 84.5, 199, 'z', 6, { h: 2.6, kind: 'gate', locked: true, key: 'officeKey', label: '단지 뒷문', lockedMsg: '뒷문이 자물쇠로 잠겨 있다. 관리사무소에 열쇠가 있을지도 모른다.' });

  // 정문: 버스가 막고 불이 났다
  M.bus(44, 142.3, 0.1, '#3a6f9a', { burnt: true });
  M.car(44.5, 149.3, 0.9, '#6b6f75', { wreck: true, burnt: true });
  M.fire(44.5, 149.3, 1.2);
  M.fire(41, 142.5, 0.8);
  M.colRect(40, 145.5, 48, 146.5, { h: 2.4, flags: F.MOVE });
  M.visuals.push({ k: 'gatePanels', x: 44, z: 146, w: 8, broken: true });
  M.interact('mainGate', 44, 148.4, '정문', 'look', { msg: '불타는 버스가 정문을 막고 있다. 여기로는 못 나간다.' });

  // 아파트 동
  M.building(14, 206, 32, 228, 40, 0, { lit: 0.18 });
  M.building(46, 206, 64, 228, 44, 1, { lit: 0.15 });
  M.building(14, 156, 32, 176, 38, 2, { lit: 0.12 });
  M.sign(23, 3.2, 205.7, Math.PI, 4, 0.8, '101동', { bg: '#20262e', size: 0.6 });
  M.sign(55, 3.2, 205.7, Math.PI, 4, 0.8, '102동', { bg: '#20262e', size: 0.6 });
  M.sign(23, 3.2, 176.3, 0, 4, 0.8, '103동', { bg: '#20262e', size: 0.6 });
  M.box(23, 205.2, 4, 1, 2.6, { mat: 'glass', collide: false });
  M.light(23, 2.6, 203.6, '#cfe0ff', { power: 0.8, range: 9, kind: 'flicker' });

  // 관리사무소 (열쇠)
  M.room(66, 150, 80, 162, { doors: [{ side: 'w', at: 155.5, w: 1.6, id: 'officeDoor' }], ext: 'brick', extColor: '#8a6a58', name: '관리사무소', flicker: true });
  M.sign(65.7, 2.9, 155.5, -Math.PI / 2, 3, 0.6, '관리사무소', { bg: '#1d4a3a', size: 0.55 });
  M.box(73, 153, 2.4, 1.1, 0.78, { mat: 'wood' });
  M.box(76, 158.5, 2.4, 1.1, 0.78, { mat: 'wood' });
  M.box(79.3, 156, 0.8, 4, 1.9, { mat: 'metal', color: '#6a7078' });
  M.box(68.5, 161.2, 3, 0.8, 1.9, { mat: 'metal', color: '#6a7078' });
  M.item('officeKey', 'key', [[73.3, 153, 0.82], [76.3, 158.5, 0.82], [69.6, 160.1, 0.05]], { label: '관리사무소 열쇠' });
  M.zombies(74, 157, 1.5, 2);

  // 경비실
  M.room(50, 148, 55, 153, { h: 2.8, doors: [{ side: 's', at: 52.5, w: 1.1, id: 'guardDoor' }], ext: 'plaster', extColor: '#b9b2a0', flicker: true });
  M.box(53.5, 149.2, 1.8, 0.7, 0.8, { mat: 'wood' });
  M.item('medGuard', 'medkit', [[53.5, 149.2, 0.82], [51, 150, 0.1]]);

  // 주차장
  M.ground(36, 158, 66, 198, 'asphalt');
  M.visuals.push({ k: 'parkingLines', x0: 36, z0: 160, x1: 66, z1: 196 });
  const R = rng(11);
  for (const z of [164, 176, 190]) {
    for (let i = 0; i < 6; i++) {
      if (R() < 0.3) continue;
      const x = 39 + i * 4.8;
      M.car(x, z, Math.PI / 2 + (R() - 0.5) * 0.25, CAR_COLORS[Math.floor(R() * CAR_COLORS.length)], { wreck: R() < 0.3 });
    }
  }
  // 놀이터
  M.ground(66, 170, 81, 192, 'sand');
  M.box(70, 177, 1.2, 4.5, 1.8, { mat: 'painted', color: '#c0642c' });
  M.box(76, 183, 4, 0.2, 2.2, { mat: 'metal', color: '#3f6fa8' });
  M.box(71, 188, 2.5, 2.5, 0.6, { mat: 'painted', color: '#d8b64a' });
  // 나무·가로등·게시판
  for (let x = 12; x < 82; x += 7) M.tree(x, 231.5, 0.9 + R() * 0.3);
  for (let z = 150; z < 204; z += 8) M.tree(11, z, 0.9 + R() * 0.3);
  M.lamp(35, 200, Math.PI / 2, { h: 5.5 });
  M.lamp(66, 200, -Math.PI / 2, { h: 5.5 });
  M.lamp(35, 158, Math.PI / 2, { h: 5.5, broken: true });
  M.lamp(63, 166, -Math.PI / 2, { h: 5.5 });
  M.lamp(80, 196, -Math.PI / 2, { h: 5.5 });
  M.box(30.5, 203.9, 1.6, 0.12, 1.1, { y0: 0.9, mat: 'board', collide: false });
  M.note('noteOffice', 30.5, 203.6, '단지 게시판', '[관리사무소 공지]\n단지 동쪽 뒷문은 야간에 잠급니다.\n뒷문 열쇠는 관리사무소(정문 옆)에서 보관합니다.\n— 관리소장');

  M.zombies(52, 178, 3, 3);
  M.zombies(74, 186, 3, 2);
  M.zombies(44, 186, 2, 1);
  M.zombies(72, 222, 3, 2);
  M.zombies(58, 192, 3, 2);
}

// ─── B. 은하시장 골목 미로 ───────────────────────────────────────────────────
function market(M) {
  M.ground(84.75, 135, 159.75, 236, 'paving');
  const lane = 3;
  const res = M.maze({
    x0: 84.75, z0: 135, cols: 6, rows: 7, bw: 9, bd: 11, lane, seed: 4242,
    extraOpen: 0.2, outsideRow: 0, exits: [2, 4], start: [0, 4],
    forceOpen: [[[0, 3], [0, 4]]],
    skip: (i, j) => (i === 2 || i === 3) && (j === 3 || j === 4),
    onBlock: (i, j, x0, z0, x1, z1, R) => {
      M.building(x0, z0, x1, z1, 6 + Math.floor(R() * 3) * 3, 3 + Math.floor(R() * 3), { lit: 0.12 });
      if (R() < 0.35) M.visuals.push({ k: 'awning', x0, z0, x1, z1, side: ['n', 's', 'w', 'e'][Math.floor(R() * 4)], color: ['#9a2f2f', '#2f5d9a', '#2f8a4a', '#b8862f'][Math.floor(R() * 4)] });
    },
    onBlocker: (x, z, horiz, R) => {
      const t = R();
      if (t < 0.28) {
        if (horiz) M.fence(x, z - lane / 2 - 0.05, x, z + lane / 2 + 0.05, 2.4);
        else M.fence(x - lane / 2 - 0.05, z, x + lane / 2 + 0.05, z, 2.4);
      } else if (horiz) M.junk(x, z, 1.6, lane + 0.3, 0, Math.floor(R() * 1e6));
      else M.junk(x, z, lane + 0.3, 1.6, 0, Math.floor(R() * 1e6));
    },
    onExitBlocker: (x, z, R) => {
      if (R() < 0.7) M.shutter(x, 138.2, lane + 0.3, 'x');
      else M.junk(x, 138.8, lane + 0.3, 1.6, 0, Math.floor(R() * 1e6));
    },
  });
  // 광장과 파출소 (산탄총)
  M.room(116, 186, 128, 195, { doors: [{ side: 'n', at: 122, w: 1.6, id: 'policeDoor' }], ext: 'plaster', extColor: '#c9ccd3', name: '파출소', lightColor: '#e2ecff' });
  M.sign(122, 3.0, 185.7, Math.PI, 3.2, 0.7, '파출소 POLICE', { bg: '#1b3f8a', size: 0.5 });
  M.light(122, 3.4, 185.2, '#4d7dff', { power: 0.9, range: 9, kind: 'siren' });
  M.car(125.5, 200.5, 0.25, '#f2f2f2', { police: true });
  M.box(120, 188.3, 2.4, 1, 0.78, { mat: 'wood' });
  M.box(125.5, 190, 1.2, 2.2, 0.78, { mat: 'wood' });
  M.box(127.4, 193.8, 0.6, 1.6, 1.9, { mat: 'metal', color: '#50565e' });
  M.item('shotgunPolice', 'shotgun', [[120.2, 188.3, 0.82], [125.5, 190.5, 0.82]]);
  M.item('ammoPolice', 'ammo', [[126.9, 193.8, 1.0]]);
  M.item('medPolice', 'medkit', [[117.4, 193.8, 0.1], [125.5, 189.2, 0.82]]);
  M.sign(122.25, 4.4, 137.6, Math.PI, 6.5, 1.1, '은하시장', { bg: '#7a1f1f', size: 0.7, color: '#ffe7a8' });
  M.box(88.1, 205, 0.1, 1.2, 0.9, { y0: 1, mat: 'board', collide: false });
  M.note('noteMarket', 88.3, 205, '시장 상인회 알림', '큰길로 통하는 골목 대부분 셔터 내렸음.\n파출소 앞 광장 쪽 골목으로 돌아서 나가세요.\n밤에는 절대 혼자 다니지 말 것.');
  // 골목 전등과 좀비
  const R = rng(99);
  for (let i = 0; i <= 6; i++) {
    for (let j = 1; j <= 7; j++) {
      const x = res.nx(i);
      const z = res.nz(j);
      if (R() < 0.42) M.light(x, 3.4, z, R() < 0.8 ? '#ffc98a' : '#ff9a6a', { power: 0.7, range: 10, kind: R() < 0.2 ? 'flicker' : 'bulb' });
      if (R() < 0.3 && !(i === 0 && (j === 3 || j === 4))) M.zombies(x, z, 1.2, 1 + Math.floor(R() * 3));
    }
  }
  M.zombies(122, 199, 3, 3);
}

// ─── C. 은하대로 (다리 붕괴, 계엄군 검문소, 은하역) ──────────────────────────
function boulevard(M) {
  M.ground(0, 108, 232, 128, 'road');
  M.ground(0, 104, 232, 108, 'sidewalk');
  M.ground(84.75, 128, 232, 135, 'sidewalk');
  M.visuals.push({ k: 'roadLines', x0: 0, x1: 232, z: 118, dir: 'x', width: 20 });
  // 북쪽 건물 줄
  M.building(0, 86, 22, 104, 26, 0);
  M.building(22, 88, 44, 104, 18, 1);
  M.building(44, 86, 64, 104, 30, 2);
  M.building(64, 88, 84, 104, 22, 0);
  M.fence(84, 101.5, 96, 101.5, 2.6);
  M.building(96, 86, 104, 104, 16, 1);
  M.building(150, 84, 162, 104, 20, 2);
  M.building(180, 86, 186, 104, 14, 0);
  M.building(186, 84, 200, 92, 10, 1);
  M.building(200, 86, 230, 104, 24, 2);
  // 서쪽 끝: 불탄 버스로 막힘
  M.bus(6, 114, Math.PI / 2 + 0.2, '#555', { burnt: true });
  M.bus(6, 124, Math.PI / 2 - 0.15, '#666', { burnt: true });
  M.junk(2.5, 118, 4.5, 26, 0, 7);

  // 은하역 2번 출구 (셔터 → 지하)
  M.ground(186.5, 92.5, 199.5, 104, 'tile');
  M.wall(186.5, 92.5, 186.5, 104, 3.4, 0.4, { mat: 'granite' });
  M.wall(199.5, 92.5, 199.5, 104, 3.4, 0.4, { mat: 'granite' });
  M.wall(186.5, 92.5, 199.5, 92.5, 3.4, 0.4, { mat: 'granite' });
  M.visuals.push({ k: 'roof', x0: 186.3, z0: 92.3, x1: 199.7, z1: 104.2, y: 3.4, t: 0.35, mat: 'granite' });
  M.door('stationShutter', 193, 103.6, 'x', 13, { h: 3.4, kind: 'shutter', locked: true, flag: 'power', label: '은하역 셔터', lockedMsg: '셔터가 내려져 있다. 정전이라 꿈쩍도 안 한다.' });
  M.stairs(193, 97.5, Math.PI, 11, 8);
  M.portal('toSubwayA', 188, 93, 198, 95.5, { x: 193, z: 403.5, yaw: Math.PI });
  M.sign(193, 3.95, 104.35, 0, 7, 0.9, '은하역  2호선', { bg: '#1f5fae', size: 0.6, flag: 'power' });
  M.box(202.2, 104.08, 1.8, 0.1, 1.1, { y0: 1, mat: 'board', collide: false });
  M.note('noteStation', 202.2, 104.5, '역 안내문', '[은하역 안내]\n정전 시 역사 출입 셔터는\n비상전원이 복구된 뒤에 열립니다.\n\n비상전원 설비: 은하 변전소\n(북쪽 공단로 끝, 큰 철탑)');
  M.trigger('stationFront', 186, 102, 200, 110);

  // 주유소
  M.ground(104, 84, 150, 104, 'concrete');
  M.visuals.push({ k: 'canopy', x0: 110, z0: 89, x1: 132, z1: 100, h: 5.2 });
  for (const [x, z] of [[110.5, 89.5], [131.5, 89.5], [110.5, 99.5], [131.5, 99.5]]) M.box(x, z, 0.5, 0.5, 5.2, { mat: 'metal', color: '#d9dde2' });
  for (const x of [115, 121, 127]) M.box(x, 94.5, 1, 0.7, 1.6, { mat: 'painted', color: '#c43a2e' });
  M.light(121, 5, 94.5, '#f4f8ff', { power: 1.1, range: 18, kind: 'flicker' });
  M.sign(121, 5.6, 100.3, 0, 8, 0.8, '은하주유소', { bg: '#b8201c', size: 0.6 });
  M.room(136, 86, 150, 97, { doors: [{ side: 's', at: 143, w: 1.6, id: 'gasDoor' }], ext: 'plaster', extColor: '#d8d2c2', name: '주유소 편의점' });
  M.box(140, 90, 3, 0.8, 1, { mat: 'wood' });
  M.box(146, 88, 5, 0.6, 1.8, { mat: 'shelf' });
  M.box(146, 92, 5, 0.6, 1.8, { mat: 'shelf' });
  M.item('medGas', 'medkit', [[140, 90, 1.05], [146.5, 95.5, 0.1]]);
  M.note('noteGas', 140.8, 90.2, '계산대 메모', '사장님, 변전소 직원분들 공단로 끝 큰 철탑 있는 데로\n다 철수했대요. 전기 언제 들어올지 모른대요.\n저도 먼저 갑니다. — 알바');
  M.car(119, 97, 0.1, '#274a5e', { wreck: true });
  M.fire(118, 98, 0.7);

  // 계엄군 검문소 (소총) — 다리 입구를 컨테이너로 막음
  M.ground(206, 104, 232, 135, 'asphalt');
  M.container(230.2, 112, Math.PI / 2, '#51623b', 2);
  M.container(230.2, 124.1, Math.PI / 2, '#46553a', 2);
  M.sandbags(230.4, 131.8, Math.PI / 2, 3.2);
  M.sandbags(230.4, 105, Math.PI / 2, 2.4);
  M.truck(214, 111.5, 0.12, '#4a5a3a');
  M.sandbags(208.5, 117, Math.PI / 2, 5);
  M.sandbags(208.5, 127.5, Math.PI / 2, 5);
  M.barrier(212, 122.3, 0, 3);
  M.box(222, 128.5, 5.5, 4, 2.6, { mat: 'canvas' });
  M.box(219, 122, 2, 0.9, 0.8, { mat: 'wood' });
  M.box(224.5, 117.5, 1.4, 1, 0.8, { mat: 'metal', color: '#4a5540' });
  M.item('rifleArmy', 'rifle', [[219, 122, 0.84], [219.6, 121.9, 0.84]]);
  M.item('ammoArmy', 'ammo', [[216.8, 127.8, 0.1]]);
  M.item('medArmy', 'medkit', [[224.5, 117.5, 0.84]]);
  M.lamp(226, 108, -Math.PI / 2, { h: 8, color: '#f4f8ff' });
  M.box(212.5, 133.6, 1.8, 0.1, 1.2, { y0: 0.9, mat: 'board', collide: false });
  M.note('noteArmy', 212.5, 133.2, '계엄군 공지', '[통행 금지]\n은하대교 붕괴 위험 — 민간인 통행 금지.\n강 건너 은하항 방면 대피자는\n지하철 2호선 은하역 대피 통로를 이용할 것.');
  M.trigger('bridgeSeen', 206, 104, 232, 135);
  // 다리 (가운데가 무너짐)
  M.visuals.push({ k: 'bridge', x0: 232, z0: 107, x1: 264, z1: 131, gap0: 243, gap1: 253 });
  M.barrier(265.5, 112, Math.PI / 2, 5);
  M.barrier(265.5, 118, Math.PI / 2, 5);
  M.barrier(265.5, 125, Math.PI / 2, 5);

  // 부서진 차들
  const R = rng(77);
  const cars = [];
  const blocked = (x, z) => (x > 184 && x < 202 && z < 112) || x > 204 || (x > 160 && x < 180 && z < 112) || x < 12;
  for (let k = 0; k < 60 && cars.length < 30; k++) {
    const x = 12 + R() * 192;
    const z = 110 + R() * 16;
    if (blocked(x, z) || cars.some(([a, b]) => Math.hypot(a - x, b - z) < 6)) continue;
    cars.push([x, z]);
    const rot = (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.9;
    M.car(x, z, rot, CAR_COLORS[Math.floor(R() * CAR_COLORS.length)], { wreck: R() < 0.6, burnt: R() < 0.15 });
  }
  M.bus(98, 118, 0.35, '#2f7d4f');
  M.fire(66, 121, 1);
  M.fire(141, 113, 0.9);
  M.car(66, 121, 0.6, '#555', { burnt: true, wreck: true });
  M.car(141, 113, 2.4, '#555', { burnt: true, wreck: true });
  // 가로등
  for (let x = 14; x < 206; x += 24) {
    if (x > 182 && x < 204) continue;
    M.lamp(x, 105.5, 0, { broken: R() < 0.25 });
  }
  for (let x = 26; x < 206; x += 24) M.lamp(x, 130.5, Math.PI, { broken: R() < 0.25 });
  // 좀비
  M.zombies(40, 116, 4, 3);
  M.zombies(80, 124, 4, 3);
  M.zombies(120, 118, 4, 2);
  M.zombies(160, 122, 4, 3);
  M.zombies(196, 112, 3, 2);
  M.zombies(218, 120, 4, 3);
}

// ─── 공원 (갈래길, 물자) ─────────────────────────────────────────────────────
function park(M) {
  M.building(159.75, 136, 166, 170, 16, 1);
  M.building(159.75, 170, 166, 204, 12, 0);
  M.building(159.75, 204, 166, 236, 18, 2);
  M.ground(166, 135, 231.6, 236, 'grass');
  M.ground(166, 150, 231.6, 155, 'paving');
  M.ground(196, 135, 201, 236, 'paving');
  M.visuals.push({ k: 'pond', x0: 176, z0: 168, x1: 192, z1: 190 });
  M.colRect(176, 168, 192, 190, { h: 0.4, flags: F.MOVE });
  const R = rng(5);
  for (let k = 0; k < 42; k++) {
    const x = 168 + R() * 60;
    const z = 138 + R() * 95;
    if ((x > 174 && x < 194 && z > 166 && z < 192) || (z > 148 && z < 157) || (x > 194 && x < 203) || (x > 210 && x < 224 && z > 202 && z < 214)) continue;
    M.tree(x, z, 0.9 + R() * 0.5);
  }
  for (const [x, z] of [[180, 152.8], [210, 152.8], [198.5, 175], [198.5, 215]]) M.box(x, z, 1.8, 0.5, 0.5, { mat: 'wood' });
  M.room(212, 204, 222, 212, { doors: [{ side: 'w', at: 208, w: 1.2, id: 'toiletDoor' }], ext: 'brick', extColor: '#7b8a8a', name: '공원 화장실', flicker: true });
  M.item('medPark', 'medkit', [[220, 206, 0.1], [219, 210, 0.9]]);
  M.lamp(198.5, 160, Math.PI / 2, { h: 4.5 });
  M.lamp(198.5, 200, -Math.PI / 2, { h: 4.5, broken: true });
  M.lamp(225, 152.8, Math.PI, { h: 4.5 });
  M.zombies(185, 200, 4, 3);
  M.zombies(215, 170, 4, 2);
  M.zombies(210, 225, 3, 3);
}

// ─── D. 북쪽 공단 (창고, 변전소) ─────────────────────────────────────────────
function industrial(M) {
  M.ground(84, 0, 232, 86, 'asphalt');
  M.ground(162, 0, 178, 108, 'road');
  M.visuals.push({ k: 'roadLines', x0: 0, x1: 108, z: 170, dir: 'z', width: 16 });
  M.ground(96, 48, 232, 58, 'road');
  M.building(100, 10, 156, 46, 12, 6, { lit: 0 });
  // 창고 2 (앞뒤로 드나들 수 있다)
  M.room(100, 60, 156, 82, {
    h: 9, doors: [{ side: 's', at: 120, w: 3.4, id: 'w2DoorS' }, { side: 'n', at: 140, w: 3.4, id: 'w2DoorN' }],
    ext: 'corrugated', int: 'corrugated', floor: 'concrete', lightColor: '#dde6ff', flicker: true, name: '물류창고',
  });
  for (const z of [65.5, 71, 76.5]) {
    M.box(114, z, 16, 1.3, 3.8, { mat: 'shelf' });
    M.box(138, z, 14, 1.3, 3.8, { mat: 'shelf' });
  }
  M.box(107, 69, 2.2, 1.2, 2, { mat: 'painted', color: '#e0a526' });
  M.item('shotgunWare', 'shotgun', [[151, 64, 0.95], [104, 64, 0.95]]);
  M.item('ammoWare', 'ammo', [[104.5, 78.5, 0.1]]);
  M.item('medWare', 'medkit', [[152, 79, 0.1], [126, 79, 0.1]]);
  M.light(114, 8.5, 71, '#dde6ff', { power: 0.8, range: 14, kind: 'flicker' });
  M.light(140, 8.5, 71, '#dde6ff', { power: 0.8, range: 14, kind: 'ceiling' });
  M.zombies(126, 68, 4, 3);
  M.zombies(145, 78, 3, 2);

  // 변전소 (비상전원)
  M.ground(184, 8, 228, 48, 'gravel');
  M.fence(184, 8, 228, 8, 3.2);
  M.fence(228, 8, 228, 48, 3.2);
  M.fence(184, 48, 228, 48, 3.2);
  M.fence(184, 8, 184, 25.5, 3.2);
  M.fence(184, 32.5, 184, 48, 3.2);
  M.visuals.push({ k: 'gatePanels', x: 184, z: 29, w: 7, axis: 'z', open: true });
  for (const [x, z] of [[192, 14], [200, 14], [192, 24], [200, 24], [192, 40], [200, 40]]) M.visuals.push({ k: 'transformer', x, z }), M.col(x, z, 2.2, 1.8, { h: 3.6, flags: F.ALL });
  M.visuals.push({ k: 'pylon', x: 216, z: 17, h: 32 });
  M.col(216, 17, 2.4, 2.4, { h: 4, flags: F.MOVE });
  M.room(206, 30, 224, 44, { doors: [{ side: 'w', at: 37, w: 1.6, id: 'subDoor' }], ext: 'concrete', extColor: '#a9aeb3', name: '변전소 제어실', light: false });
  M.box(223.2, 37, 0.8, 4, 2.2, { mat: 'metal', color: '#56606a' });
  M.box(212, 32, 3, 1, 0.8, { mat: 'metal', color: '#4c565e' });
  M.interact('powerPanel', 222.6, 37, '비상 전원 스위치', 'power', { y: 1.4, r: 2.2 });
  M.light(215, 3.2, 37, '#ffe2b0', { power: 0.9, range: 10, kind: 'power' });
  M.light(196, 6, 28, '#ffcf8a', { power: 1.2, range: 22, kind: 'power' });
  M.sign(183.6, 3.3, 29, -Math.PI / 2, 5, 0.9, '은하 변전소', { bg: '#8a1c1c', size: 0.62 });
  M.sign(184.1, 1.6, 21, -Math.PI / 2, 2.2, 0.8, '⚡ 고압 위험', { bg: '#e0b020', color: '#1a1a1a', glow: false, size: 0.5 });
  M.zombies(196, 32, 4, 3);
  M.zombies(214, 37, 2, 2);
  M.building(184, 60, 228, 84, 14, 6, { lit: 0 });
  M.horde(170, 18, 'power');
  M.horde(205, 54, 'power');
  M.horde(150, 53, 'power');
  M.horde(176, 78, 'power');
  M.horde(226, 54, 'power');
  // 공단 가로등 (주황)
  for (const [x, z, r] of [[160.5, 12, Math.PI / 2], [160.5, 40, Math.PI / 2], [179.5, 26, -Math.PI / 2], [179.5, 70, -Math.PI / 2], [110, 57.5, Math.PI], [140, 48.5, 0], [200, 57.5, Math.PI], [90, 30, Math.PI / 2], [90, 70, Math.PI / 2]]) {
    M.lamp(x, z, r, { h: 8, color: '#ffb35a' });
  }
  M.car(170, 30, 0.2, '#b8b3a6', { wreck: true });
  M.truck(170, 64, Math.PI / 2 + 0.3, '#8a6a3a');
  M.zombies(170, 50, 5, 3);
  M.zombies(120, 53, 5, 2);
  M.zombies(90, 40, 4, 2);
}

// ─── 북서 주택가 (막다른 곳, 물자) ──────────────────────────────────────────
function residential(M) {
  M.ground(0, 0, 84, 86, 'asphalt');
  const R = rng(31);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      const x0 = 8 + c * 18;
      const z0 = 6 + r * 19;
      if (c === 2 && r === 1) {
        M.room(x0, z0, x0 + 12, z0 + 11, { doors: [{ side: 's', at: x0 + 6, w: 1.2, id: 'houseDoor' }], ext: 'plaster', extColor: '#c9b89a', floor: 'wood', name: '빈 집', flicker: true, lightColor: '#ffd9a0' });
        M.box(x0 + 3, z0 + 3, 2, 1, 0.75, { mat: 'wood' });
        M.item('medHouse', 'medkit', [[x0 + 3, z0 + 3, 0.78], [x0 + 10, z0 + 9, 0.1]]);
        M.note('noteHouse', x0 + 3.5, z0 + 3.2, '식탁 위 쪽지', '엄마 아빠는 먼저 배 타러 항구로 간다.\n다리는 막혔대. 지하철로 건너간대.\n꼭 따라와. 사랑해.', 0.85);
        continue;
      }
      M.building(x0, z0, x0 + 12, z0 + 11, 5 + Math.floor(R() * 2) * 3, 7, { lit: 0.25 });
      if (R() < 0.5) M.tree(x0 + 14.5, z0 + 5, 1);
    }
  }
  M.lamp(26, 17.5, 0, { h: 5 });
  M.lamp(44, 55.5, Math.PI, { h: 5, broken: true });
  M.lamp(62, 36.5, 0, { h: 5 });
  M.zombies(20, 28, 4, 2);
  M.zombies(50, 48, 4, 3);
  M.zombies(66, 70, 4, 2);
}

// ─── E. 지하철 (은하역 → 터널 → 항구역) ──────────────────────────────────────
function subway(M) {
  const T = { mat: 'tunnel' };
  const G = { mat: 'granite' };
  // 은하역 계단통 (지상과 연결)
  M.ground(187.5, 392, 198.5, 400, 'tile');
  M.wall(187.5, 392, 187.5, 400, 4.5, 0.4, G);
  M.wall(198.5, 392, 198.5, 400, 4.5, 0.4, G);
  M.wall(187.5, 392, 198.5, 392, 4.5, 0.4, G);
  M.stairs(193, 394.5, 0, 11, 6);
  M.portal('toSurfaceA', 188, 392.5, 198, 396.5, { x: 193, z: 101.5, yaw: Math.PI });
  // 대합실 A
  M.ground(176, 400, 212, 424, 'tile');
  M.wall(176, 400, 187.5, 400, 4.5, 0.4, G);
  M.wall(198.5, 400, 212, 400, 4.5, 0.4, G);
  M.wall(176, 400, 176, 424, 4.5, 0.4, G);
  M.wall(212, 400, 212, 424, 4.5, 0.4, G);
  M.wall(176, 424, 186, 424, 4.5, 0.4, G);
  M.wall(200, 424, 212, 424, 4.5, 0.4, G);
  M.visuals.push({ k: 'ceiling', x0: 176, z0: 392, x1: 212, z1: 430, y: 4.5 });
  gateLine(M, 176, 212, 414, [181.5, 189.5, 196.5, 204.5]);
  M.box(206, 405, 3, 2, 2.4, { mat: 'painted', color: '#27426e' });
  M.box(180, 420, 0.5, 3.5, 0.5, { mat: 'metal', color: '#6b7078' });
  M.sign(193, 3.6, 400.4, 0, 6, 0.8, '은하 Eunha', { bg: '#1f5fae', size: 0.55 });
  M.box(210.6, 409, 0.1, 2.4, 1.6, { y0: 0.8, mat: 'board', collide: false });
  M.note('noteSubwayMap', 210.4, 409, '노선도', '2호선  은하 ─ (강 밑 터널) ─ 항구\n\n※ 정전으로 열차 운행 중지.\n   승강장 → 선로 → 동쪽 터널 방향이 항구역.');
  for (const [x, z] of [[184, 404], [202, 404], [184, 420], [202, 420]]) M.light(x, 4.3, z, '#e6eeff', { power: 0.7, range: 12, kind: 'flicker' });
  M.zombies(193, 408, 5, 4);
  // 승강장으로 내려가는 계단
  M.ground(186, 424, 200, 430, 'tile');
  M.wall(185.8, 424, 185.8, 430, 4.5, 0.4, G);
  M.wall(200.2, 424, 200.2, 430, 4.5, 0.4, G);
  M.stairs(193, 427, Math.PI, 14, 6, 2);
  // 승강장 A + 선로
  M.ground(150, 430, 236, 440, 'platform');
  M.ground(150, 440, 352, 450, 'ballast');
  M.visuals.push({ k: 'tracks', x0: 150, x1: 352, zs: [443, 447] });
  M.visuals.push({ k: 'platformEdge', x0: 150, x1: 236, z: 440 });
  M.visuals.push({ k: 'platformEdge', x0: 300, x1: 352, z: 440 });
  M.wall(150, 430, 186, 430, 4.5, 0.4, T);
  M.wall(200, 430, 236, 430, 4.5, 0.4, T);
  M.wall(150, 430, 150, 450, 4.5, 0.4, T);
  M.wall(236, 430, 236, 440, 4.5, 0.4, T);
  M.visuals.push({ k: 'ceiling', x0: 150, z0: 424, x1: 352, z1: 452, y: 5 });
  for (let x = 160; x < 236; x += 12) M.box(x, 434, 0.7, 0.7, 5, { mat: 'granite' });
  for (let x = 162; x < 236; x += 18) M.light(x, 4.6, 435, '#dfe8ff', { power: 0.55, range: 12, kind: x === 198 ? 'flicker' : 'ceiling' });
  M.box(172, 432, 2.2, 0.6, 0.5, { mat: 'wood' });
  M.box(222, 432, 2.2, 0.6, 0.5, { mat: 'wood' });
  // 멈춘 열차 (북쪽 선로) — 옆 선로로 걸어서 지나간다
  M.visuals.push({ k: 'train', x0: 156, x1: 216, z0: 441.4, z1: 444.6, derailed: false });
  M.colRect(156, 441.4, 216, 444.6, { h: 3.6, flags: F.ALL });
  M.zombies(200, 436, 6, 4);
  M.zombies(170, 447, 4, 2);
  // 터널 벽
  M.wall(236, 440, 300, 440, 5, 0.4, T);
  M.wall(150, 450, 240, 450, 5, 0.4, T);
  M.wall(252, 450, 352, 450, 5, 0.4, T);
  for (let x = 242; x < 300; x += 12) M.light(x, 3.2, 449.4, '#ff3a2a', { power: 0.8, range: 9, kind: 'emergency' });
  // 정비실 (터널 남쪽 벽의 문)
  M.room(240, 450, 252, 458, { doors: [{ side: 'n', at: 246, w: 1.4, id: 'maintDoor' }], ext: 'tunnel', int: 'tunnel', floor: 'concrete', flicker: true, name: '정비실' });
  M.box(250.5, 453, 1, 3, 1.9, { mat: 'metal', color: '#5a6168' });
  M.box(243, 456.5, 2.2, 1, 0.8, { mat: 'wood' });
  M.item('medMaint', 'medkit', [[243, 456.5, 0.82]]);
  M.item('ammoMaint', 'ammo', [[250.2, 456.8, 0.1]]);
  M.note('noteMaint', 243.5, 456.3, '작업 일지', '터널 중간 260m 지점 열차 탈선.\n양옆 벽 쪽은 잔해로 완전히 막힘.\n열차 앞문으로 들어가서 객실을 지나 뒷문으로만 통과 가능.\n객실 안에 뭔가 있다. 조심.', 0.85);
  M.zombies(246, 454, 1.5, 1);
  // 탈선 열차 — 안으로만 지나갈 수 있다
  const tx0 = 258;
  const tx1 = 290;
  M.visuals.push({ k: 'train', x0: tx0, x1: tx1, z0: 441.1, z1: 448.9, derailed: true, interior: true });
  M.wall(tx0, 441.1, tx1, 441.1, 3.2, 0.25, { mat: 'trainHull', color: '#b9bec4' });
  M.wall(tx0, 448.9, tx1, 448.9, 3.2, 0.25, { mat: 'trainHull', color: '#b9bec4' });
  M.wall(tx0, 441.1, tx0, 443.9, 3.2, 0.25, { mat: 'trainHull', color: '#b9bec4' });
  M.wall(tx0, 446.1, tx0, 448.9, 3.2, 0.25, { mat: 'trainHull', color: '#b9bec4' });
  M.wall(tx1, 441.1, tx1, 443.9, 3.2, 0.25, { mat: 'trainHull', color: '#b9bec4' });
  M.wall(tx1, 446.1, tx1, 448.9, 3.2, 0.25, { mat: 'trainHull', color: '#b9bec4' });
  M.junk(tx0 - 1.5, 440.6, 3, 1.4, 0, 3);
  M.junk(tx0 - 1.5, 449.4, 3, 1.4, 0, 4);
  M.junk(tx1 + 1.5, 440.6, 3, 1.4, 0, 5);
  M.junk(tx1 + 1.5, 449.4, 3, 1.4, 0, 6);
  for (let x = tx0 + 2; x < tx1 - 2; x += 4) {
    M.box(x, 441.7, 2.4, 0.7, 0.5, { mat: 'seat', color: '#3f5f8a' });
    M.box(x + 1.2, 448.3, 2.4, 0.7, 0.5, { mat: 'seat', color: '#3f5f8a' });
  }
  for (let x = tx0 + 4; x < tx1; x += 8) M.light(x, 2.9, 445, '#dfe8ff', { power: 0.45, range: 7, kind: 'flicker' });
  M.zombies(274, 445, 6, 5);
  M.zombies(254, 445, 3, 2);
  M.zombies(296, 445, 3, 2);
  // 승강장 B (항구역)
  M.ground(300, 430, 352, 440, 'platform');
  M.wall(300, 430, 322, 430, 4.5, 0.4, T);
  M.wall(336, 430, 352, 430, 4.5, 0.4, T);
  M.wall(300, 430, 300, 440, 4.5, 0.4, T);
  M.wall(352, 430, 352, 450, 4.5, 0.4, T);
  for (let x = 308; x < 352; x += 12) M.box(x, 434, 0.7, 0.7, 5, { mat: 'granite' });
  for (let x = 306; x < 352; x += 16) M.light(x, 4.6, 435, '#dfe8ff', { power: 0.55, range: 12, kind: 'ceiling' });
  M.sign(329, 3.6, 430.5, 0, 6, 0.8, '항구 Harbor', { bg: '#1f5fae', size: 0.55 });
  M.zombies(326, 436, 6, 4);
  M.ground(322, 424, 336, 430, 'tile');
  M.wall(321.8, 424, 321.8, 430, 4.5, 0.4, G);
  M.wall(336.2, 424, 336.2, 430, 4.5, 0.4, G);
  M.stairs(329, 427, 0, 14, 6, 2);
  // 대합실 B
  M.ground(312, 400, 350, 424, 'tile');
  M.wall(312, 400, 326, 400, 4.5, 0.4, G);
  M.wall(336, 400, 350, 400, 4.5, 0.4, G);
  M.wall(312, 400, 312, 424, 4.5, 0.4, G);
  M.wall(350, 400, 350, 424, 4.5, 0.4, G);
  M.wall(312, 424, 322, 424, 4.5, 0.4, G);
  M.wall(336, 424, 350, 424, 4.5, 0.4, G);
  M.visuals.push({ k: 'ceiling', x0: 312, z0: 392, x1: 350, z1: 430, y: 4.5 });
  gateLine(M, 312, 350, 414, [317.5, 325.5, 332.5, 340.5]);
  for (const [x, z] of [[320, 405], [342, 405], [320, 420], [342, 420]]) M.light(x, 4.3, z, '#e6eeff', { power: 0.6, range: 12, kind: 'ceiling' });
  M.zombies(331, 408, 5, 4);
  // 항구역 계단통
  M.ground(326, 392, 336, 400, 'tile');
  M.wall(326, 392, 326, 400, 4.5, 0.4, G);
  M.wall(336, 392, 336, 400, 4.5, 0.4, G);
  M.wall(326, 392, 336, 392, 4.5, 0.4, G);
  M.stairs(331, 394.5, 0, 10, 6);
  M.portal('toSurfaceB', 326.5, 392.5, 335.5, 396.5, { x: 309, z: 149.5, yaw: 0 });
  M.horde(160, 446, 'subway');
  M.horde(345, 446, 'subway');
  M.horde(194, 420, 'subway');
  M.horde(331, 418, 'subway');
}

/** 개찰구 줄: gaps 에 1.2m 통로 */
function gateLine(M, x0, x1, z, gaps) {
  let cur = x0;
  for (const g of [...gaps, x1 + 10]) {
    const end = Math.min(g - 0.6, x1);
    if (end > cur) {
      M.visuals.push({ k: 'turnstiles', x0: cur, x1: end, z });
      M.colRect(cur, z - 0.3, end, z + 0.3, { h: 1.1, flags: F.MOVE });
    }
    cur = g + 0.6;
  }
}

// ─── F. 강 건너: 항구역 출구, 사무실 거리 ────────────────────────────────────
function eastBank(M) {
  M.ground(264.4, 0, 276, 240, 'road');
  M.ground(264.4, 124.5, 322, 136, 'sidewalk');
  M.ground(264.4, 136, 322, 146, 'road');
  M.ground(276, 146, 322, 236, 'asphalt');
  M.trigger('eastBank', 266, 0, 360, 240);
  // 항구역 출구 (북쪽으로 열림)
  M.ground(303, 147, 315, 157, 'tile');
  M.wall(303, 147, 303, 157, 3.4, 0.4, { mat: 'granite' });
  M.wall(315, 147, 315, 157, 3.4, 0.4, { mat: 'granite' });
  M.wall(303, 157, 315, 157, 3.4, 0.4, { mat: 'granite' });
  M.visuals.push({ k: 'roof', x0: 302.8, z0: 146.8, x1: 315.2, z1: 157.2, y: 3.4, t: 0.35, mat: 'granite' });
  M.stairs(309, 152.5, 0, 11, 7);
  M.portal('toSubwayB', 304.5, 153.5, 313.5, 156.7, { x: 331, z: 403.5, yaw: Math.PI });
  M.sign(309, 3.95, 146.65, Math.PI, 6, 0.9, '항구역  2호선', { bg: '#1f5fae', size: 0.6, flag: 'power' });
  // 건물들
  M.building(276, 160, 300, 196, 16, 1);
  M.building(276, 202, 300, 236, 22, 2);
  M.building(300, 166, 322, 200, 18, 0);
  M.building(300, 206, 322, 236, 14, 1);
  M.room(278, 147, 290, 157, { doors: [{ side: 'e', at: 152, w: 1.4, id: 'shopDoor' }], ext: 'plaster', extColor: '#b8c3b0', name: '항구 매점', flicker: true });
  M.box(281, 150, 3, 0.7, 1.8, { mat: 'shelf' });
  M.box(286, 155, 2.4, 0.8, 0.9, { mat: 'wood' });
  M.item('medShop', 'medkit', [[286, 155, 0.92], [281, 152, 0.1]]);
  M.lamp(270, 150, Math.PI / 2, { h: 7 });
  M.lamp(270, 190, Math.PI / 2, { h: 7, broken: true });
  M.lamp(270, 40, Math.PI / 2, { h: 7 });
  M.lamp(270, 80, Math.PI / 2, { h: 7 });
  M.lamp(290, 134.5, Math.PI, { h: 7 });
  M.car(270, 170, 0.1, '#8a1c1c', { wreck: true });
  M.car(268.5, 60, Math.PI - 0.2, '#d9d9d9', { wreck: true });
  M.car(296, 141, Math.PI / 2 + 0.1, '#274a5e', { wreck: true });
  M.zombies(270, 120, 5, 3);
  M.zombies(290, 175, 4, 2);
  M.zombies(300, 141, 4, 3);
}

// ─── 컨테이너 야적장 미로와 관제탑 ──────────────────────────────────────────
function containerYard(M) {
  M.ground(276, 4, 322, 124.5, 'concrete');
  const colors = ['#8a2b24', '#1f5a8a', '#2f7a4a', '#b8862f', '#6a3a7a', '#4a4f55', '#c45a2a', '#2a6a6a'];
  for (let z = 6; z < 121; z += 12.2) M.container(275.2, Math.min(z + 6.1, 121 - 6.1 + 0.01), Math.PI / 2, colors[Math.floor(z) % colors.length], 2);
  const res = M.maze({
    x0: 276, z0: 6, cols: 3, rows: 10, bw: 10, bd: 8, lane: 3.5, seed: 777,
    extraOpen: 0.18, outsideRow: 10, exits: [2], start: [0, 0],
    skip: (i, j) => i <= 1 && j <= 1,
    onBlock: (i, j, x0, z0, x1, z1, R) => {
      const cx = (x0 + x1) / 2;
      for (let k = 0; k < 3; k++) {
        const z = z0 + 1.3 + k * 2.7;
        M.visuals.push({ k: 'container', x: cx, z, rot: 0, color: colors[Math.floor(R() * colors.length)], stack: 1 + Math.floor(R() * 3), len: x1 - x0 - 0.3 });
      }
      M.colRect(x0, z0, x1, z1, { h: 7.8, flags: F.ALL });
    },
    onBlocker: (x, z, horiz, R) => {
      const col = colors[Math.floor(R() * colors.length)];
      if (horiz) M.container(x, z, Math.PI / 2, col, 1 + Math.floor(R() * 2), { long: false });
      else M.container(x, z, 0, col, 1 + Math.floor(R() * 2), { long: false });
    },
    onExitBlocker: (x, z, R) => {
      M.container(x, 122.8, 0, colors[Math.floor(R() * colors.length)], 2, { long: false });
    },
  });
  // 관제탑 (정문 스위치)
  M.room(283, 12, 297, 26, { doors: [{ side: 's', at: 290, w: 1.6, id: 'towerDoor' }], ext: 'concrete', extColor: '#c8ccd0', name: '관제탑' });
  M.visuals.push({ k: 'tower', x: 290, z: 19, h: 26 });
  M.box(290, 13, 5, 0.9, 1.1, { mat: 'metal', color: '#4c565e' });
  M.interact('gatePanel', 290, 13.4, '정문 개방 버튼', 'gate', { y: 1.2, r: 2.2 });
  M.item('rifleTower', 'rifle', [[295, 24.5, 0.1], [285, 14, 0.1]]);
  M.item('ammoTower', 'ammo', [[285, 24.8, 0.1]]);
  M.item('medTower', 'medkit', [[295.5, 14, 0.1]]);
  M.sign(290, 3.1, 26.3, 0, 3.6, 0.7, '관제탑', { bg: '#20262e', size: 0.55 });
  M.sign(res.nx(2), 3.2, 124.2, 0, 4.6, 0.8, '↑ 관제탑 Control', { bg: '#2a4a2a', size: 0.5 });
  const R = rng(55);
  for (let i = 0; i <= 3; i++) {
    for (let j = 0; j < 10; j++) {
      if (R() < 0.18) M.light(res.nx(i), 7, res.nz(j), '#ffb35a', { power: 1, range: 16, kind: 'flood' });
      if (R() < 0.3 && !(i <= 1 && j <= 1)) M.zombies(res.nx(i), res.nz(j), 1.2, 1 + Math.floor(R() * 3));
    }
  }
  M.zombies(290, 30, 4, 3);
}

// ─── 항구 (정문 → 부두 → 구조선) ────────────────────────────────────────────
function port(M) {
  M.ground(322, 0, 360, 240, 'concrete');
  M.fence(322, 0, 322, 136, 3.4);
  M.fence(322, 146, 322, 240, 3.4);
  M.door('portGate', 322, 141, 'z', 10, { h: 3.4, kind: 'gate', locked: true, flag: 'portGate', label: '항구 정문', lockedMsg: '정문이 잠겨 있다. 관제탑에서 열 수 있을 것 같다.' });
  M.box(319.5, 150, 2.6, 2.6, 2.6, { mat: 'plaster', color: '#c9ccd3' });
  M.sign(319.5, 3.2, 148.6, Math.PI, 5, 0.9, '은하항 GATE', { bg: '#20262e', size: 0.55 });
  M.box(318.2, 148.6, 0.1, 1, 0.8, { y0: 1, mat: 'board', collide: false });
  M.note('noteGate', 318.2, 148.2, '경비실 안내문', '[은하항만공사]\n비상시 정문 개폐는\n컨테이너 야적장 안 관제탑 제어실에서 합니다.');
  // 크레인과 쌓인 컨테이너
  for (const z of [30, 84, 196]) {
    M.visuals.push({ k: 'crane', x: 350, z });
    for (const [dx, dz] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) M.col(350 + dx, z + dz, 0.6, 0.6, { h: 30, flags: F.ALL });
  }
  const colors = ['#8a2b24', '#1f5a8a', '#2f7a4a', '#b8862f', '#4a4f55'];
  for (const [x, z, st] of [[330, 20, 3], [330, 23, 2], [338, 60, 2], [330, 100, 1], [336, 215, 3], [336, 218, 2], [328, 60, 1]]) M.container(x, z, 0, colors[(x + z) % colors.length], st);
  // 항만사무소 (무전기)
  M.room(328, 168, 344, 182, { doors: [{ side: 'w', at: 175, w: 1.6, id: 'harborDoor' }], ext: 'concrete', extColor: '#b4bcc4', name: '항만사무소' });
  M.sign(327.7, 3.1, 175, -Math.PI / 2, 4, 0.7, '항만사무소', { bg: '#20262e', size: 0.55 });
  M.box(342.5, 175, 1, 2.4, 0.9, { mat: 'metal', color: '#4c565e' });
  M.interact('radio', 342.3, 175, '무전기', 'radio', { y: 1.2, r: 2.2 });
  M.box(333, 171, 2.4, 1, 0.78, { mat: 'wood' });
  M.item('medHarbor', 'medkit', [[333, 171, 0.82]]);
  M.item('ammoHarbor', 'ammo', [[330, 180.5, 0.1]]);
  M.note('noteRadio', 341.8, 176.4, '무전기 옆 메모', '구조선 호출: 채널 16\n"여기는 은하항, 생존자 있음"\n배가 오는 데 3분쯤 걸린다고 함.\n그동안 버틸 것.', 1.0);
  // 부두
  M.visuals.push({ k: 'pier', x0: 350, z0: 100, x1: 360, z1: 130 });
  for (const z of [102, 110, 118, 126]) M.box(359.3, z, 0.5, 0.5, 0.6, { mat: 'metal', color: '#2a2d31' });
  M.trigger('boatZone', 352, 104, 360, 126);
  for (const z of [20, 70, 120, 170, 220]) M.lamp(357, z, -Math.PI / 2, { h: 12, color: '#f0f4ff', arm: 2.2 });
  M.lamp(326, 141, Math.PI / 2, { h: 8, color: '#ffb35a' });
  M.zombies(336, 140, 4, 3);
  M.zombies(340, 100, 4, 2);
  M.zombies(338, 200, 4, 2);
  for (const [x, z] of [[330, 8], [345, 232], [356, 60], [356, 200], [300, 141], [330, 120], [340, 30]]) M.horde(x, z, 'finale');
  for (const [x, z] of [[305, 60], [290, 110], [310, 20], [300, 90]]) M.horde(x, z, 'port');
}
