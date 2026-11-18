#!/usr/bin/env python3
"""Add a destination (a town) to travel2sardinia.

Creates, without overwriting anything that already exists:
  <id>/index.html                       town page (from templates/destination.html)
  <id>/organisations/index.html         page for the town's organisations
  data/destinations/<id>/*.json         events, stays, tips, links
  an entry in data/destinations.json    (unpublished until you publish it in /admin)
  an empty chains entry in data/transit-config.json
and rebuilds admin/config.yml.

Example:
  python scripts/new_destination.py cuglieri --name Cuglieri --province Oristano \
      --lat 40.187 --lon 8.568 --airports AHO,CAG
"""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import cms_config  # noqa: E402


def write_if_missing(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        print(f"  keep    {path.relative_to(ROOT)}")
        return
    path.write_text(text)
    print(f"  create  {path.relative_to(ROOT)}")


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id", help="lowercase folder name, e.g. bosa or santu-lussurgiu")
    ap.add_argument("--name", required=True, help="town name (Italian)")
    ap.add_argument("--name-en", help="English name if different")
    ap.add_argument("--province", default="")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--airports", default="AHO,CAG,OLB", help="comma-separated airport codes")
    ap.add_argument("--publish", action="store_true", help="publish immediately (default: hidden until ready)")
    a = ap.parse_args()

    did = a.id.strip().lower()
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", did):
        sys.exit("id must be lowercase letters/numbers with single hyphens")
    reserved = {"admin", "data", "scripts", "templates", "vendor", "organisations", "assets", "tests"}
    if did in reserved:
        sys.exit(f"'{did}' is a reserved folder name")
    name_en = a.name_en or a.name
    today = date.today().isoformat()

    print(f"destination {did}")
    for tpl, out in (("destination.html", ROOT / did / "index.html"),
                     ("destination-organisations.html", ROOT / did / "organisations" / "index.html")):
        html = (ROOT / "templates" / tpl).read_text().replace("__ID__", did).replace("__NAME__", a.name)
        write_if_missing(out, html)

    base = ROOT / "data" / "destinations" / did
    write_if_missing(base / "destination.json", dump({"id": did, "links": {
        "hodlstay_base_url": "", "hodlstay_host_signup_url": "", "coordinator_contact_url": ""}}))
    write_if_missing(base / "events.json", dump({"version": 1, "year": date.today().year + 1, "updated": today,
                                                 "timezone": "Europe/Rome", "events": []}))
    write_if_missing(base / "stays.json", dump({"updated": today, "stays": []}))
    write_if_missing(base / "info.json", dump({"updated": today, "tips": []}))

    dpath = ROOT / "data" / "destinations.json"
    dj = json.loads(dpath.read_text())
    if not any(d["id"] == did for d in dj["destinations"]):
        dj["destinations"].append({
            "id": did, "name": {"it": a.name, "en": name_en}, "province": a.province,
            "lat": a.lat, "lon": a.lon, "tagline": {"it": "", "en": ""},
            "airports": [x.strip().upper() for x in a.airports.split(",") if x.strip()],
            "published": bool(a.publish)})
        dj["updated"] = today
        dpath.write_text(dump(dj))
        print("  add     data/destinations.json entry")

    tpath = ROOT / "data" / "transit-config.json"
    tc = json.loads(tpath.read_text())
    if did not in tc["chains"]:
        tc["chains"][did] = {}
        tpath.write_text(dump(tc))
        print("  add     empty chains in data/transit-config.json (set up the airport -> town routes there)")

    cms_config.build()
    print("done. Next: add segments/chains for the bus and train route, then publish it in /admin.")


if __name__ == "__main__":
    main()
