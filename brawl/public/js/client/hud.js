// 경기 화면 위 글자들: 위쪽 선수 카드(누적 %·승수), 서든데스 시계, 큰 알림, 장외 로그, 머리 위 이름표, 관전 안내.
import { ROSTER_BY_ID, SLOT_COLORS } from '../sim/roster.js';
import { SUDDEN_DEATH_AT } from '../sim/sim.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SUDDEN_TEXT = {
  octagon: '철창이 전부 떨어진다!',
  rooftop: '돌풍이 더 세게, 더 자주!',
  factory: '벨트가 빨라진다!',
  pitch: '구장이 더 크게 기운다!',
};
const LEVEL_NAMES = ['', '초보', '보통', '고수'];

/** % 가 높을수록 흰색 → 노랑 → 주황 → 빨강 */
export function pctColor(p) {
  const stops = [[0, [255, 255, 255]], [60, [255, 224, 102]], [120, [255, 159, 67]], [180, [255, 77, 77]], [260, [200, 30, 40]]];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    const [p0, c0] = stops[i - 1];
    if (p <= p1) {
      const k = (p - p0) / (p1 - p0);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
    }
  }
  return 'rgb(200,30,40)';
}

export class Hud {
  constructor() {
    this.top = $('hud-top');
    this.timer = $('hud-timer');
    this.ann = $('announce');
    this.bottom = $('hud-bottom');
    this.plates = $('nameplates');
    this.feedBox = null;
    this.spec = null;
    this.annTimer = null;
    this.hintTimer = null;
    this.lastCount = null;
    this.roster = [];
  }

  /** roster: [{ slot, name, charId, local, bot, botLevel }] (슬롯 순서) */
  setup({ roster, winsNeeded, mapId, sandbox }) {
    this.roster = roster;
    this.winsNeeded = winsNeeded;
    this.mapId = mapId;
    this.sandbox = sandbox;
    this.scores = Object.fromEntries(roster.map((r) => [r.slot, 0]));
    this.lastCount = null;
    this.phase = null;
    this.statuses = null;

    this.top.innerHTML = '';
    this.cards = new Map();
    for (const r of roster) {
      const c = document.createElement('div');
      c.className = 'pc';
      c.style.setProperty('--slot', SLOT_COLORS[r.slot]);
      const ch = ROSTER_BY_ID[r.charId];
      c.innerHTML = `<div class="top"><b>P${r.slot + 1}</b><span>${esc(r.name)}</span>${r.local ? '<em class="me">나</em>' : ''}</div>
        <div class="sub">${r.bot ? `🤖 봇 ${LEVEL_NAMES[r.botLevel] || ''}` : esc(ch ? ch.name : '')}</div>
        <div class="pct">0<small>%</small></div>
        <div class="wins">${sandbox ? '' : '<i></i>'.repeat(winsNeeded)}</div>`;
      this.top.appendChild(c);
      this.cards.set(r.slot, { el: c, wins: [...c.querySelectorAll('.wins i')], pct: c.querySelector('.pct'), out: false, shown: -1 });
    }

    this.plates.innerHTML = '';
    this.plateEls = new Map();
    for (const r of roster) {
      const p = document.createElement('div');
      p.className = `np${r.local ? ' local' : ''}`;
      p.style.setProperty('--slot', SLOT_COLORS[r.slot]);
      p.innerHTML = `<div class="mash hidden"></div><div class="meter hidden"><i></i></div>
        <div class="n">${r.local ? '▼ ' : ''}P${r.slot + 1} ${esc(r.name)}</div><div class="p">0%</div>`;
      this.plates.appendChild(p);
      this.plateEls.set(r.slot, {
        el: p, mash: p.querySelector('.mash'), meter: p.querySelector('.meter'), meterI: p.querySelector('.meter i'),
        p: p.querySelector('.p'), cache: {},
      });
    }

    const game = this.top.parentElement;
    if (!this.feedBox) {
      this.feedBox = document.createElement('div');
      this.feedBox.className = 'feed';
      game.appendChild(this.feedBox);
    }
    if (!this.spec) {
      this.spec = document.createElement('div');
      this.spec.className = 'spectate hidden';
      game.appendChild(this.spec);
    }
    this.feedBox.innerHTML = '';
    this.spec.classList.add('hidden');
    this.ann.textContent = '';
    this.timer.textContent = '';
    this.timer.classList.remove('sd', 'warn');
  }

  setScores(scores) {
    if (!scores) return;
    this.scores = { ...scores };
    for (const [slot, card] of this.cards) {
      const n = this.scores[slot] || 0;
      card.wins.forEach((w, i) => w.classList.toggle('on', i < n));
    }
  }

  nameOf(slot) {
    const r = this.roster.find((x) => x.slot === slot);
    return r ? r.name : `P${slot + 1}`;
  }

  tagOf(slot) {
    return `<b style="color:${SLOT_COLORS[slot] || '#fff'}">${esc(this.nameOf(slot))}</b>`;
  }

  announce(text, small = '', ms = 1200, cls = '') {
    clearTimeout(this.annTimer);
    this.ann.className = 'announce';
    void this.ann.offsetWidth; // 애니메이션 다시 시작
    this.ann.className = `announce pop ${cls}`;
    this.ann.innerHTML = `${esc(text)}${small ? `<small>${esc(small)}</small>` : ''}`;
    if (ms > 0) this.annTimer = setTimeout(() => { this.ann.innerHTML = ''; }, ms);
  }

  feed(html) {
    const d = document.createElement('div');
    d.className = 'fi';
    d.innerHTML = html;
    this.feedBox.appendChild(d);
    while (this.feedBox.children.length > 5) this.feedBox.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 4500);
    setTimeout(() => d.remove(), 5200);
  }

  hint(text, ms = 7000) {
    clearTimeout(this.hintTimer);
    this.bottom.innerHTML = text;
    this.bottom.classList.remove('fade');
    if (ms > 0) this.hintTimer = setTimeout(() => this.bottom.classList.add('fade'), ms);
  }

  /** 시뮬레이션 이벤트 → 알림·장외 로그 (타격마다 글자를 띄우지는 않는다) */
  event(ev) {
    switch (ev.type) {
      case 'roundStart':
        this.setScores(ev.scores);
        this.lastCount = null;
        break;
      case 'fight':
        this.announce(this.sandbox ? '연습 시작!' : '싸워라!', '', 900, 'go');
        break;
      case 'out':
        this.feed(ev.by >= 0 && ev.by !== ev.slot ? `${this.tagOf(ev.by)} ➜ ${this.tagOf(ev.slot)} 장외!` : `${this.tagOf(ev.slot)} 추락`);
        break;
      case 'suddenDeath':
        this.announce('서든데스!', SUDDEN_TEXT[this.mapId] || '', 2200, 'sd');
        break;
      case 'mapEvent':
        if (ev.what === 'gust') this.announce('돌풍!', '', 900, 'small');
        break;
      case 'roundEnd':
        this.setScores(ev.scores);
        if (ev.matchWinner !== null && ev.matchWinner !== undefined) this.announce(`${this.nameOf(ev.winner)} 우승!`, '', 4000, 'win');
        else if (ev.winner >= 0) this.announce(`${this.nameOf(ev.winner)} 승리!`, `${this.scores[ev.winner]} / ${this.winsNeeded}`, 3500, 'win');
        else this.announce('무승부!', '다 같이 떨어졌어요', 3500);
        break;
      default:
    }
  }

  /** 매 화면마다: 단계·시계·카드·관전 안내 */
  frame(meta) {
    if (!meta) return;
    const { phase, phaseT, roundTime, round, statuses } = meta;
    if (phase === 'countdown') {
      const n = Math.ceil(phaseT);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.announce(String(n), this.sandbox ? '연습 모드' : `라운드 ${round}`, 0);
      }
    }
    this.phase = phase;

    // 시계: 서든데스까지 남은 시간
    if (this.sandbox) {
      this.timer.textContent = '연습 모드';
    } else if (phase === 'fight' || phase === 'roundEnd') {
      const left = Math.max(0, SUDDEN_DEATH_AT - roundTime);
      if (left <= 0) {
        this.timer.textContent = '⚡ 서든데스';
        this.timer.classList.add('sd');
      } else {
        const s = Math.ceil(left);
        this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        this.timer.classList.toggle('warn', left < 10);
        this.timer.classList.remove('sd');
      }
    } else if (phase === 'countdown') {
      this.timer.textContent = `라운드 ${round}`;
      this.timer.classList.remove('sd', 'warn');
    }

    if (!statuses) return;
    for (const st of statuses) {
      const card = this.cards.get(st.slot);
      if (!card) continue;
      const out = !!(st.flags & 1);
      if (out !== card.out) {
        card.out = out;
        card.el.classList.toggle('out', out);
        if (out) card.pct.innerHTML = '장외';
        card.shown = -1;
      }
      const p = Math.round(st.pct || 0);
      if (!out && p !== card.shown) {
        if (p > card.shown && card.shown >= 0) {
          card.pct.classList.remove('bump');
          void card.pct.offsetWidth;
          card.pct.classList.add('bump');
        }
        card.shown = p;
        card.pct.innerHTML = `${p}<small>%</small>`;
        card.pct.style.color = pctColor(p);
      }
    }
    this.statuses = statuses;

    // 이 화면의 플레이어가 모두 떨어졌으면 관전 안내
    const locals = this.roster.filter((r) => r.local);
    const alive = statuses.filter((s) => !(s.flags & 1)).length;
    const spectating = !this.sandbox && locals.length > 0 && phase === 'fight'
      && locals.every((r) => (statuses.find((s) => s.slot === r.slot)?.flags ?? 1) & 1);
    this.spec.classList.toggle('hidden', !spectating);
    if (spectating) this.spec.textContent = `👀 탈락! 관전 중 — ${alive}명 남음`;
  }

  /** 머리 위 이름표 (카메라 투영) */
  nameplates(view) {
    if (!this.statuses || !view.scene) return;
    const H = view.container.clientHeight;
    for (const st of this.statuses) {
      const pl = this.plateEls.get(st.slot);
      if (!pl) continue;
      const head = view.fighterPos(st.slot, 'head');
      const out = st.flags & 1;
      if (!head || out || head.y < -4) {
        if (pl.cache.vis !== false) { pl.el.style.display = 'none'; pl.cache.vis = false; }
        continue;
      }
      const s = view.project({ x: head.x, y: head.y + 0.42, z: head.z });
      if (!s.visible || s.y < -40 || s.y > H + 40) {
        if (pl.cache.vis !== false) { pl.el.style.display = 'none'; pl.cache.vis = false; }
        continue;
      }
      if (pl.cache.vis !== true) { pl.el.style.display = ''; pl.cache.vis = true; }
      pl.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
      const p = Math.round(st.pct || 0);
      if (pl.cache.p !== p) {
        pl.cache.p = p;
        pl.p.textContent = `${p}%`;
        pl.p.style.color = pctColor(p);
      }

      // 초크 게이지와 연타 안내는 기능이라 남긴다 (내 캐릭터일 때만 연타 안내)
      let meter = -1;
      if (st.grab === 'submit') meter = st.grabProgress;
      else if (st.victimOf === 'submit') meter = st.victimProgress;
      if (meter >= 0) {
        pl.meter.classList.remove('hidden');
        pl.meterI.style.width = `${Math.round(meter * 100)}%`;
      } else if (!pl.meter.classList.contains('hidden')) pl.meter.classList.add('hidden');

      const r = this.roster.find((x) => x.slot === st.slot);
      let mash = '';
      if (r && r.local && !(st.flags & 2)) {
        if (st.victimOf === 'submit') mash = '연타해서 버텨!';
        else if (st.flags & 16) mash = '연타해서 빠져나와!';
        else if (st.grab === 'submit') mash = 'MMA 꾹!';
      }
      this.setText(pl, 'mash', mash);
    }
  }

  setText(pl, key, text) {
    if (pl.cache[key] === text) return;
    pl.cache[key] = text;
    pl[key].textContent = text;
    pl[key].classList.toggle('hidden', !text);
  }

  clear() {
    clearTimeout(this.annTimer);
    clearTimeout(this.hintTimer);
    this.top.innerHTML = '';
    this.plates.innerHTML = '';
    this.ann.innerHTML = '';
    this.timer.textContent = '';
    this.bottom.innerHTML = '';
    if (this.feedBox) this.feedBox.innerHTML = '';
    if (this.spec) this.spec.classList.add('hidden');
    this.statuses = null;
  }
}

export { esc };
