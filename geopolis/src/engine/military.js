// military.js
// Recruitment/movement + force summaries. Battle resolution is a STUB here;
// FEAT-002 fills resolveBattle() using the already-defined signature below.
// All math is delegated to formulas.js; mutation flows only through these
// reducer-style functions.

import { UNIT_TYPES, UNIT_TYPE_KEYS } from '../data/unitTypes.js';
import { recruitUnit } from './economy.js';
import { getState, getRegion } from './state.js';
import {
  unitPower,
  unitPowerBreakdown,
  recruitCost,
  combinedArmsBonus,
  battleOdds,
  casualties,
  techCost,
  DEFENDER_EDGE,
} from './formulas.js';

/**
 * List the unit types a state could recruit right now, annotated with whether
 * the state can currently afford each (treasury + population).
 * @param {object} gameState
 * @param {string} stateId
 * @returns {Array<{key:string, def:object, cost:number, affordable:boolean}>}
 */
export function listRecruitableUnits(gameState, stateId) {
  const state = getState(gameState, stateId);
  return UNIT_TYPE_KEYS.map((key) => {
    const def = UNIT_TYPES[key];
    const cost = recruitCost(key, 1);
    const affordable = !!state && state.treasury >= cost && state.population >= def.buildPopCost;
    return { key, def, cost, affordable };
  });
}

/**
 * Recruit a unit (thin re-export of economy.recruitUnit so military callers do
 * not need to import economy directly).
 */
export function recruit(gameState, stateId, unitType, regionId) {
  return recruitUnit(gameState, stateId, unitType, regionId);
}

/**
 * Move a unit from its current region to an adjacent region.
 * Validates ownership of the unit, adjacency, and the movedThisTurn flag.
 * @param {object} gameState
 * @param {string} stateId
 * @param {string} unitId
 * @param {string} toRegionId
 * @returns {{ok:boolean, reason:string|null, unit?:object}}
 */
export function moveUnit(gameState, stateId, unitId, toRegionId) {
  const state = getState(gameState, stateId);
  if (!state) return { ok: false, reason: 'unknown_state' };

  const unit = state.military.units.find((u) => u.id === unitId);
  if (!unit) return { ok: false, reason: 'unknown_unit' };

  const toRegion = getRegion(gameState, toRegionId);
  if (!toRegion) return { ok: false, reason: 'unknown_region' };

  const fromRegion = getRegion(gameState, unit.regionId);
  if (!fromRegion) return { ok: false, reason: 'unit_region_missing' };

  if (!fromRegion.adjacency.includes(toRegionId)) {
    return { ok: false, reason: 'not_adjacent' };
  }
  if (unit.movedThisTurn) {
    return { ok: false, reason: 'already_moved' };
  }

  unit.regionId = toRegionId;
  unit.movedThisTurn = true;
  return { ok: true, reason: null, unit };
}

/**
 * Reset movedThisTurn for every unit of a state (called at start of its turn).
 * @param {object} gameState
 * @param {string} stateId
 */
export function resetMovement(gameState, stateId) {
  const state = getState(gameState, stateId);
  if (!state) return;
  for (const u of state.military.units) u.movedThisTurn = false;
}

/**
 * Per-state force summary: unit counts by type, total strength, total upkeep,
 * and an aggregate raw power (no terrain/combined-arms context).
 * @param {object} gameState
 * @param {string} stateId
 * @returns {object}
 */
export function forceSummary(gameState, stateId) {
  const state = getState(gameState, stateId);
  const summary = {
    stateId,
    totalUnits: 0,
    totalStrength: 0,
    totalUpkeep: 0,
    byType: {},
    rawPower: 0,
  };
  if (!state) return summary;

  for (const key of UNIT_TYPE_KEYS) summary.byType[key] = 0;

  for (const unit of state.military.units) {
    const def = UNIT_TYPES[unit.type];
    summary.totalUnits += 1;
    summary.totalStrength += unit.strength;
    if (def) summary.totalUpkeep += def.upkeep;
    summary.byType[unit.type] = (summary.byType[unit.type] || 0) + 1;
    const techLevel = state.military.techLevels[unit.type] || 0;
    const region = getRegion(gameState, unit.regionId);
    const terrain = region ? region.terrain : 'plains';
    summary.rawPower += unitPower({ unit, techLevel, terrain, combinedArms: 1 });
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Battle resolution - the transparent military centerpiece (DESIGN 5.4).
// Every named modifier, both side powers, the odds, the single RNG roll, and
// per-unit casualties are returned in a BattleReport. No black boxes.
// ---------------------------------------------------------------------------

/**
 * Morale term: attack/defense power is scaled by (1 + 0.10*morale). Morale is
 * derived transparently from the owning state's approval (0..100 -> 0..1).
 * @param {object|undefined} state
 * @returns {number} morale in 0..1
 */
export function moraleOf(state) {
  if (!state) return 0.5;
  return (typeof state.approval === 'number' ? state.approval : 50) / 100;
}

/** Fraction of strength lost per missile hit on a single defender unit. */
export const MISSILE_STRIKE_FRACTION = 0.25;

/**
 * Build the per-unit power contributions for one side, returning a list of
 * breakdowns plus the summed side power (before the morale multiplier).
 * @param {object} gameState
 * @param {string} stateId owner of the units
 * @param {object[]} units engaged units (non-missile)
 * @param {string} terrain region terrain
 * @param {boolean} applyTerrain whether terrain modifiers apply (defender only)
 * @returns {{contributions:object[], summedPower:number, combinedArms:number, presentTypes:string[]}}
 */
function sidePower(gameState, stateId, units, terrain, applyTerrain) {
  const state = getState(gameState, stateId);
  const presentTypes = [...new Set(units.map((u) => u.type))];
  const combinedArms = combinedArmsBonus(presentTypes);
  const contributions = [];
  let summedPower = 0;
  for (const unit of units) {
    const techLevel = state ? state.military.techLevels[unit.type] || 0 : 0;
    // Attacker fights on the field (neutral terrain); defender gets terrain.
    const effectiveTerrain = applyTerrain ? terrain : 'plains';
    const bd = unitPowerBreakdown({ unit, techLevel, terrain: effectiveTerrain, combinedArms });
    contributions.push({ unitId: unit.id, type: unit.type, ...bd });
    summedPower += bd.power;
  }
  return { contributions, summedPower, combinedArms, presentTypes };
}

/**
 * Resolve a battle where `attackerStateId` attacks `defenderRegionId` with the
 * units named in `attackingUnitIds`. Produces a transparent BattleReport.
 *
 * Pipeline (DESIGN 5.4):
 *  1. Collect engaged attacker units (those listed, owned, located adjacent to
 *     the target) and all defender units standing in the region.
 *  2. Missiles among the attackers fire first as consumed pre-battle strikes,
 *     reducing defender strength; they are then removed.
 *  3. Compute per-unit power (base * tech * experience * combined-arms *
 *     terrain). Defender terrain modifiers + the DEFENDER_EDGE multiplier apply.
 *  4. Apply morale: power * (1 + 0.10*morale).
 *  5. odds = battleOdds(attackPower, defensePower); draw one reported roll;
 *     attackerWins = roll < odds.
 *  6. Apply casualties (fractions of strength) to both sides; winners gain
 *     experience; units at 0 strength are removed.
 *  7. If the attacker wins and the region has no defenders left, ownership
 *     transfers and surviving attackers advance into the region.
 *
 * @param {object} gameState
 * @param {string} attackerStateId
 * @param {string} defenderRegionId
 * @param {string[]} attackingUnitIds
 * @param {() => number} rng seeded RNG returning floats in [0,1)
 * @returns {{ok:boolean, reason:string|null, report:object|null}}
 */
export function resolveBattle(gameState, attackerStateId, defenderRegionId, attackingUnitIds, rng) {
  const attacker = getState(gameState, attackerStateId);
  const region = getRegion(gameState, defenderRegionId);
  if (!attacker) return { ok: false, reason: 'unknown_state', report: null };
  if (!region) return { ok: false, reason: 'unknown_region', report: null };
  if (!Array.isArray(attackingUnitIds) || attackingUnitIds.length === 0) {
    return { ok: false, reason: 'not_implemented', report: null };
  }

  const defenderStateId = region.ownerStateId;
  const defender = getState(gameState, defenderStateId);

  // Engaged attacker units: listed, owned, alive, and adjacent to the target.
  const idSet = new Set(attackingUnitIds);
  const allAttackUnits = attacker.military.units.filter((u) => {
    if (!idSet.has(u.id) || u.strength <= 0) return false;
    const r = getRegion(gameState, u.regionId);
    return r && (u.regionId === defenderRegionId || r.adjacency.includes(defenderRegionId));
  });
  if (allAttackUnits.length === 0) {
    return { ok: false, reason: 'no_eligible_attackers', report: null };
  }

  // Defenders: everything the region's owner has standing in the region.
  let defenderUnits = defender
    ? defender.military.units.filter((u) => u.regionId === defenderRegionId && u.strength > 0)
    : [];

  // --- 2. Missile pre-strike -------------------------------------------------
  const missiles = allAttackUnits.filter((u) => u.type === 'missile');
  const groundAttackUnits = allAttackUnits.filter((u) => u.type !== 'missile');
  const missileReport = {
    count: missiles.length,
    strikeFraction: MISSILE_STRIKE_FRACTION,
    totalDamage: 0,
    hits: [],
  };
  for (const missile of missiles) {
    // Each missile hits the strongest remaining defender for a fixed fraction.
    const alive = defenderUnits.filter((u) => u.strength > 0);
    if (alive.length === 0) {
      missileReport.hits.push({ missileId: missile.id, targetUnitId: null, damage: 0 });
      continue;
    }
    alive.sort((a, b) => b.strength - a.strength);
    const target = alive[0];
    const damage = Math.min(target.strength, target.maxStrength * MISSILE_STRIKE_FRACTION);
    target.strength -= damage;
    missileReport.totalDamage += damage;
    missileReport.hits.push({ missileId: missile.id, targetUnitId: target.id, damage });
  }
  // Consume missiles regardless of outcome.
  if (missiles.length > 0) {
    const consumed = new Set(missiles.map((m) => m.id));
    attacker.military.units = attacker.military.units.filter((u) => !consumed.has(u.id));
  }
  // Refresh defenders after the pre-strike (some may be gone).
  if (defender) {
    defender.military.units = defender.military.units.filter((u) => u.strength > 0);
    defenderUnits = defender.military.units.filter((u) => u.regionId === defenderRegionId);
  }

  // --- 3/4. Powers with terrain + morale ------------------------------------
  const attackSide = sidePower(gameState, attackerStateId, groundAttackUnits, region.terrain, false);
  const defenseSide = sidePower(gameState, defenderStateId, defenderUnits, region.terrain, true);

  const attackerMorale = moraleOf(attacker);
  const defenderMorale = moraleOf(defender);
  const attackerMoraleMult = 1 + 0.1 * attackerMorale;
  const defenderMoraleMult = 1 + 0.1 * defenderMorale;

  const attackPower = attackSide.summedPower * attackerMoraleMult;
  // Defender's structural edge plus terrain already baked into unit power.
  const defensePower = defenseSide.summedPower * defenderMoraleMult * DEFENDER_EDGE;

  // --- 5. Odds + single reported roll ---------------------------------------
  const odds = battleOdds(attackPower, defensePower);
  const roll = rng();
  // Undefended region: attacker occupies without a fight if ground forces exist.
  const uncontested = defenderUnits.length === 0 && groundAttackUnits.length > 0;
  const attackerWins = uncontested ? true : roll < odds;

  // --- 6. Casualties ---------------------------------------------------------
  const cas = casualties(odds, attackerWins);
  const attackerCasualties = [];
  const defenderCasualties = [];

  if (!uncontested) {
    for (const u of groundAttackUnits) {
      const loss = Math.round(u.strength * cas.attackerLoss);
      const before = u.strength;
      u.strength = Math.max(0, u.strength - loss);
      if (attackerWins) u.experience += 1;
      attackerCasualties.push({ unitId: u.id, type: u.type, before, loss, after: u.strength });
    }
    for (const u of defenderUnits) {
      const loss = Math.round(u.strength * cas.defenderLoss);
      const before = u.strength;
      u.strength = Math.max(0, u.strength - loss);
      if (!attackerWins) u.experience += 1;
      defenderCasualties.push({ unitId: u.id, type: u.type, before, loss, after: u.strength });
    }
  } else {
    for (const u of groundAttackUnits) {
      attackerCasualties.push({ unitId: u.id, type: u.type, before: u.strength, loss: 0, after: u.strength });
    }
  }

  // Remove dead units.
  const pruneDead = (st) => {
    if (st) st.military.units = st.military.units.filter((u) => u.strength > 0);
  };
  pruneDead(attacker);
  pruneDead(defender);

  // --- 7. Region ownership transfer -----------------------------------------
  const remainingDefenders = defender
    ? defender.military.units.filter((u) => u.regionId === defenderRegionId && u.strength > 0)
    : [];
  const survivingAttackers = attacker.military.units.filter(
    (u) => groundAttackUnits.some((g) => g.id === u.id) && u.strength > 0
  );
  let ownershipChanged = false;
  if (attackerWins && remainingDefenders.length === 0 && survivingAttackers.length > 0) {
    region.ownerStateId = attackerStateId;
    for (const u of survivingAttackers) {
      u.regionId = defenderRegionId;
      u.movedThisTurn = true;
    }
    ownershipChanged = true;
  }

  const report = {
    kind: 'battle',
    turn: gameState.turn,
    regionId: defenderRegionId,
    regionName: region.name,
    terrain: region.terrain,
    attackerStateId,
    defenderStateId,
    attackerContributions: attackSide.contributions,
    defenderContributions: defenseSide.contributions,
    combinedArms: {
      attacker: { presentTypes: attackSide.presentTypes, bonus: attackSide.combinedArms },
      defender: { presentTypes: defenseSide.presentTypes, bonus: defenseSide.combinedArms },
    },
    terrainEdge: { terrain: region.terrain, defenderEdge: DEFENDER_EDGE },
    morale: {
      attacker: attackerMorale,
      defender: defenderMorale,
      attackerMult: attackerMoraleMult,
      defenderMult: defenderMoraleMult,
    },
    missile: missileReport,
    attackPower,
    defensePower,
    odds,
    roll,
    uncontested,
    attackerWins,
    intensity: cas.intensity,
    casualtyFractions: { attacker: cas.attackerLoss, defender: cas.defenderLoss },
    attackerCasualties,
    defenderCasualties,
    ownershipChanged,
    newOwnerStateId: region.ownerStateId,
  };

  gameState.pendingBattles.push(report);
  gameState.log.unshift({
    kind: 'battle',
    turn: gameState.turn,
    text: `${attackerStateId} attacked ${region.name} (${defenderStateId}): ${
      attackerWins ? 'attacker won' : 'defender held'
    } [odds ${odds.toFixed(3)} roll ${roll.toFixed(3)}]`,
    report,
  });

  return { ok: true, reason: null, report };
}

/**
 * Estimate an attacker's win probability against a region BEFORE committing,
 * using the same transparent power model (no RNG). Used by the AI war/diplomacy
 * agents. Returns the odds plus the summed powers so the decision log can show
 * the math.
 * @param {object} gameState
 * @param {string} attackerStateId
 * @param {string} defenderRegionId
 * @param {string[]} [attackingUnitIds] defaults to all adjacent/standing units
 * @returns {{attackPower:number, defensePower:number, odds:number}}
 */
export function estimateWinProbability(gameState, attackerStateId, defenderRegionId, attackingUnitIds) {
  const attacker = getState(gameState, attackerStateId);
  const region = getRegion(gameState, defenderRegionId);
  if (!attacker || !region) return { attackPower: 0, defensePower: 0, odds: 0 };

  const defenderStateId = region.ownerStateId;
  const defender = getState(gameState, defenderStateId);

  let attackUnits = attacker.military.units.filter((u) => {
    if (u.strength <= 0) return false;
    const r = getRegion(gameState, u.regionId);
    return r && (u.regionId === defenderRegionId || r.adjacency.includes(defenderRegionId));
  });
  if (Array.isArray(attackingUnitIds)) {
    const set = new Set(attackingUnitIds);
    attackUnits = attackUnits.filter((u) => set.has(u.id));
  }
  const groundAttackUnits = attackUnits.filter((u) => u.type !== 'missile');
  const defenderUnits = defender
    ? defender.military.units.filter((u) => u.regionId === defenderRegionId && u.strength > 0)
    : [];

  const attackSide = sidePower(gameState, attackerStateId, groundAttackUnits, region.terrain, false);
  const defenseSide = sidePower(gameState, defenderStateId, defenderUnits, region.terrain, true);
  const attackPower = attackSide.summedPower * (1 + 0.1 * moraleOf(attacker));
  const defensePower = defenseSide.summedPower * (1 + 0.1 * moraleOf(defender)) * DEFENDER_EDGE;
  return { attackPower, defensePower, odds: battleOdds(attackPower, defensePower) };
}

// ---------------------------------------------------------------------------
// R&D tick (DESIGN 5.2 / 7.7): apply each state's research budget to its chosen
// branch and level up techs when accumulated points cross techCost(level+1).
// Kept here (military owns R&D) and invoked from turn.js.
// ---------------------------------------------------------------------------

/**
 * Pick the branch a state is researching: lowest current tech level (ties
 * resolved by UNIT_TYPE_KEYS order) so R&D spreads out deterministically. A
 * state may override by setting military.researchBranch.
 * @param {object} state
 * @returns {string}
 */
export function currentResearchBranch(state) {
  if (state.military.researchBranch && UNIT_TYPE_KEYS.includes(state.military.researchBranch)) {
    return state.military.researchBranch;
  }
  let best = UNIT_TYPE_KEYS[0];
  let bestLevel = Infinity;
  for (const key of UNIT_TYPE_KEYS) {
    const lvl = state.military.techLevels[key] || 0;
    if (lvl < bestLevel) {
      bestLevel = lvl;
      best = key;
    }
  }
  return best;
}

/**
 * Apply one R&D tick for a single state. Adds rnd points to the chosen branch
 * and levels it up (possibly multiple times) when the accumulated points cross
 * techCost(nextLevel). Returns a transparent breakdown.
 * @param {object} gameState
 * @param {string} stateId
 * @returns {object}
 */
export function rndTick(gameState, stateId) {
  const state = getState(gameState, stateId);
  if (!state) return { ok: false, reason: 'unknown_state' };
  const branch = currentResearchBranch(state);
  const points = state.military.rnd || 0;
  state.military.researchPoints[branch] = (state.military.researchPoints[branch] || 0) + points;

  const levelsGained = [];
  let level = state.military.techLevels[branch] || 0;
  // techCost(level+1) is the running cost to reach the next tier.
  while (state.military.researchPoints[branch] >= techCost(level + 1)) {
    state.military.researchPoints[branch] -= techCost(level + 1);
    level += 1;
    levelsGained.push(level);
  }
  state.military.techLevels[branch] = level;

  return {
    ok: true,
    stateId,
    branch,
    pointsAdded: points,
    accumulated: state.military.researchPoints[branch],
    newLevel: level,
    levelsGained,
  };
}
