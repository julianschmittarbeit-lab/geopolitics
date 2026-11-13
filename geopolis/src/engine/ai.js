// ai.js
// Transparent utility-model AI (DESIGN section 6). On its turn an AI state runs
// five agents (economy, military, diplomacy, intel, war). Each agent scores
// candidate actions with NAMED factors, picks the best above a threshold, and
// applies it through the engine's reducer functions. Every decision pushes a
// log entry with its score breakdown so a human can see WHY the AI acted.
//
// All thresholds live in AI_CONST so balance is visible in one place.

import { getState, getRegion } from './state.js';
import { recruitUnit, setTaxRate, investSector } from './economy.js';
import {
  forceSummary,
  resolveBattle,
  estimateWinProbability,
  moveUnit,
} from './military.js';
import {
  getRelation,
  proposeTreaty,
  declareWar,
  makePeace,
  alliesOf,
} from './diplomacy.js';
import { runOperation } from './intel.js';
import { UNIT_TYPE_KEYS } from '../data/unitTypes.js';

/** Named constants / thresholds (transparent balance knobs). */
export const AI_CONST = {
  TARGET_TAX_RATE: 0.32, // balance of treasury vs approval
  TAX_ADJUST_STEP: 0.03,
  LOW_TREASURY: 1500, // below this, raise tax / stop spending
  SURPLUS_TREASURY: 3500, // above this, free to recruit / invest
  INVEST_POINTS: 5,
  RECRUIT_THREAT_RATIO: 1.1, // recruit if a neighbor outguns us by this
  WAR_WIN_THRESHOLD: 0.6, // only declare war if estimated odds exceed this
  ATTACK_WIN_THRESHOLD: 0.55, // only attack a region at these local odds
  SUE_PEACE_WIN_THRESHOLD: 0.3, // when losing this badly, seek peace
  ALLY_RELATION_MIN: 30, // propose alliance only if relations are warm
  SPY_RELATION_MAX: 10, // spy on states we are not friendly with
  MIN_SCORE_TO_ACT: 0.1, // ignore marginal actions
  ALLIANCE_BRIBE: 0,
};

/**
 * Push a transparent decision-log entry describing an AI action.
 */
function logDecision(gameState, stateId, agent, action, score, factors, extra = {}) {
  gameState.log.unshift({
    kind: 'ai',
    turn: gameState.turn,
    stateId,
    agent,
    action,
    score,
    factors,
    ...extra,
    text: `AI ${stateId} [${agent}] -> ${action} (score ${score.toFixed(3)})`,
  });
}

/** Ids of all other states. */
function otherStateIds(gameState, stateId) {
  return Object.keys(gameState.states).filter((id) => id !== stateId);
}

/** Find the neighbor with the strongest force (the primary threat). */
function mostThreateningNeighbor(gameState, stateId) {
  const me = forceSummary(gameState, stateId).rawPower;
  let worst = null;
  let worstRatio = 0;
  for (const otherId of otherStateIds(gameState, stateId)) {
    const theirs = forceSummary(gameState, otherId).rawPower;
    const ratio = (theirs + 1) / (me + 1);
    if (ratio > worstRatio) {
      worstRatio = ratio;
      worst = otherId;
    }
  }
  return { id: worst, ratio: worstRatio };
}

// ---------------------------------------------------------------------------
// Economy agent: steer tax toward target; invest surplus into weakest sector.
// ---------------------------------------------------------------------------
function economyAgent(gameState, stateId) {
  const state = getState(gameState, stateId);
  const factors = {
    treasury: state.treasury,
    taxRate: state.economy.taxRate,
    approval: state.approval,
    targetTax: AI_CONST.TARGET_TAX_RATE,
  };

  // Tax steering: if poor, raise tax; if rich and approval low, lower it.
  let targetTax = AI_CONST.TARGET_TAX_RATE;
  if (state.treasury < AI_CONST.LOW_TREASURY) targetTax += AI_CONST.TAX_ADJUST_STEP;
  else if (state.treasury > AI_CONST.SURPLUS_TREASURY && state.approval < 55) {
    targetTax -= AI_CONST.TAX_ADJUST_STEP;
  }
  const taxDelta = Math.abs(targetTax - state.economy.taxRate);
  if (taxDelta >= 0.01) {
    const score = Math.min(1, taxDelta * 5);
    if (score >= AI_CONST.MIN_SCORE_TO_ACT) {
      setTaxRate(gameState, stateId, targetTax);
      logDecision(gameState, stateId, 'economy', 'setTaxRate', score, { ...factors, newTax: targetTax });
      return true;
    }
  }

  // Invest surplus into the sector with the lowest current investment.
  if (state.treasury > AI_CONST.SURPLUS_TREASURY) {
    const sectors = state.economy.sectors;
    let weakest = null;
    let min = Infinity;
    for (const key of Object.keys(sectors)) {
      if (sectors[key] < min) {
        min = sectors[key];
        weakest = key;
      }
    }
    if (weakest && sectors[weakest] < 100) {
      const score = Math.min(1, (100 - sectors[weakest]) / 100);
      if (score >= AI_CONST.MIN_SCORE_TO_ACT) {
        investSector(gameState, stateId, weakest, AI_CONST.INVEST_POINTS);
        logDecision(gameState, stateId, 'economy', 'investSector', score, { ...factors, sector: weakest, value: min });
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Military agent: recruit when a threat outguns us and we can afford it.
// ---------------------------------------------------------------------------
function militaryAgent(gameState, stateId) {
  const state = getState(gameState, stateId);
  const threat = mostThreateningNeighbor(gameState, stateId);
  const factors = {
    threatId: threat.id,
    threatRatio: threat.ratio,
    treasury: state.treasury,
    recruitThreshold: AI_CONST.RECRUIT_THREAT_RATIO,
  };

  const needsForce = threat.ratio >= AI_CONST.RECRUIT_THREAT_RATIO;
  const canAfford = state.treasury > AI_CONST.LOW_TREASURY;
  if (!needsForce || !canAfford) return false;

  // Choose a unit type: prefer armor when rich, infantry otherwise.
  const unitType = state.treasury > AI_CONST.SURPLUS_TREASURY ? 'armor' : 'infantry';
  // Place in an owned region (prefer the one bordering the threat if known).
  const ownedRegions = Object.keys(gameState.regions).filter(
    (id) => gameState.regions[id].ownerStateId === stateId
  );
  if (ownedRegions.length === 0) return false;
  const regionId = ownedRegions[0];

  const res = recruitUnit(gameState, stateId, unitType, regionId);
  if (res.ok) {
    const score = Math.min(1, (threat.ratio - 1) + 0.2);
    logDecision(gameState, stateId, 'military', 'recruit', score, { ...factors, unitType, regionId });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Diplomacy agent: ally with warm states sharing a rival; sue for peace when
// losing a war badly.
// ---------------------------------------------------------------------------
function diplomacyAgent(gameState, stateId, rng) {
  const state = getState(gameState, stateId);

  // Sue for peace if we are losing badly to a current enemy.
  for (const enemyId of state.atWarWith) {
    const myPower = forceSummary(gameState, stateId).rawPower;
    const theirPower = forceSummary(gameState, enemyId).rawPower;
    const winProb = (myPower + 1) / (myPower + theirPower + 2);
    if (winProb < AI_CONST.SUE_PEACE_WIN_THRESHOLD) {
      const score = 1 - winProb;
      makePeace(gameState, stateId, enemyId);
      logDecision(gameState, stateId, 'diplomacy', 'makePeace', score, {
        enemyId,
        winProb,
        threshold: AI_CONST.SUE_PEACE_WIN_THRESHOLD,
      });
      return true;
    }
  }

  // Propose an alliance with the warmest state we are not already allied with.
  const allies = new Set(alliesOf(gameState, stateId));
  let bestTarget = null;
  let bestRelation = AI_CONST.ALLY_RELATION_MIN;
  for (const otherId of otherStateIds(gameState, stateId)) {
    if (allies.has(otherId)) continue;
    if (state.atWarWith.includes(otherId)) continue;
    const rel = getRelation(gameState, stateId, otherId);
    if (rel > bestRelation) {
      bestRelation = rel;
      bestTarget = otherId;
    }
  }
  if (bestTarget) {
    const res = proposeTreaty(gameState, stateId, bestTarget, 'alliance', rng, AI_CONST.ALLIANCE_BRIBE);
    const score = Math.min(1, bestRelation / 100 + 0.2);
    logDecision(gameState, stateId, 'diplomacy', 'proposeAlliance', score, {
      targetId: bestTarget,
      relation: bestRelation,
      acceptChance: res.breakdown ? res.breakdown.acceptChance : null,
      accepted: res.accepted,
      roll: res.roll,
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Intel agent: spy on an unknown, non-friendly, strong neighbor.
// ---------------------------------------------------------------------------
function intelAgent(gameState, stateId, rng) {
  const state = getState(gameState, stateId);
  if (state.treasury < AI_CONST.LOW_TREASURY) return false;

  let bestTarget = null;
  let bestScore = AI_CONST.MIN_SCORE_TO_ACT;
  let bestFactors = null;
  for (const otherId of otherStateIds(gameState, stateId)) {
    const rel = getRelation(gameState, stateId, otherId);
    if (rel > AI_CONST.SPY_RELATION_MAX) continue;
    const unknown = !state.intel.knownInfo[otherId];
    const enemy = state.atWarWith.includes(otherId);
    // Prefer gathering info on unknown states; sabotage active enemies.
    const op = enemy ? 'sabotage' : 'gatherInfo';
    let score = 0;
    if (op === 'gatherInfo') score = unknown ? 0.6 : 0.2;
    else score = 0.8;
    // Hostility raises the score.
    score += (-rel / 100) * 0.3;
    if (score > bestScore) {
      bestScore = score;
      bestTarget = otherId;
      bestFactors = { targetId: otherId, relation: rel, op, unknown, enemy };
    }
  }
  if (bestTarget) {
    const res = runOperation(gameState, stateId, bestTarget, bestFactors.op, rng);
    logDecision(gameState, stateId, 'intel', bestFactors.op, bestScore, {
      ...bestFactors,
      successChance: res.report ? res.report.probability.successChance : null,
      success: res.report ? res.report.success : null,
      detected: res.report ? res.report.detected : null,
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// War agent: declare a winnable war on a valuable non-allied neighbor; when at
// war, attack the weakest enemy border region if local odds are favorable.
// ---------------------------------------------------------------------------
function warAgent(gameState, stateId, rng) {
  const state = getState(gameState, stateId);

  // (A) If at peace, consider declaring a winnable war.
  if (state.atWarWith.length === 0) {
    const allies = new Set(alliesOf(gameState, stateId));
    let bestTarget = null;
    let bestOdds = AI_CONST.WAR_WIN_THRESHOLD;
    let bestRegion = null;
    for (const otherId of otherStateIds(gameState, stateId)) {
      if (allies.has(otherId)) continue;
      // Find a border region of the target we could realistically take.
      for (const regionId of Object.keys(gameState.regions)) {
        if (gameState.regions[regionId].ownerStateId !== otherId) continue;
        const est = estimateWinProbability(gameState, stateId, regionId);
        if (est.odds > bestOdds && est.attackPower > 0) {
          bestOdds = est.odds;
          bestTarget = otherId;
          bestRegion = regionId;
        }
      }
    }
    if (bestTarget) {
      const war = declareWar(gameState, stateId, bestTarget);
      logDecision(gameState, stateId, 'war', 'declareWar', bestOdds, {
        targetId: bestTarget,
        estimatedOdds: bestOdds,
        threshold: AI_CONST.WAR_WIN_THRESHOLD,
        targetRegion: bestRegion,
        pulledIn: war.pulledIn,
      });
      return true;
    }
    return false;
  }

  // (B) At war: attack the best winnable enemy region.
  let bestRegion = null;
  let bestEst = null;
  let bestUnitIds = null;
  for (const enemyId of state.atWarWith) {
    for (const regionId of Object.keys(gameState.regions)) {
      if (gameState.regions[regionId].ownerStateId !== enemyId) continue;
      // Attackers: our alive units adjacent to or standing in the region.
      const attackers = state.military.units.filter((u) => {
        if (u.strength <= 0 || u.movedThisTurn) return false;
        const r = getRegion(gameState, u.regionId);
        return r && (u.regionId === regionId || r.adjacency.includes(regionId));
      });
      if (attackers.length === 0) continue;
      const est = estimateWinProbability(gameState, stateId, regionId, attackers.map((u) => u.id));
      if (est.odds > AI_CONST.ATTACK_WIN_THRESHOLD && (!bestEst || est.odds > bestEst.odds)) {
        bestEst = est;
        bestRegion = regionId;
        bestUnitIds = attackers.map((u) => u.id);
      }
    }
  }
  if (bestRegion) {
    const res = resolveBattle(gameState, stateId, bestRegion, bestUnitIds, rng);
    logDecision(gameState, stateId, 'war', 'attack', bestEst.odds, {
      regionId: bestRegion,
      estimatedOdds: bestEst.odds,
      threshold: AI_CONST.ATTACK_WIN_THRESHOLD,
      attackPower: bestEst.attackPower,
      defensePower: bestEst.defensePower,
      won: res.report ? res.report.attackerWins : null,
    });
    return true;
  }

  // (C) No favorable attack: advance a unit toward an enemy region.
  for (const enemyId of state.atWarWith) {
    for (const unit of state.military.units) {
      if (unit.movedThisTurn || unit.strength <= 0) continue;
      const r = getRegion(gameState, unit.regionId);
      if (!r) continue;
      const targetAdj = r.adjacency.find((aid) => gameState.regions[aid].ownerStateId === enemyId);
      if (targetAdj) {
        const mv = moveUnit(gameState, stateId, unit.id, targetAdj);
        if (mv.ok) {
          logDecision(gameState, stateId, 'war', 'advance', 0.3, {
            unitId: unit.id,
            toRegionId: targetAdj,
            enemyId,
          });
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Run a full AI turn for one state: execute each agent in a fixed order. Each
 * agent may apply one or more actions and log its decisions. Returns the number
 * of decisions logged this turn.
 * @param {object} gameState
 * @param {string} stateId
 * @param {() => number} rng
 * @returns {{ok:boolean, decisions:number}}
 */
export function runAiTurn(gameState, stateId, rng) {
  const state = getState(gameState, stateId);
  if (!state) return { ok: false, decisions: 0 };
  const before = gameState.log.length;

  economyAgent(gameState, stateId);
  militaryAgent(gameState, stateId);
  diplomacyAgent(gameState, stateId, rng);
  intelAgent(gameState, stateId, rng);
  warAgent(gameState, stateId, rng);

  const decisions = gameState.log.length - before;
  return { ok: true, decisions };
}

export { UNIT_TYPE_KEYS };
