// unitTypes.js
// Static definitions for the five military unit types.
// Numbers are balanced to be internally consistent with DESIGN sections 5.3/5.4:
//  - cost: up-front money to recruit one unit
//  - upkeep: money drained per turn while the unit lives
//  - maxStrength: manpower/health pool (also the strength a fresh unit starts at)
//  - basePower: the typeBasePower multiplier used in battle power math
//  - buildPopCost: population consumed to field the unit
//  - isOneShot: missiles fire once (pre-battle) then are consumed
//
// Design intent / balance notes:
//  - infantry: cheap, numerous, low per-unit power, low upkeep.
//  - armor: expensive, high power, high upkeep, pop-light.
//  - air: force multiplier, pricey, reduced ground factor handled in formulas.
//  - navy: enables coastal control / amphibious ops, high cost.
//  - missile: one-shot strike, high up-front cost, no upkeep (stored munition).

/** @typedef {'infantry'|'armor'|'air'|'navy'|'missile'} UnitTypeKey */

export const UNIT_TYPES = {
  infantry: {
    key: 'infantry',
    name_en: 'Infantry',
    name_de: 'Infanterie',
    cost: 100,
    upkeep: 5,
    maxStrength: 100,
    basePower: 1.0,
    buildPopCost: 10000,
    isOneShot: false,
  },
  armor: {
    key: 'armor',
    name_en: 'Armor',
    name_de: 'Panzer',
    cost: 300,
    upkeep: 18,
    maxStrength: 100,
    basePower: 2.4,
    buildPopCost: 4000,
    isOneShot: false,
  },
  air: {
    key: 'air',
    name_en: 'Air Force',
    name_de: 'Luftwaffe',
    cost: 450,
    upkeep: 30,
    maxStrength: 100,
    basePower: 3.0,
    buildPopCost: 2000,
    isOneShot: false,
  },
  navy: {
    key: 'navy',
    name_en: 'Navy',
    name_de: 'Marine',
    cost: 500,
    upkeep: 28,
    maxStrength: 100,
    basePower: 2.6,
    buildPopCost: 3000,
    isOneShot: false,
  },
  missile: {
    key: 'missile',
    name_en: 'Missile',
    name_de: 'Rakete',
    cost: 250,
    upkeep: 0,
    maxStrength: 100,
    basePower: 4.0,
    buildPopCost: 500,
    isOneShot: true,
  },
};

/** Ordered list of unit type keys. */
export const UNIT_TYPE_KEYS = Object.keys(UNIT_TYPES);

/**
 * Look up a unit type definition by key.
 * @param {UnitTypeKey} key
 * @returns {object|undefined}
 */
export function getUnitType(key) {
  return UNIT_TYPES[key];
}
