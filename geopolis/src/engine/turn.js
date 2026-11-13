// turn.js
// Deterministic end-turn pipeline (DESIGN section 7). Given the same seed and
// the same inputs, endTurn produces an identical resulting GameState. All
// randomness is derived from a per-turn RNG seeded from `seed + turn`, so each
// turn is reproducible and independent of call history.

import { createRng } from './rng.js';
import { deepClone, getState } from './state.js';
import { economyTick } from './economy.js';
import { resetMovement, resolveBattle, rndTick } from './military.js';
import {
  proposeTreaty,
  declareWar,
  makePeace,
  relationsDriftTick,
} from './diplomacy.js';
import { runOperation } from './intel.js';
import { runAiTurn } from './ai.js';

/** Fixed order the AI states act in (excludes the player). */
function aiStateOrder(gameState) {
  return Object.keys(gameState.states)
    .filter((id) => id !== gameState.playerStateId && gameState.states[id].isAI)
    .sort();
}

/** Share of regions a state must control for a dominance victory. */
export const VICTORY_REGION_SHARE = 0.6;
/** Consecutive zero-approval turns that cause defeat. */
export const DEFEAT_APPROVAL_TURNS = 3;
/** Turn limit after which the dominant power wins. */
export const TURN_LIMIT = 60;

/**
 * Apply one queued player action. Actions are plain descriptors so the UI can
 * build them without importing engine internals. The per-turn rng is passed so
 * chance-based actions (treaties, intel) are reproducible.
 * @returns {object} result of the applied action
 */
function applyPlayerAction(gameState, action, rng) {
  const pid = gameState.playerStateId;
  switch (action.type) {
    case 'proposeTreaty':
      return proposeTreaty(gameState, pid, action.targetId, action.treatyType, rng, action.bribe || 0);
    case 'declareWar':
      return declareWar(gameState, pid, action.targetId);
    case 'makePeace':
      return makePeace(gameState, pid, action.targetId);
    case 'intel':
      return runOperation(gameState, pid, action.targetId, action.op, rng);
    case 'attack':
      return resolveBattle(gameState, pid, action.regionId, action.attackingUnitIds || [], rng);
    default:
      return { ok: false, reason: 'unknown_action' };
  }
}

/** Count regions owned by each state. */
function regionCounts(gameState) {
  const counts = {};
  for (const id of Object.keys(gameState.states)) counts[id] = 0;
  for (const regionId of Object.keys(gameState.regions)) {
    const owner = gameState.regions[regionId].ownerStateId;
    if (counts[owner] !== undefined) counts[owner] += 1;
  }
  return counts;
}

/**
 * Evaluate victory/defeat (DESIGN section 9). Mutates gameState.status when a
 * terminal condition is met and returns a summary.
 */
function evaluateEndConditions(gameState) {
  const counts = regionCounts(gameState);
  const totalRegions = Object.keys(gameState.regions).length;
  const pid = gameState.playerStateId;
  const player = gameState.states[pid];

  // Track consecutive zero-approval turns for the player.
  gameState._zeroApprovalStreak = player.approval <= 0 ? (gameState._zeroApprovalStreak || 0) + 1 : 0;

  let status = gameState.status || 'ongoing';
  let reason = null;

  if (counts[pid] === 0) {
    status = 'defeat';
    reason = 'no_regions';
  } else if (gameState._zeroApprovalStreak >= DEFEAT_APPROVAL_TURNS) {
    status = 'defeat';
    reason = 'approval_collapse';
  } else if (counts[pid] / totalRegions >= VICTORY_REGION_SHARE) {
    status = 'victory';
    reason = 'region_dominance';
  } else if (gameState.turn >= TURN_LIMIT) {
    // Dominant power at the limit wins; player wins only if dominant.
    let leader = pid;
    for (const id of Object.keys(counts)) if (counts[id] > counts[leader]) leader = id;
    status = leader === pid ? 'victory' : 'defeat';
    reason = 'turn_limit';
  }

  gameState.status = status;
  return { status, reason, counts, totalRegions, playerRegions: counts[pid] };
}

/**
 * Advance the game by one full turn. Returns a NEW GameState (the input is not
 * mutated), so callers can keep history / compare for determinism.
 *
 * Pipeline (DESIGN 7):
 *   1. Apply queued player actions.
 *   2. Each AI state acts in fixed order.
 *   3. Resolve diplomacy drift.
 *   4. (Intel + diplomacy treaty/war actions are applied inline in 1-2.)
 *   5. (Movements + battles are applied inline by AI/player actions in 1-2.)
 *   6. Economy tick for every state.
 *   7. R&D tick for every state.
 *   8. Reset movedThisTurn, increment turn, evaluate victory/defeat.
 *   9. Append a turn summary to the log.
 *
 * @param {object} gameState
 * @param {Array<object>} [playerQueuedActions=[]]
 * @returns {object} the next GameState
 */
export function endTurn(gameState, playerQueuedActions = []) {
  const next = deepClone(gameState);
  // Clear per-turn transient battle list (reports remain in the log).
  next.pendingBattles = [];
  next.phase = 'resolving';

  // Per-turn deterministic RNG: same seed + turn => same sequence.
  const rng = createRng(`${next.seed}:${next.turn}`);

  // 1. Player queued actions.
  const playerResults = [];
  for (const action of playerQueuedActions) {
    playerResults.push({ action, result: applyPlayerAction(next, action, rng) });
  }

  // 2. AI states act in fixed order.
  let totalAiDecisions = 0;
  for (const stateId of aiStateOrder(next)) {
    const r = runAiTurn(next, stateId, rng);
    totalAiDecisions += r.decisions;
  }

  // 3. Diplomacy relation drift toward neutral.
  relationsDriftTick(next);

  // 6/7. Economy + R&D tick for every state.
  for (const stateId of Object.keys(next.states)) {
    economyTick(next, stateId);
    rndTick(next, stateId);
  }

  // 8. Reset movement, increment turn, evaluate end conditions.
  for (const stateId of Object.keys(next.states)) resetMovement(next, stateId);
  next.turn += 1;
  next.phase = 'player';
  const end = evaluateEndConditions(next);

  // 9. Turn summary.
  const battleCount = next.log.filter((e) => e.kind === 'battle' && e.turn === gameState.turn).length;
  next.log.unshift({
    kind: 'summary',
    turn: gameState.turn,
    text: `Turn ${gameState.turn} resolved: ${totalAiDecisions} AI decisions, ${battleCount} battles. Status: ${end.status}.`,
    aiDecisions: totalAiDecisions,
    battles: battleCount,
    playerActions: playerResults.length,
    status: end.status,
    endReason: end.reason,
    regionCounts: end.counts,
  });

  return next;
}
