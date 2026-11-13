// world.js
// Static world definition: 12 regions grouped into 4 states (1 player + 3 AI).
// Adjacency is declared once per edge in EDGES and expanded symmetrically by
// makeInitialWorld(), so the data cannot drift out of sync. The edge graph is
// connected (every region reachable from every other).
//
// Coordinates (x, y) are abstract SVG layout positions on a ~1000x700 canvas.

/**
 * Region definitions. ownerStateId ties each region to a starting state.
 * terrain is one of plains|mountain|forest|urban|coast.
 */
const REGION_DEFS = [
  // --- Northland (player) : north-west cluster ---
  { id: 'r_north_capital', name: 'Northaven', terrain: 'urban', owner: 'player', x: 220, y: 120 },
  { id: 'r_north_hills', name: 'Greyhills', terrain: 'mountain', owner: 'player', x: 360, y: 90 },
  { id: 'r_north_coast', name: 'Coldport', terrain: 'coast', owner: 'player', x: 120, y: 230 },

  // --- Eastmark (AI) : north-east cluster ---
  { id: 'r_east_capital', name: 'Eastmark City', terrain: 'urban', owner: 'eastmark', x: 640, y: 130 },
  { id: 'r_east_plains', name: 'Goldfields', terrain: 'plains', owner: 'eastmark', x: 800, y: 180 },
  { id: 'r_east_forest', name: 'Darkwood', terrain: 'forest', owner: 'eastmark', x: 520, y: 220 },

  // --- Southreach (AI) : south cluster ---
  { id: 'r_south_capital', name: 'Southreach', terrain: 'urban', owner: 'southreach', x: 420, y: 520 },
  { id: 'r_south_coast', name: 'Sunport', terrain: 'coast', owner: 'southreach', x: 280, y: 600 },
  { id: 'r_south_plains', name: 'Longfields', terrain: 'plains', owner: 'southreach', x: 560, y: 600 },

  // --- Westfold (AI) : west/central cluster ---
  { id: 'r_west_capital', name: 'Westfold', terrain: 'urban', owner: 'westfold', x: 180, y: 400 },
  { id: 'r_west_mountain', name: 'Ironpeak', terrain: 'mountain', owner: 'westfold', x: 340, y: 360 },
  { id: 'r_west_forest', name: 'Mistwood', terrain: 'forest', owner: 'westfold', x: 300, y: 260 },
];

/**
 * Undirected edges between regions. Each edge listed once; expanded both ways.
 * Chosen so the whole map is a single connected component and clusters touch.
 */
const EDGES = [
  // Northland internal
  ['r_north_capital', 'r_north_hills'],
  ['r_north_capital', 'r_north_coast'],
  ['r_north_hills', 'r_west_forest'],
  // Eastmark internal
  ['r_east_capital', 'r_east_plains'],
  ['r_east_capital', 'r_east_forest'],
  ['r_east_plains', 'r_east_forest'],
  // Southreach internal
  ['r_south_capital', 'r_south_coast'],
  ['r_south_capital', 'r_south_plains'],
  // Westfold internal
  ['r_west_capital', 'r_west_mountain'],
  ['r_west_capital', 'r_west_forest'],
  ['r_west_mountain', 'r_west_forest'],
  // Inter-cluster links (keep the map connected and borders contested)
  ['r_north_hills', 'r_east_forest'],
  ['r_west_forest', 'r_east_forest'],
  ['r_west_mountain', 'r_south_capital'],
  ['r_west_capital', 'r_south_coast'],
  ['r_east_forest', 'r_south_plains'],
  ['r_south_plains', 'r_west_mountain'],
  ['r_north_coast', 'r_west_capital'],
];

/**
 * Starting-state seed data. state.js expands these into full State objects.
 * flagColor is a CSS color for the SVG map.
 */
const STATE_DEFS = [
  { id: 'player', name: 'Northland', flagColor: '#2e6fb0', isPlayer: true },
  { id: 'eastmark', name: 'Eastmark', flagColor: '#b03a3a', isPlayer: false },
  { id: 'southreach', name: 'Southreach', flagColor: '#3a8f54', isPlayer: false },
  { id: 'westfold', name: 'Westfold', flagColor: '#9a7bcf', isPlayer: false },
];

/**
 * Build the initial world: a regions map with symmetric adjacency and the
 * starting-state seed list.
 * @returns {{ regions: Object<string, object>, states: object[] }}
 */
export function makeInitialWorld() {
  /** @type {Object<string, object>} */
  const regions = {};
  for (const def of REGION_DEFS) {
    regions[def.id] = {
      id: def.id,
      name: def.name,
      ownerStateId: def.owner,
      terrain: def.terrain,
      adjacency: [],
      x: def.x,
      y: def.y,
    };
  }

  // Expand edges symmetrically; ignore duplicates.
  for (const [a, b] of EDGES) {
    if (!regions[a] || !regions[b]) {
      throw new Error(`Edge references unknown region: ${a} <-> ${b}`);
    }
    if (!regions[a].adjacency.includes(b)) regions[a].adjacency.push(b);
    if (!regions[b].adjacency.includes(a)) regions[b].adjacency.push(a);
  }

  // Deep copy the state seed list so callers can mutate freely.
  const states = STATE_DEFS.map((s) => ({ ...s }));

  return { regions, states };
}

export { REGION_DEFS, STATE_DEFS, EDGES };
