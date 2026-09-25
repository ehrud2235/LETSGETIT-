// 화면 글자·막대. 길 안내 화살표는 없다: 목표 문장, 동료 위치 표시만.
import { WEAPONS, REVIVE_TIME } from '../shared/weapons.js';
import { OBJECTIVES } from '../shared/map.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OBJ = Object.fromEntries(OBJECTIVES.map((o) => [o.id, o.text]));

export class Hud {
  constructor() {
    this.el = {
      objective: $('objective'), radio: $('radio'), cross: $('crosshair'), hit: $('hitmark'), prompt: $('prompt'), ring: $('progress'),
      ringArc: $('progress-arc'), msg: $('msg'), toasts: $('toasts'), me: $('me-card'), mate: $('mate-card'), weapon: $('weapon'),
      finale: $('finale'), marker: $('mate-marker'), damage: $('damage'), low: $('lowhp'), downed: $('downed'), note: $('note-view'),
      end: $('end-screen'), tab: $('tab-panel'), fade: $('fade'), dir: $('dmg-dir'),
    };
    this.msgT = 0;
    this.radioT = 0;
    this.objId = null;
    this.hitT = 0;
    this.dmgA = 0;
    this.noteOpen = false;
    this.el.note.querySelector('button').onclick = () => this.closeNote();
  }

  objective(id, flash = true) {
    if (!OBJ[id]) return;
    this.objId = id;
    this.el.objective.textContent = OBJ[id];
    if (flash) {
      this.el.objective.classList.remove('flash');
      void this.el.objective.offsetWidth;
      this.el.objective.classList.add('flash');
    }
  }

  radio(text, dur = 9) {
    this.el.radio.textContent = text;
    this.el.radio.classList.add('show');
    this.radioT = dur;
  }

  message(text, dur = 3.5) {
    this.el.msg.textContent = text;
    this.el.msg.classList.add('show');
    this.msgT = dur;
  }

  toast(text) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3200);
  }

  hitmarker(head) {
    this.hitT = 0.18;
    this.el.hit.className = head ? 'head' : '';
  }

  hurt(amount, dirAngle = null) {
    this.dmgA = Math.min(1, this.dmgA + amount / 20);
    if (dirAngle !== null) {
      this.el.dir.style.transform = `translate(-50%, -50%) rotate(${dirAngle}rad)`;
      this.el.dir.classList.remove('show');
      void this.el.dir.offsetWidth;
      this.el.dir.classList.add('show');
    }
  }

  showNote(n) {
    this.noteOpen = true;
    this.el.note.querySelector('h3').textContent = n.title;
    this.el.note.querySelector('pre').textContent = n.text;
    this.el.note.classList.remove('hidden');
  }

  closeNote() {
    this.noteOpen = false;
    this.el.note.classList.add('hidden');
  }

  fade(on) {
    this.el.fade.classList.toggle('on', on);
  }

  /** 매 프레임 */
  update(dt, g) {
    const p = g.player;
    const me = g.me;
    this.msgT -= dt;
    if (this.msgT <= 0) this.el.msg.classList.remove('show');
    this.radioT -= dt;
    if (this.radioT <= 0) this.el.radio.classList.remove('show');
    this.hitT -= dt;
    this.el.hit.style.opacity = this.hitT > 0 ? 1 : 0;
    this.dmgA = Math.max(0, this.dmgA - dt * 1.2);
    this.el.damage.style.opacity = this.dmgA;
    // 조준선 벌어짐
    const t = p.weaponType();
    const w = WEAPONS[t];
    const moving = Math.hypot(p.vx, p.vz) > 1;
    const spread = w ? w.spread + (moving ? w.moveSpread : 0) + p.bloom : 0.02;
    const gap = 6 + spread * 420;
    this.el.cross.style.setProperty('--gap', `${gap}px`);
    this.el.cross.style.opacity = t === 'medkit' || p.sprinting ? 0.2 : 1;
    // 상호작용 안내
    const tg = p.target;
    if (tg) {
      this.el.prompt.innerHTML = `<b>E</b> ${esc(tg.label)}`;
      this.el.prompt.classList.add('show');
    } else this.el.prompt.classList.remove('show');
    // 진행 고리 (치료·부활)
    let prog = -1;
    if (p.healT > 0) prog = p.healT / 3.5;
    else if (p.reviving >= 0 && g.mate) prog = g.mate.revive;
    else if (me && me.status === 1 && me.revive > 0) prog = me.revive;
    if (prog >= 0) {
      this.el.ring.classList.add('show');
      this.el.ringArc.style.strokeDashoffset = String(113 * (1 - Math.min(1, prog)));
    } else this.el.ring.classList.remove('show');
    // 체력
    const card = (el, st, name, isMe) => {
      if (!st) {
        el.classList.add('hidden');
        return;
      }
      el.classList.remove('hidden');
      const hp = Math.max(0, Math.round(st.hp));
      const state = st.status === 1 ? `쓰러짐 ${Math.ceil(st.bleed)}초` : st.status === 2 ? '사망' : !st.conn ? '연결 끊김' : `${hp}`;
      el.querySelector('.nm').textContent = name + (isMe ? '' : '');
      el.querySelector('.hp').textContent = state;
      const bar = el.querySelector('.bar i');
      bar.style.width = `${st.status === 1 ? Math.min(100, (st.bleed / 30) * 100) : hp}%`;
      bar.className = st.status === 1 ? 'down' : hp < 30 ? 'low' : hp < 60 ? 'mid' : '';
      el.querySelector('.kit').classList.toggle('on', !!st.medkit);
      el.querySelector('.bw').classList.toggle('on', st.downs >= 2 && st.status === 0);
    };
    card(this.el.me, me, g.names[g.slot] || '나', true);
    card(this.el.mate, g.solo ? null : g.mate, g.names[1 - g.slot] || '동료', false);
    // 무기
    const m = p.mag();
    if (t === 'medkit') this.el.weapon.innerHTML = `<div class="wn">구급상자</div><div class="ammo">왼쪽 버튼 꾹: 치료</div>`;
    else {
      const res = t === 'pistol' ? '∞' : p.primary.reserve;
      this.el.weapon.innerHTML = `<div class="wn">${w.name}${p.reloadT > 0 ? ' <small>장전 중</small>' : ''}</div><div class="ammo"><b class="${m.mag === 0 ? 'empty' : m.mag <= w.mag * 0.25 ? 'lowam' : ''}">${m.mag}</b> / ${res}</div>
        <div class="slots"><span class="${p.cur === 'primary' ? 'on' : ''} ${p.primary ? '' : 'none'}">1 ${p.primary ? WEAPONS[p.primary.type].name : '—'}</span><span class="${p.cur === 'pistol' ? 'on' : ''}">2 권총</span><span class="${me && me.medkit ? '' : 'none'}">4 구급상자</span></div>`;
    }
    // 저체력
    const hpk = me && me.status === 0 ? me.hp : 100;
    this.el.low.style.opacity = hpk < 30 ? (30 - hpk) / 40 + 0.15 * Math.sin(performance.now() / 300) : 0;
    // 쓰러짐
    if (me && me.status === 1) {
      this.el.downed.classList.remove('hidden');
      this.el.downed.querySelector('b').textContent = Math.ceil(me.bleed);
      this.el.downed.querySelector('small').textContent = me.revive > 0 ? '동료가 일으켜 주는 중…' : g.solo ? '' : '동료가 일으켜 줄 때까지 버텨라! (권총은 쏠 수 있다)';
    } else this.el.downed.classList.add('hidden');
    // 구조선 타이머
    if (g.finaleLeft >= 0 && !g.ended) {
      this.el.finale.classList.remove('hidden');
      if (g.boatT >= 0) this.el.finale.textContent = g.boatT >= 10 ? '🚢 배에 타라!' : '🚢 배가 들어온다';
      else {
        const s = Math.ceil(g.finaleLeft);
        this.el.finale.textContent = `구조선 도착까지 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }
    } else this.el.finale.classList.add('hidden');
    // 동료 표시 (화면 밖이면 가장자리 화살표)
    const mate = g.mate;
    if (mate && !g.solo && mate.conn) {
      const scr = g.project(mate.x, mate.status === 0 ? 2.1 : 0.9, mate.z);
      const W = window.innerWidth;
      const H = window.innerHeight;
      const on = scr.visible && scr.x > 30 && scr.x < W - 30 && scr.y > 30 && scr.y < H - 30;
      const d = Math.round(Math.hypot(mate.x - p.x, mate.z - p.z));
      const occluded = scr.occluded;
      if (on && !occluded) this.el.marker.classList.add('hidden');
      else {
        this.el.marker.classList.remove('hidden');
        let x = scr.x;
        let y = scr.y;
        if (!on) {
          const cx = W / 2;
          const cy = H / 2;
          let dx = scr.x - cx;
          let dy = scr.y - cy;
          if (!scr.visible) {
            dx = -dx;
            dy = -dy;
          }
          const k = Math.min((W / 2 - 50) / Math.abs(dx || 1), (H / 2 - 60) / Math.abs(dy || 1));
          x = cx + dx * k;
          y = cy + dy * k;
        }
        this.el.marker.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        this.el.marker.textContent = `${mate.status === 1 ? '⚠ ' : ''}${g.names[mate.slot] || '동료'} ${d}m`;
        this.el.marker.classList.toggle('down', mate.status === 1);
      }
    } else this.el.marker.classList.add('hidden');
    // 탭: 목표와 상태
    const tab = p.keys.has('Tab') && p.enabled;
    this.el.tab.classList.toggle('hidden', !tab);
    if (tab) {
      const ws = g.worldState || {};
      this.el.tab.innerHTML = `<h3>현재 목표</h3><p>${esc(OBJ[this.objId] || '')}</p>
        <p class="sm">시도 ${ws.attempts || 1}번째 · 경과 ${fmtTime(g.runTime)} · 처치 ${g.kills}</p>
        <p class="sm">열쇠: ${ws.keys && ws.keys.length ? '관리사무소 열쇠' : '없음'} · 전원: ${ws.flags?.power ? '복구됨' : '꺼짐'} · 항구 정문: ${ws.flags?.portGate ? '열림' : '잠김'}</p>`;
    }
  }

  endScreen(html) {
    this.el.end.innerHTML = html;
    this.el.end.classList.remove('hidden');
  }

  hideEnd() {
    this.el.end.classList.add('hidden');
  }
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`;
}

export { esc };
