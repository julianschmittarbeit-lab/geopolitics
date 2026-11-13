// save.js
// Persistence for GameState: localStorage quick-save/load plus JSON file
// export/import. The serialization core (serializeGame / deserializeGame) is
// pure and DOM-free so it can be unit tested under node:test; the browser-only
// pieces (localStorage, Blob download, FileReader) are thin wrappers around it
// and degrade gracefully when those globals are absent.
//
// Round-trip guarantee: deserializeGame(serializeGame(g)) deep-equals g,
// including seed, turn, log and RNG-relevant fields, so a loaded game continues
// deterministically from exactly where it was saved.

import { GAME_VERSION } from './state.js';

/** localStorage key used for the quick-save slot. */
export const SAVE_KEY = 'geopolis.save.v1';

/** A small wrapper envelope so we can version save files independently. */
const SAVE_FORMAT = 'geopolis-save';

/**
 * Serialize a GameState into a JSON string wrapped in a small envelope.
 * Pure: does not touch the DOM, localStorage, or the filesystem.
 * @param {object} gameState
 * @param {boolean} [pretty=false] pretty-print (for file export)
 * @returns {string}
 */
export function serializeGame(gameState, pretty = false) {
  const envelope = {
    format: SAVE_FORMAT,
    gameVersion: typeof gameState.version === 'number' ? gameState.version : GAME_VERSION,
    savedAt: null, // left null to keep serialization deterministic/testable
    state: gameState,
  };
  return JSON.stringify(envelope, null, pretty ? 2 : 0);
}

/**
 * Parse a serialized save string back into a GameState. Accepts both the
 * envelope form produced by serializeGame and a bare GameState object (so hand
 * written or older saves still load). Throws on invalid JSON / shape.
 * @param {string} json
 * @returns {object} GameState
 */
export function deserializeGame(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error('invalid_json');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid_save');

  // Envelope form?
  const state = parsed.format === SAVE_FORMAT && parsed.state ? parsed.state : parsed;

  if (typeof state.turn !== 'number' || !state.states || !state.regions || !state.settings) {
    throw new Error('invalid_save_shape');
  }
  return state;
}

// ---------------------------------------------------------------------------
// Browser-only wrappers. Each checks for the relevant global so importing this
// module under node (for tests) is safe; the pure functions above do the work.
// ---------------------------------------------------------------------------

/** True if a usable localStorage exists in this environment. */
export function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch (e) {
    return false;
  }
}

/**
 * Quick-save the game to localStorage. Returns {ok, reason?}.
 * @param {object} gameState
 */
export function saveGame(gameState) {
  if (!hasLocalStorage()) return { ok: false, reason: 'no_local_storage' };
  try {
    localStorage.setItem(SAVE_KEY, serializeGame(gameState, false));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'write_failed' };
  }
}

/**
 * Load the quick-save from localStorage, or null if none / invalid.
 * @returns {object|null} GameState
 */
export function loadGame() {
  if (!hasLocalStorage()) return null;
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    return deserializeGame(raw);
  } catch (e) {
    return null;
  }
}

/** True if a quick-save is present. */
export function hasSavedGame() {
  if (!hasLocalStorage()) return false;
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch (e) {
    return false;
  }
}

/** Remove the quick-save slot. */
export function clearSave() {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    /* ignore */
  }
}

/**
 * Export the game as a downloadable JSON file (browser only). Builds a Blob and
 * triggers a download via a temporary anchor. No-op return under node.
 * @param {object} gameState
 * @param {string} [filename]
 * @returns {{ok:boolean, reason?:string, filename?:string}}
 */
export function exportGame(gameState, filename) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    return { ok: false, reason: 'no_dom' };
  }
  const name = filename || `geopolis-turn${gameState.turn}-seed${gameState.seed}.json`;
  const blob = new Blob([serializeGame(gameState, true)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { ok: true, filename: name };
}

/**
 * Import a game from a File (browser only, via FileReader). Resolves with the
 * parsed GameState or rejects with an Error.
 * @param {File} file
 * @returns {Promise<object>} GameState
 */
export function importGame(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('no_file_reader'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(deserializeGame(String(reader.result)));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsText(file);
  });
}
