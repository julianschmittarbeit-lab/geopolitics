# GEOPOLIS — Design & Roadmap

> A browser-based turn-based geopolitical strategy game. Military-focused, with
> coupled Diplomacy, Intelligence, and Economy subsystems. Inspired by the genre
> of "grand strategy / head-of-state" simulators, but an **original** game: it
> deliberately avoids the common weaknesses of such games (overloaded UI,
> black-box combat, weak AI, broken numbers) and keeps every mechanic
> **transparent and explainable**.

Status: living document. Milestone 1 is the first fully playable version.

---

## 1. Design pillars

1. **Military first.** The deepest, most detailed subsystem. Units, recruitment,
   R&D, budget, movement on a map, wars, and **transparent battle resolution**
   (the player can always see the exact math behind an outcome).
2. **No black boxes.** Every computed number (battle odds, economic output,
   diplomatic acceptance, intel success chance) is derived from a documented
   formula and surfaced in the UI via tooltips / breakdown panels.
3. **Readable UI.** One screen, a left map, a right context panel, a top status
   bar, a bottom action/log bar. No nested menu mazes. Progressive disclosure:
   show summaries, expand for detail on demand.
4. **Understandable AI.** AI states use a transparent utility/scoring model with
   named factors. Decisions are logged so the player (and the developer) can see
   *why* the AI did something.
5. **Self-contained.** Pure client-side. No backend, no network at runtime.
   Save/load via `localStorage` + export/import JSON file.

## 2. Tech stack & how it runs

- **Vanilla HTML + CSS + JavaScript (ES modules).** Zero build step.
- **Rendering:** DOM for UI panels; an inline **SVG map** for the world/regions
  (easy hit-testing, styling, and labels without a canvas engine).
- **State:** a single plain-object `GameState`, mutated only through reducer-style
  functions in `engine/`. The UI re-renders from state after each action.
- **Persistence:** `localStorage` for quick save; JSON export/import for files.
- **Run it:** because ES modules are blocked on `file://` by browser CORS, run a
  static server from the project folder:
  - `python3 -m http.server 8000` then open `http://localhost:8000/`
  - or `npx serve` / any static server.
  The README documents this.

Rationale for zero-build: lowest friction, guaranteed to run anywhere with a
browser + a trivial static server, no toolchain/network dependency. A bundler
adds nothing essential at this scope.

## 3. Project layout

```
geopolis/
├── index.html              # app shell + root containers
├── styles/
│   ├── base.css            # layout, variables, typography
│   └── components.css      # panels, buttons, map, tooltips
├── src/
│   ├── main.js             # bootstrap: load state, wire UI, start loop
│   ├── engine/
│   │   ├── state.js        # GameState shape, new-game factory
│   │   ├── economy.js      # budget, taxes, sectors, approval
│   │   ├── military.js     # units, recruitment, R&D, movement, battle
│   │   ├── diplomacy.js    # relations, treaties, war/peace, alliances
│   │   ├── intel.js        # espionage ops, counter-intel, info
│   │   ├── ai.js           # AI state decision logic (utility model)
│   │   ├── turn.js         # end-turn pipeline (resolve order)
│   │   ├── rng.js          # seeded RNG (reproducible, testable)
│   │   └── formulas.js     # ALL numeric formulas, pure functions
│   ├── data/
│   │   ├── world.js        # regions, adjacency, starting states
│   │   ├── unitTypes.js    # unit definitions & stats
│   │   └── techs.js        # R&D tree
│   └── ui/
│       ├── map.js          # SVG map render + interaction
│       ├── panels.js       # context panels (state, military, economy…)
│       ├── topbar.js       # resources / turn indicator
│       ├── log.js          # event log / battle report viewer
│       ├── dialogs.js      # modal dialogs (diplomacy, war, intel)
│       └── i18n.js         # German/English strings
├── tests/
│   └── *.test.mjs          # node:test unit tests for engine + formulas
├── docs/DESIGN.md          # this file
└── README.md               # how to run + how to play
```

## 4. Data model (GameState)

```
GameState {
  version: number,
  seed: number,
  turn: number,                 // 1-based round counter
  phase: 'player' | 'resolving',
  playerStateId: string,
  selectedRegionId: string|null,
  states: { [id]: State },
  regions: { [id]: Region },
  log: LogEntry[],              // newest first
  pendingBattles: BattleReport[],
  settings: { lang: 'de'|'en' }
}

State {
  id, name, flagColor,
  isPlayer: bool, isAI: bool,
  treasury: number,             // money
  economy: {
    gdp, taxRate (0..1),
    sectors: { industry, services, agriculture, energy } // 0..100 investment
  },
  approval: number,             // 0..100 public approval
  population: number,
  military: {
    budget: number,             // allocated per turn
    rnd: number,                // allocated per turn to research
    techLevels: { infantry, armor, air, navy, missile }, // integer tiers
    units: Unit[]               // actual forces
  },
  intel: {
    budget: number,
    agents: number,
    counterIntel: number,       // defensive rating
    knownInfo: { [stateId]: InfoDossier }
  },
  diplomacy: {
    relations: { [stateId]: number }, // -100..100
    treaties: Treaty[]                 // alliance, nonAggression, trade
  },
  atWarWith: string[]           // state ids
}

Unit {
  id, type: 'infantry'|'armor'|'air'|'navy'|'missile',
  strength: number,             // current manpower/health 0..max
  maxStrength, experience: number,
  regionId: string,             // where it is
  movedThisTurn: bool
}

Region {
  id, name, ownerStateId,
  adjacency: string[],          // neighboring region ids
  terrain: 'plains'|'mountain'|'forest'|'urban'|'coast',
  x, y                          // layout for SVG
}
```

## 5. Core formulas (transparent, in `formulas.js`)

All formulas are pure functions, unit-tested, and surfaced in UI breakdowns.

### 5.1 Economy
- `gdp = base * (1 + 0.004*sum(sectorInvestments)) * (0.6 + 0.4*approval/100)`
- `taxRevenue = gdp * taxRate * 0.25`
- `approvalDelta = +f(lowTax) + f(economyGrowth) - f(highTax) - f(warWeariness)`
  - High tax lowers approval; growth and winning wars raise it; losses lower it.
- `treasury += taxRevenue - militaryBudget - intelBudget - rnd - upkeep`
- `upkeep = sum(unit.upkeep)` per unit type.

### 5.2 Military R&D
- Each turn a state's `rnd` adds research points to a chosen branch.
- `techLevel` increases when accumulated points cross `cost(level) = 100 * level^1.5`.
- Higher tech multiplies unit combat power: `techMult = 1 + 0.15 * techLevel`.

### 5.3 Recruitment
- Building a unit costs money up front + raises upkeep.
- Cost/upkeep/maxStrength are per unit type in `unitTypes.js`.
- Recruitment capped by `population` and treasury.

### 5.4 Battle resolution (TRANSPARENT — the centerpiece)
Battles are resolved deterministically given a seed; every term is reported.

For attacker vs defender over a contested region:
```
power(unit) = unit.strength
            * typeBasePower[type]
            * (1 + 0.15 * techLevel[type])
            * (1 + 0.05 * experience)
            * combinedArmsBonus
            * terrainModifier[type][terrain]   // defender benefits from terrain
attackPower = sum(power(attackerUnits)) * (1 + 0.10*attackerMorale)
defensePower = sum(power(defenderUnits)) * (1 + 0.10*defenderMorale) * 1.20  // defender's edge
odds = attackPower / (attackPower + defensePower)
roll = seededRng()                        // reported
attackerWins = roll < odds
```
Casualties scale with how close the fight was:
```
intensity = 1 - abs(odds - 0.5)*? ...     // closer fight => heavier losses both sides
loserLoss = 0.35..0.70 of engaged strength
winnerLoss = loserLoss * (1 - odds or odds)  // winner loses less the stronger they were
```
- **Combined arms:** mixing infantry + armor + air gives a bonus (documented).
- **Missiles:** one-shot strike units — deal pre-battle damage then are consumed.
- **Air/Navy:** air contributes to land battles at reduced ground factor; navy
  controls coastal regions and enables amphibious attacks.
- Every battle produces a **BattleReport**: list of each modifier, the computed
  powers, the odds, the roll, and per-unit casualties. The UI shows this in full.

### 5.5 Diplomacy acceptance
- `acceptChance = base[treatyType] + relationFactor + powerFactor + bribeFactor - warFactor`
- Alliances pull both states into each other's wars (configurable).
- Relations drift toward neutral each turn and shift from actions (war declaration
  is a big negative; trade/alliance positive).

### 5.6 Intelligence
- Operation success: `p = clamp(base[op] + 0.02*agents + 0.1*relationPenalty
  - 0.03*targetCounterIntel, 0.05, 0.95)`
- Ops: `gatherInfo` (reveals dossier: treasury/military estimates),
  `sabotage` (damage economy/units), `counterIntel` (raise own defense).
- Failed ops can be **detected**, causing relation penalties — shown to player.

## 6. AI decision logic (transparent utility model)

Each AI state, on its turn, scores candidate actions and picks the best, logging
the score breakdown. Factors are named and documented:

- **Economy agent:** adjust tax rate toward a target balancing treasury vs
  approval; invest surplus into sectors with best marginal GDP return.
- **Military agent:** maintain a force ratio vs its most threatening neighbor;
  recruit when treasury allows and threat is high; fund R&D when safe.
- **Diplomacy agent:** seek alliances with states sharing a common rival; improve
  relations with strong neighbors; declare war only when `winProbability`
  (estimated from known/estimated forces) exceeds a threshold AND the target is
  valuable AND not strongly allied.
- **Intel agent:** spy on unknown strong neighbors; sabotage active enemies.
- **War agent:** when at war, move units toward weakest enemy border region and
  attack when local force ratio is favorable; sue for peace when losing badly.

Difficulty = scaling on AI budgets and aggression thresholds (future milestone).

## 7. Turn pipeline (`turn.js`)

End-turn order (deterministic):
1. Player actions are already applied during their turn.
2. For each AI state (in fixed order): run AI agents to queue actions.
3. Resolve diplomacy changes (treaties, declarations).
4. Resolve intel operations (both player's queued and AI's).
5. Resolve all movements, then all battles for contested regions.
6. Economy tick: compute GDP, revenue, upkeep, approval; update treasuries.
7. R&D tick: apply research points, level up techs.
8. Increment turn counter; check victory/defeat conditions.
9. Produce a turn summary in the log.

## 8. UI layout

```
┌──────────────────────────────────────────── Top bar ───────────────────────┐
│ State name | Treasury | GDP | Approval | Turn N | [End Turn]                 │
├───────────────────────────────┬─────────────────────────────────────────────┤
│                               │  Context panel (tabs):                       │
│          SVG MAP              │   • Overview  • Military  • Economy           │
│   (regions, units, selection) │   • Diplomacy • Intel                        │
│                               │  (shows breakdowns & actions for selection)   │
├───────────────────────────────┴─────────────────────────────────────────────┤
│  Event log / battle reports (expandable), language toggle (DE/EN)            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Clicking a region selects it; the context panel shows its state, its units, and
contextual actions (move, attack, recruit, diplomacy, spy). Tooltips everywhere
show the formula breakdown for any number.

## 9. Victory / defeat (Milestone 1)

- **Defeat:** player loses all regions, or approval hits 0 for 3 consecutive turns.
- **Victory:** player controls a target share of regions (e.g. 60%), or is the
  last/dominant power after a turn limit.

## 10. Milestone roadmap

### Milestone 1 — Fully playable vertical slice (THIS DELIVERY)
Map of ~10–14 regions, 4–5 states (1 player + 3–4 AI). All four subsystems
present and coupled: economy (tax/sectors/approval/treasury), military (5 unit
types, recruit, R&D, move, transparent battles, war/peace), diplomacy (relations,
alliance + non-aggression + peace, declare war), intel (gather info, sabotage,
counter-intel). Transparent AI opponents. Turn loop. Save/load (localStorage +
file). Readable DE/EN UI with formula breakdowns. Unit tests for engine+formulas.

### Milestone 2 — Depth
Larger map, more unit subtypes & combined-arms nuance, supply/logistics,
unit experience & veterancy UI, richer tech tree, multiple treaty types, trade
deals, embargoes, UN-style votes, more intel ops (coup, disinformation),
difficulty levels, event system (random/world events).

### Milestone 3 — Breadth & polish
More states & a real geographic map, domestic politics (elections, parties,
laws), media/propaganda, detailed budgets, scenarios/campaigns, scripting for
events, accessibility & localization pass, balance tuning via telemetry.

### Milestone 4 — Advanced
Naval/air theatres as first-class maps, nuclear deterrence & doctrines,
coalition warfare, long diplomacy chains, modding data files, optional PWA
packaging for offline install.
```
