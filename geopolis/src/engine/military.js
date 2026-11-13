// military.js
// Recruitment/movement + force summaries. Battle resolution is a STUB here;
// FEAT-002 fills resolveBattle() using the already-defined signature below.
// All math is delegated to formulas.js; mutation flows only through these
// reducer-style functions.

import { UNIT_TYPES, UNIT_TYPE_KEYS } from '../data/unitTypes.js';
import { recruitUnit } from './economy.js';
import { getState, getRegion } from './state.js';
import { unitPower, recruitCost } from './formulas.js';

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
// Battle resolution — STUB. Full transparent logic lands in FEAT-002.
// The signature is fixed now so other code can depend on it.
// ---------------------------------------------------------------------------

/**
 * Resolve a battle where `attackerStateId` attacks `defenderRegionId` with the
 * units named in `attackingUnitIds`. Produces a transparent BattleReport.
 *
 * TODO(FEAT-002): implement full transparent resolution using
 *   formulas.unitPower / combinedArmsBonus / battleOdds / casualties and the
 *   injected `rng` for the single reported roll. Must populate the report with
 *   every modifier, computed powers, odds, the roll, and per-unit casualties,
 *   then apply strength loss, experience gain, region ownership change, and
 *   push the report onto gameState.pendingBattles / log.
 *
 * @param {object} gameState
 * @param {string} attackerStateId
 * @param {string} defenderRegionId
 * @param {string[]} attackingUnitIds
 * @param {() => number} rng seeded RNG returning floats in [0,1)
 * @returns {{ok:boolean, reason:string, report:null}}
 */
export function resolveBattle(gameState, attackerStateId, defenderRegionId, attackingUnitIds, rng) {
  // Intentionally not implemented in FEAT-001.
  return {
    ok: false,
    reason: 'not_implemented',
    report: null,
  };
}
