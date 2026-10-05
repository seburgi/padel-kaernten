# Buchungsplattformen – wie die Daten abgefragt werden

Nützlich, wenn du eine Anlage zu `scraper/venues.json` hinzufügen willst oder eine Anlage Fehler liefert.

## eTennis (`"platform": "etennis"`)

Erkennbar an "powered by eTennis.at" im Seitentitel; Domains wie `*.tennisplatz.info` oder eigene Domains (z. B. buchung-padelbase.at).

- Abruf: `GET {base_url}/reservierung?c={category_id}&d={unix_ts_tag_mitternacht}` – serverseitig gerendertes HTML.
- `category_id` = Wert `c=` aus der Reservierungs-URL. Eine Anlage kann mehrere Kategorien haben (z. B. Sandplatz / Padel / Kinderplatz); im Menü stehen alle `reservierung?c=…`-Links mit Namen. Die Padel-Kategorie nehmen.
- Pro Tag ein Block `day-courts` (Platznamen) + `day-body` (eine Spalte `<div class="court" data-cid=…>` pro Platz).
- Freie Zellen: `class="slot av …" data-begin="<unix>" data-size="<einheiten>"`; belegt: `class="slot … res …"`; vergangen: `pastSlot`.
- Länge einer Einheit = Abstand der Zeitleiste links (`time-schedule-left`), meist 30 min.
- Je nach Client werden 1 oder 7 Tage gerendert; die Kopfzeile trägt `data-dt` je Tag in derselben Reihenfolge wie die `day-body`-Blöcke.
- Padelbase hat viele Standorte (Wien, OÖ, Salzburg, Tirol …) unter derselben Domain – nur Kärntner Standorte eintragen.

## Wansport (`"platform": "wansport"`)

Italienisches System, Domain `<anlage>.wansport.com`.

- Abruf: `GET {base_url}/de-de/index.php?option=com_wsinit&task=prenotazioni.getPannelloPrenotazioni&format=raw&filtroData=YYYY-MM-DD&filtroSport={sport_id}` → JSON, ohne Login.
- `sport_id` steht im Netzwerk-Request der Seite `/de-de/bookingspanel` (`filtroSport=…`); Padel war bei Arena One `15`.
- `dati.sedi[].risorse[]` = Plätze; `tslots` = Öffnungsraster (30 min), `listaPrenotazioni` = Buchungen (`startdate/starttime/enddate/endtime`). Frei = Raster minus Buchungen.
- `isFuoriFinestraTemporale: true` = Datum außerhalb des Buchungsfensters.
- Die Buchungen enthalten Namen der Buchenden (`lista_organizzazioni`) – nur die Zeiten verwenden, Namen nie ausgeben.

## Eversports (`"platform": "eversports"`)

`www.eversports.at/s/<slug>` (Übersicht) bzw. `/sb/<slug>` (Buchungsplan). Liegt hinter Cloudflare: einfache `curl`/`urllib`-Requests bekommen 403, deshalb nutzt das Skript `curl_cffi` mit Chrome-Impersonation.

- Raster + Preise: `POST /api/booking/calendar/update` (form-encoded) mit `facilityId, facilitySlug, sport[id], sport[slug], sport[name], sport[uuid], date, type=user` → HTML mit `<td data-state="free" data-date data-start="HHMM" data-end data-price data-court>`. Hier ist alles "free" markiert.
- Belegte Slots: `GET /api/slot?facilityId=…&startDate=YYYY-MM-DD&courts[]=…` → `{"slots":[{"date","start","court"}]}`. Frei = Raster minus diese Liste.
- IDs finden: Buchungsplan `/sb/<slug>` im Browser öffnen, auf "nächste Woche" klicken und den Request-Body von `calendar/update` mitlesen (enthält alle Sport-Felder). Die Court-IDs ermittelt das Skript selbst aus dem HTML.
- Maximal 21 Tage im Voraus (`data-max-calendar-days`).
