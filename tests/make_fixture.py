#!/usr/bin/env python3
"""Write small synthetic GTFS feeds (arst.zip, trenitalia.zip, aspo.zip) for testing
scripts/build_transit.py without network access. The data is invented."""
import io
import sys
import zipfile
from pathlib import Path


def feed(path, stops, trips, extra_dates=()):
    files = {
        "stops.txt": "stop_id,stop_name\n" + "".join(f"{i},{n}\n" for i, n in stops),
        "routes.txt": "route_id,route_short_name\n" + "".join(
            f"{r},{r}\n" for r in sorted({t[1] for t in trips})),
        "trips.txt": "route_id,service_id,trip_id\n" + "".join(
            f"{t[1]},{t[2]},{t[0]}\n" for t in trips),
        "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                        "WD,1,1,1,1,1,1,0,20260101,20271231\nSU,0,0,0,0,0,0,1,20260101,20271231\n",
        "calendar_dates.txt": "service_id,date,exception_type\n" + "".join(
            f"{s},{d},{e}\n" for s, d, e in extra_dates),
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n" + "".join(
            f"{t[0]},{a},{a},{s},{k}\n" for t in trips for k, (s, a) in enumerate(t[3])),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in files.items():
            z.writestr(name, text)
    Path(path).write_bytes(buf.getvalue())


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    # Holiday: 2027-08-15 is a Sunday anyway; 2027-06-02 (Wed) runs the Sunday service.
    hol = [("WD", "20270602", "2"), ("SU", "20270602", "1")]
    feed(out / "arst.zip",
         [("A1", "ALGHERO Aeroporto Fertilia"), ("A2", "ALGHERO Via Catalogna"),
          ("B1", "BOSA Piazza Zanetti"), ("B2", "BOSA MARINA"), ("M1", "MACOMER Stazione FS")],
         [("t1", "9321", "WD", [("A1", "07:30:00"), ("A2", "07:50:00"), ("B1", "09:05:00")]),
          ("t2", "9321", "WD", [("A1", "14:10:00"), ("A2", "14:30:00"), ("B1", "15:45:00")]),
          ("t3", "9322", "SU", [("A2", "10:00:00"), ("B1", "11:10:00")]),
          ("t4", "9400", "WD", [("M1", "08:20:00"), ("B1", "09:20:00")]),
          ("t5", "9400", "WD", [("M1", "17:40:00"), ("B2", "18:35:00")]),
          ("t6", "9400", "SU", [("M1", "12:30:00"), ("B1", "13:30:00")])],
         hol)
    feed(out / "trenitalia.zip",
         [("E1", "Elmas Aeroporto"), ("C1", "Cagliari"), ("MA", "Macomer"),
          ("O1", "Olbia Terranova"), ("CH", "Chilivani-Ozieri")],
         [("r1", "R", "WD", [("C1", "06:00:00"), ("E1", "06:08:00"), ("MA", "07:45:00")]),
          ("r2", "R", "WD", [("C1", "15:00:00"), ("E1", "15:08:00"), ("MA", "16:50:00")]),
          ("r3", "R", "SU", [("E1", "10:08:00"), ("MA", "11:50:00")]),
          ("r4", "R", "WD", [("O1", "09:00:00"), ("CH", "10:30:00")]),
          ("r5", "R", "WD", [("CH", "11:00:00"), ("MA", "12:05:00")]),
          ("r6", "R", "WD", [("O1", "13:00:00"), ("CH", "14:20:00"), ("MA", "15:30:00")])],
         hol)
    feed(out / "aspo.zip",
         [("P1", "Aeroporto Costa Smeralda"), ("P2", "Stazione FS Olbia Terranova")],
         [("a1", "2", "WD", [("P1", "08:00:00"), ("P2", "08:20:00")]),
          ("a2", "2", "WD", [("P1", "12:00:00"), ("P2", "12:20:00")])])
    print(f"fixtures written to {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures")
