// subsystems.test.mjs
// Tests for FEAT-002: transparent battle resolution, diplomacy, intel, the AI
// utility model, and the deterministic end-turn pipeline.
// Run with: node --test 'tests/**/*.test.mjs'  (or `npm test`).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../src/engine/rng.js';
import { newGame, getState, getRegion, deepClone } from '../src/engine/state.js';
import {
  resolveBattle,
  estimateWinProbability,
  rndTick,
  forceSummary,
} from '../src/engine/military.js';
import * as MIL from '../src/engine/military.js';
import {
  getRelation,
  setRelation,
  proposeTreaty,
  declareWar,
  makePeace,
  alliesOf,
  acceptTreaty,
  treatyAcceptChance,
  relationsDriftTick,
} from '../src/engine/diplomacy.js';
import { runOperation } from '../src/engine/intel.js';
import { runAiTurn } from '../src/engine/ai.js';
import { endTurn } from '../src/engine/turn.js';
import * as ECON from '../src/engine/economy.js';
import * as F from '../src/engine/formulas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Place a controlled battle: give the player a stack of units adjacent to an
 * enemy region and (optionally) set the defender garrison. Returns ids.
 */
function setupBattle(g, { attackerTypes = ['infantry'], defenderTypes = ['infantry'] } = {}) {
  const player = getState(g, 'player');
  // Pick an enemy region adjacent to a player-owned region.
  let targetRegionId = null;
  let fromRegionId = null;
  for (const rid of Object.keys(g.regions)) {
    const r = g.regions[rid];
    if (r.ownerStateId === 'player') continue;
    for (const adj of r.adjacency) {
      if (g.regions[adj].ownerStateId === 'player') {
        targetRegionId = rid;
        fromRegionId = adj;
        break;
      }
    }
    if (targetRegionId) break;
  }
  assert.ok(targetRegionId, 'expected a player-adjacent enemy region');

  const defenderId = g.regions[targetRegionId].ownerStateId;
  const defender = getState(g, defenderId);
  // Clear the region and set a fresh defender garrison.
  defender.military.units = defender.military.units.filter((u) => u.regionId !== targetRegionId);
  defenderTypes.forEach((type, i) => {
    defender.military.units.push({
      id: `d_${i}`,
      type,
      strength: 100,
      maxStrength: 100,
      experience: 0,
      regionId: targetRegionId,
      movedThisTurn: false,
    });
  });

  // Give the attacker a stack in the adjacent owned region.
  player.military.units = player.military.units.filter((u) => u.regionId !== fromRegionId);
  const attackerIds = [];
  attackerTypes.forEach((type, i) => {
    const id = `a_${i}`;
    attackerIds.push(id);
    player.military.units.push({
      id,
      type,
      strength: 100,
      maxStrength: 100,
      experience: 0,
      regionId: fromRegionId,
      movedThisTurn: false,
    });
  });

  return { targetRegionId, fromRegionId, defenderId, attackerIds };
}

// ---------------------------------------------------------------------------
// Battle resolution: determinism + full transparent report
// ---------------------------------------------------------------------------

test('resolveBattle is deterministic for a fixed seed', () => {
  const g1 = newGame({ seed: 5 });
  const g2 = newGame({ seed: 5 });
  const s1 = setupBattle(g1);
  const s2 = setupBattle(g2);
  const r1 = resolveBattle(g1, 'player', s1.targetRegionId, s1.attackerIds, createRng(99));
  const r2 = resolveBattle(g2, 'player', s2.targetRegionId, s2.attackerIds, createRng(99));
  assert.ok(r1.ok && r2.ok);
  assert.equal(r1.report.roll, r2.report.roll);
  assert.equal(r1.report.odds, r2.report.odds);
  assert.equal(r1.report.attackerWins, r2.report.attackerWins);
  assert.equal(r1.report.attackPower, r2.report.attackPower);
  assert.equal(r1.report.defensePower, r2.report.defensePower);
});

test('BattleReport exposes every named modifier and is internally consistent', () => {
  const g = newGame({ seed: 5 });
  const s = setupBattle(g, { attackerTypes: ['infantry', 'armor', 'air'], defenderTypes: ['infantry'] });
  const res = resolveBattle(g, 'player', s.targetRegionId, s.attackerIds, createRng(3));
  assert.ok(res.ok);
  const rep = res.report;

  // Required top-level keys.
  for (const key of [
    'attackerContributions', 'defenderContributions', 'combinedArms', 'terrainEdge',
    'morale', 'missile', 'attackPower', 'defensePower', 'odds', 'roll',
    'attackerWins', 'casualtyFractions', 'attackerCasualties', 'defenderCasualties',
    'ownershipChanged', 'intensity',
  ]) {
    assert.ok(key in rep, `missing report key: ${key}`);
  }

  // Each attacker contribution exposes the named modifiers from DESIGN 5.4.
  for (const c of rep.attackerContributions) {
    for (const k of ['base', 'techMult', 'experienceMult', 'combinedArms', 'terrainMod', 'groundFactor', 'power']) {
      assert.ok(k in c, `contribution missing ${k}`);
    }
  }

  // odds == battleOdds(attackPower, defensePower).
  assert.ok(Math.abs(rep.odds - F.battleOdds(rep.attackPower, rep.defensePower)) < 1e-9);
  // winner decided by the single reported roll vs odds.
  assert.equal(rep.attackerWins, rep.uncontested ? true : rep.roll < rep.odds);
  // combined-arms bonus recorded for the attacker's mix of all three arms.
  assert.equal(rep.combinedArms.attacker.bonus, 1.3);
  // defender terrain edge is the documented constant.
  assert.equal(rep.terrainEdge.defenderEdge, F.DEFENDER_EDGE);
  // report is attached to pendingBattles and the log.
  assert.ok(g.pendingBattles.includes(rep));
  assert.ok(g.log.some((e) => e.kind === 'battle'));
});

test('much stronger attacker wins across most seeds and can capture the region', () => {
  let wins = 0;
  const N = 40;
  for (let seed = 0; seed < N; seed++) {
    const g = newGame({ seed });
    const s = setupBattle(g, {
      attackerTypes: ['armor', 'armor', 'armor', 'air'],
      defenderTypes: ['infantry'],
    });
    const res = resolveBattle(g, 'player', s.targetRegionId, s.attackerIds, createRng(seed * 7 + 1));
    if (res.report.attackerWins) wins += 1;
  }
  assert.ok(wins >= N * 0.8, `expected dominant attacker to usually win, won ${wins}/${N}`);
});

test('defender terrain edge is measurable (urban infantry defends better)', () => {
  // Compare defense power of the same garrison on plains vs urban terrain.
  function defPowerOn(terrain) {
    const g = newGame({ seed: 1 });
    const s = setupBattle(g, { attackerTypes: ['infantry'], defenderTypes: ['infantry'] });
    g.regions[s.targetRegionId].terrain = terrain;
    const res = resolveBattle(g, 'player', s.targetRegionId, s.attackerIds, createRng(1));
    return res.report.defensePower;
  }
  const plains = defPowerOn('plains');
  const urban = defPowerOn('urban');
  assert.ok(urban > plains, `urban defense ${urban} should exceed plains ${plains}`);
});

test('missiles deal consumed pre-battle damage', () => {
  const g = newGame({ seed: 2 });
  const s = setupBattle(g, { attackerTypes: ['missile', 'infantry'], defenderTypes: ['infantry'] });
  const player = getState(g, 'player');
  const before = player.military.units.filter((u) => u.type === 'missile').length;
  assert.ok(before >= 1);
  const res = resolveBattle(g, 'player', s.targetRegionId, s.attackerIds, createRng(2));
  assert.ok(res.report.missile.count >= 1);
  assert.ok(res.report.missile.totalDamage > 0);
  // Missile consumed.
  const after = player.military.units.filter((u) => u.type === 'missile').length;
  assert.equal(after, before - res.report.missile.count);
});

test('estimateWinProbability agrees with resolveBattle powers (no RNG)', () => {
  const g = newGame({ seed: 8 });
  const s = setupBattle(g, { attackerTypes: ['armor', 'armor'], defenderTypes: ['infantry'] });
  const est = estimateWinProbability(g, 'player', s.targetRegionId, s.attackerIds);
  const res = resolveBattle(deepClone(g), 'player', s.targetRegionId, s.attackerIds, createRng(1));
  assert.ok(Math.abs(est.attackPower - res.report.attackPower) < 1e-6);
  assert.ok(Math.abs(est.defensePower - res.report.defensePower) < 1e-6);
  assert.ok(Math.abs(est.odds - res.report.odds) < 1e-9);
});

// ---------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------

test('diplomacy acceptance chance is monotonic in relations', () => {
  const g = newGame({ seed: 1 });
  setRelation(g, 'player', 'eastmark', -50);
  const low = treatyAcceptChance(g, 'player', 'eastmark', 'alliance').acceptChance;
  setRelation(g, 'player', 'eastmark', 50);
  const high = treatyAcceptChance(g, 'player', 'eastmark', 'alliance').acceptChance;
  assert.ok(high > low);
});

test('setRelation clamps and is symmetric', () => {
  const g = newGame({ seed: 1 });
  assert.equal(setRelation(g, 'player', 'eastmark', 999), 100);
  assert.equal(getRelation(g, 'player', 'eastmark'), 100);
  assert.equal(getRelation(g, 'eastmark', 'player'), 100);
  assert.equal(setRelation(g, 'player', 'eastmark', -999), -100);
});

test('proposeTreaty accepts when chance is high and records the treaty', () => {
  const g = newGame({ seed: 1 });
  setRelation(g, 'player', 'eastmark', 100);
  // Force a roll of 0 so a high chance always accepts.
  const res = proposeTreaty(g, 'player', 'eastmark', 'nonAggression', () => 0);
  assert.ok(res.ok && res.accepted);
  assert.ok(getState(g, 'player').diplomacy.treaties.some((t) => t.type === 'nonAggression' && t.with === 'eastmark'));
  assert.ok('acceptChance' in res.breakdown);
});

test('declareWar sets mutual war, applies penalty, and pulls allies in', () => {
  const g = newGame({ seed: 1 });
  // southreach allied to eastmark; player declares war on eastmark.
  acceptTreaty(g, 'eastmark', 'southreach', 'alliance');
  assert.ok(alliesOf(g, 'eastmark').includes('southreach'));
  const relBefore = getRelation(g, 'player', 'eastmark');
  const res = declareWar(g, 'player', 'eastmark');
  assert.ok(res.ok);
  assert.ok(getState(g, 'player').atWarWith.includes('eastmark'));
  assert.ok(getState(g, 'eastmark').atWarWith.includes('player'));
  // relation dropped by the documented penalty.
  assert.ok(getRelation(g, 'player', 'eastmark') < relBefore);
  // ally pulled in.
  assert.ok(res.pulledIn.includes('southreach'));
  assert.ok(getState(g, 'player').atWarWith.includes('southreach'));
  assert.ok(getState(g, 'southreach').atWarWith.includes('player'));
});

test('makePeace ends a war and warms relations', () => {
  const g = newGame({ seed: 1 });
  declareWar(g, 'player', 'eastmark');
  const relAtWar = getRelation(g, 'player', 'eastmark');
  makePeace(g, 'player', 'eastmark');
  assert.ok(!getState(g, 'player').atWarWith.includes('eastmark'));
  assert.ok(!getState(g, 'eastmark').atWarWith.includes('player'));
  assert.ok(getRelation(g, 'player', 'eastmark') > relAtWar);
});

test('relationsDriftTick moves relations toward neutral but not during war', () => {
  const g = newGame({ seed: 1 });
  setRelation(g, 'player', 'eastmark', 50);
  setRelation(g, 'player', 'westfold', -40);
  relationsDriftTick(g);
  assert.ok(getRelation(g, 'player', 'eastmark') < 50);
  assert.ok(getRelation(g, 'player', 'westfold') > -40);
  // War freezes the drift.
  declareWar(g, 'player', 'southreach');
  setRelation(g, 'player', 'southreach', -80);
  relationsDriftTick(g);
  assert.equal(getRelation(g, 'player', 'southreach'), -80);
});

// ---------------------------------------------------------------------------
// Intelligence
// ---------------------------------------------------------------------------

test('intel success scales with agents and inversely with counterIntel', () => {
  const g = newGame({ seed: 1 });
  // Force success (roll 0) and measure probabilities via the report.
  getState(g, 'player').intel.agents = 1;
  getState(g, 'eastmark').intel.counterIntel = 0;
  const few = runOperation(g, 'player', 'eastmark', 'gatherInfo', () => 0);
  getState(g, 'player').intel.agents = 10;
  const many = runOperation(g, 'player', 'eastmark', 'gatherInfo', () => 0);
  assert.ok(many.report.probability.successChance > few.report.probability.successChance);

  getState(g, 'player').intel.agents = 5;
  getState(g, 'eastmark').intel.counterIntel = 0;
  const weakTarget = runOperation(g, 'player', 'eastmark', 'gatherInfo', () => 0);
  getState(g, 'eastmark').intel.counterIntel = 30;
  const hardTarget = runOperation(g, 'player', 'eastmark', 'gatherInfo', () => 0);
  assert.ok(hardTarget.report.probability.successChance < weakTarget.report.probability.successChance);
});

test('gatherInfo writes a dossier on success', () => {
  const g = newGame({ seed: 1 });
  const res = runOperation(g, 'player', 'eastmark', 'gatherInfo', () => 0);
  assert.ok(res.report.success);
  const dossier = getState(g, 'player').intel.knownInfo.eastmark;
  assert.ok(dossier && typeof dossier.treasuryEstimate === 'number');
  assert.ok('totalStrength' in dossier && 'techLevels' in dossier);
});

test('failed intel op can be detected and costs relations', () => {
  const g = newGame({ seed: 1 });
  setRelation(g, 'player', 'eastmark', 0);
  const relBefore = getRelation(g, 'player', 'eastmark');
  // First roll >= chance => failure; second roll (detection) = 0 => detected.
  let n = 0;
  const rng = () => (n++ === 0 ? 0.999 : 0);
  const res = runOperation(g, 'player', 'eastmark', 'sabotage', rng);
  assert.equal(res.report.success, false);
  assert.equal(res.report.detected, true);
  assert.ok(getRelation(g, 'player', 'eastmark') < relBefore);
});

test('sabotage damages target economy on success', () => {
  const g = newGame({ seed: 1 });
  const target = getState(g, 'eastmark');
  const before = target.treasury;
  const res = runOperation(g, 'player', 'eastmark', 'sabotage', () => 0);
  assert.ok(res.report.success);
  assert.ok(target.treasury < before);
  assert.ok(res.report.effect.economicDamage > 0);
});

// ---------------------------------------------------------------------------
// R&D tick
// ---------------------------------------------------------------------------

test('rndTick accumulates research and levels tech when crossing techCost', () => {
  const g = newGame({ seed: 1 });
  const st = getState(g, 'player');
  st.military.rnd = 100; // exactly techCost(1)
  st.military.researchBranch = 'infantry';
  const r = rndTick(g, 'player');
  assert.ok(r.ok);
  assert.equal(st.military.techLevels.infantry, 1);
  assert.ok(r.levelsGained.includes(1));
});

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

test('runAiTurn does not throw and logs at least one decision for a surplus state', () => {
  const g = newGame({ seed: 3 });
  getState(g, 'eastmark').treasury = 10000; // plenty of surplus to act on
  const before = g.log.length;
  const res = runAiTurn(g, 'eastmark', createRng(3));
  assert.ok(res.ok);
  assert.ok(res.decisions >= 1, 'AI should log at least one decision');
  assert.ok(g.log.length > before);
  // A logged decision carries a named score breakdown.
  const aiEntry = g.log.find((e) => e.kind === 'ai');
  assert.ok(aiEntry && typeof aiEntry.score === 'number' && aiEntry.factors);
});

// ---------------------------------------------------------------------------
// Turn pipeline
// ---------------------------------------------------------------------------

test('endTurn advances the turn and does not mutate the input', () => {
  const g = newGame({ seed: 7 });
  const snapshot = JSON.stringify(g);
  const next = endTurn(g, []);
  assert.equal(next.turn, g.turn + 1);
  assert.equal(JSON.stringify(g), snapshot, 'input state must be untouched');
});

test('endTurn is deterministic across two runs with equal seed', () => {
  const g = newGame({ seed: 7 });
  const a = endTurn(deepClone(g), []);
  const b = endTurn(deepClone(g), []);
  assert.equal(JSON.stringify(a.states), JSON.stringify(b.states));
  assert.equal(JSON.stringify(a.regions), JSON.stringify(b.regions));
});

test('multi-turn simulation is stable, deterministic, and preserves invariants', () => {
  function run() {
    let g = newGame({ seed: 7 });
    for (let i = 0; i < 15; i++) g = endTurn(g, []);
    return g;
  }
  const a = run();
  const b = run();
  assert.equal(a.turn, 16);
  assert.equal(JSON.stringify(a.states), JSON.stringify(b.states));

  // Invariants: treasuries stay within the sane bounds enforced by the
  // insolvency rule (floored at 0, never unbounded-negative) and unit
  // strengths stay within [0, max]. The floor is what makes the economy
  // coherent; a regression that removed it would fail here.
  const TREASURY_UPPER_BOUND = 1_000_000; // generous sanity cap
  for (const st of Object.values(a.states)) {
    assert.ok(Number.isFinite(st.treasury));
    assert.ok(st.treasury >= 0, `treasury must not go negative, got ${st.treasury} for ${st.id}`);
    assert.ok(st.treasury <= TREASURY_UPPER_BOUND, `treasury implausibly high: ${st.treasury}`);
    assert.ok(st.approval >= 0 && st.approval <= 100);
    for (const u of st.military.units) {
      assert.ok(u.strength >= 0 && u.strength <= u.maxStrength, `unit ${u.id} strength ${u.strength}`);
    }
  }

  // The run produced AI decisions and at least one battle over 15 turns.
  assert.ok(a.log.some((e) => e.kind === 'ai'));
  assert.ok(a.log.some((e) => e.kind === 'battle'));
  assert.ok(a.log.some((e) => e.kind === 'summary'));
});

test('every region remains owned by a valid state after many turns', () => {
  let g = newGame({ seed: 11 });
  for (let i = 0; i < 15; i++) g = endTurn(g, []);
  for (const r of Object.values(g.regions)) {
    assert.ok(g.states[r.ownerStateId], `region ${r.id} owned by unknown state ${r.ownerStateId}`);
  }
});

test('player queued attack action is applied through endTurn', () => {
  const g = newGame({ seed: 5 });
  const s = setupBattle(g, { attackerTypes: ['armor', 'armor', 'air'], defenderTypes: ['infantry'] });
  const next = endTurn(g, [
    { type: 'attack', regionId: s.targetRegionId, attackingUnitIds: s.attackerIds },
  ]);
  assert.ok(next.log.some((e) => e.kind === 'battle'));
});

// ---------------------------------------------------------------------------
// Economy solvency (rebalanced numbers + insolvency rule)
// ---------------------------------------------------------------------------

test('a passive player stays solvent (treasury never negative) over 30 turns', () => {
  for (const seed of [7, 3, 11, 1, 2]) {
    let g = newGame({ seed });
    for (let i = 0; i < 30; i++) {
      g = endTurn(g, []);
      assert.ok(
        getState(g, 'player').treasury >= 0,
        `passive player went insolvent-negative at turn ${g.turn} (seed ${seed})`
      );
    }
  }
});

test('every state treasury is bounded (never unbounded-negative) over a 30-turn sim', () => {
  let g = newGame({ seed: 7 });
  for (let i = 0; i < 30; i++) {
    g = endTurn(g, []);
    for (const st of Object.values(g.states)) {
      assert.ok(st.treasury >= 0, `state ${st.id} treasury ${st.treasury} < 0 at turn ${g.turn}`);
    }
  }
});

test('insolvency floors the treasury at 0 and penalizes approval', () => {
  const g = newGame({ seed: 1 });
  const st = getState(g, 'player');
  // Force a deep shortfall: tiny treasury, huge military budget.
  st.treasury = 10;
  st.military.budget = 5000;
  const approvalBefore = st.approval;
  const bd = ECON.economyTick(g, 'player');
  assert.equal(st.treasury, 0, 'treasury must floor at 0, not go negative');
  assert.equal(bd.insolvent, true);
  assert.ok(bd.shortfall > 0);
  assert.ok(bd.insolvencyApprovalPenalty > 0);
  assert.ok(st.approval < approvalBefore, 'insolvency should cost approval');
});

// ---------------------------------------------------------------------------
// Territory capture (sustained pressure takes ground)
// ---------------------------------------------------------------------------

test('a clearly stronger attacker captures a defended region within a few assaults', () => {
  // A dominant attacking stack vs a single defender should take the region
  // through sustained pressure well within N assaults, for every seed.
  const N = 6;
  for (let seed = 0; seed < 20; seed++) {
    const g = newGame({ seed });
    const s = setupBattle(g, {
      attackerTypes: ['armor', 'armor', 'armor', 'air'],
      defenderTypes: ['infantry'],
    });
    let captured = false;
    for (let assault = 0; assault < N && !captured; assault++) {
      // Fresh, undepleted attackers each assault (reinforcements arrive).
      const player = getState(g, 'player');
      for (const u of player.military.units) {
        if (s.attackerIds.includes(u.id)) {
          u.strength = u.maxStrength;
          u.movedThisTurn = false;
        }
      }
      const res = resolveBattle(g, 'player', s.targetRegionId, s.attackerIds, createRng(seed * 13 + assault));
      if (res.ok && res.report.ownershipChanged) captured = true;
      if (getRegion(g, s.targetRegionId).ownerStateId === 'player') captured = true;
    }
    assert.ok(captured, `stronger attacker failed to capture within ${N} assaults (seed ${seed})`);
  }
});

test('an AI-only world changes region ownership within 30 turns (wars resolve)', () => {
  // Across a spread of seeds, at least most should see the map change hands;
  // a frozen-map regression (capture requiring a full garrison wipe) would
  // drop this to near zero.
  let seedsWithCapture = 0;
  const seeds = 20;
  for (let seed = 0; seed < seeds; seed++) {
    let g = newGame({ seed });
    const owners0 = Object.fromEntries(Object.keys(g.regions).map((r) => [r, g.regions[r].ownerStateId]));
    for (let i = 0; i < 30; i++) g = endTurn(g, []);
    const changed = Object.keys(g.regions).some((r) => g.regions[r].ownerStateId !== owners0[r]);
    if (changed) seedsWithCapture += 1;
  }
  assert.ok(
    seedsWithCapture >= seeds * 0.75,
    `expected most seeds to see territory change hands, got ${seedsWithCapture}/${seeds}`
  );
});

test('retreat mechanic is transparent and only broken garrisons yield the region', () => {
  // Sustained pressure, not a single engagement, takes a defended region. The
  // report exposes retreats; a unit retreats (and the region flips) only once
  // it is beaten below the retreat threshold, otherwise it holds.
  const g = newGame({ seed: 5 });
  const s = setupBattle(g, {
    attackerTypes: ['armor', 'armor', 'armor', 'air'],
    defenderTypes: ['infantry'],
  });
  const res = resolveBattle(g, 'player', s.targetRegionId, s.attackerIds, createRng(1));
  assert.ok(res.ok);
  assert.ok(Array.isArray(res.report.retreats), 'report must expose retreat outcomes');

  const defender = getState(g, s.defenderId);
  const garrison = defender.military.units.filter((u) => u.regionId === s.targetRegionId && u.strength > 0);
  if (res.report.ownershipChanged) {
    // Region flipped: no un-broken defender should remain in it.
    assert.equal(getRegion(g, s.targetRegionId).ownerStateId, 'player');
    assert.equal(garrison.length, 0);
  } else if (res.report.attackerWins) {
    // Attacker won but the garrison held above the retreat threshold.
    assert.ok(
      garrison.every((u) => u.strength >= u.maxStrength * MIL.RETREAT_STRENGTH_FRACTION),
      'any garrison that stayed must be above the retreat threshold'
    );
  }
});

test('a broken garrison with no friendly fallback is destroyed and the region flips', () => {
  // Isolate the target so the defender has no adjacent owned region to retreat
  // into, then hit it hard enough to break it: it must be destroyed, not teleport.
  const g = newGame({ seed: 5 });
  const s = setupBattle(g, {
    attackerTypes: ['armor', 'armor', 'armor', 'armor', 'air', 'air'],
    defenderTypes: ['infantry'],
  });
  const defender = getState(g, s.defenderId);
  // Strand the garrison: give it a single weakened unit and remove the owner's
  // other regions' adjacency as a fallback by moving all its other units away.
  defender.military.units = defender.military.units.filter((u) => u.regionId === s.targetRegionId);
  for (const u of defender.military.units) u.strength = 20; // already near-broken
  // Make the defender own no region adjacent to the target.
  const target = getRegion(g, s.targetRegionId);
  for (const adj of target.adjacency) {
    if (getRegion(g, adj).ownerStateId === s.defenderId) getRegion(g, adj).ownerStateId = 'southreach';
  }
  const res = resolveBattle(g, 'player', s.targetRegionId, s.attackerIds, createRng(2));
  assert.ok(res.ok);
  if (res.report.attackerWins) {
    assert.equal(getRegion(g, s.targetRegionId).ownerStateId, 'player');
    assert.ok(res.report.retreats.some((r) => r.destroyed), 'stranded broken garrison must be destroyed');
  }
});
