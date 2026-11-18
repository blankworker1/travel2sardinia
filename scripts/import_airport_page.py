#!/usr/bin/env python3
"""Import arrivals from a saved airport "Tutti i voli" page into data/flights.json.

Works with the SOGEAAL (aeroportodialghero.it) and Geasar (geasar.it) pages, which share
one format. On a phone: open the airport's "All flights" list with *Type of flight: Line*,
scroll to the bottom so every flight loads, save the page (Chrome: ⋮ → ⬇), rename the
.mhtml to .txt. Then:

  python3 scripts/import_airport_page.py saved-page.txt [--publish]

It replaces that airport's previously imported routes (ids starting "<airport>-"), keeps
everything else, drops periods that have already ended, and prints a summary.
Imported routes stay unpublished unless --publish is given.
"""
import argparse, collections, datetime as dt, email, html as H, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def page_html(path):
    msg = email.message_from_bytes(Path(path).read_bytes())
    for part in msg.walk():
        if part.get_content_type() == "text/html":
            return part.get_payload(decode=True).decode("utf-8", "replace"), msg.get("Date"), msg.get("Snapshot-Content-Location")
    return Path(path).read_text("utf-8", "replace"), None, None  # a plain saved .html


def text(x):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", x))).strip()


def t24(s):
    s = s.strip().lower().replace(".", ":")
    m = re.match(r"(\d{1,2}):(\d{2})\s*(am|pm)?", s)
    if not m:
        return ""
    h, mi, ap = int(m.group(1)), int(m.group(2)), m.group(3)
    if ap == "pm" and h < 12: h += 12
    if ap == "am" and h == 12: h = 0
    return f"{h:02d}:{mi:02d}"


def parse_rows(src):
    out = []
    for a, body in re.findall(r"<tr (data-service=[^>]*)>(.*?)</tr>", src, re.S):
        at = dict(re.findall(r'data-([a-z]+)="([^"]*)"', a))
        tds = re.findall(r"<td[^>]*>(.*?)</td>", body, re.S)
        m = re.search(r"<span>(.*?)</span>", tds[0], re.S)
        smalls = [t24(text(x)) for x in (re.findall(r"<small>(.*?)</small>", tds[2], re.S) + re.findall(r"<small>(.*?)</small>", tds[3], re.S))]
        dep = t24(text((re.findall(r"<small>(.*?)</small>", tds[2], re.S) or [""])[0]))
        arr = t24(text((re.findall(r"<small>(.*?)</small>", tds[3], re.S) or [""])[0]))
        rng = re.search(r'class="validita-range">(.*?)</span>', body, re.S)
        pills = re.search(r'class="giorni-pills">(.*?)</span>\s*</td>', body, re.S)
        days = "".join(str(i + 1) for i, c in enumerate(re.findall(r'<span class="([^"]*)"', pills.group(1) if pills else "")) if "on" in c.split())
        out.append(dict(type=at.get("type"), service=at.get("service"), airline=at.get("airline", ""), airport=at.get("airport"),
                        remote=at.get("remote"), fno=text(m.group(1)) if m else text(tds[0]), dep=dep, arr=arr,
                        range=text(rng.group(1)).split() if rng else [], days=days))
    return out


def year_for(ddmm, saved):
    """The year that puts dd-mm closest to (and not much before) the date the page was saved."""
    d, m = map(int, ddmm.split("-"))
    for y in (saved.year - 1, saved.year, saved.year + 1):
        try:
            when = dt.date(y, m, d)
        except ValueError:
            continue
        if when >= saved - dt.timedelta(days=120):
            return when
    return dt.date(saved.year + 1, m, d)


def shift_days(days, n):
    return "".join(sorted({str((int(c) - 1 + n) % 7 + 1) for c in days}))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("page")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--today", help="YYYY-MM-DD (default: today)")
    a = ap.parse_args()

    src, saved_hdr, url = page_html(a.page)
    saved = dt.datetime.strptime(saved_hdr, "%a, %d %b %Y %H:%M:%S %Z").date() if saved_hdr else dt.date.today()
    today = dt.date.fromisoformat(a.today) if a.today else dt.date.today()
    ref = json.loads((ROOT / "data" / "airports-ref.json").read_text())
    rows = [r for r in parse_rows(src) if r["type"] == "arrival" and r["service"] == "Linea"]
    if not rows:
        sys.exit("No scheduled arrivals found. Was the page saved with the full list loaded?")
    airport = rows[0]["airport"]
    unknown = sorted({r["remote"] for r in rows} - set(ref["airports"]))
    if unknown:
        sys.exit(f"Unknown airport codes {unknown}: add them to data/airports-ref.json and run again.")

    routes, past, overnight = {}, 0, 0
    for r in rows:
        start, end = year_for(r["range"][0], saved), None
        end = year_for(r["range"][1], saved)
        if end < start:
            end = end.replace(year=end.year + 1)
        days = r["days"]
        if r["dep"] and r["arr"] and r["arr"] < r["dep"]:  # lands after midnight: arrival is the next day
            start, end, days = start + dt.timedelta(1), end + dt.timedelta(1), shift_days(days, 1)
            overnight += 1
        if end < today:
            past += 1
            continue
        up = r["airline"].upper()
        airline = "easyJet" if up.startswith("EASYJET") else ref["airlines"].get(up, r["airline"].title())
        key = (r["remote"], airline)
        if key not in routes:
            it, en, country, lat, lon = ref["airports"][r["remote"]]
            slug = re.sub(r"[^a-z0-9]+", "", airline.lower())[:12]
            routes[key] = {"id": f"{airport.lower()}-{r['remote'].lower()}-{slug}", "from_iata": r["remote"], "from_city": it,
                           "from_city_en": en, "country": country, "lat": lat, "lon": lon, "to": airport, "airline": airline,
                           "flight_no": "", "arr_time": "", "seasons": [], "sample": False, "published": bool(a.publish),
                           "admin_note": f"Imported from {url or 'saved airport page'} (saved {saved.isoformat()})"}
        routes[key]["seasons"].append({"start": start.isoformat(), "end": end.isoformat(), "days": days, "arr_time": r["arr"], "flight_no": r["fno"]})
    for rt in routes.values():
        rt["seasons"].sort(key=lambda x: (x["start"], x["arr_time"]))
        fns = {x["flight_no"] for x in rt["seasons"]}
        if len(fns) == 1:
            rt["flight_no"] = fns.pop()
            for x in rt["seasons"]:
                x["flight_no"] = ""

    path = ROOT / "data" / "flights.json"
    data = json.loads(path.read_text())
    prefix = f"{airport.lower()}-"
    removed = sum(1 for x in data["routes"] if x["id"].startswith(prefix))
    data["routes"] = [x for x in data["routes"] if not x["id"].startswith(prefix)] + sorted(routes.values(), key=lambda x: (x["from_city"], x["airline"]))
    data["updated"] = today.isoformat()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    periods = sum(len(x["seasons"]) for x in routes.values())
    print(f"{airport}: {len(rows)} scheduled arrivals (page saved {saved}); {past} already ended; "
          f"{overnight} land after midnight (moved to next day)")
    print(f"→ {len(routes)} routes, {periods} periods ({'published' if a.publish else 'unpublished'}); replaced {removed} earlier {airport} routes")
    by_c = collections.Counter(x["country"] for x in routes.values())
    print("   by country:", ", ".join(f"{c} {n}" for c, n in by_c.most_common()))


if __name__ == "__main__":
    main()
