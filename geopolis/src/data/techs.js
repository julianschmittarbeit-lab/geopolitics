// techs.js
// R&D tree: the five research branches and the pure cost/multiplier functions.
// Per DESIGN section 5.2:
//   cost(level)      = 100 * level^1.5    (research points to reach `level`)
//   techMult(level)  = 1 + 0.15 * level   (combat power multiplier at `level`)

/** The research branches, mirroring the unit types. */
export const TECH_BRANCHES = ['infantry', 'armor', 'air', 'navy', 'missile'];

/** Metadata for each branch for UI display. */
export const TECH_BRANCH_INFO = {
  infantry: { key: 'infantry', name_en: 'Infantry Doctrine', name_de: 'Infanterie-Doktrin' },
  armor: { key: 'armor', name_en: 'Armor Doctrine', name_de: 'Panzer-Doktrin' },
  air: { key: 'air', name_en: 'Air Doctrine', name_de: 'Luft-Doktrin' },
  navy: { key: 'navy', name_en: 'Naval Doctrine', name_de: 'Marine-Doktrin' },
  missile: { key: 'missile', name_en: 'Missile Doctrine', name_de: 'Raketen-Doktrin' },
};

/**
 * Research points required to reach a given tech level (from the level below).
 * cost(level) = 100 * level^1.5. Level 0 costs 0.
 * @param {number} level target tech level (integer >= 0)
 * @returns {number}
 */
export function cost(level) {
  if (level <= 0) return 0;
  return 100 * Math.pow(level, 1.5);
}

/**
 * Combat power multiplier granted by a tech level.
 * techMult(level) = 1 + 0.15 * level.
 * @param {number} level
 * @returns {number}
 */
export function techMult(level) {
  return 1 + 0.15 * level;
}
