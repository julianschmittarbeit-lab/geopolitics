// topbar.js
// Top status bar: player state name, treasury, GDP, approval, turn counter, and
// the main action buttons (End Turn, Save, Export, Load, language toggle). Every
// number carries a tooltip built from the matching formulas.js *Breakdown so the
// player can always see the math behind it (no black boxes).

import { getPlayerState } from '../engine/state.js';
import { gdpBreakdown, taxRevenueBreakdown, approvalDeltaBreakdown } from '../engine/formulas.js';
import { upkeepTotal } from '../engine/formulas.js';
import { t } from './i18n.js';
import { el, clear, fmtInt, fmtMoney, tooltipFromBreakdown } from './format.js';

const STATE_BASE_OUTPUT = 1000; // mirrors economy.js STATE_BASE_OUTPUT for the preview tooltip

/**
 * Render the top bar.
 * @param {HTMLElement} container #topbar
 * @param {object} game
 * @param {object} actions { onEndTurn, onSave, onExport, onLoad, onToggleLang }
 */
export function renderTopbar(container, game, actions) {
  clear(container);
  const player = getPlayerState(game);
  if (!player) return;

  const sectors = player.economy.sectors;
  const sumSectors = sectors.industry + sectors.services + sectors.agriculture + sectors.energy;
  const gdpBd = gdpBreakdown(STATE_BASE_OUTPUT, sumSectors, player.approval);
  const revBd = taxRevenueBreakdown(gdpBd.gdp, player.economy.taxRate);
  const upkeep = upkeepTotal(player.military.units);
  const approvalBd = approvalDeltaBreakdown({
    taxRate: player.economy.taxRate,
    growth: 0,
    warWeariness: Math.min(1, player.atWarWith.length * 0.2),
  });

  const left = el('div', { class: 'topbar-left' }, [
    el('span', { class: 'topbar-brand', text: t(game, 'app.title') }),
    el('span', {
      class: 'topbar-state',
      attrs: { style: `border-color:${player.flagColor}` },
      text: player.name,
    }),
  ]);

  const stats = el('div', { class: 'topbar-stats' }, [
    stat(
      t(game, 'topbar.treasury'),
      fmtMoney(player.treasury),
      `${t(game, 'eco.revenue')}: +${Math.round(revBd.taxRevenue)}\n` +
        `${t(game, 'mil.upkeep')}: -${upkeep}\n` +
        `military: -${player.military.budget}  rnd: -${player.military.rnd}  intel: -${player.intel.budget}\n` +
        tooltipFromBreakdown(revBd)
    ),
    stat(
      t(game, 'topbar.gdp'),
      fmtInt(player.economy.gdp),
      tooltipFromBreakdown(gdpBd)
    ),
    stat(
      t(game, 'topbar.approval'),
      `${Math.round(player.approval)}%`,
      `${t(game, 'eco.approvalBreakdown')}\n` + tooltipFromBreakdown(approvalBd)
    ),
    stat(t(game, 'topbar.turn'), String(game.turn), ''),
  ]);

  const buttons = el('div', { class: 'topbar-actions' }, [
    el('button', {
      class: 'btn btn-primary',
      text: t(game, 'topbar.endTurn'),
      onclick: () => actions.onEndTurn && actions.onEndTurn(),
    }),
    el('button', { class: 'btn', text: t(game, 'topbar.save'), onclick: () => actions.onSave && actions.onSave() }),
    el('button', { class: 'btn', text: t(game, 'topbar.export'), onclick: () => actions.onExport && actions.onExport() }),
    el('button', { class: 'btn', text: t(game, 'topbar.load'), onclick: () => actions.onLoad && actions.onLoad() }),
    el('button', {
      class: 'btn btn-lang',
      text: game.settings.lang === 'de' ? 'EN' : 'DE',
      title: t(game, 'start.langLabel'),
      onclick: () => actions.onToggleLang && actions.onToggleLang(),
    }),
  ]);

  container.appendChild(left);
  container.appendChild(stats);
  container.appendChild(buttons);
}

/** One labelled stat with a tooltip. */
function stat(label, value, tooltip) {
  return el('div', { class: 'topbar-stat', title: tooltip || '' }, [
    el('span', { class: 'topbar-stat-label', text: label }),
    el('span', { class: 'topbar-stat-value', text: value }),
  ]);
}
