// ui-smoke.test.mjs
// Environment-agnostic smoke tests for the UI-adjacent pure modules: i18n.js
// (string table + t()) and save.js (serialize/deserialize round-trip). These
// run under node:test with NO DOM: they import only the pure parts. DOM-only
// helpers (download/import/localStorage) are not exercised here; they are
// isolated behind environment checks in the modules themselves.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newGame } from '../src/engine/state.js';
import { endTurn } from '../src/engine/turn.js';
import {
  STRINGS,
  LANGUAGES,
  t,
  toggleLang,
  setLang,
  currentLang,
  checkKeyParity,
} from '../src/ui/i18n.js';
import { serializeGame, deserializeGame, SAVE_KEY } from '../src/engine/save.js';

test('i18n: both language tables exist and share identical key sets', () => {
  assert.ok(STRINGS.de && STRINGS.en, 'both tables present');
  const parity = checkKeyParity();
  assert.deepEqual(parity.missingInEn, [], 'no DE keys missing from EN');
  assert.deepEqual(parity.missingInDe, [], 'no EN keys missing from DE');
  assert.ok(parity.ok);
  assert.deepEqual(LANGUAGES, ['de', 'en']);
});

test('i18n: t() resolves active language, falls back to EN, then to the key', () => {
  const de = newGame({ seed: 1, lang: 'de' });
  const en = newGame({ seed: 1, lang: 'en' });
  assert.equal(t(de, 'topbar.treasury'), 'Staatskasse');
  assert.equal(t(en, 'topbar.treasury'), 'Treasury');
  // Unknown key returns the key itself (visible typo, not a silent blank).
  assert.equal(t(de, 'does.not.exist'), 'does.not.exist');
  // Placeholder substitution works.
  STRINGS.de['__test.ph'] = 'Hallo {name}';
  assert.equal(t(de, '__test.ph', { name: 'Welt' }), 'Hallo Welt');
  delete STRINGS.de['__test.ph'];
});

test('i18n: default language is German when unset or invalid', () => {
  assert.equal(currentLang(undefined), 'de');
  assert.equal(currentLang({ settings: { lang: 'xx' } }), 'de');
});

test('i18n: toggleLang / setLang flip settings.lang', () => {
  const g = newGame({ seed: 1, lang: 'de' });
  assert.equal(toggleLang(g), 'en');
  assert.equal(g.settings.lang, 'en');
  assert.equal(toggleLang(g), 'de');
  assert.equal(setLang(g, 'en'), 'en');
  assert.equal(setLang(g, 'bogus'), 'en'); // ignored
});

test('i18n: no em dashes appear in any UI string', () => {
  for (const lang of LANGUAGES) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      assert.ok(!String(value).includes('\u2014'), `em dash in ${lang}.${key}`);
    }
  }
});

test('save: serialize/deserialize round-trips an exact GameState', () => {
  const g = newGame({ seed: 4242, lang: 'de' });
  const json = serializeGame(g, false);
  const back = deserializeGame(json);
  assert.deepEqual(back, g, 'round-trip is identical');
  assert.equal(back.seed, 4242, 'seed preserved');
  assert.equal(back.turn, g.turn, 'turn preserved');
});

test('save: pretty export also round-trips and preserves seed', () => {
  const g = newGame({ seed: 7, lang: 'en' });
  const pretty = serializeGame(g, true);
  assert.ok(pretty.includes('\n'), 'pretty output is multi-line');
  const back = deserializeGame(pretty);
  assert.deepEqual(back, g);
});

test('save: a loaded mid-game continues deterministically from the same seed', () => {
  // Play a few turns, save, then verify endTurn from the reloaded state matches
  // endTurn from the live state (same seed => identical next state).
  let g = newGame({ seed: 99, lang: 'en' });
  g = endTurn(g, []);
  g = endTurn(g, []);
  const saved = serializeGame(g);
  const reloaded = deserializeGame(saved);
  const liveNext = endTurn(g, []);
  const reloadedNext = endTurn(reloaded, []);
  assert.deepEqual(reloadedNext, liveNext, 'determinism preserved across save/load');
});

test('save: deserialize accepts a bare GameState and rejects garbage', () => {
  const g = newGame({ seed: 1, lang: 'de' });
  const bare = JSON.stringify(g);
  assert.deepEqual(deserializeGame(bare), g, 'bare state loads');
  assert.throws(() => deserializeGame('not json'), /invalid_json/);
  assert.throws(() => deserializeGame('{"foo":1}'), /invalid_save_shape/);
  assert.equal(typeof SAVE_KEY, 'string');
});
