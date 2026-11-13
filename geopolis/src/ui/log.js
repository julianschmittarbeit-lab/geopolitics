// log.js
// Event-log renderer. Shows gameState.log newest-first (the engine unshifts, so
// the array is already newest-first). Battle entries are clickable to open the
// transparent BattleReport viewer; AI decision entries expose their named score
// factors; the whole panel is collapsible. Pure render-from-state.

import { getState } from '../engine/state.js';
import { t } from './i18n.js';
import { el, clear, fmtFloat } from './format.js';
import { openBattleReport } from './dialogs.js';

/** Map a log entry kind to a localized label + css class. */
function kindMeta(game, kind) {
  switch (kind) {
    case 'battle':
      return { label: t(game, 'log.kindBattle'), cls: 'log-battle' };
    case 'diplomacy':
      return { label: t(game, 'log.kindDiplomacy'), cls: 'log-diplomacy' };
    case 'intel':
      return { label: t(game, 'log.kindIntel'), cls: 'log-intel' };
    case 'ai':
      return { label: t(game, 'log.kindAi'), cls: 'log-ai' };
    case 'summary':
      return { label: t(game, 'log.kindSummary'), cls: 'log-summary' };
    default:
      return { label: kind || '', cls: '' };
  }
}

/** Replace raw state ids in engine-generated English text with state names. */
function humanizeText(game, text) {
  if (!text) return '';
  let out = String(text);
  for (const id of Object.keys(game.states)) {
    out = out.split(id).join(game.states[id].name);
  }
  return out;
}

/**
 * Render the log.
 * @param {HTMLElement} container #log
 * @param {object} game
 * @param {object} ui transient UI state ({ logCollapsed:boolean })
 * @param {object} actions { onToggleCollapse }
 */
export function renderLog(container, game, ui, actions) {
  clear(container);
  const collapsed = !!ui.logCollapsed;

  const header = el('div', { class: 'log-header' }, [
    el('span', { class: 'log-title', text: t(game, 'log.title') }),
    el('button', {
      class: 'btn btn-small',
      text: collapsed ? t(game, 'log.expand') : t(game, 'log.collapse'),
      onclick: () => actions.onToggleCollapse && actions.onToggleCollapse(),
    }),
  ]);
  container.appendChild(header);

  if (collapsed) return;

  const list = el('div', { class: 'log-list' });
  if (!game.log || game.log.length === 0) {
    list.appendChild(el('p', { class: 'muted', text: t(game, 'log.empty') }));
  }

  for (const entry of game.log) {
    const meta = kindMeta(game, entry.kind);
    const row = el('div', { class: `log-entry ${meta.cls}` });

    const line = el('div', { class: 'log-line' }, [
      el('span', { class: 'log-turn', text: `R${entry.turn}` }),
      el('span', { class: `log-kind ${meta.cls}`, text: meta.label }),
      el('span', { class: 'log-text', text: humanizeText(game, entry.text) }),
    ]);
    row.appendChild(line);

    // Battle entries: a button to open the full transparent report.
    if (entry.kind === 'battle' && entry.report) {
      line.appendChild(
        el('button', {
          class: 'btn btn-small log-report-btn',
          text: t(game, 'log.viewReport'),
          onclick: () => openBattleReport(game, entry.report),
        })
      );
    }

    // AI entries: show the named score factors inline.
    if (entry.kind === 'ai' && entry.factors) {
      const factors = el('div', { class: 'log-factors' });
      factors.appendChild(el('span', { class: 'log-factors-label', text: `${t(game, 'log.aiFactors')}:` }));
      for (const [k, v] of Object.entries(entry.factors)) {
        let shown = v;
        if (typeof v === 'number') shown = fmtFloat(v, 3);
        else if (typeof v === 'string' && game.states[v]) shown = game.states[v].name;
        factors.appendChild(el('span', { class: 'log-factor', text: `${k}=${shown}` }));
      }
      row.appendChild(factors);
    }

    // Intel entries: surface the success probability if present.
    if (entry.kind === 'intel' && entry.report && entry.report.probability) {
      row.appendChild(
        el('div', { class: 'log-factors' }, [
          el('span', {
            class: 'log-factor',
            text: `${t(game, 'intel.successChance')}=${fmtFloat(entry.report.probability.successChance, 3)}`,
          }),
        ])
      );
    }

    list.appendChild(row);
  }

  container.appendChild(list);
}

// Re-export so a region reference can be resolved if needed by callers.
export { getState };
