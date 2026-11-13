// main.js
// Bootstrap + controller. Builds the full playable UI on top of the finished
// engine. On load it shows a start screen (New Game / Continue / Import), then
// wires the live game: top bar, SVG map, tabbed context panel, event log, a
// queued-actions tray, and End Turn -> turn.endTurn with the player's queued
// action descriptors. The UI always re-renders from GameState after any action,
// so there is no hidden game state (only transient selection/tab/queue/dialog).

import { newGame } from './engine/state.js';
import { endTurn } from './engine/turn.js';
import { saveGame, loadGame, hasSavedGame, exportGame, importGame } from './engine/save.js';
import { t, toggleLang } from './ui/i18n.js';
import { el, clear } from './ui/format.js';
import { renderTopbar } from './ui/topbar.js';
import { renderMap } from './ui/map.js';
import { renderPanels } from './ui/panels.js';
import { renderLog } from './ui/log.js';
import { confirmDialog, closeModal, openModal, openBattleReport } from './ui/dialogs.js';

/**
 * The controller holds the single GameState plus transient UI state. All
 * mutations to game flow through engine functions; UI re-renders from state.
 */
function createController(roots) {
  /** @type {object} */
  let game = null;
  const ui = {
    activeTab: 'overview',
    queuedActions: [],
    logCollapsed: false,
  };

  function notify(msgKey) {
    if (!roots.notice) return;
    roots.notice.textContent = t(game, msgKey);
    roots.notice.classList.add('show');
    clearTimeout(notify._timer);
    notify._timer = setTimeout(() => roots.notice.classList.remove('show'), 2500);
  }

  function selectRegion(regionId) {
    game.selectedRegionId = game.selectedRegionId === regionId ? null : regionId;
    rerender();
  }

  function queueAction(descriptor) {
    ui.queuedActions.push(descriptor);
    notify('notice.actionQueued');
    rerender();
  }

  function unqueueAction(index) {
    ui.queuedActions.splice(index, 1);
    rerender();
  }

  function confirmWar(targetId) {
    const other = game.states[targetId];
    confirmDialog(
      game,
      t(game, 'dialog.confirmWar'),
      `${t(game, 'dialog.confirmWarBody')} ${other ? other.name : targetId}?`,
      () => queueAction({ type: 'declareWar', targetId })
    );
  }

  function doEndTurn() {
    const actions = ui.queuedActions.slice();
    game = endTurn(game, actions);
    ui.queuedActions = [];
    // Autosave after each turn so Continue always works.
    saveGame(game);
    rerender();
    if (game.status === 'victory' || game.status === 'defeat') showOutcome();
  }

  function showOutcome() {
    const isWin = game.status === 'victory';
    const body = el('div', {}, [
      el('p', { text: t(game, isWin ? 'outcome.victoryBody' : 'outcome.defeatBody') }),
    ]);
    openModal(game, t(game, isWin ? 'outcome.victory' : 'outcome.defeat'), body, [
      {
        label: t(game, 'outcome.newGame'),
        kind: 'btn-primary',
        onClick: () => {
          closeModal();
          showStartScreen();
        },
      },
    ]);
  }

  const actions = {
    rerender,
    notify,
    selectRegion,
    queueAction,
    unqueueAction,
    confirmWar,
    openBattleReport: (report) => openBattleReport(game, report),
    onEndTurn: doEndTurn,
    onSave: () => {
      const r = saveGame(game);
      notify(r.ok ? 'notice.saved' : 'notice.importError');
    },
    onExport: () => {
      exportGame(game);
      notify('notice.exported');
    },
    onLoad: () => openImportPicker(),
    onToggleLang: () => {
      toggleLang(game);
      rerender();
    },
    onToggleCollapse: () => {
      ui.logCollapsed = !ui.logCollapsed;
      rerender();
    },
  };

  function renderQueue() {
    clear(roots.queue);
    if (ui.queuedActions.length === 0) {
      roots.queue.classList.remove('has-items');
      return;
    }
    roots.queue.classList.add('has-items');
    roots.queue.appendChild(el('span', { class: 'queue-label', text: `${t(game, 'topbar.endTurn')}:` }));
    ui.queuedActions.forEach((a, i) => {
      roots.queue.appendChild(
        el('span', { class: 'queue-chip' }, [
          el('span', { text: describeAction(game, a) }),
          el('button', { class: 'queue-x', text: 'x', onclick: () => unqueueAction(i) }),
        ])
      );
    });
  }

  function rerender() {
    if (!game) return;
    document.documentElement.lang = game.settings.lang;
    renderTopbar(roots.topbar, game, actions);
    renderMap(roots.map, game, selectRegion);
    renderPanels(roots.panel, { game, ui, actions });
    renderLog(roots.log, game, ui, actions);
    renderQueue();
  }

  // --- Start screen ---------------------------------------------------------
  function showStartScreen() {
    const lang = game && game.settings ? game.settings.lang : 'de';
    const probe = { settings: { lang } };
    roots.app.classList.add('hidden');
    clear(roots.start);
    roots.start.classList.remove('hidden');

    const seedInput = el('input', { class: 'input', type: 'text', value: String(Date.now() % 100000) });
    const langSelect = el('select', { class: 'select' }, [
      el('option', { value: 'de', text: 'Deutsch' }),
      el('option', { value: 'en', text: 'English' }),
    ]);
    langSelect.value = lang;

    const start = (continueGame, imported) => {
      if (imported) {
        game = imported;
      } else if (continueGame) {
        game = loadGame();
        if (!game) return;
      } else {
        game = newGame({ seed: seedInput.value || 1, lang: langSelect.value });
      }
      ui.activeTab = 'overview';
      ui.queuedActions = [];
      roots.start.classList.add('hidden');
      roots.app.classList.remove('hidden');
      rerender();
    };

    const buttons = el('div', { class: 'start-buttons' }, [
      el('button', { class: 'btn btn-primary btn-large', text: t(probe, 'start.newGame'), onclick: () => start(false) }),
      hasSavedGame()
        ? el('button', { class: 'btn btn-large', text: t(probe, 'start.continue'), onclick: () => start(true) })
        : el('span', { class: 'muted', text: t(probe, 'start.noSave') }),
      el('button', {
        class: 'btn btn-large',
        text: t(probe, 'start.import'),
        onclick: () => openImportPicker((g) => start(false, g)),
      }),
    ]);

    roots.start.appendChild(
      el('div', { class: 'start-card' }, [
        el('h1', { class: 'start-heading', text: t(probe, 'start.heading') }),
        el('p', { class: 'start-tagline', text: t(probe, 'start.tagline') }),
        el('div', { class: 'start-row' }, [
          el('label', { class: 'start-label', text: t(probe, 'start.seedLabel') }),
          seedInput,
        ]),
        el('div', { class: 'start-row' }, [
          el('label', { class: 'start-label', text: t(probe, 'start.langLabel') }),
          langSelect,
        ]),
        buttons,
      ])
    );
  }

  function openImportPicker(onLoaded) {
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      document.body.removeChild(input);
      if (!file) return;
      try {
        const loaded = await importGame(file);
        if (onLoaded) {
          onLoaded(loaded);
        } else {
          game = loaded;
          ui.queuedActions = [];
          rerender();
          notify('notice.imported');
        }
      } catch (e) {
        if (game) notify('notice.importError');
      }
    });
    input.click();
  }

  return { showStartScreen, rerender, get game() { return game; } };
}

/** Describe a queued player action for the queue tray. */
function describeAction(game, a) {
  const name = (id) => (game.states[id] ? game.states[id].name : id);
  const region = (id) => (game.regions[id] ? game.regions[id].name : id);
  switch (a.type) {
    case 'proposeTreaty':
      return `${t(game, 'dip.proposeTreaty')}: ${name(a.targetId)} (${t(game, `dip.${a.treatyType}`)})`;
    case 'declareWar':
      return `${t(game, 'dip.declareWar')}: ${name(a.targetId)}`;
    case 'makePeace':
      return `${t(game, 'dip.makePeace')}: ${name(a.targetId)}`;
    case 'intel':
      return `${t(game, 'intel.runOp')}: ${name(a.targetId)} (${a.op})`;
    case 'attack':
      return `${t(game, 'mil.attack')}: ${region(a.regionId)}`;
    default:
      return a.type;
  }
}

/** Wire up DOM roots and start. */
export function boot() {
  const roots = {
    app: document.getElementById('app'),
    start: document.getElementById('start-screen'),
    topbar: document.getElementById('topbar'),
    map: document.getElementById('map'),
    panel: document.getElementById('context-panel'),
    log: document.getElementById('log'),
    queue: document.getElementById('queue-bar'),
    notice: document.getElementById('notice'),
  };
  const controller = createController(roots);
  controller.showStartScreen();
  return controller;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
