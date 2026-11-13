# GEOPOLIS

A browser-based, turn-based geopolitical strategy game. Client-side only, zero
build step, no runtime dependencies. Military-focused, with coupled diplomacy,
intelligence, and economy subsystems and fully transparent, explainable math.

See `docs/DESIGN.md` for the authoritative architecture, data model, formulas,
and roadmap.

## Run it

ES modules cannot load from `file://` (browser CORS blocks them), so serve the
folder with any static server:

```
cd geopolis
python3 -m http.server 8000
```

Then open [http://localhost:8000/](http://localhost:8000/).

At this milestone the page boots the engine, creates a new game, and logs a
summary to the browser console. The full interactive UI (map, panels, log)
arrives in a later feature.

## Project status

This is Milestone 1, feature 1 (the foundation): seeded RNG, static data
(unit types, tech tree, world map), the core `GameState` model, pure numeric
formulas, and the economy/military recruitment and movement engine. Battle
resolution is stubbed with its final signature and is implemented next.

## Develop / test

Node 22 is used for the test suite (the game itself needs only a browser).

```
cd geopolis
npm test
```

`npm test` runs the Node built-in test runner over `tests/**/*.test.mjs`.
The equivalent explicit command is:

```
node --test 'tests/**/*.test.mjs'
```

Note: on this Node build, `node --test tests/` (a bare directory argument) is
interpreted as a single module to execute rather than a directory to scan, so
use the glob form above (or plain `node --test` from the project root, which
auto-discovers the test files).

Syntax-check every source file:

```
for f in $(find src -name '*.js'); do node --check "$f" || echo FAIL:$f; done
```
