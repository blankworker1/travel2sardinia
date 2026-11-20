#!/usr/bin/env python3
"""Find map positions for stays that don't have one yet, using OpenStreetMap (Nominatim).

Runs in the weekly workflow (and after stays change). One request a second, as Nominatim asks.
A stay that can't be placed gets "geo": "not_found" and is listed without a dot; drop a pin
by hand in the admin (lat/lon) and it's kept from then on.
Also fills in the area (town, Bosa Marina, countryside) from the position, unless set by hand.
"""
import json, math, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "travel2sardinia/1.0 (https://github.com/blankworker1/travel2sardinia)"


def query(params):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(dict(params, format="json", limit=1, countrycodes="it"))
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
        res = json.load(r)
    time.sleep(1.1)
    return res[0] if res else None


def km(a, b):
    return 6371 * math.dist((math.radians(a[0]), math.radians(a[1]) * math.cos(math.radians(a[0]))),
                            (math.radians(b[0]), math.radians(b[1]) * math.cos(math.radians(a[0]))))


def main():
    dests = json.loads((ROOT / "data/destinations.json").read_text())["destinations"]
    changed = False
    for d in dests:
        path = ROOT / f"data/destinations/{d['id']}/stays.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        areas = d.get("areas") or []          # e.g. [{"name": "Bosa Marina", "lat": .., "lon": .., "km": 1.2}]
        centre = (d["lat"], d["lon"])
        town = d["name"]["it"] if isinstance(d["name"], dict) else d["name"]
        for s in data.get("stays", []):
            if s.get("lat") is None and s.get("geo") != "not_found" and s.get("address"):
                street = re.sub(r"\b(loc\.?|localit[aà])\s*", "", s["address"], flags=re.I)
                street = re.split(r"\s+-\s+", street)[0]          # "Vico X 1 - Corso Y 69": take the first
                hit = None
                for params in ({"street": street, "city": town}, {"q": f"{street}, {town}"}, {"q": f"{s['name']}, {town}"}):
                    try:
                        hit = query(params)
                    except Exception as e:
                        print("lookup failed:", e, file=sys.stderr)
                        hit = None
                    if hit and km(centre, (float(hit["lat"]), float(hit["lon"]))) < 12:
                        break
                    hit = None
                if hit:
                    s["lat"], s["lon"], s["geo"] = round(float(hit["lat"]), 5), round(float(hit["lon"]), 5), "osm"
                else:
                    s["geo"] = "not_found"
                print(f"{d['id']}: {s['name']}: {'found' if hit else 'not found'}")
                changed = True
            if s.get("lat") is not None and not s.get("area"):
                p = (s["lat"], s["lon"])
                near = [a for a in areas if km(p, (a["lat"], a["lon"])) <= a.get("km", 1)]
                s["area"] = near[0]["name"] if near else (town if km(p, centre) <= 1.5 else "countryside")
                changed = True
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print("changed" if changed else "nothing to do")


if __name__ == "__main__":
    main()
