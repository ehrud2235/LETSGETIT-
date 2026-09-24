// 경기 화면 위 글자들: 위쪽 선수 카드(승수·기절 게이지), 서든데스 시계, 큰 알림, 킬 로그, 머리 위 이름표.
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
const VICTIM_TAG = { tackle: '태클!', mount: '깔렸다!', submit: '조르기!', suplex: '수플렉스!' };
const ATTACK_TAG = { mount: '마운트', submit: '초크 중', suplex: '수플렉스!' };

export class Hud {
  constructor() {
    this.top = $('hud-top');
    this.timer = $('hud-timer');
    this.ann = $('announce');
    this.bottom = $('hud-bottom');
    this.plates = $('nameplates');
    this.feedBox = null;
    this.annTimer = null;
    this.hintTimer = null;
    this.lastCount = null;
    this.roster = [];
  }

  /**
   * roster: [{ slot, name, charId, local }] (슬롯 순서)
   */
  setup({ roster, winsNeeded, mapId, sandbox }) {
    this.roster = roster;
    this.winsNeeded = winsNeeded;
    this.mapId = mapId;
    this.sandbox = sandbox;
    this.scores = Object.fromEntries(roster.map((r) => [r.slot, 0]));
    this.lastCount = null;
    this.phase = null;

    this.top.innerHTML = '';
    this.cards = new Map();
    for (const r of roster) {
      const c = document.createElement('div');
      c.className = 'pc';
      c.style.setProperty('--slot', SLOT_COLORS[r.slot]);
      const ch = ROSTER_BY_ID[r.charId];
      c.innerHTML = `<div class="top"><b>P${r.slot + 1}</b><span>${esc(r.name)}</span>${r.local ? '<em class="me">나</em>' : ''}</div>
        <div class="sub">${r.bot ? `🤖 봇 ${['', '초보', '보통', '고수'][r.botLevel] || ''}` : esc(ch ? ch.name : '')}</div>
        <div class="wins">${sandbox ? '' : '<i></i>'.repeat(winsNeeded)}</div>
        <div class="bar"><i></i></div>`;
      this.top.appendChild(c);
      this.cards.set(r.slot, { el: c, wins: [...c.querySelectorAll('.wins i')], bar: c.querySelector('.bar i'), out: false });
    }

    this.plates.innerHTML = '';
    this.plateEls = new Map();
    for (const r of roster) {
      const p = document.createElement('div');
      p.className = `np${r.local ? ' local' : ''}`;
      p.style.setProperty('--slot', SLOT_COLORS[r.slot]);
      p.innerHTML = `<div class="mash hidden"></div><div class="meter hidden"><i></i></div><div class="tag hidden"></div>
        <div class="n">${r.local ? '▼ ' : ''}P${r.slot + 1} ${esc(r.name)}</div><div class="hp"><i></i></div>`;
      this.plates.appendChild(p);
      this.plateEls.set(r.slot, {
        el: p, mash: p.querySelector('.mash'), meter: p.querySelector('.meter'), meterI: p.querySelector('.meter i'),
        tag: p.querySelector('.tag'), hp: p.querySelector('.hp i'), cache: {},
      });
    }

    if (!this.feedBox) {
      this.feedBox = document.createElement('div');
      this.feedBox.className = 'feed';
      this.top.parentElement.appendChild(this.feedBox);
    }
    this.feedBox.innerHTML = '';
    this.ann.textContent = '';
    this.timer.textContent = '';
    this.timer.classList.remove('sd');
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

  /** 시뮬레이션 이벤트 → 알림·킬 로그 */
  event(ev) {
    switch (ev.type) {
      case 'roundStart':
        this.setScores(ev.scores);
        this.lastCount = null;
        break;
      case 'fight':
        this.announce(this.sandbox ? '연습 시작!' : '싸워라!', '', 900, 'go');
        break;
      case 'ko':
        this.feed(ev.by >= 0 && ev.by !== ev.slot ? `${this.tagOf(ev.by)} 💥 ${this.tagOf(ev.slot)} 기절` : `${this.tagOf(ev.slot)} 기절`);
        break;
      case 'out':
        this.feed(ev.by >= 0 && ev.by !== ev.slot ? `${this.tagOf(ev.by)} ➜ ${this.tagOf(ev.slot)} 탈락!` : `${this.tagOf(ev.slot)} 추락…`);
        break;
      case 'submitWin':
        this.feed(`${this.tagOf(ev.by)} 🤼 ${this.tagOf(ev.slot)} 탭아웃!`);
        break;
      case 'suplex':
        this.feed(`${this.tagOf(ev.by)} 의 수플렉스!`);
        break;
      case 'takedown':
        this.feed(`${this.tagOf(ev.by)} 태클 성공`);
        break;
      case 'escape':
        this.feed(`${this.tagOf(ev.slot)} 탈출!`);
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
      case 'respawn':
        this.feed(`${this.tagOf(ev.slot)} 다시 등장`);
        break;
      default:
    }
  }

  /** 매 화면마다: 단계·시계·카드 */
  frame(meta) {
    if (!meta) return;
    const { phase, phaseT, roundTime, round, statuses } = meta;
    if (phase === 'countdown') {
      const n = Math.ceil(phaseT);
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.announce(String(n), this.sandbox ? '연습 모드' : `라운드 ${round}`, 0);
      }
    } else if (this.phase === 'countdown' && phase === 'fight' && this.lastCount !== null) {
      this.lastCount = null;
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

    if (statuses) {
      for (const st of statuses) {
        const card = this.cards.get(st.slot);
        if (!card) continue;
        const out = !!(st.flags & 1);
        if (out !== card.out) {
          card.out = out;
          card.el.classList.toggle('out', out);
        }
        card.bar.style.width = `${Math.round(st.hp * 100)}%`;
        card.el.classList.toggle('ko', !!(st.flags & 2));
      }
      this.statuses = statuses;
    }
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
      pl.hp.style.width = `${Math.round(st.hp * 100)}%`;

      const r = this.roster.find((x) => x.slot === st.slot);
      let tag = '';
      if (st.flags & 2) tag = '기절 💫';
      else if (st.victimOf) tag = VICTIM_TAG[st.victimOf] || '';
      else if (st.grab) tag = ATTACK_TAG[st.grab] || '';
      else if (st.flags & 64) tag = '들어 올림!';
      else if (st.flags & 16) tag = '잡힘!';
      this.setText(pl, 'tag', tag);

      let meter = -1;
      if (st.grab === 'submit') meter = st.grabProgress;
      else if (st.victimOf === 'submit') meter = st.victimProgress;
      if (meter >= 0) {
        pl.meter.classList.remove('hidden');
        pl.meterI.style.width = `${Math.round(meter * 100)}%`;
      } else if (!pl.meter.classList.contains('hidden')) pl.meter.classList.add('hidden');

      let mash = '';
      if (r && r.local && !(st.flags & 2)) {
        if (st.victimOf === 'submit') mash = '연타해서 버텨!';
        else if (st.flags & 16) mash = '아무 버튼 연타!';
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
    this.statuses = null;
  }
}

export { esc };
