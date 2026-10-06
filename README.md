# Padel Kärnten – freie Plätze

Kleine Webseite, die zeigt, wo in Kärnten zu einer bestimmten Zeit noch ein Padel-Court frei ist.

**→ https://padel.burgstaller.me/**

Abgedeckte Anlagen: Padelbase Annenheim, Padel Ten Villach, Sportunion Klagenfurt, Arena One Klagenfurt, smash Pörtschach.

## Wie es funktioniert

```
GitHub Actions (alle 30 min) ──► scraper/snapshot.py ──► site/data.json ──► GitHub Pages
                                     │
                                     ├─ eTennis     (Padelbase, Padel Ten, Sportunion)  1 Abruf / Woche
                                     ├─ Wansport    (Arena One)                         1 Abruf / Tag
                                     └─ Eversports  (smash)                             2 Abrufe / Woche
```

Die Buchungsseiten erlauben keine direkten Abfragen aus dem Browser (kein CORS, Eversports hinter Cloudflare).
Deshalb holt ein geplanter GitHub-Actions-Job die Daten serverseitig ab und veröffentlicht sie zusammen mit der
statischen Seite (`site/index.html`). Die Seite filtert dann nur noch lokal nach Tag, Uhrzeit und Spieldauer.

Gespeichert werden ausschließlich **freie Zeitfenster** (Platz, Datum, von–bis, bei Eversports der Preis) –
keine Buchungsdetails und keine Namen.

## Lokal ausprobieren

```bash
uv run scraper/snapshot.py          # schreibt site/data.json
python3 -m http.server -d site 8765 # dann http://localhost:8765
```

## Anlage hinzufügen

Eintrag in `scraper/venues.json` ergänzen. Unterstützt werden die Plattformen `etennis`, `wansport` und `eversports`;
welche IDs man jeweils braucht und wie die Abfrage funktioniert, steht in [PLATTFORMEN.md](PLATTFORMEN.md).

Zusätzliche Felder pro Anlage:

| Feld | Zweck |
|---|---|
| `area` / `area_by_court` | `halle`, `freiluft` oder `ueberdacht` (Eversports meldet das selbst) |
| `price_classes` | eTennis-Preisklassen, die in der Legende „Preise/h“ fehlen, z. B. `{"price38510": 34}` |
| `price_rules` | feste Platzpreise in €/h, wenn die Buchungsseite keine zeigt (Wochentage 0=Mo … 6=So) |
| `price_note` | Hinweis, der auf der Seite unter der Anlage erscheint |
| `sources` | Belege für Platztyp und Preise |

| Anlage | Plätze | Preise (Platz/h) | Quelle Preise |
|---|---|---|---|
| Padelbase Annenheim | 4 × Freiluft | 16–32 € (Winter 16–24 €) | Buchungsseite |
| Padel Ten Villach | 3 × Halle | 20–36 € | Buchungsseite + padelten.at |
| Sportunion Klagenfurt | 3 × Freiluft | 22 € / 30 € ab 16 Uhr | Buchungsseite |
| Arena One | 6 × Halle | 40 € / 48 € (10–12 € pro Person) | arenaone.at |
| smash Pörtschach | 3 × Freiluft | 28 € / 36 € | Buchungsplan |

## Hinweise

- Die Daten sind bis zu ~30 Minuten alt (GitHub verzögert geplante Läufe manchmal zusätzlich).
- GitHub pausiert geplante Workflows in öffentlichen Repos nach 60 Tagen ohne Commit. Dann unter *Actions* wieder aktivieren
  oder einen beliebigen Commit pushen.
- Kein offizielles Angebot der Anlagen.
