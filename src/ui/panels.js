// panels.js
// The tabbed context panel (Overview / Military / Economy / Diplomacy / Intel).
// Each tab renders from GameState and wires its controls to engine functions.
// Immediate actions (recruit, move, tax, invest, counter-intel strengthening
// via its queued op) mutate state and trigger a re-render through the shared
// controller; chance-resolved actions (treaties, war, intel, attacks) are
// queued as player action descriptors resolved at end of turn by turn.endTurn.
//
// The controller passes a single `ctx` object:
//   { game, ui, actions }
// where ui holds transient selection ({ activeTab, queuedActions }) and actions
// holds callbacks: rerender(), queueAction(descriptor), unqueueAction(index),
// openBattleReport(report), notify(msgKey).

import { getState, getRegion, getPlayerState, unitsInRegion } from '../engine/state.js';
import { listRecruitableUnits, recruit, moveUnit, forceSummary, estimateWinProbability } from '../engine/military.js';
import { setTaxRate, investSector } from '../engine/economy.js';
import { getRelation, treatyAcceptChance, alliesOf, TREATY_TYPES } from '../engine/diplomacy.js';
import { runOperation, INTEL_OPS } from '../engine/intel.js';
import { intelSuccessChanceBreakdown } from '../engine/formulas.js';
import { gdpBreakdown, taxRevenueBreakdown } from '../engine/formulas.js';
import { UNIT_TYPES } from '../data/unitTypes.js';
import { t, unitTypeName } from './i18n.js';
import { el, clear, fmtInt, fmtMoney, fmtFloat, fmtPct, tooltipFromBreakdown } from './format.js';

const STATE_BASE_OUTPUT = 1000;

export const TABS = ['overview', 'military', 'economy', 'diplomacy', 'intel'];

/**
 * Render the whole context panel.
 * @param {HTMLElement} container #context-panel
 * @param {object} ctx { game, ui, actions }
 */
export function renderPanels(container, ctx) {
  clear(container);
  const { game, ui } = ctx;
  if (!TABS.includes(ui.activeTab)) ui.activeTab = 'overview';

  // Tab bar
  const tabBar = el('div', { class: 'tab-bar' });
  for (const tab of TABS) {
    tabBar.appendChild(
      el('button', {
        class: `tab ${ui.activeTab === tab ? 'active' : ''}`.trim(),
        text: t(game, `tab.${tab}`),
        onclick: () => {
          ui.activeTab = tab;
          ctx.actions.rerender();
        },
      })
    );
  }
  container.appendChild(tabBar);

  const panel = el('div', { class: 'tab-panel' });
  switch (ui.activeTab) {
    case 'military':
      renderMilitary(panel, ctx);
      break;
    case 'economy':
      renderEconomy(panel, ctx);
      break;
    case 'diplomacy':
      renderDiplomacy(panel, ctx);
      break;
    case 'intel':
      renderIntel(panel, ctx);
      break;
    default:
      renderOverview(panel, ctx);
  }
  container.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
function renderOverview(root, ctx) {
  const { game } = ctx;
  const player = getPlayerState(game);
  const sel = game.selectedRegionId ? getRegion(game, game.selectedRegionId) : null;

  // Player summary
  const force = forceSummary(game, player.id);
  root.appendChild(el('h3', { text: t(game, 'overview.playerSummary') }));
  root.appendChild(
    kv(game, [
      [t(game, 'topbar.treasury'), fmtMoney(player.treasury)],
      [t(game, 'topbar.gdp'), fmtInt(player.economy.gdp)],
      [t(game, 'topbar.approval'), `${Math.round(player.approval)}%`],
      [t(game, 'overview.population'), fmtInt(player.population)],
      [t(game, 'overview.forces'), `${force.totalUnits} (${t(game, 'intel.powerEst')} ${fmtInt(force.rawPower)})`],
      [t(game, 'overview.regionsOwned'), String(countRegions(game, player.id))],
      [t(game, 'overview.atWarWith'), namesOf(game, player.atWarWith) || t(game, 'generic.none')],
      [t(game, 'overview.allies'), namesOf(game, alliesOf(game, player.id)) || t(game, 'generic.none')],
    ])
  );

  // Selected region
  root.appendChild(el('h3', { text: t(game, 'overview.regionInfo') }));
  if (!sel) {
    root.appendChild(el('p', { class: 'muted', text: t(game, 'overview.selectRegion') }));
    return;
  }
  const owner = getState(game, sel.ownerStateId);
  root.appendChild(
    kv(game, [
      [t(game, 'generic.region'), sel.name],
      [t(game, 'generic.terrain'), sel.terrain],
      [t(game, 'generic.owner'), owner ? owner.name : t(game, 'generic.neutral')],
      [t(game, 'overview.adjacent'), sel.adjacency.map((id) => getRegion(game, id).name).join(', ')],
    ])
  );
  const units = unitsInRegion(game, sel.id);
  root.appendChild(el('h4', { text: t(game, 'overview.unitsHere') }));
  root.appendChild(unitList(game, units, true));
}

// ---------------------------------------------------------------------------
// Military
// ---------------------------------------------------------------------------
function renderMilitary(root, ctx) {
  const { game, ui, actions } = ctx;
  const player = getPlayerState(game);
  const sel = game.selectedRegionId ? getRegion(game, game.selectedRegionId) : null;

  // Tech levels
  root.appendChild(el('h3', { text: t(game, 'mil.techLevels') }));
  const tech = el('div', { class: 'chip-row' });
  for (const key of Object.keys(player.military.techLevels)) {
    tech.appendChild(
      el('span', { class: 'chip', text: `${unitTypeName(game, UNIT_TYPES[key])}: ${player.military.techLevels[key]}` })
    );
  }
  root.appendChild(tech);

  if (!sel) {
    root.appendChild(el('p', { class: 'muted', text: t(game, 'overview.selectRegion') }));
    return;
  }

  // Units in the selected region
  root.appendChild(el('h3', { text: t(game, 'mil.unitsInRegion') }));
  const unitsHere = unitsInRegion(game, sel.id);
  root.appendChild(unitList(game, unitsHere, true));

  // Units already committed to a queued attack this turn cannot be moved or
  // queued into a second attack. We reserve them here so one stack is never
  // double-spent in a single turn (transparent: reserved units are labelled).
  const reserved = reservedUnitIds(ui);

  // Move controls for player units in this region
  const playerUnitsHere = unitsHere.filter((u) => u.ownerStateId === player.id);
  if (playerUnitsHere.length > 0 && sel.adjacency.length > 0) {
    root.appendChild(el('h4', { text: t(game, 'mil.move') }));
    for (const u of playerUnitsHere) {
      const def = UNIT_TYPES[u.type];
      const row = el('div', { class: 'action-row' });
      row.appendChild(el('span', { class: 'action-label', text: `${unitTypeName(game, def)} (${u.strength})` }));
      if (reserved.has(u.id)) {
        row.appendChild(el('span', { class: 'queued-flag', text: t(game, 'mil.reservedForAttack') }));
      } else if (u.movedThisTurn) {
        row.appendChild(el('span', { class: 'muted', text: t(game, 'mil.movedThisTurn') }));
      } else {
        const select = el('select', { class: 'select' });
        for (const adj of sel.adjacency) {
          const r = getRegion(game, adj);
          select.appendChild(el('option', { value: adj, text: r.name }));
        }
        row.appendChild(select);
        row.appendChild(
          el('button', {
            class: 'btn btn-small',
            text: t(game, 'mil.move'),
            onclick: () => {
              const res = moveUnit(game, player.id, u.id, select.value);
              if (res.ok) {
                game.selectedRegionId = select.value;
                actions.rerender();
              }
            },
          })
        );
      }
      root.appendChild(row);
    }
  }

  // Attack controls: adjacent enemy regions reachable from here.
  const enemyAdjacent = sel.adjacency
    .map((id) => getRegion(game, id))
    .filter((r) => r && r.ownerStateId !== player.id);
  // Only units that have not moved AND are not already reserved for a queued
  // attack this turn are available to commit to a new attack.
  const readyAttackers = playerUnitsHere.filter((u) => !u.movedThisTurn && !reserved.has(u.id));
  if (enemyAdjacent.length > 0 && readyAttackers.length > 0) {
    root.appendChild(el('h4', { text: t(game, 'mil.attack') }));
    for (const r of enemyAdjacent) {
      const attackerIds = readyAttackers.map((u) => u.id);
      const est = estimateWinProbability(game, player.id, r.id, attackerIds);
      const already = (ui.queuedActions || []).some(
        (a) => a.type === 'attack' && a.regionId === r.id
      );
      const row = el('div', { class: 'action-row' });
      row.appendChild(
        el('span', {
          class: 'action-label',
          title:
            `${t(game, 'mil.attackPower')}: ${fmtFloat(est.attackPower, 1)}\n` +
            `${t(game, 'mil.defensePower')}: ${fmtFloat(est.defensePower, 1)}`,
          text: `${r.name}: ${t(game, 'mil.winChance')} ${fmtPct(est.odds)}`,
        })
      );
      if (already) {
        row.appendChild(el('span', { class: 'queued-flag', text: t(game, 'mil.queuedAttack') }));
      } else {
        row.appendChild(
          el('button', {
            class: 'btn btn-small btn-danger',
            text: t(game, 'mil.attack'),
            onclick: () => {
              actions.queueAction({ type: 'attack', regionId: r.id, attackingUnitIds: attackerIds });
            },
          })
        );
      }
      root.appendChild(row);
    }
  }

  // Recruit controls (only if the player owns the selected region).
  root.appendChild(el('h3', { text: t(game, 'mil.recruit') }));
  if (sel.ownerStateId !== player.id) {
    root.appendChild(el('p', { class: 'muted', text: t(game, 'mil.mustOwnRegionToRecruit') }));
    return;
  }
  const options = listRecruitableUnits(game, player.id);
  const typeSelect = el('select', { class: 'select' });
  for (const o of options) {
    typeSelect.appendChild(
      el('option', {
        value: o.key,
        text: `${unitTypeName(game, o.def)} (${t(game, 'mil.cost')} ${o.cost}, ${t(game, 'mil.upkeep')} ${o.def.upkeep})`,
      })
    );
  }
  // Default the select to the first recruitable type so value is never blank.
  if (options.length > 0 && !typeSelect.value) typeSelect.value = options[0].key;
  const preview = el('span', { class: 'muted' });
  const updatePreview = () => {
    const def = UNIT_TYPES[typeSelect.value] || (options[0] && options[0].def);
    if (!def) return;
    preview.textContent = `${t(game, 'mil.cost')}: ${def.cost} | ${t(game, 'mil.upkeep')}: ${def.upkeep} | ${t(
      game,
      'mil.popCost'
    )}: ${fmtInt(def.buildPopCost)}`;
  };
  typeSelect.addEventListener('change', updatePreview);
  updatePreview();

  const recruitRow = el('div', { class: 'action-row' }, [
    typeSelect,
    el('button', {
      class: 'btn btn-small btn-primary',
      text: t(game, 'mil.recruitHere'),
      onclick: () => {
        const res = recruit(game, player.id, typeSelect.value, sel.id);
        actions.notify(res.ok ? 'notice.recruited' : 'notice.cannotAfford');
        if (res.ok) actions.rerender();
      },
    }),
  ]);
  root.appendChild(recruitRow);
  root.appendChild(preview);
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------
function renderEconomy(root, ctx) {
  const { game, actions } = ctx;
  const player = getPlayerState(game);
  const eco = player.economy;

  // Tax slider
  root.appendChild(el('h3', { text: t(game, 'eco.taxRate') }));
  const taxValue = el('span', { class: 'slider-value', text: `${Math.round(eco.taxRate * 100)}%` });
  const slider = el('input', {
    class: 'slider',
    type: 'range',
    min: '0',
    max: '100',
    value: String(Math.round(eco.taxRate * 100)),
  });
  slider.addEventListener('input', () => {
    taxValue.textContent = `${slider.value}%`;
  });
  slider.addEventListener('change', () => {
    setTaxRate(game, player.id, Number(slider.value) / 100);
    actions.rerender();
  });
  root.appendChild(el('div', { class: 'action-row' }, [slider, taxValue]));

  // Sector investment
  root.appendChild(el('h3', { text: t(game, 'eco.sectors') }));
  for (const sector of Object.keys(eco.sectors)) {
    const row = el('div', { class: 'action-row' }, [
      el('span', { class: 'action-label', text: `${t(game, `eco.${sector}`)}: ${eco.sectors[sector]}` }),
      el('button', {
        class: 'btn btn-small',
        text: '+5',
        onclick: () => {
          investSector(game, player.id, sector, 5);
          actions.rerender();
        },
      }),
      el('button', {
        class: 'btn btn-small',
        text: '-5',
        onclick: () => {
          investSector(game, player.id, sector, -5);
          actions.rerender();
        },
      }),
    ]);
    root.appendChild(row);
  }

  // GDP + approval breakdown (transparent)
  const sumSectors = eco.sectors.industry + eco.sectors.services + eco.sectors.agriculture + eco.sectors.energy;
  const gdpBd = gdpBreakdown(STATE_BASE_OUTPUT, sumSectors, player.approval);
  const revBd = taxRevenueBreakdown(gdpBd.gdp, eco.taxRate);
  root.appendChild(el('h3', { text: t(game, 'eco.gdpBreakdown') }));
  root.appendChild(
    kv(game, [
      [t(game, 'eco.base'), fmtInt(gdpBd.base)],
      [t(game, 'eco.sectorFactor'), fmtFloat(gdpBd.sectorFactor, 3)],
      [t(game, 'eco.approvalFactor'), fmtFloat(gdpBd.approvalFactor, 3)],
      [t(game, 'topbar.gdp'), fmtInt(gdpBd.gdp)],
      [t(game, 'eco.revenue'), fmtInt(revBd.taxRevenue)],
    ])
  );
}

// ---------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------
function renderDiplomacy(root, ctx) {
  const { game, ui, actions } = ctx;
  const player = getPlayerState(game);

  root.appendChild(el('h3', { text: t(game, 'dip.relations') }));
  const others = Object.keys(game.states).filter((id) => id !== player.id);

  for (const otherId of others) {
    const other = getState(game, otherId);
    const rel = getRelation(game, player.id, otherId);
    const atWar = player.atWarWith.includes(otherId);
    const card = el('div', { class: 'relation-card' });

    const head = el('div', { class: 'relation-head' }, [
      el('span', { class: 'relation-name', attrs: { style: `border-color:${other.flagColor}` }, text: other.name }),
      el('span', { class: `relation-value ${rel < 0 ? 'neg' : 'pos'}`, text: `${t(game, 'dip.relation')} ${rel}` }),
      atWar ? el('span', { class: 'war-flag', text: t(game, 'dip.atWar') }) : null,
    ]);
    card.appendChild(head);

    // Treaty proposer: type dropdown + bribe + accept-chance preview.
    const typeSelect = el('select', { class: 'select' });
    for (const type of TREATY_TYPES) {
      typeSelect.appendChild(el('option', { value: type, text: t(game, `dip.${type}`) }));
    }
    if (!typeSelect.value) typeSelect.value = TREATY_TYPES[0];
    const bribeInput = el('input', { class: 'input-small', type: 'number', min: '0', step: '100', value: '0' });
    const chanceLabel = el('span', { class: 'muted' });
    const updateChance = () => {
      const bd = treatyAcceptChance(game, player.id, otherId, typeSelect.value, Number(bribeInput.value) || 0);
      chanceLabel.textContent = `${t(game, 'dip.acceptChance')}: ${fmtPct(bd.acceptChance)}`;
      chanceLabel.title = tooltipFromBreakdown(bd);
    };
    typeSelect.addEventListener('change', updateChance);
    bribeInput.addEventListener('input', updateChance);
    updateChance();

    const queuedTreaty = (ui.queuedActions || []).some(
      (a) => a.type === 'proposeTreaty' && a.targetId === otherId
    );

    card.appendChild(
      el('div', { class: 'action-row' }, [
        typeSelect,
        el('span', { class: 'action-label', text: t(game, 'dip.bribe') }),
        bribeInput,
      ])
    );
    card.appendChild(el('div', { class: 'action-row' }, [chanceLabel]));
    card.appendChild(
      el('div', { class: 'action-row' }, [
        queuedTreaty
          ? el('span', { class: 'queued-flag', text: t(game, 'dip.queued') })
          : el('button', {
              class: 'btn btn-small',
              text: t(game, 'dip.proposeTreaty'),
              onclick: () => {
                actions.queueAction({
                  type: 'proposeTreaty',
                  targetId: otherId,
                  treatyType: typeSelect.value,
                  bribe: Number(bribeInput.value) || 0,
                });
              },
            }),
        atWar
          ? el('button', {
              class: 'btn btn-small',
              text: t(game, 'dip.makePeace'),
              onclick: () => actions.queueAction({ type: 'makePeace', targetId: otherId }),
            })
          : el('button', {
              class: 'btn btn-small btn-danger',
              text: t(game, 'dip.declareWar'),
              onclick: () => actions.confirmWar(otherId),
            }),
      ])
    );

    root.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Intel
// ---------------------------------------------------------------------------
function renderIntel(root, ctx) {
  const { game, actions } = ctx;
  const player = getPlayerState(game);

  root.appendChild(el('h3', { text: t(game, 'tab.intel') }));
  root.appendChild(
    kv(game, [
      [t(game, 'intel.budget'), fmtMoney(player.intel.budget)],
      [t(game, 'intel.agents'), String(player.intel.agents)],
      [t(game, 'intel.counterIntel'), String(player.intel.counterIntel)],
    ])
  );

  // Run operation controls
  root.appendChild(el('h3', { text: t(game, 'intel.runOp') }));
  const others = Object.keys(game.states).filter((id) => id !== player.id);
  const targetSelect = el('select', { class: 'select' });
  for (const id of others) targetSelect.appendChild(el('option', { value: id, text: getState(game, id).name }));
  if (others.length > 0 && !targetSelect.value) targetSelect.value = others[0];

  const opSelect = el('select', { class: 'select' });
  const opLabel = { gatherInfo: 'intel.gatherInfo', sabotage: 'intel.sabotage', counterIntel: 'intel.counterIntelOp' };
  for (const op of INTEL_OPS) opSelect.appendChild(el('option', { value: op, text: t(game, opLabel[op]) }));
  if (!opSelect.value) opSelect.value = INTEL_OPS[0];

  const chance = el('span', { class: 'muted' });
  const updateChance = () => {
    const op = opSelect.value;
    const target = getState(game, targetSelect.value);
    if (!target) return;
    const rel = getRelation(game, player.id, targetSelect.value);
    const relationPenalty = op === 'counterIntel' ? 0 : Math.max(0, Math.min(1, (-rel + 100) / 200));
    const targetCounterIntel = op === 'counterIntel' ? 0 : target.intel.counterIntel || 0;
    const bd = intelSuccessChanceBreakdown({ op, agents: player.intel.agents, relationPenalty, targetCounterIntel });
    chance.textContent = `${t(game, 'intel.successChance')}: ${fmtPct(bd.successChance)}`;
    chance.title = tooltipFromBreakdown(bd);
    targetSelect.disabled = op === 'counterIntel';
  };
  opSelect.addEventListener('change', updateChance);
  targetSelect.addEventListener('change', updateChance);
  updateChance();

  root.appendChild(el('div', { class: 'action-row' }, [opSelect, targetSelect]));
  root.appendChild(el('div', { class: 'action-row' }, [chance]));
  root.appendChild(
    el('div', { class: 'action-row' }, [
      el('button', {
        class: 'btn btn-small',
        text: t(game, 'intel.runOp'),
        onclick: () => {
          actions.queueAction({ type: 'intel', targetId: targetSelect.value, op: opSelect.value });
        },
      }),
    ])
  );

  // Known dossiers
  root.appendChild(el('h3', { text: t(game, 'intel.dossiers') }));
  let any = false;
  for (const id of others) {
    const dossier = player.intel.knownInfo[id];
    if (!dossier) continue;
    any = true;
    root.appendChild(el('h4', { text: getState(game, id).name }));
    root.appendChild(
      kv(game, [
        [t(game, 'topbar.turn'), String(dossier.turn)],
        [t(game, 'intel.treasuryEst'), fmtMoney(dossier.treasuryEstimate)],
        [t(game, 'intel.gdpEst'), fmtInt(dossier.gdpEstimate)],
        [t(game, 'intel.unitsEst'), `${dossier.totalUnits} (${dossier.totalStrength})`],
        [t(game, 'intel.powerEst'), fmtInt(dossier.rawPower)],
      ])
    );
  }
  if (!any) root.appendChild(el('p', { class: 'muted', text: t(game, 'intel.noDossier') }));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function kv(game, pairs) {
  const grid = el('div', { class: 'kv-grid' });
  for (const [k, v] of pairs) {
    grid.appendChild(el('div', { class: 'kv-key', text: k }));
    grid.appendChild(el('div', { class: 'kv-val', text: String(v) }));
  }
  return grid;
}

function unitList(game, units, showOwner) {
  if (!units || units.length === 0) return el('p', { class: 'muted', text: t(game, 'mil.noUnits') });
  const wrap = el('div', { class: 'unit-list' });
  for (const u of units) {
    const def = UNIT_TYPES[u.type];
    const owner = showOwner ? getState(game, u.ownerStateId) : null;
    wrap.appendChild(
      el('div', { class: 'unit-item' }, [
        owner
          ? el('span', { class: 'unit-owner-dot', attrs: { style: `background:${owner.flagColor}` } })
          : null,
        el('span', { class: 'unit-name', text: unitTypeName(game, def) }),
        el('span', { class: 'unit-stat', text: `${t(game, 'mil.strength')} ${u.strength}` }),
        el('span', { class: 'unit-stat', text: `${t(game, 'mil.experience')} ${u.experience}` }),
      ])
    );
  }
  return wrap;
}

/**
 * Set of unit ids already committed to a queued attack this turn. Used to stop
 * one stack from being double-committed (attacked twice, or attacked and moved).
 * @param {object} ui transient UI state holding queuedActions
 * @returns {Set<string>}
 */
function reservedUnitIds(ui) {
  const ids = new Set();
  for (const a of ui.queuedActions || []) {
    if (a.type === 'attack' && Array.isArray(a.attackingUnitIds)) {
      for (const id of a.attackingUnitIds) ids.add(id);
    }
  }
  return ids;
}

function countRegions(game, stateId) {
  let n = 0;
  for (const id of Object.keys(game.regions)) if (game.regions[id].ownerStateId === stateId) n += 1;
  return n;
}

function namesOf(game, ids) {
  if (!ids || ids.length === 0) return '';
  return ids.map((id) => (getState(game, id) ? getState(game, id).name : id)).join(', ');
}
