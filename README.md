# Travel to Bosa

A bilingual (Italian / English) **information** app for reaching Bosa, Sardinia. Pick a date and see:

1. **Flights** to Sardinia's three airports: Alghero (AHO), Cagliari (CAG) and Olbia (OLB), with origin cities on a map.
2. **Getting to Bosa** by bus and train from each airport, worked out from the public ARST, Trenitalia and ASPO timetables.
3. **Places to stay** in Bosa, with links to Hodlstay.
4. **Events and holidays** in Bosa, with warnings about holiday timetables.
5. **Good to know**: local tips.

There are no prices and no bookings: every action is a link out to the provider (airline search, ARST, Trenitalia, Hodlstay).

## How it works

- It's a static site: `index.html`, `app.js`, `i18n.js` and `style.css`. All the content lives in JSON files in `data/`. There is no server and no database.
- **Editing**: `/admin` opens [Sveltia CMS](https://github.com/sveltia/sveltia-cms). Every save is a commit to this repo, and the site redeploys automatically.
- **Timetables**: `.github/workflows/transit.yml` runs every Monday (or on demand). It downloads the GTFS feeds and runs `scripts/build_transit.py`, which writes `data/transit.json`.
- **Hosting**: GitHub Pages, deployed by `.github/workflows/deploy.yml`.

## Keeping it up to date

Local businesses, authorities and cultural groups send updates through a WhatsApp coordination group. Once a month, the coordinator enters them in `/admin`. Every event can have a website link button. See [COORDINATION.md](COORDINATION.md) for the monthly cycle and ready-to-paste reminder messages in Italian and English.

## One-time setup

1. **Pages**: go to Settings → Pages → Source and choose **GitHub Actions**.
2. **Timetables**: go to Actions → *Update timetables* → **Run workflow**. Then open `data/transit.json` and check `matched_stops`: each segment should list the right stops, such as "Macomer" or a Bosa stop. If one is empty or wrong, adjust its pattern in `data/transit-config.json` and run the workflow again.
3. **Editors**: each editor needs a GitHub account with write access to this repo. They create a *fine-grained personal access token* (Settings → Developer settings) limited to this repo with **Contents: Read and write**, then open `https://<pages-url>/admin/` and choose *Sign in with token*.

## Data files

| File | What it holds | Edited in |
|---|---|---|
| `data/events.json` | Holidays and Bosa events (status: fixed / pattern / tbc) | Admin |
| `data/flights.json` | Seasonal route table (days of week, periods) | Admin |
| `data/stays.json` | Hodlstay listings in Bosa | Admin |
| `data/info.json` | Local tips | Admin |
| `data/site.json` | Titles, links, airports | Admin |
| `data/transit-config.json` | GTFS feeds, stop patterns, airport → Bosa chains | By hand |
| `data/transit.json` | Generated timetable. Don't edit it | Workflow |

Entries with `"published": false` are hidden from the public site. In the admin, new stays start unpublished, so the admin can review them before they go live.

## Language

The `IT | EN` toggle switches the interface (`i18n.js`) and all the bilingual content fields (`{ "it": …, "en": … }`). The choice is saved in the browser and in the URL (`?lang=en`). Dates can be linked directly: `?date=2027-09-11`.

## Local development

```sh
python3 -m http.server 8000      # then open http://localhost:8000
python3 tests/make_fixture.py /tmp/fix && python3 scripts/build_transit.py --local /tmp/fix --start 2027-01-01 --out /tmp/transit.json
```

The fixture feeds in `tests/` are invented test data and are never published.

## Data sources

- Bus and rail timetables: ARST, Trenitalia and ASPO GTFS open data (mirrors via the Mobility Database).
- Map: © OpenStreetMap contributors. Leaflet 1.9.4 is bundled in `vendor/`.
- Flight routes: entered by hand from the airports' published destination lists.
