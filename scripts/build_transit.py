#!/usr/bin/env python3
"""Build data/transit.json from public GTFS feeds (ARST, Trenitalia, ASPO).

Reads data/transit-config.json, downloads each feed, finds trips that pass a
"from" stop and later a "to" stop for every configured segment, and writes a
compact timetable the static app can read.

Usage:
  python scripts/build_transit.py                 # download feeds
  python scripts/build_transit.py --local DIR     # use DIR/<feed>.zip instead
"""
import argparse
import csv
import datetime as dt
import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "data" / "transit-config.json"
OUT = ROOT / "data" / "transit.json"


def read_csv(zf, name):
    try:
        raw = zf.read(name)
    except KeyError:
        return []
    text = raw.decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def fetch(urls):
    last = None
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "travel2sardinia/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            zipfile.ZipFile(io.BytesIO(data))  # validate
            print(f"  downloaded {url} ({len(data)//1024} KB)")
            return data
        except Exception as e:  # try the next mirror
            print(f"  failed {url}: {e}")
            last = e
    raise RuntimeError(f"all mirrors failed: {last}")


def to_min(t):
    if not t:
        return None
    h, m, *_ = t.strip().split(":")
    return int(h) * 60 + int(m)


def service_days(zf, start, n):
    """Return {service_id: bitstring of length n starting at start}."""
    days = [start + dt.timedelta(d) for d in range(n)]
    active = {}
    for row in read_csv(zf, "calendar.txt"):
        s = dt.datetime.strptime(row["start_date"], "%Y%m%d").date()
        e = dt.datetime.strptime(row["end_date"], "%Y%m%d").date()
        week = [row[k] == "1" for k in
                ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")]
        active[row["service_id"]] = [s <= d <= e and week[d.weekday()] for d in days]
    index = {d: i for i, d in enumerate(days)}
    for row in read_csv(zf, "calendar_dates.txt"):
        d = dt.datetime.strptime(row["date"], "%Y%m%d").date()
        if d not in index:
            continue
        bits = active.setdefault(row["service_id"], [False] * n)
        bits[index[d]] = row["exception_type"] == "1"
    return {k: "".join("1" if b else "0" for b in v) for k, v in active.items()}


def matcher(pattern, exclude=None):
    inc = re.compile(pattern, re.I)
    exc = re.compile(exclude, re.I) if exclude else None
    return lambda name: bool(inc.search(name)) and not (exc and exc.search(name))


def build(config, feeds_data, start):
    n = config["window_days"]
    services = []          # list of bitstrings
    service_index = {}     # bitstring -> index
    segments_out = {}
    matched = {}

    by_feed = {}
    for seg_id, seg in config["segments"].items():
        by_feed.setdefault(seg["feed"], []).append((seg_id, seg))

    for feed, segs in by_feed.items():
        if feed not in feeds_data:
            print(f"! feed {feed} unavailable, skipping {[s for s, _ in segs]}")
            for seg_id, seg in segs:
                segments_out[seg_id] = {**meta(seg), "trips": []}
            continue
        zf = zipfile.ZipFile(io.BytesIO(feeds_data[feed]))
        stops = {r["stop_id"]: r["stop_name"] for r in read_csv(zf, "stops.txt")}
        routes = {r["route_id"]: (r.get("route_short_name") or r.get("route_long_name") or "")
                  for r in read_csv(zf, "routes.txt")}
        trips = {r["trip_id"]: r for r in read_csv(zf, "trips.txt")}
        svc = service_days(zf, start, n)

        stop_times = {}
        for r in read_csv(zf, "stop_times.txt"):
            stop_times.setdefault(r["trip_id"], []).append(r)

        for seg_id, seg in segs:
            is_from = matcher(seg["from"], seg.get("from_exclude"))
            is_to = matcher(seg["to"], seg.get("to_exclude"))
            from_ids = {s for s, name in stops.items() if is_from(name)}
            to_ids = {s for s, name in stops.items() if is_to(name)}
            matched[seg_id] = {
                "from": sorted({stops[s] for s in from_ids}),
                "to": sorted({stops[s] for s in to_ids}),
            }
            out = set()
            for trip_id, st in stop_times.items():
                st.sort(key=lambda r: int(r["stop_sequence"]))
                dep = None
                for r in st:
                    if dep is None and r["stop_id"] in from_ids:
                        dep = to_min(r["departure_time"] or r["arrival_time"])
                    elif dep is not None and r["stop_id"] in to_ids:
                        arr = to_min(r["arrival_time"] or r["departure_time"])
                        trip = trips.get(trip_id)
                        if trip is None or arr is None:
                            break
                        bits = svc.get(trip["service_id"])
                        if not bits or "1" not in bits:
                            break
                        if bits not in service_index:
                            service_index[bits] = len(services)
                            services.append(bits)
                        out.add((dep, arr, service_index[bits], routes.get(trip["route_id"], "")))
                        break
            segments_out[seg_id] = {**meta(seg), "trips": sorted(out)}
            print(f"  {seg_id}: {len(from_ids)} from-stops, {len(to_ids)} to-stops, {len(out)} trips")

    return {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "window_start": start.isoformat(),
        "window_days": n,
        "min_transfer_minutes": config.get("min_transfer_minutes", 10),
        "trip_fields": ["dep_min", "arr_min", "service", "route"],
        "services": services,
        "segments": segments_out,
        "chains": config["chains"],
        "matched_stops": matched,
    }


def meta(seg):
    return {k: seg[k] for k in ("mode", "operator") if k in seg}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", help="directory with <feed>.zip files")
    ap.add_argument("--start", help="window start YYYY-MM-DD (default: today)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    config = json.loads(CONFIG.read_text())
    start = dt.date.fromisoformat(args.start) if args.start else dt.date.today()

    feeds_data = {}
    for feed, urls in config["feeds"].items():
        print(f"feed {feed}")
        try:
            if args.local:
                feeds_data[feed] = (Path(args.local) / f"{feed}.zip").read_bytes()
            else:
                feeds_data[feed] = fetch(urls)
        except Exception as e:
            print(f"! {feed}: {e}")

    if not feeds_data:
        print("no feeds available; leaving existing transit.json untouched")
        sys.exit(1)

    result = build(config, feeds_data, start)
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
