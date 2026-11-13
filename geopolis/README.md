# GEOPOLIS

Eine browserbasierte, rundenbasierte geopolitische Strategie. Militaer zuerst,
mit gekoppelten Subsystemen fuer Diplomatie, Geheimdienst und Wirtschaft. Ein
eigenstaendiges Spiel, inspiriert vom Genre der Staatenlenker-Simulationen, das
bewusst deren typische Schwaechen vermeidet: ueberladenes UI, Blackbox-Kampf,
schwache KI und kaputte Zahlenwerte. Jede berechnete Zahl ist transparent und
wird im UI ueber eine Formel-Aufschluesselung erklaert.

Zero-Build, rein clientseitig. Kein Backend, keine Netzwerkverbindung zur
Laufzeit, keine externen Bibliotheken, Schriften oder CDNs. Laeuft offline.

---

## Deutsch

### Was ist das?

GEOPOLIS ist der erste voll spielbare Meilenstein (Milestone 1): eine Karte aus
12 Regionen, 4 Staaten (1 Spieler + 3 KI) und alle vier gekoppelten Subsysteme.
Ziel ist die Vorherrschaft (Kontrolle ueber mindestens 60 Prozent der Regionen)
oder die dominante Macht beim Rundenlimit zu sein.

### Starten

Weil ES-Module vom Browser auf `file://` wegen CORS blockiert werden, kann die
`index.html` nicht per Doppelklick geoeffnet werden. Sie muss ueber einen
einfachen statischen Server ausgeliefert werden:

```
cd geopolis
python3 -m http.server 8000
```

Dann im Browser oeffnen: `http://localhost:8000/`

Warum `file://` nicht funktioniert: Browser behandeln lokale Dateien als
"opaque origin". ES-Module (`import ...`) unterliegen der CORS-Pruefung, und
diese schlaegt fuer `file://`-URLs fehl. Ein Server liefert die Dateien ueber
`http://` mit korrektem MIME-Typ aus, wodurch die Module laden.

Alternative ohne Python (benoetigt Node, laedt ein Hilfspaket):

```
cd geopolis
npx serve
```

### Wie man spielt

1. **Neues Spiel / Fortsetzen / Laden** auf dem Startbildschirm waehlen. Ein
   Startwert (Seed) macht Partien reproduzierbar.
2. Eine **Region** auf der Karte anklicken, um sie auszuwaehlen. Gueltige
   Bewegungsziele sind gruen, moegliche Angriffsziele rot umrandet.
3. Im rechten **Kontextpanel** ueber die Tabs agieren:
   - **Uebersicht:** Lage des eigenen Staates und der gewaehlten Region.
   - **Militaer:** Einheiten aufstellen, bewegen, Angriffe einplanen. Die
     Technologiestufen sind sichtbar.
   - **Wirtschaft:** Steuersatz (Schieberegler) und Sektorinvestitionen. Die
     BIP- und Zustimmungs-Aufschluesselung zeigt die Formel.
   - **Diplomatie:** Beziehungen, Vertraege anbieten (mit Annahmechance),
     Krieg erklaeren, Frieden schliessen.
   - **Geheimdienst:** Budget/Agenten/Abwehr, Operationen ausfuehren (mit
     Erfolgschance), bekannte Dossiers.
4. Sofortige Aktionen (aufstellen, bewegen, Steuern, investieren) wirken direkt.
   Zufallsbehaftete Aktionen (Vertrag, Krieg, Angriff, Spionage) werden in der
   **Aktionsleiste** gesammelt und beim Rundenende aufgeloest.
5. **Runde beenden** klicken. Die KI-Staaten handeln danach transparent (jede
   Entscheidung steht mit ihren benannten Faktoren im Protokoll).

### Einen Gefechtsbericht lesen

Jedes Gefecht erzeugt einen vollstaendig transparenten Bericht. Im
Ereignisprotokoll unten auf **Bericht ansehen** bei einem Gefechtseintrag
klicken. Der Bericht zeigt jeden Term der Berechnung:

- **Kampfkraefte:** Angriffskraft und Verteidigungskraft als Endsummen.
- **Siegchance (odds):** `Angriffskraft / (Angriffskraft + Verteidigungskraft)`.
- **Wuerfel (roll):** der eine gezogene Zufallswert. Angreifer gewinnt, wenn
  `roll < odds`.
- **Moral, Verbundene Waffen, Gelaendevorteil:** die Multiplikatoren beider
  Seiten.
- **Raketenschlag:** Vorabschaden durch Raketen (Einwegwaffen).
- **Einheitenbeitraege:** pro Einheit Basis, Technologie, Erfahrung, verbundene
  Waffen, Gelaende und die resultierende Kraft.
- **Verluste:** pro Einheit Staerke vorher, Verlust, nachher.

So ist jeder Ausgang nachvollziehbar, nichts ist eine Blackbox.

### Speichern und Laden

- **Speichern:** legt den Spielstand im Browser ab (localStorage). Nach jedem
  Rundenende wird automatisch gespeichert, damit **Fortsetzen** funktioniert.
- **Exportieren:** laedt den Spielstand als JSON-Datei herunter.
- **Laden:** importiert eine zuvor exportierte JSON-Datei.

Der Spielstand enthaelt den Seed, sodass eine geladene Partie deterministisch
exakt dort weiterlaeuft, wo sie gespeichert wurde.

### Sprache

Oben rechts kann zwischen **Deutsch** und **Englisch** umgeschaltet werden. Alle
UI-Texte wechseln sofort.

### Bekannte Einschraenkungen (Milestone 1)

- Kleine Karte (12 Regionen, 4 Staaten), ein Schwierigkeitsgrad.
- Keine Versorgung/Logistik, keine Veteranen-Oberflaeche, einfacher Tech-Baum.
- Nur ein Buendnis-, Nichtangriffs-, Handels- und Friedensvertrag; keine
  Embargos, UN-Abstimmungen oder Handelsdeals.
- Geheimdienst: nur gatherInfo, sabotage, counterIntel.
- Keine Ereignisse/Weltereignisse. Die KI ist absichtlich einfach und
  transparent, nicht maximal stark.

Der vollstaendige Fahrplan (Milestones 2 bis 4) steht in
[`docs/DESIGN.md`](docs/DESIGN.md).

---

## English

### What it is

GEOPOLIS is the first fully playable milestone: a 12-region map, 4 states (1
player + 3 AI), and all four coupled subsystems (military, diplomacy, intel,
economy). Win by dominance (controlling at least 60 percent of regions) or by
being the dominant power at the turn limit. Everything is transparent: every
number is derived from a documented formula and surfaced in the UI.

### Running it

Browsers block ES modules on `file://` for CORS reasons, so you cannot just
double-click `index.html`. Serve it from a trivial static server:

```
cd geopolis
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in your browser.

Why `file://` does not work: browsers treat local files as an opaque origin, and
ES module imports are subject to CORS, which fails for `file://` URLs. A server
delivers the files over `http://` with the correct MIME type so the modules
load. Alternative without Python: `npx serve` (needs Node).

### How to play

Select a region on the map, then act via the right-hand tabbed panel: Overview,
Military (recruit / move / queue attacks), Economy (tax slider + sector
investment), Diplomacy (relations, treaties, war, peace), and Intel (operations
and dossiers). Immediate actions apply at once; chance-resolved actions
(treaties, war, attacks, espionage) collect in the action tray and resolve when
you press **End Turn**. The AI then acts, logging each decision with its named
score factors.

### Reading a battle report

Click **View report** on a battle entry in the event log. The report shows every
term: both combat powers, the win odds `attack / (attack + defense)`, the single
dice roll (attacker wins if `roll < odds`), morale / combined-arms / terrain
multipliers, the missile pre-strike, per-unit power contributions, and per-unit
casualties (before, loss, after). No black boxes.

### Save and load

Save stores the game in the browser (localStorage; also autosaved after each
turn, so Continue works). Export downloads a JSON file; Load imports one. The
save includes the seed, so a loaded game continues deterministically from
exactly where it was saved.

### Known limitations (Milestone 1)

Small map and one difficulty; no logistics, veterancy UI, or deep tech tree;
limited treaty types; three intel ops; no world events; deliberately simple,
transparent AI. See [`docs/DESIGN.md`](docs/DESIGN.md) for the full roadmap
(Milestones 2 to 4).

---

## Development

- **Tests:** `node --test` from `geopolis/` (auto-discovery), or `npm test`.
  Note: on Node 22, `node --test tests/` with a bare directory argument fails
  with MODULE_NOT_FOUND. Use plain `node --test`, `npm test`, or
  `node --test 'tests/**/*.test.mjs'`.
- **Syntax check:** `for f in $(find src -name '*.js'); do node --check "$f"; done`
- **Structure:** see [`docs/DESIGN.md`](docs/DESIGN.md) section 3. Engine logic
  lives in `src/engine/` (pure, unit-tested), static data in `src/data/`, and
  DOM/SVG rendering in `src/ui/`. The UI always re-renders from a single
  `GameState`; there is no hidden game state.
