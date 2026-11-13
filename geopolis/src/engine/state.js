// state.js
// GameState factory + selectors + deepClone.
// Builds the full initial GameState (DESIGN section 4) from the static data
// modules. No UI imports, no randomness required for the layout (the world is
// deterministic); the seed is stored so later systems can derive an RNG.

import { makeInitialWorld } from '../data/world.js';
import { UNIT_TYPES } from '../data/unitTypes.js';

export const GAME_VERSION = 1;

/** Starting economic/political defaults applied to every state. */
const STATE_DEFAULTS = {
  treasury: 5000,
  gdp: 1000,
  taxRate: 0.3,
  sectors: { industry: 40, services: 40, agriculture: 30, energy: 30 },
  approval: 60,
  population: 5_000_000,
  // Budgets are calibrated against the tax-collection factor in formulas.js so
  // that a reasonably played state runs close to break-even at the starting
  // numbers (see README / DESIGN economy notes). Tuning these three plus the
  // collection factor keeps the economy solvent instead of unbounded-negative.
  militaryBudget: 120,
  rnd: 60,
  intelBudget: 40,
  agents: 2,
  counterIntel: 10,
};

/**
 * Starting garrison each state fields. Each entry is [unitType, regionIndex]
 * where regionIndex selects which owned region (0 = capital) the unit starts
 * in. Garrisons are concentrated so that a frontier region is not a one-unit
 * paper target: every region gets a defender and the capital is held in force.
 * This gives a new (even passive) player several turns of runway rather than
 * losing a region to the first enemy stack. Recruitment expands forces in play.
 */
const STARTING_FORCE = [
  ['infantry', 0],
  ['infantry', 0],
  ['armor', 0],
  ['infantry', 1],
  ['armor', 1],
  ['infantry', 2],
  ['infantry', 2],
];

/**
 * Deep clone a plain-data value (GameState and its parts are JSON-safe).
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Build a fresh Unit for a state in a region.
 * @param {string} idSuffix unique-per-game id fragment
 * @param {string} type unit type key
 * @param {string} regionId
 * @returns {object}
 */
function makeUnit(idSuffix, type, regionId) {
  const def = UNIT_TYPES[type];
  const maxStrength = def ? def.maxStrength : 100;
  return {
    id: `u_${idSuffix}`,
    type,
    strength: maxStrength,
    maxStrength,
    experience: 0,
    regionId,
    movedThisTurn: false,
  };
}

/**
 * Create a brand-new GameState.
 * @param {{seed?: number|string, lang?: 'de'|'en'}} [opts]
 * @returns {object} GameState
 */
export function newGame(opts = {}) {
  const { seed = 1, lang = 'en' } = opts;
  const world = makeInitialWorld();

  /** @type {Object<string, object>} */
  const regions = world.regions;

  // Group owned regions per state so we can place starting units sensibly.
  const regionsByOwner = {};
  for (const regionId of Object.keys(regions)) {
    const owner = regions[regionId].ownerStateId;
    (regionsByOwner[owner] ||= []).push(regionId);
  }

  const stateIds = world.states.map((s) => s.id);

  /** @type {Object<string, object>} */
  const states = {};
  let unitCounter = 0;

  for (const seedState of world.states) {
    const id = seedState.id;
    const ownedRegions = regionsByOwner[id] || [];

    // Neutral relations toward every other state; empty self relation omitted.
    const relations = {};
    const knownInfo = {};
    for (const otherId of stateIds) {
      if (otherId === id) continue;
      relations[otherId] = 0;
      knownInfo[otherId] = null;
    }

    // Place the starting garrison, concentrating per the [type, regionIndex]
    // layout above and clamping the index to the regions the state owns.
    const units = [];
    STARTING_FORCE.forEach(([type, regionIndex]) => {
      if (!ownedRegions.length) return;
      const regionId = ownedRegions[Math.min(regionIndex, ownedRegions.length - 1)];
      units.push(makeUnit(`${id}_${unitCounter++}`, type, regionId));
    });

    states[id] = {
      id,
      name: seedState.name,
      flagColor: seedState.flagColor,
      isPlayer: !!seedState.isPlayer,
      isAI: !seedState.isPlayer,
      treasury: STATE_DEFAULTS.treasury,
      economy: {
        gdp: STATE_DEFAULTS.gdp,
        taxRate: STATE_DEFAULTS.taxRate,
        sectors: { ...STATE_DEFAULTS.sectors },
      },
      approval: STATE_DEFAULTS.approval,
      population: STATE_DEFAULTS.population,
      military: {
        budget: STATE_DEFAULTS.militaryBudget,
        rnd: STATE_DEFAULTS.rnd,
        techLevels: { infantry: 0, armor: 0, air: 0, navy: 0, missile: 0 },
        researchPoints: { infantry: 0, armor: 0, air: 0, navy: 0, missile: 0 },
        units,
      },
      intel: {
        budget: STATE_DEFAULTS.intelBudget,
        agents: STATE_DEFAULTS.agents,
        counterIntel: STATE_DEFAULTS.counterIntel,
        knownInfo,
      },
      diplomacy: {
        relations,
        treaties: [],
      },
      atWarWith: [],
    };
  }

  const playerStateId = stateIds.includes('player') ? 'player' : stateIds[0];

  return {
    version: GAME_VERSION,
    seed,
    turn: 1,
    phase: 'player',
    playerStateId,
    selectedRegionId: null,
    states,
    regions,
    log: [],
    pendingBattles: [],
    settings: { lang },
  };
}

// ---------------------------------------------------------------------------
// Selectors (read-only helpers; never mutate)
// ---------------------------------------------------------------------------

/** @returns {object|undefined} */
export function getState(gameState, stateId) {
  return gameState.states[stateId];
}

/** @returns {object|undefined} */
export function getRegion(gameState, regionId) {
  return gameState.regions[regionId];
}

/** @returns {object|undefined} */
export function getPlayerState(gameState) {
  return gameState.states[gameState.playerStateId];
}

/**
 * All units currently located in a region, across all states.
 * @returns {object[]}
 */
export function unitsInRegion(gameState, regionId) {
  const result = [];
  for (const stateId of Object.keys(gameState.states)) {
    for (const unit of gameState.states[stateId].military.units) {
      if (unit.regionId === regionId) {
        result.push({ ...unit, ownerStateId: stateId });
      }
    }
  }
  return result;
}

/**
 * All units owned by a state.
 * @returns {object[]}
 */
export function unitsOfState(gameState, stateId) {
  const st = gameState.states[stateId];
  return st ? st.military.units : [];
}
