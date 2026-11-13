// foundation.test.mjs
// Unit tests for the FEAT-001 foundation: RNG, formulas, world, state, economy,
// military movement. Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRng, randInt, pick, normalizeSeed } from '../src/engine/rng.js';
import * as F from '../src/engine/formulas.js';
import { makeInitialWorld } from '../src/data/world.js';
import { UNIT_TYPES } from '../src/data/unitTypes.js';
import * as techs from '../src/data/techs.js';
import {
  newGame,
  getState,
  getRegion,
  getPlayerState,
  unitsInRegion,
  deepClone,
} from '../src/engine/state.js';
import {
  recruitUnit,
  setTaxRate,
  investSector,
  economyTick,
} from '../src/engine/economy.js';
import {
  moveUnit,
  listRecruitableUnits,
  forceSummary,
  resolveBattle,
  resetMovement,
} from '../src/engine/military.js';

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------

test('rng is reproducible for the same seed', () => {
  const a = createRng(1234);
  const b = createRng(1234);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('rng differs for different seeds', () => {
  const a = createRng(1);
  const b = createRng(2);
  assert.notDeepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('rng returns floats in [0,1)', () => {
  const r = createRng('seed-string');
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
  }
});

test('randInt stays in range and pick returns a member', () => {
  const r = createRng(42);
  for (let i = 0; i < 500; i++) {
    const v = randInt(r, 3, 7);
    assert.ok(v >= 3 && v <= 7 && Number.isInteger(v));
  }
  const arr = ['x', 'y', 'z'];
  for (let i = 0; i < 100; i++) {
    assert.ok(arr.includes(pick(r, arr)));
  }
  assert.equal(pick(r, []), undefined);
});

test('normalizeSeed produces uint32 for strings and numbers', () => {
  assert.equal(normalizeSeed(5), 5);
  const h = normalizeSeed('abc');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});

// ---------------------------------------------------------------------------
// Formulas (known inputs/outputs)
// ---------------------------------------------------------------------------

test('gdp formula matches DESIGN 5.1', () => {
  // base=1000, sumSectors=100, approval=100
  // sectorFactor = 1.4, approvalFactor = 1.0 => 1400
  assert.equal(F.gdp(1000, 100, 100), 1400);
  // approval 50 => approvalFactor 0.8 => 1120
  assert.ok(Math.abs(F.gdp(1000, 100, 50) - 1120) < 1e-9);
});

test('taxRevenue = gdp * taxRate * 0.25', () => {
  assert.equal(F.taxRevenue(1000, 0.4), 100);
  assert.equal(F.taxRevenue(2000, 0), 0);
});

test('approvalDelta rewards low tax and growth, penalizes war', () => {
  const lowTaxGrowth = F.approvalDelta({ taxRate: 0.1, growth: 0.1, warWeariness: 0 });
  const highTaxWar = F.approvalDelta({ taxRate: 0.8, growth: -0.1, warWeariness: 1 });
  assert.ok(lowTaxGrowth > 0, `expected positive, got ${lowTaxGrowth}`);
  assert.ok(highTaxWar < 0, `expected negative, got ${highTaxWar}`);
});

test('upkeepTotal sums unit type upkeep', () => {
  const units = [{ type: 'infantry' }, { type: 'infantry' }, { type: 'armor' }];
  const expected = UNIT_TYPES.infantry.upkeep * 2 + UNIT_TYPES.armor.upkeep;
  assert.equal(F.upkeepTotal(units), expected);
});

test('techCost is monotonic increasing and matches 100*level^1.5', () => {
  assert.equal(F.techCost(0), 0);
  assert.equal(F.techCost(1), 100);
  assert.ok(Math.abs(F.techCost(4) - 800) < 1e-9); // 100*4^1.5 = 800
  for (let l = 1; l < 20; l++) {
    assert.ok(F.techCost(l + 1) > F.techCost(l), `not monotonic at ${l}`);
  }
  // data module agrees with formulas module
  assert.equal(techs.cost(4), F.techCost(4));
  assert.equal(techs.techMult(3), F.techMult(3));
});

test('techMult = 1 + 0.15*level', () => {
  assert.equal(F.techMult(0), 1);
  assert.ok(Math.abs(F.techMult(2) - 1.3) < 1e-9);
});

test('recruitCost uses unit type cost', () => {
  assert.equal(F.recruitCost('infantry', 1), UNIT_TYPES.infantry.cost);
  assert.equal(F.recruitCost('armor', 3), UNIT_TYPES.armor.cost * 3);
  assert.equal(F.recruitCost('nope'), 0);
});

test('unitPower scales with strength, tech, terrain', () => {
  const unit = { type: 'infantry', strength: 100, experience: 0 };
  const base = F.unitPower({ unit, techLevel: 0, terrain: 'plains', combinedArms: 1 });
  const teched = F.unitPower({ unit, techLevel: 2, terrain: 'plains', combinedArms: 1 });
  const urban = F.unitPower({ unit, techLevel: 0, terrain: 'urban', combinedArms: 1 });
  assert.ok(teched > base, 'tech should raise power');
  assert.ok(urban > base, 'infantry should be stronger in urban terrain');
  // air gets reduced ground factor
  const air = F.unitPower({ unit: { type: 'air', strength: 100, experience: 0 }, techLevel: 0, terrain: 'plains', combinedArms: 1 });
  const expectedAir = 100 * UNIT_TYPES.air.basePower * 1 * 1 * 1 * 1 * F.AIR_GROUND_FACTOR;
  assert.ok(Math.abs(air - expectedAir) < 1e-6);
});

test('combinedArmsBonus increases with mixed arms', () => {
  assert.equal(F.combinedArmsBonus(['infantry']), 1.0);
  assert.equal(F.combinedArmsBonus(['infantry', 'armor']), 1.15);
  assert.equal(F.combinedArmsBonus(['infantry', 'armor', 'air']), 1.3);
});

test('battleOdds normalizes and handles zero', () => {
  assert.equal(F.battleOdds(100, 100), 0.5);
  assert.equal(F.battleOdds(300, 100), 0.75);
  assert.equal(F.battleOdds(0, 0), 0.5);
});

test('casualties: loser loses more than winner; close fights bloodier', () => {
  const close = F.casualties(0.5, true);
  const lopsided = F.casualties(0.9, true);
  assert.ok(close.attackerLoss <= close.defenderLoss);
  assert.ok(close.defenderLoss > lopsided.defenderLoss, 'closer fight bloodier for loser');
  const defWin = F.casualties(0.2, false); // attacker loses
  assert.ok(defWin.attackerLoss >= defWin.defenderLoss);
  for (const c of [close, lopsided, defWin]) {
    assert.ok(c.attackerLoss >= 0 && c.attackerLoss <= 1);
    assert.ok(c.defenderLoss >= 0 && c.defenderLoss <= 1);
  }
});

test('diplomacyAcceptChance in (0,1) and rises with relation', () => {
  const low = F.diplomacyAcceptChance({ treatyType: 'alliance', relation: -50 });
  const high = F.diplomacyAcceptChance({ treatyType: 'alliance', relation: 80 });
  assert.ok(high > low);
  assert.ok(low >= 0.02 && high <= 0.98);
});

test('intelSuccessChance clamped to [0.05,0.95] and rises with agents', () => {
  const few = F.intelSuccessChance({ op: 'gatherInfo', agents: 0 });
  const many = F.intelSuccessChance({ op: 'gatherInfo', agents: 10 });
  assert.ok(many > few);
  const floor = F.intelSuccessChance({ op: 'sabotage', agents: 0, targetCounterIntel: 100 });
  assert.equal(floor, 0.05);
});

// ---------------------------------------------------------------------------
// World: adjacency symmetry & connectivity
// ---------------------------------------------------------------------------

test('world adjacency is symmetric', () => {
  const { regions } = makeInitialWorld();
  for (const id of Object.keys(regions)) {
    for (const nb of regions[id].adjacency) {
      assert.ok(regions[nb], `neighbor ${nb} missing`);
      assert.ok(regions[nb].adjacency.includes(id), `asymmetric edge ${id}<->${nb}`);
    }
  }
});

test('world graph is connected', () => {
  const { regions } = makeInitialWorld();
  const ids = Object.keys(regions);
  const seen = new Set();
  const stack = [ids[0]];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nb of regions[cur].adjacency) stack.push(nb);
  }
  assert.equal(seen.size, ids.length, 'not all regions reachable');
});

test('world has >=10 regions and 4-5 states incl. player', () => {
  const { regions, states } = makeInitialWorld();
  assert.ok(Object.keys(regions).length >= 10);
  assert.ok(states.length >= 4 && states.length <= 5);
  assert.ok(states.some((s) => s.id === 'player' && s.isPlayer));
});

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

test('newGame produces a valid consistent GameState', () => {
  const g = newGame({ seed: 1, lang: 'en' });
  assert.ok(Object.keys(g.regions).length >= 10);
  assert.ok(Object.keys(g.states).length >= 4);
  assert.ok(g.states.player && g.states.player.isPlayer);
  assert.equal(g.playerStateId, 'player');
  assert.equal(g.turn, 1);

  // Every region owner is a real state.
  for (const r of Object.values(g.regions)) {
    assert.ok(g.states[r.ownerStateId], `region ${r.id} owned by unknown state`);
  }

  // Starting units are placed in regions owned by their state.
  for (const st of Object.values(g.states)) {
    assert.ok(st.military.units.length > 0, `${st.id} has no units`);
    for (const u of st.military.units) {
      assert.equal(g.regions[u.regionId].ownerStateId, st.id);
      assert.ok(u.strength > 0 && u.strength <= u.maxStrength);
    }
    // neutral relations toward others
    for (const other of Object.keys(g.states)) {
      if (other === st.id) continue;
      assert.equal(st.diplomacy.relations[other], 0);
    }
  }
});

test('selectors work', () => {
  const g = newGame({ seed: 7 });
  assert.equal(getPlayerState(g).id, 'player');
  const anyRegion = Object.keys(g.regions)[0];
  assert.equal(getRegion(g, anyRegion).id, anyRegion);
  assert.equal(getState(g, 'player').id, 'player');
  const units = unitsInRegion(g, anyRegion);
  assert.ok(Array.isArray(units));
});

test('deepClone is independent of the source', () => {
  const g = newGame({ seed: 1 });
  const c = deepClone(g);
  c.states.player.treasury = -999;
  assert.notEqual(g.states.player.treasury, -999);
});

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

test('recruitUnit happy path deducts cost and adds a unit', () => {
  const g = newGame({ seed: 1 });
  const player = getState(g, 'player');
  const region = Object.keys(g.regions).find((id) => g.regions[id].ownerStateId === 'player');
  const before = player.treasury;
  const beforeUnits = player.military.units.length;
  const res = recruitUnit(g, 'player', 'infantry', region);
  assert.ok(res.ok, `expected ok, got ${res.reason}`);
  assert.equal(player.military.units.length, beforeUnits + 1);
  assert.equal(player.treasury, before - UNIT_TYPES.infantry.cost);
});

test('recruitUnit rejects insufficient funds', () => {
  const g = newGame({ seed: 1 });
  const player = getState(g, 'player');
  player.treasury = 1; // too poor
  const region = Object.keys(g.regions).find((id) => g.regions[id].ownerStateId === 'player');
  const res = recruitUnit(g, 'player', 'armor', region);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'insufficient_funds');
});

test('recruitUnit rejects region not owned', () => {
  const g = newGame({ seed: 1 });
  const enemyRegion = Object.keys(g.regions).find((id) => g.regions[id].ownerStateId !== 'player');
  const res = recruitUnit(g, 'player', 'infantry', enemyRegion);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'region_not_owned');
});

test('setTaxRate clamps and investSector clamps', () => {
  const g = newGame({ seed: 1 });
  assert.equal(setTaxRate(g, 'player', 2).taxRate, 1);
  assert.equal(setTaxRate(g, 'player', -1).taxRate, 0);
  const inv = investSector(g, 'player', 'industry', 1000);
  assert.equal(inv.value, 100);
  assert.equal(investSector(g, 'player', 'nope', 10).ok, false);
});

test('economyTick conservation: treasury delta equals netTreasury', () => {
  const g = newGame({ seed: 1 });
  const player = getState(g, 'player');
  const before = player.treasury;
  const bd = economyTick(g, 'player');
  assert.ok(bd.ok);
  const delta = player.treasury - before;
  assert.ok(Math.abs(delta - bd.netTreasury) < 1e-6, `delta ${delta} vs net ${bd.netTreasury}`);
  // netTreasury must equal revenue minus all outflows
  const expectedNet = bd.revenue.taxRevenue - bd.militaryBudget - bd.intelBudget - bd.rnd - bd.upkeep;
  assert.ok(Math.abs(bd.netTreasury - expectedNet) < 1e-6);
  // approval stays within bounds
  assert.ok(player.approval >= 0 && player.approval <= 100);
});

// ---------------------------------------------------------------------------
// Military movement & summaries
// ---------------------------------------------------------------------------

test('listRecruitableUnits reports affordability', () => {
  const g = newGame({ seed: 1 });
  const list = listRecruitableUnits(g, 'player');
  assert.equal(list.length, Object.keys(UNIT_TYPES).length);
  assert.ok(list.find((x) => x.key === 'infantry').affordable);
});

test('moveUnit obeys adjacency and movedThisTurn', () => {
  const g = newGame({ seed: 1 });
  const player = getState(g, 'player');
  const unit = player.military.units[0];
  const from = getRegion(g, unit.regionId);
  const adj = from.adjacency[0];
  const res = moveUnit(g, 'player', unit.id, adj);
  assert.ok(res.ok, `expected move ok, got ${res.reason}`);
  assert.equal(unit.regionId, adj);
  assert.ok(unit.movedThisTurn);
  // second move blocked
  const again = moveUnit(g, 'player', unit.id, from.id);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already_moved');
  // reset then non-adjacent blocked
  resetMovement(g, 'player');
  const faraway = Object.keys(g.regions).find((id) => id !== adj && !getRegion(g, adj).adjacency.includes(id));
  const bad = moveUnit(g, 'player', unit.id, faraway);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'not_adjacent');
});

test('forceSummary aggregates units', () => {
  const g = newGame({ seed: 1 });
  const s = forceSummary(g, 'player');
  assert.ok(s.totalUnits > 0);
  assert.ok(s.rawPower > 0);
  assert.ok(s.totalUpkeep > 0);
});

test('resolveBattle is a declared stub (not implemented yet)', () => {
  const g = newGame({ seed: 1 });
  const rng = createRng(1);
  const res = resolveBattle(g, 'player', Object.keys(g.regions)[0], [], rng);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not_implemented');
  assert.equal(typeof resolveBattle, 'function');
  assert.equal(resolveBattle.length, 5); // signature arity preserved
});
