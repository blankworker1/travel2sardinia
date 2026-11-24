#!/usr/bin/env python3
"""Read hosts' calendar links (iCal) and write which nights each stay is booked.

The links are private: they live only in GitHub secrets CAL_1 … CAL_30 (repository → Settings →
Secrets and variables → Actions). Each holds one stay:
  bosa/bomarosa-b-b https://www.airbnb.com/calendar/ical/123.ics
with more links after it, separated by spaces: one per room (free if any room is free).
The same room on two platforms that aren't synced: join its links with "+" (booked if booked on either).
The stay id is shown in the admin (Bosa → Stays → ID). Links are never printed or saved.
Nothing but booked dates is written: no guest names, codes or links.

Output: data/destinations/<town>/availability.json
  {"updated": "...Z", "stays": {"<stay id>": {"checked": "...Z", "ok": true,
      "rooms": [[["2026-12-20", "2026-12-27"], ...], ...]}}}
  Each room is a list of booked [first night, check-out day) ranges. A stay is free on a night
  if at least one of its rooms is free.

Local test:  CAL_FILE=slots.json python3 scripts/build_availability.py   ({"CAL_1": "bosa/x https://…"})
"""
import datetime as dt, json, os, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "travel2sardinia-availability/1.0 (+https://github.com/blankworker1/travel2sardinia)"
HORIZON = 540   # days ahead


def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/calendar, */*"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def parse_date(v):
    m = re.match(r"(\d{4})(\d{2})(\d{2})", v.strip())
    return dt.date(int(m[1]), int(m[2]), int(m[3])) if m else None


def booked_ranges(ics):
    text = re.sub(r"\r?\n[ \t]", "", ics)            # unfold continued lines
    if "BEGIN:VCALENDAR" not in text:
        raise ValueError("not an iCal calendar")
    today = dt.date.today()
    end_window = today + dt.timedelta(days=HORIZON)
    out = []
    for ev in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", text, re.S):
        if re.search(r"^STATUS:CANCELLED", ev, re.M | re.I) or re.search(r"^TRANSP:TRANSPARENT", ev, re.M | re.I):
            continue
        s = re.search(r"^DTSTART[^:\n]*:(.+)$", ev, re.M)
        e = re.search(r"^DTEND[^:\n]*:(.+)$", ev, re.M)
        start = parse_date(s[1]) if s else None
        if not start:
            continue
        end = parse_date(e[1]) if e else None
        if not end or end <= start:
            end = start + dt.timedelta(days=1)
        start, end = max(start, today - dt.timedelta(days=1)), min(end, end_window)
        if start < end:
            out.append([start, end])
    out.sort()
    merged = []
    for a, b in out:                                   # join overlapping or touching stays
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [[a.isoformat(), b.isoformat()] for a, b in merged]


def main():
    if os.environ.get("CAL_FILE"):
        slots = json.loads(Path(os.environ["CAL_FILE"]).read_text())
    else:
        slots = {k: v for k, v in os.environ.items() if re.fullmatch(r"CAL_\d+", k)}
    cals = {}
    for name, value in sorted(slots.items()):
        parts = [p for p in re.split(r"[\s,]+", (value or "").strip()) if p]
        if not parts:
            continue
        m = re.fullmatch(r"([a-z0-9-]+)/([a-z0-9-]+)", parts[0].lower())
        if not m:
            print(f"{name}: should start with town/stay-id (e.g. bosa/bomarosa-b-b), skipped", file=sys.stderr)
            continue
        cals.setdefault(m[1], {}).setdefault(m[2], []).extend(parts[1:])
    if not cals:
        print("No calendar links set yet (secrets CAL_1 … CAL_30). Nothing to do.")
        return

    for town, stays in cals.items():
        path = ROOT / f"data/destinations/{town}/availability.json"
        if not (ROOT / f"data/destinations/{town}").is_dir():
            print(f"{town}: no such town, skipped", file=sys.stderr)
            continue
        known = {s["id"] for s in json.loads((ROOT / f"data/destinations/{town}/stays.json").read_text()).get("stays", [])} \
            if (ROOT / f"data/destinations/{town}/stays.json").exists() else set()
        old = json.loads(path.read_text()).get("stays", {}) if path.exists() else {}
        out = {}
        for stay, urls in sorted(stays.items()):
            if stay not in known and not stay.startswith("test"):
                print(f"{town}/{stay}: no stay with this id in stays.json, skipped", file=sys.stderr)
                continue
            rooms, failed = [], 0
            for i, room in enumerate(urls, 1):
                # One entry per room; "link1+link2" = the same room on two platforms (booked if booked on either).
                ranges = []
                for u in room.split("+"):
                    try:
                        ranges += booked_ranges(fetch(u))
                    except Exception as e:
                        failed += 1
                        print(f"{town}/{stay}: a calendar of room {i} could not be read ({type(e).__name__})", file=sys.stderr)
                ranges.sort()
                merged = []
                for a, b in ranges:
                    if merged and a <= merged[-1][1]:
                        merged[-1][1] = max(merged[-1][1], b)
                    else:
                        merged.append([a, b])
                rooms.append(merged)
            if failed:   # keep the last good result rather than show a half-read stay as free
                prev = old.get(stay)
                out[stay] = dict(prev, ok=False) if prev else {"checked": None, "ok": False, "rooms": []}
            else:
                prev = old.get(stay) or {}
                # Unchanged and confirmed within 6 hours: keep the file as it is (no commit every 3 hours).
                recent = prev.get("checked") and dt.datetime.fromisoformat(prev["checked"].replace("Z", "+00:00")) > dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=6)
                out[stay] = prev if prev.get("ok") and prev.get("rooms") == rooms and recent else {"checked": now_iso(), "ok": True, "rooms": rooms}
                print(f"{town}/{stay}: {len(rooms)} calendar(s), {sum(len(r) for r in rooms)} booked period(s)")
        checked = [v["checked"] for v in out.values() if v.get("checked")]
        path.write_text(json.dumps({"updated": max(checked) if checked else None, "stays": out}, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
