#!/usr/bin/env python3
"""Import Cagliari flights from a saved SOGAER "Live flights info" page.

Cagliari has no seasonal timetable page, only a live board covering today and tomorrow.
So each save adds two days of observations to data/sources/CAG-board.json, and the
Cagliari routes in data/flights.json are rebuilt from everything observed so far:

- every origin seen on the board becomes a route (published, so the map is complete);
- each flight (number + arrival time) becomes a period with the weekdays it was seen on;
- while fewer than all seven weekdays have been observed, routes keep days_tbc: true,
  so the site says "days to be confirmed" instead of guessing.

On a phone: open https://www.sogaer.it/en/live-flights-info, save the page
(Chrome: ⋮ → ⬇), rename the .mhtml to .txt. Every two days covers a week in four saves.

  python3 scripts/import_sogaer_board.py saved-page.txt [--period-end 2027-03-27]

Departures are recorded too (for the return journey), but not yet used for routes.
"""
import argparse, collections, datetime as dt, email, html as H, json, re, sys
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OBS = ROOT / "data/sources/CAG-board.json"
ROME = dt.timezone(dt.timedelta(hours=1))  # winter time is enough to get the save date right

# Board names → airport codes. Add a line when a new origin appears (the script will ask).
PLACES = {
    "barcelona": "BCN", "bari": "BRI", "basel": "BSL", "basel-mulhouse": "BSL", "bergamo": "BGY", "milan bergamo": "BGY",
    "bologna": "BLQ", "brussels charl": "CRL", "brussels charleroi": "CRL", "budapest": "BUD", "catania": "CTA",
    "forli'": "FRL", "forli": "FRL", "geneva": "GVA", "genoa": "GOA", "krakow": "KRK", "london stansted": "STN",
    "malta": "MLA", "milan linate": "LIN", "milan malpensa": "MXP", "palermo": "PMO", "paris beauvais": "BVA",
    "paris orly": "ORY", "perugia": "PEG", "pescara": "PSR", "pisa": "PSA", "rome ciampino": "CIA",
    "rome fiumicino": "FCO", "seville": "SVQ", "turin": "TRN", "venice": "VCE", "verona": "VRN",
}
AIRLINES = {"FR": "Ryanair", "RK": "Ryanair", "XZ": "Aeroitalia", "U2": "easyJet", "EC": "easyJet", "DS": "easyJet",
            "VY": "Vueling", "BT": "airBaltic", "W6": "Wizz Air", "W4": "Wizz Air", "V7": "Volotea", "AZ": "ITA Airways"}
SLUG = {"Ryanair": "ryanair", "Aeroitalia": "aeroitalia", "easyJet": "easyjet", "Vueling": "vueling", "airBaltic": "airbaltic",
        "Wizz Air": "wizzair", "Volotea": "volotea", "ITA Airways": "ita"}
DAYS = "1234567"


def page_html(path):
    msg = email.message_from_bytes(Path(path).read_bytes())
    for part in msg.walk():
        if part.get_content_type() == "text/html":
            return part.get_payload(decode=True).decode("utf-8", "replace"), msg.get("Date")
    sys.exit("No HTML found in the saved page.")


def clean(x):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", x))).strip()


def rows(seg):
    out = []
    for tr in re.findall(r'<tr class="table-row">(.*?)</tr>', seg, re.S):
        st = re.search(r'class="st-td">(.*?)</td>', tr, re.S).group(1)
        place = re.search(r'class="destinazione-td">(.*?)</td>', tr, re.S)
        fno = re.search(r'flight-number-td"><span>(.*?)</span>', tr, re.S)
        if not (place and fno):
            continue
        status = re.search(r'status-volo[^>]*>(.*?)</span>', tr, re.S)
        out.append(dict(next_day="+1" in st, time=re.search(r"\d\d:\d\d", st).group(0), place=clean(place.group(1)),
                        flight=re.sub(r"\s+0*", " ", clean(fno.group(1))).replace(" ", ""),
                        status=clean(status.group(1)) if status else ""))
    return out


def by_day(lst):
    """Split into today and tomorrow, dropping yesterday's late flights that lead the list."""
    today = [r for r in lst if not r["next_day"]]
    tomorrow = [r for r in lst if r["next_day"]]
    i = 0
    later = lambda r, rest: r["flight"] in {x["flight"] for x in rest}
    while i < len(today) and (today[i]["time"] >= "20:00" or later(today[i], today[i + 1:])):
        i += 1
    return today[i:], tomorrow


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("saved")
    ap.add_argument("--period-start", default="2026-11-18")
    ap.add_argument("--period-end", default="2027-03-27")
    a = ap.parse_args()

    html, date_hdr = page_html(a.saved)
    saved = parsedate_to_datetime(date_hdr).astimezone(ROME).date()
    pi, ai = html.find('<div id="partenze"'), html.find('<div id="arrivi"')
    if pi < 0 or ai < 0:
        sys.exit("This doesn't look like the SOGAER live flights page.")
    dep, arr = rows(html[pi:ai]), rows(html[ai:])
    d0, d1 = saved.isoformat(), (saved + dt.timedelta(days=1)).isoformat()
    (a0, a1), (p0, p1) = by_day(arr), by_day(dep)

    obs = json.loads(OBS.read_text()) if OBS.exists() else {"note": "Cagliari board observations, one entry per date. Written by scripts/import_sogaer_board.py.", "days": {}}
    strip = lambda L: [{k: r[k] for k in ("time", "place", "flight")} for r in L]
    obs["days"][d0] = {"saved": date_hdr, "arrivals": strip(a0), "departures": strip(p0)}
    # Tomorrow's list may still change: don't overwrite a date already saved as "today".
    if d1 not in obs["days"] or obs["days"][d1].get("partial"):
        obs["days"][d1] = {"saved": date_hdr, "partial": True, "arrivals": strip(a1), "departures": strip(p1)}
    obs["days"] = dict(sorted(obs["days"].items()))
    OBS.parent.mkdir(parents=True, exist_ok=True)
    OBS.write_text(json.dumps(obs, ensure_ascii=False, indent=1) + "\n")

    unknown = sorted({r["place"] for d in obs["days"].values() for r in d["arrivals"] if r["place"].lower() not in PLACES})
    if unknown:
        sys.exit(f"Unknown origins, add them to PLACES: {unknown}")

    # ---- rebuild the Cagliari routes from all observations
    ref = json.loads((ROOT / "data/airports-ref.json").read_text())["airports"]
    fl_path = ROOT / "data/flights.json"
    fl = json.loads(fl_path.read_text())
    old = {r["id"]: r for r in fl["routes"] if r["to"] == "CAG"}
    seen_wd = {str(dt.date.fromisoformat(d).isoweekday()) for d in obs["days"]}
    complete = set(DAYS) <= seen_wd
    flights = collections.defaultdict(lambda: collections.defaultdict(set))   # route id → (flight, time) → weekdays
    dates_seen = collections.defaultdict(set)
    meta = {}
    for d, entry in obs["days"].items():
        wd = str(dt.date.fromisoformat(d).isoweekday())
        for r in entry["arrivals"]:
            iata = PLACES[r["place"].lower()]
            airline = AIRLINES.get(r["flight"][:2], r["flight"][:2])
            rid = f"cag-{iata.lower()}-{SLUG.get(airline, airline.lower())}"
            flights[rid][(r["flight"], r["time"])].add(wd)
            dates_seen[rid].add(d)
            meta[rid] = (iata, airline)

    missing_ref = sorted({iata for iata, _ in meta.values() if iata not in ref})
    if missing_ref:
        sys.exit(f"Add these airports to data/airports-ref.json first: {missing_ref}")

    new_routes, added = [], []
    for rid in sorted(set(flights) | set(old)):
        prev = old.get(rid)
        if rid not in flights:            # on file but not seen on the board yet: keep, still to confirm
            prev = dict(prev, days_tbc=True)
            prev.pop("days_observed", None)
            new_routes.append(prev)
            continue
        iata, airline = meta[rid]
        it, en, country, lat, lon = ref[iata]
        seasons = [{"start": a.period_start, "end": a.period_end, "days": "".join(sorted(wds)), "arr_time": tm, "flight_no": fno}
                   for (fno, tm), wds in sorted(flights[rid].items(), key=lambda x: (x[0][1], x[0][0]))]
        seen = ", ".join(dt.date.fromisoformat(d).strftime("%a %d %b") for d in sorted(dates_seen[rid]))
        r = {"id": rid, "from_iata": iata, "from_city": it, "from_city_en": en, "country": country, "lat": lat, "lon": lon,
             "to": "CAG", "airline": airline, "flight_no": "", "arr_time": "", "seasons": seasons,
             "sample": False, "published": prev.get("published", True) if prev else True,
             "admin_note": f"From the SOGAER arrivals board, seen {seen}." + ("" if complete else " Days still to confirm: not every weekday has been observed yet.")}
        if not complete:
            r["days_tbc"] = True
            r["days_observed"] = "".join(sorted(seen_wd))   # weekdays the board has been checked on
        if not prev:
            added.append(rid)
        new_routes.append(r)

    fl["routes"] = [r for r in fl["routes"] if r["to"] != "CAG"] + new_routes
    fl_path.write_text(json.dumps(fl, ensure_ascii=False, indent=2) + "\n")

    names = dict(zip(DAYS, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]))
    print(f"Saved {saved} ({names[str(saved.isoweekday())]}): {len(a0)} arrivals today, {len(a1)} tomorrow; departures {len(p0)} + {len(p1)}.")
    print(f"Weekdays observed so far: {', '.join(names[d] for d in DAYS if d in seen_wd)}"
          + ("  → complete: days confirmed." if complete else f"  → still missing {', '.join(names[d] for d in DAYS if d not in seen_wd)}."))
    print(f"Cagliari routes: {len(new_routes)} ({len(added)} new: {', '.join(added) or 'none'}).")
    unseen = [rid for rid in old if rid not in flights]
    if unseen:
        print(f"On file but not seen on the board yet: {', '.join(unseen)}")


if __name__ == "__main__":
    main()
