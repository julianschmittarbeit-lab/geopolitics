// economy.js
// Reducer-style economy functions. All mutation of GameState economy happens
// here; all math is delegated to formulas.js. Each action returns a result
// object { ok, reason, breakdown } so the UI can explain what happened.

import {
  gdp as gdpFormula,
  gdpBreakdown,
  taxRevenue,
  taxRevenueBreakdown,
  approvalDelta,
  approvalDeltaBreakdown,
  upkeepTotal,
  recruitCost,
  recruitCostBreakdown,
  clamp,
} from './formulas.js';
import { UNIT_TYPES } from '../data/unitTypes.js';
import { getState, getRegion } from './state.js';

/**
 * Allocate a deterministic, per-game unique unit id. The counter lives on the
 * GameState (not a module global) so two separate endTurn runs from the same
 * cloned state produce identical ids, preserving reproducibility.
 * @param {object} gameState
 * @param {string} stateId
 * @returns {string}
 */
function nextUnitId(gameState, stateId) {
  if (typeof gameState._unitSeq !== 'number') gameState._unitSeq = 0;
  gameState._unitSeq += 1;
  return `u_rec_${stateId}_${gameState._unitSeq}`;
}

/**
 * Recruit one unit of a type into a region the state owns.
 * Validates treasury and population; deducts cost and population; appends Unit.
 * @param {object} gameState
 * @param {string} stateId
 * @param {string} unitType
 * @param {string} regionId
 * @returns {{ok:boolean, reason:string|null, breakdown:object, unit?:object}}
 */
export function recruitUnit(gameState, stateId, unitType, regionId) {
  const state = getState(gameState, stateId);
  const def = UNIT_TYPES[unitType];
  const region = getRegion(gameState, regionId);
  const breakdown = recruitCostBreakdown(unitType, 1);

  if (!state) return { ok: false, reason: 'unknown_state', breakdown };
  if (!def) return { ok: false, reason: 'unknown_unit_type', breakdown };
  if (!region) return { ok: false, reason: 'unknown_region', breakdown };
  if (region.ownerStateId !== stateId) return { ok: false, reason: 'region_not_owned', breakdown };
  if (state.treasury < breakdown.totalCost) return { ok: false, reason: 'insufficient_funds', breakdown };
  if (state.population < breakdown.popCost) return { ok: false, reason: 'insufficient_population', breakdown };

  state.treasury -= breakdown.totalCost;
  state.population -= breakdown.popCost;

  const unit = {
    id: nextUnitId(gameState, stateId),
    type: unitType,
    strength: def.maxStrength,
    maxStrength: def.maxStrength,
    experience: 0,
    regionId,
    movedThisTurn: false,
  };
  state.military.units.push(unit);

  return { ok: true, reason: null, breakdown, unit };
}

/**
 * Set a state's tax rate (clamped to 0..1).
 * @returns {{ok:boolean, reason:string|null, taxRate:number}}
 */
export function setTaxRate(gameState, stateId, rate) {
  const state = getState(gameState, stateId);
  if (!state) return { ok: false, reason: 'unknown_state', taxRate: 0 };
  const clamped = clamp(Number(rate) || 0, 0, 1);
  state.economy.taxRate = clamped;
  return { ok: true, reason: null, taxRate: clamped };
}

/**
 * Invest into one economic sector (points clamped so the sector stays 0..100).
 * @returns {{ok:boolean, reason:string|null, sector?:string, value?:number}}
 */
export function investSector(gameState, stateId, sector, points) {
  const state = getState(gameState, stateId);
  if (!state) return { ok: false, reason: 'unknown_state' };
  if (!(sector in state.economy.sectors)) return { ok: false, reason: 'unknown_sector' };
  const next = clamp(state.economy.sectors[sector] + Number(points || 0), 0, 100);
  state.economy.sectors[sector] = next;
  return { ok: true, reason: null, sector, value: next };
}

/**
 * Apply one economy tick for a single state: recompute GDP, collect tax, pay
 * upkeep and budgets, update approval and treasury. Returns a full breakdown.
 * @param {object} gameState
 * @param {string} stateId
 * @returns {object} breakdown of the tick
 */
export function economyTick(gameState, stateId) {
  const state = getState(gameState, stateId);
  if (!state) return { ok: false, reason: 'unknown_state' };

  const sectors = state.economy.sectors;
  const sumSectors = sectors.industry + sectors.services + sectors.agriculture + sectors.energy;
  const prevGdp = state.economy.gdp;

  const gdpBd = gdpBreakdown(STATE_BASE_OUTPUT, sumSectors, state.approval);
  const newGdp = gdpBd.gdp;
  const revenueBd = taxRevenueBreakdown(newGdp, state.economy.taxRate);
  const revenue = revenueBd.taxRevenue;

  const upkeep = upkeepTotal(state.military.units);
  const militaryBudget = state.military.budget;
  const rnd = state.military.rnd;
  const intelBudget = state.intel.budget;

  const growth = prevGdp > 0 ? (newGdp - prevGdp) / prevGdp : 0;
  const warWeariness = clampWeariness(state.atWarWith.length);

  const netTreasury = revenue - militaryBudget - intelBudget - rnd - upkeep;
  const projected = state.treasury + netTreasury;

  // --- Insolvency rule (transparent, DESIGN economy) ------------------------
  // The treasury can never fall below 0. If projected spending would overdraw
  // it, the state is insolvent this turn: spending is capped at the funds on
  // hand, the treasury floors at 0, and the public reacts with an approval
  // penalty proportional to the size of the shortfall. This gives a negative
  // balance a real consequence instead of letting it run unbounded-negative.
  let insolvent = false;
  let shortfall = 0;
  let insolvencyApprovalPenalty = 0;
  if (projected < 0) {
    insolvent = true;
    shortfall = -projected; // money the state could not cover this turn
    // Scale the penalty by shortfall relative to GDP; cap it so one bad turn
    // is painful but not instantly fatal.
    insolvencyApprovalPenalty = clamp((shortfall / Math.max(newGdp, 1)) * INSOLVENCY_APPROVAL_SCALE, 0, INSOLVENCY_APPROVAL_MAX);
  }

  // Consume this turn's accumulated battle mood (set by resolveBattle) so
  // military success/failure feeds approval, then reset it for next turn.
  const combatMood = state._combatMood || 0;
  state._combatMood = 0;

  const apBd = approvalDeltaBreakdown({ taxRate: state.economy.taxRate, growth, warWeariness, combatMood });
  const approvalAfterDelta = state.approval + apBd.approvalDelta - insolvencyApprovalPenalty;
  const newApproval = clampApproval(approvalAfterDelta);

  // Commit mutations
  state.economy.gdp = newGdp;
  state.approval = newApproval;
  state.treasury = Math.max(0, projected);

  return {
    ok: true,
    stateId,
    gdp: gdpBd,
    revenue: revenueBd,
    upkeep,
    militaryBudget,
    intelBudget,
    rnd,
    growth,
    warWeariness,
    approval: apBd,
    netTreasury,
    insolvent,
    shortfall,
    insolvencyApprovalPenalty,
    newTreasury: state.treasury,
  };
}

// Base economic output used by the GDP formula; kept here so economy.js owns
// the economic constants while formulas.js stays input-driven and pure.
const STATE_BASE_OUTPUT = 1000;

// Insolvency approval penalty tuning: approvalPenalty = clamp(shortfall/gdp *
// SCALE, 0, MAX). A shortfall equal to the whole GDP would cost the full MAX.
const INSOLVENCY_APPROVAL_SCALE = 40;
const INSOLVENCY_APPROVAL_MAX = 12;

function clampApproval(v) {
  return clamp(v, 0, 100);
}

function clampWeariness(numWars) {
  // Each active war adds strain; capped at 1.
  return clamp(numWars * 0.2, 0, 1);
}

// Re-export a couple of helpers so callers/tests can reach the math cleanly.
export { gdpFormula as gdp, taxRevenue, approvalDelta, upkeepTotal, recruitCost };
