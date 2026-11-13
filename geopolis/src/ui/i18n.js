// i18n.js
// Bilingual string table (German primary, English fallback) plus a tiny t()
// helper bound to gameState.settings.lang. Code identifiers stay English; only
// the user-facing values are translated. This module is DOM-free and pure so it
// can be unit tested under node:test without a browser.
//
// Usage:
//   import { t, setLang, currentLang } from './i18n.js';
//   t(game, 'topbar.treasury')  // -> 'Staatskasse' or 'Treasury'
//
// A key missing from the active language falls back to English, then to the
// raw key itself (so a typo is visible rather than silent).

/** Supported languages in display order (for the toggle). */
export const LANGUAGES = ['de', 'en'];

/** The full string table. Keep keys grouped by UI area. */
export const STRINGS = {
  de: {
    // Application / shell
    'app.title': 'GEOPOLIS',
    'app.subtitle': 'Geopolitische Strategie',

    // Start screen
    'start.heading': 'GEOPOLIS',
    'start.tagline': 'Rundenbasierte geopolitische Strategie. Militaer zuerst, alles transparent.',
    'start.newGame': 'Neues Spiel',
    'start.continue': 'Fortsetzen',
    'start.import': 'Spielstand laden (JSON)',
    'start.seedLabel': 'Startwert (Seed)',
    'start.langLabel': 'Sprache',
    'start.noSave': 'Kein gespeicherter Spielstand gefunden.',

    // Top bar
    'topbar.state': 'Staat',
    'topbar.treasury': 'Staatskasse',
    'topbar.gdp': 'BIP',
    'topbar.approval': 'Zustimmung',
    'topbar.turn': 'Runde',
    'topbar.endTurn': 'Runde beenden',
    'topbar.save': 'Speichern',
    'topbar.export': 'Exportieren',
    'topbar.load': 'Laden',
    'topbar.menu': 'Menue',

    // Tabs
    'tab.overview': 'Uebersicht',
    'tab.military': 'Militaer',
    'tab.economy': 'Wirtschaft',
    'tab.diplomacy': 'Diplomatie',
    'tab.intel': 'Geheimdienst',

    // Generic
    'generic.none': 'Keine',
    'generic.unknown': 'Unbekannt',
    'generic.close': 'Schliessen',
    'generic.cancel': 'Abbrechen',
    'generic.confirm': 'Bestaetigen',
    'generic.yes': 'Ja',
    'generic.no': 'Nein',
    'generic.region': 'Region',
    'generic.terrain': 'Gelaende',
    'generic.owner': 'Besitzer',
    'generic.neutral': 'neutral',
    'generic.you': 'Sie',
    'generic.na': '-',

    // Overview panel
    'overview.selectRegion': 'Waehlen Sie eine Region auf der Karte.',
    'overview.regionInfo': 'Regionsinfo',
    'overview.adjacent': 'Angrenzend',
    'overview.unitsHere': 'Einheiten hier',
    'overview.playerSummary': 'Ihr Staat',
    'overview.population': 'Bevoelkerung',
    'overview.forces': 'Streitkraefte',
    'overview.atWarWith': 'Im Krieg mit',
    'overview.allies': 'Verbuendete',
    'overview.regionsOwned': 'Regionen',

    // Military panel
    'mil.unitsInRegion': 'Einheiten in dieser Region',
    'mil.noUnits': 'Keine Einheiten in dieser Region.',
    'mil.recruit': 'Einheit aufstellen',
    'mil.recruitHere': 'Hier aufstellen',
    'mil.selectType': 'Einheitentyp',
    'mil.cost': 'Kosten',
    'mil.upkeep': 'Unterhalt',
    'mil.popCost': 'Bevoelkerung',
    'mil.strength': 'Staerke',
    'mil.experience': 'Erfahrung',
    'mil.move': 'Bewegen',
    'mil.attack': 'Angreifen',
    'mil.moveTo': 'Bewegen nach',
    'mil.attackPreview': 'Angriffsvorschau',
    'mil.winChance': 'Siegchance',
    'mil.attackPower': 'Angriffskraft',
    'mil.defensePower': 'Verteidigungskraft',
    'mil.selectTargets': 'Ziel waehlen (angrenzende feindliche Region)',
    'mil.notOwned': 'Diese Region gehoert Ihnen nicht, Sie koennen hier nicht aufstellen.',
    'mil.mustOwnRegionToRecruit': 'Aufstellen nur in eigenen Regionen moeglich.',
    'mil.techLevels': 'Technologiestufen',
    'mil.research': 'Forschung',
    'mil.movedThisTurn': 'bereits bewegt',
    'mil.queuedAttack': 'Angriff eingeplant',
    'mil.reservedForAttack': 'fuer Angriff reserviert',

    // Economy panel
    'eco.taxRate': 'Steuersatz',
    'eco.sectors': 'Wirtschaftssektoren',
    'eco.industry': 'Industrie',
    'eco.services': 'Dienstleistungen',
    'eco.agriculture': 'Landwirtschaft',
    'eco.energy': 'Energie',
    'eco.invest': 'Investieren',
    'eco.gdpBreakdown': 'BIP-Aufschluesselung',
    'eco.approvalBreakdown': 'Zustimmungs-Aufschluesselung',
    'eco.revenue': 'Steuereinnahmen',
    'eco.base': 'Basis',
    'eco.sectorFactor': 'Sektorfaktor',
    'eco.approvalFactor': 'Zustimmungsfaktor',

    // Diplomacy panel
    'dip.relations': 'Beziehungen',
    'dip.relation': 'Beziehung',
    'dip.proposeTreaty': 'Vertrag anbieten',
    'dip.declareWar': 'Krieg erklaeren',
    'dip.makePeace': 'Frieden schliessen',
    'dip.treatyType': 'Vertragsart',
    'dip.alliance': 'Buendnis',
    'dip.nonAggression': 'Nichtangriffspakt',
    'dip.trade': 'Handelsabkommen',
    'dip.peace': 'Frieden',
    'dip.bribe': 'Bestechung',
    'dip.acceptChance': 'Annahmechance',
    'dip.treaties': 'Vertraege',
    'dip.atWar': 'im Krieg',
    'dip.queued': 'Fuer Rundenende eingeplant',

    // Intel panel
    'intel.budget': 'Budget',
    'intel.agents': 'Agenten',
    'intel.counterIntel': 'Spionageabwehr',
    'intel.runOp': 'Operation ausfuehren',
    'intel.op': 'Operation',
    'intel.gatherInfo': 'Informationen sammeln',
    'intel.sabotage': 'Sabotage',
    'intel.counterIntelOp': 'Spionageabwehr staerken',
    'intel.successChance': 'Erfolgschance',
    'intel.dossiers': 'Bekannte Dossiers',
    'intel.noDossier': 'Noch keine Erkenntnisse.',
    'intel.treasuryEst': 'Staatskasse (geschaetzt)',
    'intel.gdpEst': 'BIP (geschaetzt)',
    'intel.unitsEst': 'Einheiten',
    'intel.powerEst': 'Kampfkraft',

    // Dialogs
    'dialog.confirmWar': 'Krieg erklaeren?',
    'dialog.confirmWarBody': 'Wollen Sie wirklich Krieg erklaeren gegen',
    'dialog.confirmTreaty': 'Vertrag anbieten?',
    'dialog.confirmIntel': 'Operation bestaetigen?',
    'dialog.resolvesAtEndTurn': 'Diese Aktion wird beim Rundenende aufgeloest.',

    // Battle report
    'battle.title': 'Gefechtsbericht',
    'battle.region': 'Region',
    'battle.terrain': 'Gelaende',
    'battle.attacker': 'Angreifer',
    'battle.defender': 'Verteidiger',
    'battle.result': 'Ergebnis',
    'battle.attackerWon': 'Angreifer siegreich',
    'battle.defenderHeld': 'Verteidiger hielt stand',
    'battle.uncontested': 'unverteidigt besetzt',
    'battle.powers': 'Kampfkraefte',
    'battle.attackPower': 'Angriffskraft',
    'battle.defensePower': 'Verteidigungskraft',
    'battle.odds': 'Siegchance (Formel)',
    'battle.roll': 'Wuerfel',
    'battle.morale': 'Moral',
    'battle.combinedArms': 'Verbundene Waffen',
    'battle.terrainEdge': 'Gelaendevorteil Verteidiger',
    'battle.missiles': 'Raketenschlag',
    'battle.contributions': 'Einheitenbeitraege',
    'battle.unit': 'Einheit',
    'battle.base': 'Basis',
    'battle.tech': 'Technologie',
    'battle.exp': 'Erfahrung',
    'battle.power': 'Kraft',
    'battle.casualties': 'Verluste',
    'battle.before': 'vorher',
    'battle.loss': 'Verlust',
    'battle.after': 'nachher',
    'battle.ownershipChanged': 'Region hat den Besitzer gewechselt',
    'battle.intensity': 'Intensitaet',

    // Log
    'log.title': 'Ereignisprotokoll',
    'log.collapse': 'Einklappen',
    'log.expand': 'Ausklappen',
    'log.empty': 'Noch keine Ereignisse.',
    'log.viewReport': 'Bericht ansehen',
    'log.aiFactors': 'Entscheidungsfaktoren',
    'log.kindBattle': 'Gefecht',
    'log.kindDiplomacy': 'Diplomatie',
    'log.kindIntel': 'Geheimdienst',
    'log.kindAi': 'KI-Entscheidung',
    'log.kindSummary': 'Rundenzusammenfassung',

    // Outcomes
    'outcome.victory': 'Sieg!',
    'outcome.defeat': 'Niederlage',
    'outcome.victoryBody': 'Sie haben die Vorherrschaft erlangt. Herzlichen Glueckwunsch.',
    'outcome.defeatBody': 'Ihr Staat ist gefallen. Das Spiel ist vorbei.',
    'outcome.newGame': 'Neues Spiel starten',

    // Notices
    'notice.saved': 'Spiel in diesem Browser gespeichert.',
    'notice.exported': 'Spielstand als JSON-Datei exportiert.',
    'notice.imported': 'Spielstand geladen.',
    'notice.importError': 'Spielstand konnte nicht geladen werden.',
    'notice.recruited': 'Einheit aufgestellt.',
    'notice.cannotAfford': 'Nicht genug Mittel oder Bevoelkerung.',
    'notice.actionQueued': 'Aktion fuer das Rundenende eingeplant.',
  },

  en: {
    'app.title': 'GEOPOLIS',
    'app.subtitle': 'Geopolitical Strategy',

    'start.heading': 'GEOPOLIS',
    'start.tagline': 'Turn-based geopolitical strategy. Military first, everything transparent.',
    'start.newGame': 'New Game',
    'start.continue': 'Continue',
    'start.import': 'Load Save (JSON)',
    'start.seedLabel': 'Seed',
    'start.langLabel': 'Language',
    'start.noSave': 'No saved game found.',

    'topbar.state': 'State',
    'topbar.treasury': 'Treasury',
    'topbar.gdp': 'GDP',
    'topbar.approval': 'Approval',
    'topbar.turn': 'Turn',
    'topbar.endTurn': 'End Turn',
    'topbar.save': 'Save',
    'topbar.export': 'Export',
    'topbar.load': 'Load',
    'topbar.menu': 'Menu',

    'tab.overview': 'Overview',
    'tab.military': 'Military',
    'tab.economy': 'Economy',
    'tab.diplomacy': 'Diplomacy',
    'tab.intel': 'Intel',

    'generic.none': 'None',
    'generic.unknown': 'Unknown',
    'generic.close': 'Close',
    'generic.cancel': 'Cancel',
    'generic.confirm': 'Confirm',
    'generic.yes': 'Yes',
    'generic.no': 'No',
    'generic.region': 'Region',
    'generic.terrain': 'Terrain',
    'generic.owner': 'Owner',
    'generic.neutral': 'neutral',
    'generic.you': 'You',
    'generic.na': '-',

    'overview.selectRegion': 'Select a region on the map.',
    'overview.regionInfo': 'Region info',
    'overview.adjacent': 'Adjacent',
    'overview.unitsHere': 'Units here',
    'overview.playerSummary': 'Your state',
    'overview.population': 'Population',
    'overview.forces': 'Forces',
    'overview.atWarWith': 'At war with',
    'overview.allies': 'Allies',
    'overview.regionsOwned': 'Regions',

    'mil.unitsInRegion': 'Units in this region',
    'mil.noUnits': 'No units in this region.',
    'mil.recruit': 'Recruit unit',
    'mil.recruitHere': 'Recruit here',
    'mil.selectType': 'Unit type',
    'mil.cost': 'Cost',
    'mil.upkeep': 'Upkeep',
    'mil.popCost': 'Population',
    'mil.strength': 'Strength',
    'mil.experience': 'Experience',
    'mil.move': 'Move',
    'mil.attack': 'Attack',
    'mil.moveTo': 'Move to',
    'mil.attackPreview': 'Attack preview',
    'mil.winChance': 'Win chance',
    'mil.attackPower': 'Attack power',
    'mil.defensePower': 'Defense power',
    'mil.selectTargets': 'Pick a target (adjacent enemy region)',
    'mil.notOwned': 'You do not own this region, you cannot recruit here.',
    'mil.mustOwnRegionToRecruit': 'You can only recruit in regions you own.',
    'mil.techLevels': 'Tech levels',
    'mil.research': 'Research',
    'mil.movedThisTurn': 'already moved',
    'mil.queuedAttack': 'Attack queued',
    'mil.reservedForAttack': 'reserved for attack',

    'eco.taxRate': 'Tax rate',
    'eco.sectors': 'Economic sectors',
    'eco.industry': 'Industry',
    'eco.services': 'Services',
    'eco.agriculture': 'Agriculture',
    'eco.energy': 'Energy',
    'eco.invest': 'Invest',
    'eco.gdpBreakdown': 'GDP breakdown',
    'eco.approvalBreakdown': 'Approval breakdown',
    'eco.revenue': 'Tax revenue',
    'eco.base': 'Base',
    'eco.sectorFactor': 'Sector factor',
    'eco.approvalFactor': 'Approval factor',

    'dip.relations': 'Relations',
    'dip.relation': 'Relation',
    'dip.proposeTreaty': 'Propose treaty',
    'dip.declareWar': 'Declare war',
    'dip.makePeace': 'Make peace',
    'dip.treatyType': 'Treaty type',
    'dip.alliance': 'Alliance',
    'dip.nonAggression': 'Non-aggression pact',
    'dip.trade': 'Trade agreement',
    'dip.peace': 'Peace',
    'dip.bribe': 'Bribe',
    'dip.acceptChance': 'Accept chance',
    'dip.treaties': 'Treaties',
    'dip.atWar': 'at war',
    'dip.queued': 'Queued for end of turn',

    'intel.budget': 'Budget',
    'intel.agents': 'Agents',
    'intel.counterIntel': 'Counter-intel',
    'intel.runOp': 'Run operation',
    'intel.op': 'Operation',
    'intel.gatherInfo': 'Gather info',
    'intel.sabotage': 'Sabotage',
    'intel.counterIntelOp': 'Strengthen counter-intel',
    'intel.successChance': 'Success chance',
    'intel.dossiers': 'Known dossiers',
    'intel.noDossier': 'No intelligence yet.',
    'intel.treasuryEst': 'Treasury (est.)',
    'intel.gdpEst': 'GDP (est.)',
    'intel.unitsEst': 'Units',
    'intel.powerEst': 'Combat power',

    'dialog.confirmWar': 'Declare war?',
    'dialog.confirmWarBody': 'Do you really want to declare war on',
    'dialog.confirmTreaty': 'Propose treaty?',
    'dialog.confirmIntel': 'Confirm operation?',
    'dialog.resolvesAtEndTurn': 'This action resolves at end of turn.',

    'battle.title': 'Battle Report',
    'battle.region': 'Region',
    'battle.terrain': 'Terrain',
    'battle.attacker': 'Attacker',
    'battle.defender': 'Defender',
    'battle.result': 'Result',
    'battle.attackerWon': 'Attacker won',
    'battle.defenderHeld': 'Defender held',
    'battle.uncontested': 'occupied undefended',
    'battle.powers': 'Combat powers',
    'battle.attackPower': 'Attack power',
    'battle.defensePower': 'Defense power',
    'battle.odds': 'Win odds (formula)',
    'battle.roll': 'Roll',
    'battle.morale': 'Morale',
    'battle.combinedArms': 'Combined arms',
    'battle.terrainEdge': 'Defender terrain edge',
    'battle.missiles': 'Missile strike',
    'battle.contributions': 'Unit contributions',
    'battle.unit': 'Unit',
    'battle.base': 'Base',
    'battle.tech': 'Tech',
    'battle.exp': 'Experience',
    'battle.power': 'Power',
    'battle.casualties': 'Casualties',
    'battle.before': 'before',
    'battle.loss': 'loss',
    'battle.after': 'after',
    'battle.ownershipChanged': 'Region changed hands',
    'battle.intensity': 'Intensity',

    'log.title': 'Event log',
    'log.collapse': 'Collapse',
    'log.expand': 'Expand',
    'log.empty': 'No events yet.',
    'log.viewReport': 'View report',
    'log.aiFactors': 'Decision factors',
    'log.kindBattle': 'Battle',
    'log.kindDiplomacy': 'Diplomacy',
    'log.kindIntel': 'Intel',
    'log.kindAi': 'AI decision',
    'log.kindSummary': 'Turn summary',

    'outcome.victory': 'Victory!',
    'outcome.defeat': 'Defeat',
    'outcome.victoryBody': 'You have achieved dominance. Congratulations.',
    'outcome.defeatBody': 'Your state has fallen. The game is over.',
    'outcome.newGame': 'Start a new game',

    'notice.saved': 'Game saved in this browser.',
    'notice.exported': 'Game exported as a JSON file.',
    'notice.imported': 'Game loaded.',
    'notice.importError': 'Could not load the game.',
    'notice.recruited': 'Unit recruited.',
    'notice.cannotAfford': 'Not enough funds or population.',
    'notice.actionQueued': 'Action queued for end of turn.',
  },
};

/**
 * Resolve the active language from a GameState (defaults to German).
 * @param {object} [gameState]
 * @returns {'de'|'en'}
 */
export function currentLang(gameState) {
  const lang = gameState && gameState.settings && gameState.settings.lang;
  return LANGUAGES.includes(lang) ? lang : 'de';
}

/**
 * Translate a key for the active language, falling back to English then to the
 * raw key. Supports optional {placeholder} substitution via the params object.
 * @param {object} gameState GameState (for settings.lang), or a bare lang code
 * @param {string} key dotted string key
 * @param {Object<string,string|number>} [params] placeholder values
 * @returns {string}
 */
export function t(gameState, key, params) {
  const lang = typeof gameState === 'string' ? (LANGUAGES.includes(gameState) ? gameState : 'de') : currentLang(gameState);
  const table = STRINGS[lang] || STRINGS.de;
  let value = table[key];
  if (value === undefined) value = STRINGS.en[key];
  if (value === undefined) value = key;
  if (params) {
    value = value.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  }
  return value;
}

/**
 * Toggle a GameState between German and English (mutates settings.lang in place
 * and returns the new language). Pure w.r.t. everything except settings.lang.
 * @param {object} gameState
 * @returns {'de'|'en'}
 */
export function toggleLang(gameState) {
  if (!gameState.settings) gameState.settings = { lang: 'de' };
  gameState.settings.lang = currentLang(gameState) === 'de' ? 'en' : 'de';
  return gameState.settings.lang;
}

/**
 * Set the language explicitly (ignored if not supported).
 * @param {object} gameState
 * @param {'de'|'en'} lang
 * @returns {'de'|'en'}
 */
export function setLang(gameState, lang) {
  if (!gameState.settings) gameState.settings = { lang: 'de' };
  if (LANGUAGES.includes(lang)) gameState.settings.lang = lang;
  return gameState.settings.lang;
}

/**
 * Localized display name of a unit type, honoring the active language.
 * @param {object} gameState
 * @param {object} unitTypeDef a UNIT_TYPES entry ({name_de, name_en})
 * @returns {string}
 */
export function unitTypeName(gameState, unitTypeDef) {
  if (!unitTypeDef) return t(gameState, 'generic.unknown');
  return currentLang(gameState) === 'de' ? unitTypeDef.name_de : unitTypeDef.name_en;
}

/**
 * Verify both language tables expose exactly the same set of keys. Useful in
 * tests to guard against drift. Returns {ok, missingInEn, missingInDe}.
 * @returns {{ok:boolean, missingInEn:string[], missingInDe:string[]}}
 */
export function checkKeyParity() {
  const deKeys = Object.keys(STRINGS.de);
  const enKeys = Object.keys(STRINGS.en);
  const missingInEn = deKeys.filter((k) => !(k in STRINGS.en));
  const missingInDe = enKeys.filter((k) => !(k in STRINGS.de));
  return { ok: missingInEn.length === 0 && missingInDe.length === 0, missingInEn, missingInDe };
}
