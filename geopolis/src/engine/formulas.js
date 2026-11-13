// formulas.js
// ALL pure numeric formulas for the game (DESIGN section 5).
// Every function here is pure: no Math.random, no mutation of inputs, no I/O.
// Randomness is injected by callers (the RNG roll is passed in, not drawn here).
// Where a UI tooltip benefits from seeing the terms, a sibling *Breakdown()
// returns an object of named terms alongside the final value.

import { UNIT_TYPES } from '../data/unitTypes.js';
import { cost as techCostData, techMult as techMultData } from '../data/techs.js';

/** Clamp a number into [lo, hi]. */
export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

// ---------------------------------------------------------------------------
// 5.1 Economy
// ---------------------------------------------------------------------------

/**
 * Gross domestic product.
 * gdp = base * (1 + 0.004*sumSectors) * (0.6 + 0.4*approval/100)
 * @param {number} base base economic output
 * @param {number} sumSectors sum of sector investments (0..400)
 * @param {number} approval 0..100
 * @returns {number}
 */
export function gdp(base, sumSectors, approval) {
  return gdpBreakdown(base, sumSectors, approval).gdp;
}

export function gdpBreakdown(base, sumSectors, approval) {
  const sectorFactor = 1 + 0.004 * sumSectors;
  const approvalFactor = 0.6 + 0.4 * (approval / 100);
  const value = base * sectorFactor * approvalFactor;
  return { base, sumSectors, approval, sectorFactor, approvalFactor, gdp: value };
}

/**
 * Collection factor: the share of nominal tax that actually reaches the
 * treasury. Calibrated (with the default budgets in state.js) so that a
 * reasonably played state covers its fixed spending instead of going bankrupt.
 * Surfaced in the tax-revenue breakdown so the number stays transparent.
 */
export const TAX_COLLECTION_FACTOR = 0.65;

/**
 * Tax revenue collected from GDP.
 * taxRevenue = gdp * taxRate * TAX_COLLECTION_FACTOR
 * @param {number} gdpValue
 * @param {number} taxRate 0..1
 * @returns {number}
 */
export function taxRevenue(gdpValue, taxRate) {
  return gdpValue * taxRate * TAX_COLLECTION_FACTOR;
}

export function taxRevenueBreakdown(gdpValue, taxRate) {
  const collectionFactor = TAX_COLLECTION_FACTOR;
  const value = gdpValue * taxRate * collectionFactor;
  return { gdp: gdpValue, taxRate, collectionFactor, taxRevenue: value };
}

/**
 * Change in public approval for one turn.
 * Positive from low tax and economic growth; negative from high tax and war
 * weariness. Result is a delta (apply then clamp to 0..100 by the caller/tick).
 * @param {object} p
 * @param {number} p.taxRate 0..1
 * @param {number} p.growth GDP growth ratio this turn (e.g. 0.03 = +3%)
 * @param {number} p.warWeariness 0..1 accumulated strain from active wars
 * @returns {number}
 */
export function approvalDelta(p) {
  return approvalDeltaBreakdown(p).approvalDelta;
}

export function approvalDeltaBreakdown({ taxRate, growth, warWeariness, combatMood = 0 }) {
  // Neutral tax is 0.3; below raises approval, above lowers it.
  const taxTerm = (0.3 - taxRate) * 10; // +3 at zero tax, -7 at full tax
  const growthTerm = clamp(growth, -0.25, 0.25) * 40; // +/- up to 10
  const warTerm = -clamp(warWeariness, 0, 1) * 4; // up to -4 (softened)
  // Military outcomes sway the public: victories raise approval, defeats lower
  // it (DESIGN 5.1). combatMood is the net battle score accumulated this turn.
  const combatTerm = clamp(combatMood, -5, 5);
  // Peacetime recovery: with no active wars approval drifts back toward a
  // stable baseline so a competent, non-belligerent state is not bled dry.
  const peaceRecovery = warWeariness <= 0 ? 1.5 : 0;
  const value = taxTerm + growthTerm + warTerm + combatTerm + peaceRecovery;
  return {
    taxRate,
    growth,
    warWeariness,
    combatMood,
    taxTerm,
    growthTerm,
    warTerm,
    combatTerm,
    peaceRecovery,
    approvalDelta: value,
  };
}

/**
 * Total per-turn upkeep for a list of units (sums unit type upkeep).
 * @param {Array<{type:string}>} units
 * @returns {number}
 */
export function upkeepTotal(units) {
  let sum = 0;
  for (const u of units) {
    const def = UNIT_TYPES[u.type];
    if (def) sum += def.upkeep;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// 5.2 Military R&D
// data/techs.js is the SINGLE SOURCE OF TRUTH for the R&D cost/multiplier
// curves (DESIGN 5.2). formulas.js re-exports them so every caller reaches the
// math through one surface and the two definitions cannot drift apart.
// ---------------------------------------------------------------------------

/** Research points to reach `level`: 100 * level^1.5 (from data/techs.js). */
export function techCost(level) {
  return techCostData(level);
}

/** Combat multiplier at a tech level: 1 + 0.15*level (from data/techs.js). */
export function techMult(level) {
  return techMultData(level);
}

// ---------------------------------------------------------------------------
// 5.3 Recruitment
// ---------------------------------------------------------------------------

/**
 * Up-front recruitment cost for a unit type (count defaults to 1).
 * @param {string} unitTypeKey
 * @param {number} [count=1]
 * @returns {number}
 */
export function recruitCost(unitTypeKey, count = 1) {
  const def = UNIT_TYPES[unitTypeKey];
  if (!def) return 0;
  return def.cost * count;
}

export function recruitCostBreakdown(unitTypeKey, count = 1) {
  const def = UNIT_TYPES[unitTypeKey];
  const unitCost = def ? def.cost : 0;
  const popCost = def ? def.buildPopCost * count : 0;
  const upkeep = def ? def.upkeep * count : 0;
  return { unitTypeKey, count, unitCost, totalCost: unitCost * count, popCost, upkeepAdded: upkeep };
}

// ---------------------------------------------------------------------------
// 5.4 Battle resolution building blocks
// ---------------------------------------------------------------------------

/**
 * Terrain modifier table. Defender benefits from favorable terrain; some unit
 * types are penalized on terrain that does not suit them. Values multiply unit
 * power. Keyed [unitType][terrain].
 */
export const TERRAIN_MODIFIER = {
  infantry: { plains: 1.0, mountain: 1.25, forest: 1.2, urban: 1.3, coast: 1.0 },
  armor: { plains: 1.3, mountain: 0.7, forest: 0.8, urban: 0.9, coast: 1.0 },
  air: { plains: 1.0, mountain: 1.0, forest: 1.0, urban: 1.0, coast: 1.0 },
  navy: { plains: 0.1, mountain: 0.1, forest: 0.1, urban: 0.6, coast: 1.4 },
  missile: { plains: 1.0, mountain: 1.0, forest: 1.0, urban: 1.0, coast: 1.0 },
};

/** Air contributes to land battles at a reduced ground factor. */
export const AIR_GROUND_FACTOR = 0.6;

/**
 * Combined-arms bonus: mixing infantry + armor + air among the engaged unit
 * types grants a multiplicative bonus (up to +30% with all three present).
 * @param {string[]} presentTypes distinct unit types engaged
 * @returns {number} multiplier >= 1
 */
export function combinedArmsBonus(presentTypes) {
  const core = ['infantry', 'armor', 'air'];
  const n = core.filter((t) => presentTypes.includes(t)).length;
  // 0/1 type -> 1.0, 2 -> 1.15, 3 -> 1.30
  if (n >= 3) return 1.3;
  if (n === 2) return 1.15;
  return 1.0;
}

/**
 * Combat power of a single unit in a given context.
 * power = strength * basePower * techMult(level) * (1 + 0.05*experience)
 *         * combinedArms * terrainModifier[type][terrain]
 * Air units attacking/defending land get the AIR_GROUND_FACTOR applied.
 * @param {object} p
 * @param {{type:string, strength:number, experience?:number}} p.unit
 * @param {number} p.techLevel tech level for this unit's branch
 * @param {string} p.terrain region terrain
 * @param {number} [p.combinedArms=1] combined-arms multiplier
 * @returns {number}
 */
export function unitPower(p) {
  return unitPowerBreakdown(p).power;
}

export function unitPowerBreakdown({ unit, techLevel, terrain, combinedArms = 1 }) {
  const def = UNIT_TYPES[unit.type] || { basePower: 1 };
  const base = def.basePower;
  const tech = techMult(techLevel || 0);
  const exp = 1 + 0.05 * (unit.experience || 0);
  const terrainMod = (TERRAIN_MODIFIER[unit.type] && TERRAIN_MODIFIER[unit.type][terrain]) || 1.0;
  const groundFactor = unit.type === 'air' ? AIR_GROUND_FACTOR : 1.0;
  const power = unit.strength * base * tech * exp * combinedArms * terrainMod * groundFactor;
  return {
    type: unit.type,
    strength: unit.strength,
    base,
    techMult: tech,
    experienceMult: exp,
    combinedArms,
    terrainMod,
    groundFactor,
    power,
  };
}

/**
 * Attacker win odds from total powers.
 * odds = attackPower / (attackPower + defensePower)
 * Returns 0.5 if both sides are zero power.
 * @param {number} attackPower
 * @param {number} defensePower
 * @returns {number} 0..1
 */
export function battleOdds(attackPower, defensePower) {
  const total = attackPower + defensePower;
  if (total <= 0) return 0.5;
  return attackPower / total;
}

export function battleOddsBreakdown(attackPower, defensePower) {
  return { attackPower, defensePower, odds: battleOdds(attackPower, defensePower) };
}

/** Defender's inherent defensive edge multiplier (DESIGN 5.4). */
export const DEFENDER_EDGE = 1.2;

/**
 * Casualty fractions for both sides given the odds.
 * Closer fights (odds near 0.5) are bloodier; the winner loses less the more
 * decisive their advantage. Returns fractions in [0,1] of engaged strength.
 * @param {number} odds attacker win odds 0..1
 * @param {boolean} attackerWins outcome (from the injected roll)
 * @returns {{attackerLoss:number, defenderLoss:number, intensity:number}}
 */
export function casualties(odds, attackerWins) {
  // intensity peaks (1) at odds=0.5, falls to ~0 at a totally lopsided fight.
  const intensity = 1 - Math.abs(odds - 0.5) * 2; // 0..1
  const loserLoss = 0.35 + 0.35 * intensity; // 0.35..0.70
  // Winner loses proportionally less when their edge is larger.
  const winnerEdge = attackerWins ? odds : 1 - odds; // 0.5..1 typically
  const winnerLoss = loserLoss * (1 - winnerEdge);
  const attackerLoss = attackerWins ? winnerLoss : loserLoss;
  const defenderLoss = attackerWins ? loserLoss : winnerLoss;
  return {
    attackerLoss: clamp(attackerLoss, 0, 1),
    defenderLoss: clamp(defenderLoss, 0, 1),
    intensity,
  };
}

// ---------------------------------------------------------------------------
// 5.5 Diplomacy
// ---------------------------------------------------------------------------

/** Base acceptance chance per treaty type. */
export const TREATY_BASE = {
  nonAggression: 0.5,
  trade: 0.55,
  alliance: 0.3,
  peace: 0.4,
};

/**
 * Chance a target state accepts a proposed treaty.
 * acceptChance = base + relationFactor + powerFactor + bribeFactor - warFactor
 * @param {object} p
 * @param {string} p.treatyType key into TREATY_BASE
 * @param {number} p.relation -100..100 current relation
 * @param {number} [p.powerRatio=1] proposer power / target power
 * @param {number} [p.bribe=0] money offered
 * @param {boolean} [p.atWar=false] whether the two are at war
 * @returns {number} 0..1
 */
export function diplomacyAcceptChance(p) {
  return diplomacyAcceptChanceBreakdown(p).acceptChance;
}

export function diplomacyAcceptChanceBreakdown({ treatyType, relation, powerRatio = 1, bribe = 0, atWar = false }) {
  const base = TREATY_BASE[treatyType] ?? 0.4;
  const relationFactor = (relation / 100) * 0.4; // +/- 0.4
  const powerFactor = clamp((powerRatio - 1) * 0.1, -0.2, 0.2); // stronger proposer helps
  const bribeFactor = clamp(bribe / 5000, 0, 0.25); // money sweetens the deal
  const warFactor = atWar && treatyType !== 'peace' ? 0.3 : 0; // hard to ally mid-war
  const value = clamp(base + relationFactor + powerFactor + bribeFactor - warFactor, 0.02, 0.98);
  return { base, relationFactor, powerFactor, bribeFactor, warFactor, acceptChance: value };
}

// ---------------------------------------------------------------------------
// 5.6 Intelligence
// ---------------------------------------------------------------------------

/** Base success chance per intel operation. */
export const INTEL_BASE = {
  gatherInfo: 0.6,
  sabotage: 0.35,
  counterIntel: 0.7,
};

/**
 * Intel operation success chance.
 * p = clamp(base + 0.02*agents + 0.1*relationPenalty - 0.03*targetCounterIntel, 0.05, 0.95)
 * @param {object} p
 * @param {string} p.op key into INTEL_BASE
 * @param {number} [p.agents=0]
 * @param {number} [p.relationPenalty=0] 0..1 (worse relations => easier to justify risk)
 * @param {number} [p.targetCounterIntel=0]
 * @returns {number} 0.05..0.95
 */
export function intelSuccessChance(p) {
  return intelSuccessChanceBreakdown(p).successChance;
}

export function intelSuccessChanceBreakdown({ op, agents = 0, relationPenalty = 0, targetCounterIntel = 0 }) {
  const base = INTEL_BASE[op] ?? 0.4;
  const agentTerm = 0.02 * agents;
  const relationTerm = 0.1 * relationPenalty;
  const counterTerm = -0.03 * targetCounterIntel;
  const value = clamp(base + agentTerm + relationTerm + counterTerm, 0.05, 0.95);
  return { base, agentTerm, relationTerm, counterTerm, successChance: value };
}
