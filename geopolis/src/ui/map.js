// map.js
// Inline SVG world map rendered purely from GameState. Regions are drawn as
// circles at their x/y coordinates, adjacency as lines, owner shown by color,
// unit counts as a small badge. The selected region is highlighted, and valid
// move/attack targets for the current selection are outlined. Clicking a region
// sets gameState.selectedRegionId (via the provided onSelect callback) and the
// controller re-renders. No hidden UI state lives here.

import { getState, getRegion, unitsInRegion } from '../engine/state.js';
import { el, clear } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 920;
const VIEW_H = 700;

/** Create an SVG element with attributes. */
function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

/**
 * Compute the set of regions adjacent to the player's units (valid move/attack
 * targets) given the currently selected region. We highlight neighbors of the
 * selected region when it is owned by the player (move/attack reach from there).
 * @param {object} game
 * @returns {{moveTargets:Set<string>, attackTargets:Set<string>}}
 */
function computeTargets(game) {
  const moveTargets = new Set();
  const attackTargets = new Set();
  const sel = game.selectedRegionId;
  if (!sel) return { moveTargets, attackTargets };
  const region = getRegion(game, sel);
  if (!region) return { moveTargets, attackTargets };
  const player = game.playerStateId;
  // If the player has any units in the selected region, its neighbors are reach.
  const hasPlayerUnits = unitsInRegion(game, sel).some((u) => u.ownerStateId === player);
  if (!hasPlayerUnits) return { moveTargets, attackTargets };
  for (const adj of region.adjacency) {
    const adjRegion = getRegion(game, adj);
    if (!adjRegion) continue;
    if (adjRegion.ownerStateId === player) moveTargets.add(adj);
    else attackTargets.add(adj);
  }
  return { moveTargets, attackTargets };
}

/**
 * Render the map into the given container.
 * @param {HTMLElement} container the #map element
 * @param {object} game GameState
 * @param {(regionId:string)=>void} onSelect called when a region is clicked
 */
export function renderMap(container, game, onSelect) {
  clear(container);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    class: 'map-svg',
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  });

  // Adjacency lines (drawn first, under the nodes).
  const drawn = new Set();
  for (const regionId of Object.keys(game.regions)) {
    const r = game.regions[regionId];
    for (const adj of r.adjacency) {
      const key = regionId < adj ? `${regionId}|${adj}` : `${adj}|${regionId}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const b = game.regions[adj];
      if (!b) continue;
      svg.appendChild(
        svgEl('line', { x1: r.x, y1: r.y, x2: b.x, y2: b.y, class: 'map-edge' })
      );
    }
  }

  const { moveTargets, attackTargets } = computeTargets(game);

  // Region nodes.
  for (const regionId of Object.keys(game.regions)) {
    const r = game.regions[regionId];
    const owner = getState(game, r.ownerStateId);
    const color = owner ? owner.flagColor : '#888';
    const selected = game.selectedRegionId === regionId;
    const isMove = moveTargets.has(regionId);
    const isAttack = attackTargets.has(regionId);

    const units = unitsInRegion(game, regionId);
    const unitCount = units.length;

    const g = svgEl('g', { class: 'map-node', 'data-region': regionId });
    g.style.cursor = 'pointer';
    g.addEventListener('click', () => onSelect(regionId));

    let ringClass = 'map-region';
    if (selected) ringClass += ' selected';
    if (isMove) ringClass += ' move-target';
    if (isAttack) ringClass += ' attack-target';

    g.appendChild(
      svgEl('circle', {
        cx: r.x,
        cy: r.y,
        r: 30,
        class: ringClass,
        fill: color,
      })
    );

    // Terrain hint (small letter) + region name label.
    g.appendChild(
      svgEl('text', { x: r.x, y: r.y + 4, class: 'map-terrain', 'text-anchor': 'middle' }, [
        document.createTextNode(terrainGlyph(r.terrain)),
      ])
    );
    g.appendChild(
      svgEl('text', { x: r.x, y: r.y + 48, class: 'map-label', 'text-anchor': 'middle' }, [
        document.createTextNode(r.name),
      ])
    );

    // Unit-count badge.
    if (unitCount > 0) {
      g.appendChild(svgEl('circle', { cx: r.x + 24, cy: r.y - 24, r: 11, class: 'map-badge' }));
      g.appendChild(
        svgEl('text', { x: r.x + 24, y: r.y - 20, class: 'map-badge-text', 'text-anchor': 'middle' }, [
          document.createTextNode(String(unitCount)),
        ])
      );
    }

    svg.appendChild(g);
  }

  container.appendChild(svg);

  // A compact legend of states so colors are readable.
  const legend = el('div', { class: 'map-legend' });
  for (const id of Object.keys(game.states)) {
    const s = game.states[id];
    legend.appendChild(
      el('span', { class: 'legend-item' }, [
        el('span', { class: 'legend-swatch', attrs: { style: `background:${s.flagColor}` } }),
        el('span', { text: s.name }),
      ])
    );
  }
  container.appendChild(legend);
}

/** Short glyph per terrain for the map nodes. */
function terrainGlyph(terrain) {
  switch (terrain) {
    case 'mountain':
      return '^';
    case 'forest':
      return 'Y';
    case 'urban':
      return '#';
    case 'coast':
      return '~';
    default:
      return '.';
  }
}
