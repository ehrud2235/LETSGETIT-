// 무기 수치. 좀비 체력은 60 (보통 난이도).
export const WEAPONS = {
  pistol: {
    name: '권총', slot: 2, dmg: 26, head: 3, pellets: 1, spread: 0.012, moveSpread: 0.02, interval: 0.15, auto: false,
    mag: 15, reserve: Infinity, reload: 1.35, range: 70, noise: 30, recoil: 0.018,
  },
  shotgun: {
    name: '산탄총', slot: 1, dmg: 14, head: 1.6, pellets: 9, spread: 0.075, moveSpread: 0.03, interval: 0.85, auto: false,
    mag: 8, reserve: 56, maxReserve: 72, reload: 0.5, shellReload: true, range: 32, noise: 44, recoil: 0.07,
  },
  rifle: {
    name: '소총', slot: 1, dmg: 24, head: 2.5, pellets: 1, spread: 0.014, moveSpread: 0.03, interval: 0.095, auto: true,
    mag: 30, reserve: 240, maxReserve: 300, reload: 2.1, range: 90, noise: 42, recoil: 0.012,
  },
};

export const WEAPON_IDS = ['pistol', 'shotgun', 'rifle', 'medkit'];
export const MEDKIT_TIME = 3.5;
export const REVIVE_TIME = 3.5;
export const SHOVE = { range: 2.3, cone: 0.75, cooldown: 0.65, push: 5.5, stun: 0.9 };
