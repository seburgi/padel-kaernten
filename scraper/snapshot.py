# /// script
# requires-python = ">=3.10"
# dependencies = ["curl_cffi>=0.7"]
# ///
"""Holt die freien Padel-Zeiten aller Anlagen für die nächsten Tage und schreibt site/data.json.

Läuft per GitHub Actions alle 30 Minuten. Pro Lauf:
  eTennis    1 Abruf pro Kalenderwoche
  Eversports 2 Abrufe pro 7 Tage
  Wansport   1 Abruf pro Tag
Gespeichert werden nur freie Zeitfenster – keine Buchungsdetails, keine Namen.

  uv run scraper/snapshot.py --days 14 --out site/data.json
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import html as htmllib
import json
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

from curl_cffi import requests

TZ = ZoneInfo("Europe/Vienna")
HERE = Path(__file__).resolve().parent
TIMEOUT = 25

# Ergebnis je Anlage: {platz_name: {datum_iso: [(start_min, end_min, eur_pro_stunde|None), ...]}}
Free = dict[str, dict[str, list[tuple[int, int, float | None]]]]
# Fetcher liefern (free, links, step): step = Raster der möglichen Startzeiten in Minuten


def session() -> requests.Session:
    # Eversports sitzt hinter Cloudflare; Chrome-Impersonation kommt durch.
    return requests.Session(impersonate="chrome", timeout=TIMEOUT)


def minutes(t: dt.datetime) -> int:
    return t.hour * 60 + t.minute


def add(free: Free, court: str, day: dt.date, b: dt.datetime, e: dt.datetime, price=None):
    end = minutes(e) if e.date() == day else 24 * 60
    free.setdefault(court, {}).setdefault(day.isoformat(), []).append((minutes(b), end, price))


# --------------------------------------------------------------------------- eTennis
def etennis(v: dict, days: list[dt.date]) -> tuple[Free, dict, int]:
    free: Free = {}
    links = {}
    s = session()
    mondays = sorted({d - dt.timedelta(days=d.weekday()) for d in days})
    for monday in mondays:
        noon = dt.datetime.combine(monday, dt.time(12), TZ)
        page = s.get(f"{v['base_url']}/reservierung?c={v['category_id']}&t={int(noon.timestamp())}").text

        labels = re.findall(r'time-schedule-left">(.*?)</div></div>', page, re.S)
        times = re.findall(r"<span>(\d\d):(\d\d)</span>", labels[0] if labels else page)
        unit = 30
        if len(times) >= 2:
            (h1, m1), (h2, m2) = times[0], times[1]
            unit = (int(h2) * 60 + int(m2)) - (int(h1) * 60 + int(m1)) or 30

        # Legende "Preise/h": <div class="price price34378"> &euro; 16</div>; jeder Slot trägt die Klasse
        legend = {cls: float(eur.replace(",", ".")) for cls, eur in re.findall(
            r'<div class="price (price[-\d]+)">\s*(?:&euro;|€)\s*([\d.,]+)', page.split('class="pricebox"', 1)[-1])}
        legend.update(v.get("price_classes", {}))  # Klassen, die in der Legende fehlen (aus venues.json)

        day_dates = [dt.datetime.fromtimestamp(int(t), TZ).date()
                     for t in re.findall(r'<div class="day[^"]*"[^>]*data-dt="(\d+)"', page)]
        parts = page.split('class="day-body"')
        blocks = [(parts[i - 1].rsplit("day-courts", 1)[-1], parts[i]) for i in range(1, len(parts))]
        if len(day_dates) != len(blocks):
            raise RuntimeError("Seitenaufbau unerwartet (Tage nicht zuordenbar)")

        for day, (head, body) in zip(day_dates, blocks):
            if day not in days:
                continue
            names = re.findall(r'<div class="court[^"]*" style="width:[^"]*">([^<]*)</div>', head)
            columns = re.split(r'<div class="court[^"]*" data-cid="\d+"', body)[1:]
            for i, col in enumerate(columns):
                court = htmllib.unescape(names[i]).strip() if i < len(names) else f"Platz {i + 1}"
                free.setdefault(court, {}).setdefault(day.isoformat(), [])
                for m in re.finditer(r'<div\s+class="slot av([^"]*)"[^>]*data-begin="(\d+)"\s+data-size="(\d+)"', col):
                    b = dt.datetime.fromtimestamp(int(m.group(2)), TZ)
                    cls = re.search(r"price[-\d]+", m.group(1))
                    price = legend.get(cls.group(0)) if cls else None
                    add(free, court, day, b, b + dt.timedelta(minutes=unit * int(m.group(3))), price)
            midnight = dt.datetime.combine(day, dt.time(0), TZ)
            links[day.isoformat()] = f"{v['base_url']}/reservierung?c={v['category_id']}&d={int(midnight.timestamp())}"
    return free, links, unit


# --------------------------------------------------------------------------- Wansport
def wansport(v: dict, days: list[dt.date]) -> tuple[Free, dict, int]:
    free: Free = {}
    step = 30
    s = session()

    def parse(d: str, t: str) -> dt.datetime:
        return dt.datetime.fromisoformat(f"{d} {t}").replace(tzinfo=TZ)

    for day in days:
        data = s.get(f"{v['base_url']}/de-de/index.php?option=com_wsinit"
                     f"&task=prenotazioni.getPannelloPrenotazioni&format=raw"
                     f"&filtroData={day.isoformat()}&filtroSport={v['sport_id']}").json()
        if not data.get("success"):
            raise RuntimeError("API meldet keinen Erfolg")
        for sede in data["dati"].get("sedi", []):
            for r in sede.get("risorse", []):
                court = r.get("nome", "?").strip()
                free.setdefault(court, {}).setdefault(day.isoformat(), [])
                if r.get("isFuoriFinestraTemporale"):
                    continue
                # Nur die Zeitintervalle der Buchungen – die Namen der Buchenden werden nie gelesen.
                booked = [(parse(p["startdate"], p["starttime"]), parse(p["enddate"], p["endtime"]))
                          for p in r.get("listaPrenotazioni") or []]
                for ts in r.get("tslots", []):
                    if not ts.get("published", True) or ts.get("is_inizio_prenotazioni_disabilitato"):
                        continue
                    step = int(ts.get("durata_tslot") or step)
                    b = dt.datetime.fromisoformat(ts["ts_start"]).replace(tzinfo=TZ)
                    e = dt.datetime.fromisoformat(ts["ts_end"]).replace(tzinfo=TZ)
                    if not any(bs < e and be > b for bs, be in booked):
                        add(free, court, day, b, e)
    link = f"{v['base_url']}/de-de/bookingspanel"
    return free, {d.isoformat(): link for d in days}, step


# --------------------------------------------------------------------------- Eversports
def eversports(v: dict, days: list[dt.date]) -> tuple[Free, dict, int]:
    base = "https://www.eversports.at"
    free: Free = {}
    areas: dict[str, str] = {}
    step = 60
    s = session()
    sp = v["sport"]
    hdr = {"X-Requested-With": "XMLHttpRequest"}
    wanted = {d.isoformat() for d in days}
    start = min(days)
    while start <= max(days):
        form = {
            "facilityId": v["facility_id"], "facilitySlug": v["facility_slug"],
            "sport[id]": sp["id"], "sport[slug]": sp["slug"], "sport[name]": sp["name"],
            "sport[uuid]": sp["uuid"], "date": start.isoformat(), "type": "user",
        }
        page = s.post(f"{base}/api/booking/calendar/update", data=form, headers=hdr).text
        names = {cid: htmllib.unescape(n).strip() for cid, n in re.findall(
            r'<td data-court="(\d+)"[^>]*>\s*<div class="court-name[^"]*">([^<]*)<', page)}
        # <tr data-area="outdoor" data-surface="Kunstrasen" class="court"> ... <td data-court="115472">
        for row_area, cid in re.findall(r'<tr[^>]*data-area="(\w+)"[^>]*>\s*<td data-court="(\d+)"', page):
            if cid in names:
                areas[names[cid]] = {"indoor": "halle", "outdoor": "freiluft"}.get(row_area, row_area)
        cells = []
        for tag in re.findall(r"<td [^>]*data-state=[^>]*>", page):
            # Eversports mischt "..." und '...' bei Attributen
            a = {k: v1 or v2 for k, v1, v2 in re.findall(r'''([\w-]+)=(?:"([^"]*)"|'([^']*)')''', tag)}
            if a.get("data-date") in wanted:
                cells.append(a)
        if cells:
            court_ids = sorted({c["data-court"] for c in cells})
            q = "&".join(f"courts%5B%5D={c}" for c in court_ids)
            occ = s.get(f"{base}/api/slot?facilityId={v['facility_id']}&startDate={start.isoformat()}&{q}",
                        headers=hdr).json().get("slots", [])
            occupied = {(o["date"], o["start"], str(o["court"])) for o in occ}
            for c in cells:
                cid, day_iso = c["data-court"], c["data-date"]
                court = names.get(cid, f"Platz {cid}")
                free.setdefault(court, {}).setdefault(day_iso, [])
                if c.get("data-state") != "free" or (day_iso, c["data-start"], cid) in occupied:
                    continue
                b, e = c["data-start"], c["data-end"]
                step = (int(e[:2]) * 60 + int(e[2:])) - (int(b[:2]) * 60 + int(b[2:])) or step
                bm, em = int(b[:2]) * 60 + int(b[2:]), int(e[:2]) * 60 + int(e[2:])
                price = float(c["data-price"]) * 60 / (em - bm) if c.get("data-price") and em > bm else None
                free[court][day_iso].append((bm, em, price))
        start += dt.timedelta(days=7)
    link = f"{base}/sb/{v['facility_slug']}"
    v.setdefault("_areas", {}).update(areas)  # vom Buchungsplan gemeldet; venues.json hat Vorrang (area_of)
    return free, {d.isoformat(): link for d in days}, step


FETCHERS = {"etennis": etennis, "wansport": wansport, "eversports": eversports}


def merge(units):
    """Aneinandergrenzende Einheiten mit gleichem Preis zusammenfassen (kleinere JSON-Datei)."""
    out: list[list] = []
    for b, e, p in sorted(set(units)):
        if out and out[-1][1] == b and out[-1][2] == p:
            out[-1][1] = e
        else:
            out.append([b, e, p])
    return out


def apply_price_rules(venue: dict, free: Free) -> None:
    """Feste Platzpreise (€/h) aus venues.json für Anlagen, deren Buchungsseite keine Preise zeigt.
    Einheiten werden an Regelgrenzen nicht geteilt – die Plattform-Raster (30 min) liegen ohnehin darauf."""
    rules = venue.get("price_rules")
    if not rules:
        return
    hm = lambda s: int(s[:2]) * 60 + int(s[3:5])
    for per_day in free.values():
        for day_iso, units in per_day.items():
            wd = dt.date.fromisoformat(day_iso).weekday()
            for i, (b, e, p) in enumerate(units):
                if p is None:
                    for r in rules:
                        if wd in r["weekdays"] and hm(r["from"]) <= b < hm(r["to"]):
                            units[i] = (b, e, float(r["eur_h"]))
                            break


def area_of(venue: dict, court: str) -> str | None:
    """halle / freiluft / überdacht – aus venues.json (pro Platz oder Anlage), sonst vom Buchungsplan."""
    return (venue.get("area_by_court", {}).get(court) or venue.get("area")
            or venue.get("_areas", {}).get(court))


def run(venue: dict, days: list[dt.date]) -> dict:
    entry = {k: venue.get(k) for k in ("id", "name", "ort", "platform", "price_note")}
    try:
        free, links, step = FETCHERS[venue["platform"]](venue, days)
        apply_price_rules(venue, free)
        entry["error"] = None
        entry["step"] = step
        entry["links"] = links
        entry["courts"] = [{"name": name, "area": area_of(venue, name),
                            "free": {d: merge(u) for d, u in sorted(per_day.items())}}
                           for name, per_day in free.items()]
    except Exception as exc:  # eine kaputte Anlage soll die anderen nicht blockieren
        entry.update(error=f"{type(exc).__name__}: {exc}"[:300], step=30, links={}, courts=[])
    return entry


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--out", default=str(HERE.parent / "site" / "data.json"))
    args = ap.parse_args()

    venues = [v for v in json.loads((HERE / "venues.json").read_text())["venues"] if v.get("enabled", True)]
    now = dt.datetime.now(TZ)
    days = [now.date() + dt.timedelta(days=i) for i in range(args.days)]

    with cf.ThreadPoolExecutor(max_workers=len(venues)) as ex:
        results = list(ex.map(lambda v: run(v, days), venues))

    data = {"generated": now.isoformat(timespec="seconds"),
            "days": [d.isoformat() for d in days], "venues": results}
    Path(args.out).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))

    for r in results:
        n = sum(len(u) for c in r["courts"] for u in c["free"].values())
        status = "FEHLER " + r["error"] if r["error"] else f"{len(r['courts'])} Plätze, {n} freie Fenster"
        print(f"{r['name']:<24} {status}")
    # Nur scheitern, wenn gar nichts geklappt hat – dann bleibt der letzte Stand online.
    return 1 if all(r["error"] for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
