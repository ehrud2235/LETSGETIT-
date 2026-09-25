// 단계별로 갈 수 있는 곳/없는 곳 확인: node tools/routecheck.mjs
import { buildMap } from '../public/js/shared/map.js';
import { NavGrid } from '../public/js/shared/nav.js';
import { reachable, distTo } from '../public/js/shared/route.js';

const map = buildMap();
const nav = new NavGrid(map);
for (const d of map.doors) if (!d.locked) nav.setDoor(d.id, false);
const P = {
  key: [73.3, 153.8], backGateIn: [83, 199], police: [122, 190], boulevard: [100, 124], station: [193, 106],
  panel: [221.8, 37], w2: [128, 70], gas: [143, 92], park: [210, 190], house: [50, 29], checkpoint: [219, 124],
  subA: [193, 94.2], ugArrive: [193, 403.5], ugPortalB: [331, 394.5], trainMid: [274, 445], maint: [246, 455],
  ebArrive: [309, 149.5], tower: [290, 14.4], radio: [341.4, 175], boat: [356, 115], yardExit: [304.75, 126],
};
const check = (label, from, yes, no) => {
  const d = reachable(nav, from);
  const out = [];
  let ok = true;
  for (const k of yes) { const v = distTo(nav, d, ...P[k]); out.push(`${k}=${v}`); if (v < 0) ok = false; }
  for (const k of no) { const v = distTo(nav, d, ...P[k]); out.push(`!${k}=${v}`); if (v >= 0) ok = false; }
  console.log(`${ok ? 'OK ' : 'BAD'} ${label}: ${out.join(' ')}`);
  return ok;
};
let all = true;
all &= check('1 시작', map.starts[0], ['key', 'backGateIn'], ['police', 'boulevard', 'station']);
nav.setDoor('backGate', false);
all &= check('2 뒷문 열림', map.starts[0], ['police', 'boulevard', 'station', 'panel', 'w2', 'gas', 'park', 'house', 'checkpoint'], ['subA', 'ebArrive']);
nav.setDoor('stationShutter', false);
all &= check('3 셔터 열림', map.starts[0], ['subA'], ['ebArrive']);
all &= check('4 지하', P.ugArrive, ['trainMid', 'maint', 'ugPortalB'], []);
all &= check('5 강 건너', P.ebArrive, ['tower', 'yardExit'], ['radio', 'boat', 'station']);
nav.setDoor('portGate', false);
all &= check('6 정문 열림', P.ebArrive, ['radio', 'boat'], []);
console.log(all ? '전체 경로 OK' : '경로 문제 있음');
process.exitCode = all ? 0 : 1;
