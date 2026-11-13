// dialogs.js
// Modal dialog helper plus specific dialogs: confirm (war/treaty/intel) and the
// full BattleReport viewer that renders EVERY term of a BattleReport so combat
// is completely transparent. All dialogs are built from DOM nodes and mounted
// into a shared #modal-root overlay; closing removes the overlay.

import { getState } from '../engine/state.js';
import { UNIT_TYPES } from '../data/unitTypes.js';
import { t, unitTypeName } from './i18n.js';
import { el, clear, fmtInt, fmtFloat, fmtPct } from './format.js';

/** Ensure a single overlay root exists and return it. */
function modalRoot() {
  let root = document.getElementById('modal-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'modal-root';
    document.body.appendChild(root);
  }
  return root;
}

/** Close any open modal. */
export function closeModal() {
  const root = modalRoot();
  clear(root);
  root.classList.remove('open');
}

/**
 * Open a modal with a title, body node(s) and optional footer buttons.
 * @param {object} game
 * @param {string} title
 * @param {Node|Node[]} body
 * @param {Array<{label:string, kind?:string, onClick:Function}>} [buttons]
 * @param {object} [opts] { wide:boolean }
 */
export function openModal(game, title, body, buttons = [], opts = {}) {
  const root = modalRoot();
  clear(root);
  root.classList.add('open');

  const footer = el('div', { class: 'modal-footer' });
  for (const b of buttons) {
    footer.appendChild(
      el('button', {
        class: `btn ${b.kind || ''}`.trim(),
        text: b.label,
        onclick: () => b.onClick(),
      })
    );
  }
  footer.appendChild(
    el('button', { class: 'btn', text: t(game, 'generic.close'), onclick: () => closeModal() })
  );

  const bodyWrap = el('div', { class: 'modal-body' });
  const list = Array.isArray(body) ? body : [body];
  for (const n of list) if (n) bodyWrap.appendChild(n);

  const dialog = el('div', { class: `modal-dialog ${opts.wide ? 'wide' : ''}`.trim() }, [
    el('div', { class: 'modal-header' }, [
      el('h2', { class: 'modal-title', text: title }),
      el('button', { class: 'modal-x', text: 'x', title: t(game, 'generic.close'), onclick: () => closeModal() }),
    ]),
    bodyWrap,
    footer,
  ]);

  const backdrop = el('div', { class: 'modal-backdrop', onclick: () => closeModal() });
  root.appendChild(backdrop);
  root.appendChild(dialog);
}

/**
 * Generic confirm dialog. Calls onConfirm when the primary button is pressed,
 * then closes.
 */
export function confirmDialog(game, title, message, onConfirm, kind = 'btn-danger') {
  const body = el('div', {}, [
    el('p', { text: message }),
    el('p', { class: 'muted', text: t(game, 'dialog.resolvesAtEndTurn') }),
  ]);
  openModal(game, title, body, [
    {
      label: t(game, 'generic.confirm'),
      kind,
      onClick: () => {
        closeModal();
        onConfirm();
      },
    },
  ]);
}

/**
 * Render a full BattleReport in a modal. Every numeric term is shown: both
 * powers, each unit contribution with its modifiers, odds, roll, morale,
 * combined-arms, terrain edge, missile pre-strike, and per-unit casualties.
 * @param {object} game
 * @param {object} report BattleReport
 */
export function openBattleReport(game, report) {
  if (!report) return;
  const atkState = getState(game, report.attackerStateId);
  const defState = getState(game, report.defenderStateId);
  const atkName = atkState ? atkState.name : report.attackerStateId;
  const defName = defState ? defState.name : report.defenderStateId;

  const resultText = report.uncontested
    ? t(game, 'battle.uncontested')
    : report.attackerWins
    ? t(game, 'battle.attackerWon')
    : t(game, 'battle.defenderHeld');

  const body = [];

  // Header facts
  body.push(
    kvGrid([
      [t(game, 'battle.region'), `${report.regionName} (${report.terrain})`],
      [t(game, 'battle.attacker'), atkName],
      [t(game, 'battle.defender'), defName],
      [t(game, 'battle.result'), resultText],
      [t(game, 'battle.intensity'), fmtFloat(report.intensity, 3)],
    ])
  );

  // Powers + odds + roll (the decisive math)
  body.push(el('h3', { text: t(game, 'battle.powers') }));
  body.push(
    kvGrid([
      [t(game, 'battle.attackPower'), fmtFloat(report.attackPower, 2)],
      [t(game, 'battle.defensePower'), fmtFloat(report.defensePower, 2)],
      [t(game, 'battle.odds'), `${fmtFloat(report.odds, 3)} (${fmtPct(report.odds)})`],
      [t(game, 'battle.roll'), fmtFloat(report.roll, 3)],
      [
        t(game, 'battle.morale'),
        `${t(game, 'battle.attacker')} x${fmtFloat(report.morale.attackerMult, 2)} / ${t(
          game,
          'battle.defender'
        )} x${fmtFloat(report.morale.defenderMult, 2)}`,
      ],
      [
        t(game, 'battle.combinedArms'),
        `${t(game, 'battle.attacker')} x${fmtFloat(report.combinedArms.attacker.bonus, 2)} / ${t(
          game,
          'battle.defender'
        )} x${fmtFloat(report.combinedArms.defender.bonus, 2)}`,
      ],
      [t(game, 'battle.terrainEdge'), `x${fmtFloat(report.terrainEdge.defenderEdge, 2)} (${report.terrainEdge.terrain})`],
    ])
  );

  // Missile pre-strike
  if (report.missile && report.missile.count > 0) {
    body.push(el('h3', { text: t(game, 'battle.missiles') }));
    const rows = report.missile.hits.map((h) => [
      h.missileId,
      h.targetUnitId || t(game, 'generic.na'),
      fmtFloat(h.damage, 1),
    ]);
    body.push(table([t(game, 'battle.unit'), 'target', t(game, 'battle.loss')], rows));
  }

  // Attacker contributions
  body.push(el('h3', { text: `${t(game, 'battle.attacker')}: ${t(game, 'battle.contributions')}` }));
  body.push(contributionTable(game, report.attackerContributions));

  // Defender contributions
  body.push(el('h3', { text: `${t(game, 'battle.defender')}: ${t(game, 'battle.contributions')}` }));
  body.push(contributionTable(game, report.defenderContributions));

  // Casualties
  body.push(el('h3', { text: t(game, 'battle.casualties') }));
  body.push(
    el('div', { class: 'two-col' }, [
      el('div', {}, [
        el('h4', { text: t(game, 'battle.attacker') }),
        casualtyTable(game, report.attackerCasualties),
      ]),
      el('div', {}, [
        el('h4', { text: t(game, 'battle.defender') }),
        casualtyTable(game, report.defenderCasualties),
      ]),
    ])
  );

  if (report.ownershipChanged) {
    body.push(el('p', { class: 'battle-flag', text: t(game, 'battle.ownershipChanged') }));
  }

  openModal(game, t(game, 'battle.title'), body, [], { wide: true });
}

/** Build a labelled key/value grid. */
function kvGrid(pairs) {
  const grid = el('div', { class: 'kv-grid' });
  for (const [k, v] of pairs) {
    grid.appendChild(el('div', { class: 'kv-key', text: k }));
    grid.appendChild(el('div', { class: 'kv-val', text: String(v) }));
  }
  return grid;
}

/** Build a simple table from a header row and data rows. */
function table(headers, rows) {
  const thead = el(
    'tr',
    {},
    headers.map((h) => el('th', { text: h }))
  );
  const body = rows.map((r) => el('tr', {}, r.map((c) => el('td', { text: String(c) }))));
  return el('table', { class: 'data-table' }, [el('thead', {}, [thead]), el('tbody', {}, body)]);
}

/** Per-unit power contribution table (shows every multiplier). */
function contributionTable(game, contributions) {
  if (!contributions || contributions.length === 0) {
    return el('p', { class: 'muted', text: t(game, 'mil.noUnits') });
  }
  const headers = [
    t(game, 'battle.unit'),
    t(game, 'mil.strength'),
    t(game, 'battle.base'),
    t(game, 'battle.tech'),
    t(game, 'battle.exp'),
    t(game, 'battle.combinedArms'),
    t(game, 'generic.terrain'),
    t(game, 'battle.power'),
  ];
  const rows = contributions.map((c) => [
    unitTypeName(game, UNIT_TYPES[c.type]),
    fmtInt(c.strength),
    fmtFloat(c.base, 2),
    fmtFloat(c.techMult, 2),
    fmtFloat(c.experienceMult, 2),
    fmtFloat(c.combinedArms, 2),
    fmtFloat(c.terrainMod * c.groundFactor, 2),
    fmtFloat(c.power, 1),
  ]);
  return table(headers, rows);
}

/** Per-unit casualty table. */
function casualtyTable(game, casualties) {
  if (!casualties || casualties.length === 0) {
    return el('p', { class: 'muted', text: t(game, 'generic.none') });
  }
  const headers = [
    t(game, 'battle.unit'),
    t(game, 'battle.before'),
    t(game, 'battle.loss'),
    t(game, 'battle.after'),
  ];
  const rows = casualties.map((c) => [
    unitTypeName(game, UNIT_TYPES[c.type]),
    fmtInt(c.before),
    fmtInt(c.loss),
    fmtInt(c.after),
  ]);
  return table(headers, rows);
}
