// intel.js
// Espionage operations: gatherInfo, sabotage, counterIntel. Each operation's
// success chance comes from formulas.intelSuccessChance and is returned in a
// transparent report (probability breakdown, the single reported roll, success,
// and a detection flag). Failed ops may be detected, costing relations.

import { getState } from './state.js';
import { clamp, intelSuccessChanceBreakdown } from './formulas.js';
import { forceSummary } from './military.js';
import { adjustRelation } from './diplomacy.js';

/** Operations this module supports. */
export const INTEL_OPS = ['gatherInfo', 'sabotage', 'counterIntel'];

/** Named tuning constants (kept transparent). */
export const SABOTAGE_TREASURY_FRACTION = 0.1; // economic damage on success
export const SABOTAGE_UNIT_DAMAGE = 25; // strength removed from one unit
export const COUNTER_INTEL_GAIN = 5; // defense rating raised on success
export const DETECTION_RELATION_PENALTY = -15; // relation hit when caught
export const BASE_DETECTION_CHANCE = 0.4; // chance a FAILED op is detected

/**
 * Convert a relation value into the 0..1 relationPenalty term the formula
 * expects: worse (more negative) relations make an operator bolder / easier to
 * justify, raising success chance.
 * @param {number} relation -100..100
 * @returns {number} 0..1
 */
function relationPenaltyTerm(relation) {
  return clamp((-relation + 100) / 200, 0, 1); // relation -100 -> 1, +100 -> 0
}

/**
 * Run an intelligence operation. Draws a single reported roll from the injected
 * rng. On success, applies the operation's effect. On failure, rolls detection;
 * if detected, the target learns of it and relations drop.
 *
 * @param {object} gameState
 * @param {string} actorStateId
 * @param {string} targetStateId
 * @param {('gatherInfo'|'sabotage'|'counterIntel')} op
 * @param {() => number} rng
 * @returns {object} report
 */
export function runOperation(gameState, actorStateId, targetStateId, op, rng) {
  const actor = getState(gameState, actorStateId);
  if (!actor) return { ok: false, reason: 'unknown_state', report: null };
  if (!INTEL_OPS.includes(op)) return { ok: false, reason: 'unknown_op', report: null };

  // counterIntel is a self-directed op; target defaults to the actor.
  const resolvedTargetId = op === 'counterIntel' ? actorStateId : targetStateId;
  const target = getState(gameState, resolvedTargetId);
  if (!target) return { ok: false, reason: 'unknown_target', report: null };

  const relation = actor.diplomacy.relations[resolvedTargetId];
  const relationPenalty = op === 'counterIntel' ? 0 : relationPenaltyTerm(typeof relation === 'number' ? relation : 0);
  const targetCounterIntel = op === 'counterIntel' ? 0 : target.intel.counterIntel || 0;

  const breakdown = intelSuccessChanceBreakdown({
    op,
    agents: actor.intel.agents || 0,
    relationPenalty,
    targetCounterIntel,
  });

  const roll = typeof rng === 'function' ? rng() : 0;
  const success = roll < breakdown.successChance;

  const report = {
    kind: 'intel',
    turn: gameState.turn,
    op,
    actorStateId,
    targetStateId: resolvedTargetId,
    probability: breakdown,
    roll,
    success,
    detected: false,
    effect: null,
  };

  if (success) {
    report.effect = applyIntelEffect(gameState, actor, target, op);
  } else {
    // A failed op may be detected (counterIntel on self is never "detected").
    if (op !== 'counterIntel') {
      const detectRoll = rng();
      const detectChance = clamp(BASE_DETECTION_CHANCE + 0.01 * targetCounterIntel, 0, 0.95);
      if (detectRoll < detectChance) {
        report.detected = true;
        report.detectionChance = detectChance;
        report.detectionRoll = detectRoll;
        adjustRelation(gameState, actorStateId, resolvedTargetId, DETECTION_RELATION_PENALTY);
      }
    }
  }

  gameState.log.unshift({
    kind: 'intel',
    turn: gameState.turn,
    text: `${actorStateId} ran ${op} on ${resolvedTargetId}: ${success ? 'success' : 'failed'}${
      report.detected ? ' (detected!)' : ''
    } [p ${breakdown.successChance.toFixed(3)} roll ${roll.toFixed(3)}]`,
    report,
  });

  return { ok: true, reason: null, report };
}

/**
 * Apply the concrete effect of a successful operation. Returns a description of
 * what changed for the report.
 */
function applyIntelEffect(gameState, actor, target, op) {
  switch (op) {
    case 'gatherInfo': {
      const force = forceSummary(gameState, target.id);
      const dossier = {
        turn: gameState.turn,
        treasuryEstimate: Math.round(target.treasury),
        gdpEstimate: Math.round(target.economy.gdp),
        totalUnits: force.totalUnits,
        totalStrength: force.totalStrength,
        rawPower: Math.round(force.rawPower),
        techLevels: { ...target.military.techLevels },
      };
      actor.intel.knownInfo[target.id] = dossier;
      return { type: 'dossier', dossier };
    }
    case 'sabotage': {
      const economicDamage = Math.round(target.treasury * SABOTAGE_TREASURY_FRACTION);
      target.treasury = Math.max(0, target.treasury - economicDamage);
      let unitHit = null;
      const units = target.military.units.filter((u) => u.strength > 0);
      if (units.length > 0) {
        // Hit the strongest unit (most impactful), deterministic given state.
        units.sort((a, b) => b.strength - a.strength);
        const u = units[0];
        const before = u.strength;
        u.strength = Math.max(0, u.strength - SABOTAGE_UNIT_DAMAGE);
        unitHit = { unitId: u.id, type: u.type, before, after: u.strength };
        target.military.units = target.military.units.filter((x) => x.strength > 0);
      }
      return { type: 'sabotage', economicDamage, unitHit };
    }
    case 'counterIntel': {
      actor.intel.counterIntel = (actor.intel.counterIntel || 0) + COUNTER_INTEL_GAIN;
      return { type: 'counterIntel', newCounterIntel: actor.intel.counterIntel };
    }
    default:
      return null;
  }
}
