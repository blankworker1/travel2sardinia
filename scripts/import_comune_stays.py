#!/usr/bin/env python3
"""Import a town's stays from its Comune's public "Promozione turistica" page.

Bosa's tourist-tax portal publishes the hosts who chose to be promoted:
https://bosa.imposta-soggiorno.it/promozione (all types) or ?tipo=N (one type).
On a phone: open the page (in Italian, translation off), save it (Chrome: ⋮ → ⬇),
rename the .mhtml to .txt. Then:

  python3 scripts/import_comune_stays.py bosa saved-page.txt [more-saves.txt ...]

- Saving "all types" refreshes the list: hosts no longer on the Comune's page are removed,
  new ones are added (published), and edits made in the admin are kept (type, area,
  map position, notes, hodlstay link, published).
- Saving a single type (?tipo=3 etc.) sets the type of the hosts on that page.
  Without that, the type is guessed from the name and can be corrected in the admin.
- Phone numbers aren't copied. The site shows an email button and the host's website.
- Map positions are added by scripts/geocode_stays.py (run by the weekly workflow).
"""
import email, datetime as dt, html as H, json, re, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIPO = {"1": "hotel", "2": "agriturismo", "3": "bnb", "4": "cav", "5": "camping", "7": "residence",
        "9": "affittacamere", "10": "hostel", "11": "casa_ferie", "12": "short_let", "13": "boat", "14": "resid_hotel"}
KEEP = ("type", "type_source", "area", "lat", "lon", "geo", "notes", "url", "published", "languages")


def page(path):
    msg = email.message_from_bytes(Path(path).read_bytes())
    for part in msg.walk():
        if part.get_content_type() == "text/html":
            return part.get_payload(decode=True).decode("utf-8", "replace"), msg.get("Snapshot-Content-Location") or ""
    sys.exit(f"{path}: no HTML found")


def clean(x):
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<!--.*?-->|<[^>]+>", " ", x, flags=re.S))).strip()


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:60]


def guess_type(name, mail=""):
    n = f"{name} {mail}".lower()
    for pat, t in [(r"albergo resid|residenzial", "resid_hotel"), (r"\bhotel\b|albergo", "hotel"), (r"agricampeggio|campeggio|camping", "camping"),
                   (r"agritur|fattoria", "agriturismo"), (r"b\s*&\s*b|b&b|bed and breakfast|\bbnb\b", "bnb"),
                   (r"affittacamere|affitta camere|guest house|rooms\b|camere", "affittacamere"), (r"residence", "residence"),
                   (r"ostello|hostel", "hostel"), (r"locazione|affitti brevi", "short_let")]:
        if re.search(pat, n):
            return t
    return "cav"   # holiday homes and apartments: the most common kind


def tidy_name(n):
    return n if not n.isupper() else " ".join(w.capitalize() if len(w) > 2 or i == 0 else w.lower() for i, w in enumerate(n.lower().split()))


def entries(h):
    out = []
    for it in re.split(r'<div class="item">', h)[1:]:
        m = re.search(r'class="username">(.*?)</div>', it, re.S)
        f = {clean(k).rstrip(":").lower(): clean(v) for k, v in re.findall(r'<div class="name">(.*?)</div>\s*<div class="comment">(.*?)</div>', it, re.S)}
        name = clean(m.group(1)) if m else ""
        mail = (f.get("e-mail") or "").strip().lower()
        if not name:
            continue
        site = f.get("sito") or f.get("website") or ""
        site = site.rstrip(".") if site else ""
        if re.search(r"comune\.bosa\.it", site):   # placeholder, not the host's site
            site = ""
        addr = re.sub(r"\s*\b0[89]0(13|89)\b\s*", " ", f.get("indirizzo") or f.get("address") or "").strip()
        addr = re.sub(r"\s*\bbosa\b\s*$", "", addr, flags=re.I).strip(" ,")
        out.append({"name": tidy_name(name), "address": addr, "email": mail, "website": site})
    return out


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    dest, saves = sys.argv[1], sys.argv[2:]
    path = ROOT / f"data/destinations/{dest}/stays.json"
    data = json.loads(path.read_text()) if path.exists() else {"stays": []}
    old = data.get("stays", [])
    by_key = {}
    for s in old:
        by_key[s.get("email") or s["id"]] = s

    full, typed = None, {}
    for p in saves:
        h, url = page(p)
        ents = entries(h)
        m = re.search(r"[?&]tipo=(\d+)", url)
        if m:
            for e in ents:
                typed[e["email"] or slug(e["name"])] = TIPO.get(m.group(1), "cav")
            print(f"{p}: {len(ents)} stays of type {TIPO.get(m.group(1))}")
        else:
            full = ents
            print(f"{p}: {len(ents)} stays (all types)")

    stays = [s for s in old if s.get("source") != "comune"]   # stays added by hand stay as they are
    if full is None:     # only typed pages: just set types on what we have
        full = [{k: s.get(k, "") for k in ("name", "address", "email", "website")} for s in old if s.get("source") == "comune"]
    ids, added = set(s["id"] for s in stays), []
    for e in full:
        key = e["email"] or slug(e["name"])
        prev = by_key.get(key) or {}
        sid = prev.get("id") or slug(e["name"])
        while sid in ids:
            sid += "-2"
        ids.add(sid)
        s = {"id": sid, "name": e["name"], "type": guess_type(e["name"], e["email"]), "type_source": "guess", "area": "",
             "address": e["address"], "email": e["email"], "website": e["website"], "source": "comune", "published": True}
        for k in KEEP:
            if k in prev:
                s[k] = prev[k]
        if prev.get("address") and prev["address"] != e["address"]:   # moved: find it on the map again
            for k in ("lat", "lon", "geo"):
                s.pop(k, None)
        if key in typed:
            s["type"], s["type_source"] = typed[key], "comune"
        if not prev:
            added.append(s["name"])
        stays.append(s)
    removed = [s["name"] for s in old if s.get("source") == "comune" and (s.get("email") or s["id"]) not in {e["email"] or slug(e["name"]) for e in full}]

    data["updated"] = dt.date.today().isoformat()
    data["source_url"] = data.get("source_url") or "https://bosa.imposta-soggiorno.it/promozione"
    data["stays"] = sorted(stays, key=lambda s: s["name"].lower())
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(data['stays'])} stays in {dest}. Added {len(added)}" + (f": {', '.join(added)}" if len(added) < 15 else "") +
          f". Removed {len(removed)}" + (f": {', '.join(removed)}" if removed else "") + ".")
    print("Types guessed from names:", sum(1 for s in data["stays"] if s.get("type_source") == "guess"))


if __name__ == "__main__":
    main()
