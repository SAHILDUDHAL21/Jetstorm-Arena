/**
 * Original weapon definitions. All values configurable; the authoritative
 * server is the only consumer for combat math — clients read these purely
 * for HUD/render purposes.
 */
import type { WeaponDef, WeaponId } from './types';

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    damage: 20,
    fireRateMs: 280,
    magazineSize: 12,
    reloadMs: 900,
    bulletSpeed: 950,
    spread: 0.035,
    range: 720,
    recoil: 2.4,
    ammoReserve: 60,
    pellets: 1,
    rocket: false,
    auto: false,
    weight: 0.2,
  },
  smg: {
    id: 'smg',
    name: 'SMG',
    damage: 12,
    fireRateMs: 92,
    magazineSize: 30,
    reloadMs: 1150,
    bulletSpeed: 1000,
    spread: 0.075,
    range: 620,
    recoil: 1.6,
    ammoReserve: 120,
    pellets: 1,
    rocket: false,
    auto: true,
    weight: 0.25,
  },
  rifle: {
    id: 'rifle',
    name: 'Rifle',
    damage: 18,
    fireRateMs: 112,
    magazineSize: 25,
    reloadMs: 1350,
    bulletSpeed: 1150,
    spread: 0.04,
    range: 900,
    recoil: 2.2,
    ammoReserve: 90,
    pellets: 1,
    rocket: false,
    auto: true,
    weight: 0.35,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    damage: 9,
    fireRateMs: 780,
    magazineSize: 6,
    reloadMs: 1600,
    bulletSpeed: 860,
    spread: 0.26,
    range: 400,
    recoil: 6.5,
    ammoReserve: 30,
    pellets: 7,
    rocket: false,
    auto: false,
    weight: 0.55,
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    damage: 85,
    fireRateMs: 1400,
    magazineSize: 5,
    reloadMs: 1800,
    bulletSpeed: 1750,
    spread: 0.004,
    range: 1700,
    recoil: 7,
    ammoReserve: 15,
    pellets: 1,
    rocket: false,
    auto: false,
    weight: 0.7,
  },
  rocket: {
    id: 'rocket',
    name: 'Rocket',
    damage: 45, // direct hit
    fireRateMs: 950,
    magazineSize: 1,
    reloadMs: 2100,
    bulletSpeed: 560,
    spread: 0.01,
    range: 950,
    recoil: 6,
    ammoReserve: 6,
    pellets: 1,
    rocket: true,
    auto: false,
    weight: 0.8,
  },
};

export const WEAPON_IDS: WeaponId[] = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'rocket'];

export function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(WEAPONS, v);
}

export function weaponName(id: WeaponId): string {
  return WEAPONS[id].name;
}
