// main.js
// Bootstrap for FEAT-001: import the engine, create a new game, and log a
// readable summary. Full UI wiring (map/panels/log) arrives in FEAT-003.

import { newGame, getPlayerState, unitsOfState } from './engine/state.js';
import { forceSummary } from './engine/military.js';

/**
 * Build a plain summary object for a fresh game (used for the console log and
 * easy to assert against in a browser smoke test).
 * @param {object} game
 * @returns {object}
 */
export function newGameSummary(game) {
  const player = getPlayerState(game);
  return {
    version: game.version,
    seed: game.seed,
    turn: game.turn,
    lang: game.settings.lang,
    states: Object.keys(game.states).length,
    regions: Object.keys(game.regions).length,
    player: player ? player.name : null,
    playerTreasury: player ? player.treasury : null,
    playerUnits: player ? unitsOfState(game, player.id).length : 0,
    playerForce: player ? forceSummary(game, player.id) : null,
  };
}

function boot() {
  const game = newGame({ seed: 1, lang: 'en' });
  const summary = newGameSummary(game);
  // eslint-disable-next-line no-console
  console.log('[GEOPOLIS] New game ready:', summary);

  // Surface a tiny bit of text so the page is not blank before FEAT-003.
  if (typeof document !== 'undefined') {
    const topbar = document.getElementById('topbar');
    if (topbar) {
      topbar.textContent = `GEOPOLIS - ${summary.player} | Treasury ${summary.playerTreasury} | Turn ${summary.turn} | ${summary.states} states, ${summary.regions} regions`;
    }
    const log = document.getElementById('log');
    if (log) {
      log.textContent = 'Foundation loaded. Full UI arrives in a later milestone step.';
    }
  }

  return game;
}

// Run automatically in the browser; stay quiet when imported by tests/node.
if (typeof document !== 'undefined') {
  boot();
}

export { boot };
