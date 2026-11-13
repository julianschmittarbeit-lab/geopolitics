// diplomacy.js
// Relations, treaties, war and peace. All mutation of diplomacy state flows
// through these reducer-style functions; all chance math is delegated to
// formulas.diplomacyAcceptChance and returned as a transparent breakdown.
//
// Treaty types (DESIGN 5.5): alliance, nonAggression, trade, peace.
// Relations are clamped to [-100, 100] and drift toward neutral each turn.

import { getState } from './state.js';
import { forceSummary } from './military.js';
import { clamp, diplomacyAcceptChanceBreakdown } from './formulas.js';

export const RELATION_MIN = -100;
export const RELATION_MAX = 100;

/** Relation shifts for notable actions (named so the log can explain them). */
export const RELATION_SHIFT = {
  declareWar: -60,
  makePeace: 20,
  allianceSigned: 25,
  nonAggressionSigned: 12,
  tradeSigned: 10,
};

/** How fast relations decay toward 0 each turn (absolute points). */
export const RELATION_DRIFT_PER_TURN = 2;

/** Treaty types that may be proposed. */
export const TREATY_TYPES = ['alliance', 'nonAggression', 'trade', 'peace'];

/**
 * Read a state's relation toward another (0 if unset).
 * @returns {number}
 */
export function getRelation(gameState, aId, bId) {
  const a = getState(gameState, aId);
  if (!a) return 0;
  const v = a.diplomacy.relations[bId];
  return typeof v === 'number' ? v : 0;
}

/**
 * Set a relation, clamped. Relations are stored symmetrically so both sides
 * agree on the number.
 * @returns {number} the clamped value applied
 */
export function setRelation(gameState, aId, bId, value) {
  const clamped = clamp(value, RELATION_MIN, RELATION_MAX);
  const a = getState(gameState, aId);
  const b = getState(gameState, bId);
  if (a) a.diplomacy.relations[bId] = clamped;
  if (b) b.diplomacy.relations[aId] = clamped;
  return clamped;
}

/**
 * Adjust a relation by a delta (symmetric, clamped).
 * @returns {number} the new clamped value
 */
export function adjustRelation(gameState, aId, bId, delta) {
  return setRelation(gameState, aId, bId, getRelation(gameState, aId, bId) + delta);
}

/** Power ratio proposer/target from force summaries (min 0.1 to avoid /0). */
function powerRatio(gameState, proposerId, targetId) {
  const p = forceSummary(gameState, proposerId).rawPower;
  const t = forceSummary(gameState, targetId).rawPower;
  return (p + 1) / (Math.max(t, 0) + 1);
}

function hasTreaty(state, otherId, type) {
  return state.diplomacy.treaties.some((t) => t.with === otherId && t.type === type);
}

function addTreaty(gameState, aId, bId, type) {
  const a = getState(gameState, aId);
  const b = getState(gameState, bId);
  if (a && !hasTreaty(a, bId, type)) a.diplomacy.treaties.push({ type, with: bId, turn: gameState.turn });
  if (b && !hasTreaty(b, aId, type)) b.diplomacy.treaties.push({ type, with: aId, turn: gameState.turn });
}

function removeTreaty(gameState, aId, bId, type) {
  const a = getState(gameState, aId);
  const b = getState(gameState, bId);
  if (a) a.diplomacy.treaties = a.diplomacy.treaties.filter((t) => !(t.with === bId && t.type === type));
  if (b) b.diplomacy.treaties = b.diplomacy.treaties.filter((t) => !(t.with === aId && t.type === type));
}

/** List the state ids a state is allied with. */
export function alliesOf(gameState, stateId) {
  const st = getState(gameState, stateId);
  if (!st) return [];
  return st.diplomacy.treaties.filter((t) => t.type === 'alliance').map((t) => t.with);
}

/**
 * Compute the acceptance chance for a proposed treaty, with full breakdown.
 * Does not mutate state. Used by proposeTreaty and by the AI.
 * @returns {object} breakdown including acceptChance
 */
export function treatyAcceptChance(gameState, proposerId, targetId, treatyType, bribe = 0) {
  const relation = getRelation(gameState, proposerId, targetId);
  const ratio = powerRatio(gameState, proposerId, targetId);
  const atWar = (getState(gameState, proposerId)?.atWarWith || []).includes(targetId);
  return diplomacyAcceptChanceBreakdown({ treatyType, relation, powerRatio: ratio, bribe, atWar });
}

/**
 * Propose a treaty. Draws a single reported roll from the injected rng and
 * decides acceptance. On acceptance, acceptTreaty applies the effects.
 * @returns {{ok:boolean, reason:string|null, accepted:boolean, roll:number, breakdown:object}}
 */
export function proposeTreaty(gameState, proposerId, targetId, treatyType, rng, bribe = 0) {
  if (!TREATY_TYPES.includes(treatyType)) {
    return { ok: false, reason: 'unknown_treaty_type', accepted: false, roll: 0, breakdown: null };
  }
  const proposer = getState(gameState, proposerId);
  const target = getState(gameState, targetId);
  if (!proposer || !target) {
    return { ok: false, reason: 'unknown_state', accepted: false, roll: 0, breakdown: null };
  }
  const breakdown = treatyAcceptChance(gameState, proposerId, targetId, treatyType, bribe);
  const roll = typeof rng === 'function' ? rng() : 0;
  const accepted = roll < breakdown.acceptChance;

  if (accepted) {
    // A bribe changes hands even conceptually; deduct if offered and affordable.
    if (bribe > 0 && proposer.treasury >= bribe) {
      proposer.treasury -= bribe;
      target.treasury += bribe;
    }
    acceptTreaty(gameState, proposerId, targetId, treatyType);
  }
  return { ok: true, reason: null, accepted, roll, breakdown };
}

/**
 * Apply the effects of an accepted treaty (relation bump, treaty record, and
 * for peace: end the war). Exposed so the AI/engine can also apply directly.
 * @returns {{ok:boolean, reason:string|null, treatyType:string}}
 */
export function acceptTreaty(gameState, aId, bId, treatyType) {
  switch (treatyType) {
    case 'peace':
      return makePeace(gameState, aId, bId);
    case 'alliance':
      addTreaty(gameState, aId, bId, 'alliance');
      adjustRelation(gameState, aId, bId, RELATION_SHIFT.allianceSigned);
      break;
    case 'nonAggression':
      addTreaty(gameState, aId, bId, 'nonAggression');
      adjustRelation(gameState, aId, bId, RELATION_SHIFT.nonAggressionSigned);
      break;
    case 'trade':
      addTreaty(gameState, aId, bId, 'trade');
      adjustRelation(gameState, aId, bId, RELATION_SHIFT.tradeSigned);
      break;
    default:
      return { ok: false, reason: 'unknown_treaty_type', treatyType };
  }
  return { ok: true, reason: null, treatyType };
}

/**
 * Declare war. Adds both states to each other's atWarWith, applies the big
 * relation penalty, cancels any peace/non-aggression/alliance between them, and
 * pulls the defender's allies into the war on the defender's side (DESIGN 5.5).
 * @returns {{ok:boolean, reason:string|null, pulledIn:string[], relation:number}}
 */
export function declareWar(gameState, aggressorId, defenderId) {
  const aggressor = getState(gameState, aggressorId);
  const defender = getState(gameState, defenderId);
  if (!aggressor || !defender) {
    return { ok: false, reason: 'unknown_state', pulledIn: [], relation: 0 };
  }
  if (aggressorId === defenderId) {
    return { ok: false, reason: 'cannot_war_self', pulledIn: [], relation: 0 };
  }

  const enterWar = (xId, yId) => {
    const x = getState(gameState, xId);
    if (x && !x.atWarWith.includes(yId)) x.atWarWith.push(yId);
  };

  // Cancel incompatible treaties, then set war on both sides.
  for (const type of ['alliance', 'nonAggression', 'peace']) {
    removeTreaty(gameState, aggressorId, defenderId, type);
  }
  enterWar(aggressorId, defenderId);
  enterWar(defenderId, aggressorId);
  const relation = adjustRelation(gameState, aggressorId, defenderId, RELATION_SHIFT.declareWar);

  // Pull the defender's allies in on the defender's side.
  const pulledIn = [];
  for (const allyId of alliesOf(gameState, defenderId)) {
    if (allyId === aggressorId) continue;
    enterWar(allyId, aggressorId);
    enterWar(aggressorId, allyId);
    adjustRelation(gameState, aggressorId, allyId, Math.round(RELATION_SHIFT.declareWar / 2));
    pulledIn.push(allyId);
  }

  gameState.log.unshift({
    kind: 'diplomacy',
    turn: gameState.turn,
    text: `${aggressorId} declared war on ${defenderId}${pulledIn.length ? ` (allies pulled in: ${pulledIn.join(', ')})` : ''}`,
  });

  return { ok: true, reason: null, pulledIn, relation };
}

/**
 * Make peace between two states: remove each other from atWarWith, record a
 * peace treaty marker, and apply the relation bump.
 * @returns {{ok:boolean, reason:string|null}}
 */
export function makePeace(gameState, aId, bId) {
  const a = getState(gameState, aId);
  const b = getState(gameState, bId);
  if (!a || !b) return { ok: false, reason: 'unknown_state' };
  a.atWarWith = a.atWarWith.filter((id) => id !== bId);
  b.atWarWith = b.atWarWith.filter((id) => id !== aId);
  adjustRelation(gameState, aId, bId, RELATION_SHIFT.makePeace);
  gameState.log.unshift({
    kind: 'diplomacy',
    turn: gameState.turn,
    text: `${aId} and ${bId} made peace`,
  });
  return { ok: true, reason: null };
}

/**
 * Drift every pair of relations toward neutral (0) by RELATION_DRIFT_PER_TURN.
 * States at war do not warm up toward each other. Called once per turn.
 * @param {object} gameState
 */
export function relationsDriftTick(gameState) {
  const ids = Object.keys(gameState.states);
  const done = new Set();
  for (const aId of ids) {
    const a = getState(gameState, aId);
    for (const bId of ids) {
      if (aId === bId) continue;
      const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
      if (done.has(key)) continue;
      done.add(key);
      if (a.atWarWith.includes(bId)) continue; // wars keep tensions high
      const current = getRelation(gameState, aId, bId);
      if (current === 0) continue;
      const step = Math.min(RELATION_DRIFT_PER_TURN, Math.abs(current));
      setRelation(gameState, aId, bId, current - Math.sign(current) * step);
    }
  }
}
