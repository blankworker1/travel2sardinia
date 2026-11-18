/* travel2sardinia: static information app. No backend: everything is read from /data.
   One script serves two kinds of page:
   - the island home (body[data-page=home]): flights, destinations, island holidays
   - a destination page (body[data-dest=<id>]): flights, getting there, stays, events, tips
   Travellers start from their city; the date is optional. */
(function () {
  "use strict";

  const BASE = new URL(".", document.currentScript.src); // site root, wherever it is hosted
  const DEST = document.body.dataset.dest || "";
  const AIRPORT_EXIT_MIN = 30; // time from landing to the first bus/train
  const state = { lang: "en", origin: "", date: "", data: {}, dest: null, map: null, layers: null };

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const has = (s) => !!document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const t = (k, ...a) => { const v = (I18N[state.lang] || I18N.en)[k]; return typeof v === "function" ? v(...a) : (v ?? k); };
  const tx = (o) => (o && typeof o === "object") ? (o[state.lang] || o.en || o.it || "") : (o || "");
  const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmtISO = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return fmtISO(d); };
  const isoWeekday = (s) => ((parseDate(s).getUTCDay() + 6) % 7) + 1; // 1=Mon … 7=Sun
  const today = () => fmtISO(new Date());
  const locale = () => (state.lang === "it" ? "it-IT" : "en-GB");
  const fmtDay = (s, opts) => parseDate(s).toLocaleDateString(locale(), Object.assign({ weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }, opts));
  const monthName = (y, m, style) => new Date(Date.UTC(y, m, 1)).toLocaleDateString(locale(), { month: style || "long", timeZone: "UTC" });
  const dayName = (n) => parseDate(`2027-01-0${3 + Number(n)}`).toLocaleDateString(locale(), { weekday: "short", timeZone: "UTC" }); // 2027-01-04 is a Monday
  const countryName = (code) => { try { return new Intl.DisplayNames([locale()], { type: "region" }).of(code); } catch (e) { return code; } };
  const hm = (m) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  const toMin = (s) => { if (!s) return null; const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} ${t("min")}`);
  const published = (x) => x && x.published !== false;
  const isUrl = (u) => /^https?:\/\//.test(u || "");
  const monthBounds = (y, m) => {
    const first = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const last = addDays(m === 11 ? `${y + 1}-01-01` : `${y}-${String(m + 2).padStart(2, "0")}-01`, -1);
    return [first, last];
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };

  async function loadJSON(path, fallback) {
    try {
      const r = await fetch(new URL(`data/${path}.json`, BASE), { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      console.warn("could not load", path, e);
      return fallback;
    }
  }

  // ---------- data queries ----------
  const destName = () => (state.dest ? tx(state.dest.name) : "");
  const links = () => Object.assign({}, state.data.site.links || {}, (state.data.destSettings || {}).links || {});
  const hasDays = (x) => /[1-7]/.test(String(x.days || ""));
  // days_tbc: the route is known to operate but its days aren't confirmed yet (shown, clearly marked).
  const isTbc = (r) => r.days_tbc === true;
  const inPeriod = (r, date) => (r.seasons || []).some((x) => x.start <= date && date <= x.end);
  const allRoutes = () => (state.data.flights.routes || []).filter((r) => published(r) &&
    ((r.seasons || []).some(hasDays) || (isTbc(r) && (r.seasons || []).some((x) => x.end >= today()))));
  const destinations = () => (state.data.destinations.destinations || []).filter(published);

  // The operating period (season) a route flies on for a given date, or null.
  function seasonOn(r, date) {
    const wd = String(isoWeekday(date));
    return (r.seasons || []).filter(hasDays).sort((x, y) => (x.arr_time || "").localeCompare(y.arr_time || ""))
      .find((s) => s.start <= date && date <= s.end && String(s.days || "").includes(wd)) || null;
  }
  const fliesOn = (r, date) => !!seasonOn(r, date);
  // Arrival time: the period's own time first, then the route's general time.
  const arrTime = (r, s) => (s && s.arr_time) || r.arr_time || "";
  // With no date chosen: the next period still to come (else the first one).
  const nextSeason = (r) => { const ss = [...(r.seasons || [])].filter(hasDays).sort((x, y) => x.start.localeCompare(y.start)); return ss.find((x) => x.end >= today()) || ss[0]; };
  // City name in the current language (from_city_en is optional).
  const cityName = (r) => (state.lang === "en" && r.from_city_en) || r.from_city;
  const flightNo = (r, s) => (s && s.flight_no) || r.flight_no || "";

  function nextFlight(r, from, maxDays) {
    for (let i = 1; i <= (maxDays || 120); i++) { const d = addDays(from, i); if (fliesOn(r, d)) return d; }
    return null;
  }

  function routeMonths(r, year) {
    const months = new Set();
    for (const s of r.seasons || []) {
      if (!String(s.days || "").trim() && !isTbc(r)) continue;
      for (let m = 0; m < 12; m++) { const [first, last] = monthBounds(year, m); if (s.start <= last && s.end >= first) months.add(m); }
    }
    return months;
  }

  function visibleRoutes() {
    let list = allRoutes();
    if (state.dest && state.dest.airports && state.dest.airports.length) list = list.filter((r) => state.dest.airports.includes(r.to));
    if (state.origin) list = list.filter((r) => r.from_iata === state.origin);
    else if (state.date) list = list.filter((r) => fliesOn(r, state.date) || (isTbc(r) && inPeriod(r, state.date)));
    return list;
  }

  function originCity() {
    const r = allRoutes().find((x) => x.from_iata === state.origin);
    return r ? cityName(r) : "";
  }

  const allEvents = () => (state.data.events || []).filter(published);
  const eventsBetween = (from, to) => allEvents().filter((e) => e.start && e.start <= to && (e.end || e.start) >= from);
  const isTransportHoliday = (date) => eventsBetween(date, date).some((e) => e.transport === "holiday_timetable");

  // ---------- transit routing ----------
  const chainsFor = (airport, destId = DEST) => (((state.data.transit.chains || {})[destId]) || {})[airport] || [];

  function serviceActive(tr, svc, date) {
    if (!tr.window_start) return false;
    const i = Math.round((parseDate(date) - parseDate(tr.window_start)) / 86400000);
    const bits = tr.services[svc];
    return !!bits && i >= 0 && i < bits.length && bits[i] === "1";
  }

  function tripsOn(seg, date) {
    const tr = state.data.transit;
    const s = tr.segments[seg];
    if (!s) return [];
    return s.trips.filter((x) => serviceActive(tr, x[2], date)).map((x) => ({ seg, dep: x[0], arr: x[1], route: x[3], mode: s.mode, operator: s.operator }));
  }

  function itineraries(airport, date, landedMin, limit, destId = DEST) {
    const tr = state.data.transit;
    const gap = tr.min_transfer_minutes || 10;
    const results = [];
    for (const chain of chainsFor(airport, destId)) {
      const legsByStep = chain.map((seg) => tripsOn(seg, date).sort((a, b) => a.dep - b.dep));
      if (legsByStep.some((l) => !l.length)) continue;
      for (const first of legsByStep[0].filter((x) => x.dep >= landedMin + AIRPORT_EXIT_MIN)) {
        const legs = [first];
        let ok = true;
        for (let i = 1; i < legsByStep.length; i++) {
          const prev = legs[legs.length - 1];
          const next = legsByStep[i].find((x) => x.dep >= prev.arr + gap);
          if (!next) { ok = false; break; }
          legs.push(next);
        }
        if (ok) results.push(legs);
      }
    }
    // earliest arrival first; for each arrival keep the latest departure
    results.sort((a, b) => a[a.length - 1].arr - b[b.length - 1].arr || b[0].dep - a[0].dep);
    const seen = new Set();
    const unique = results.filter((l) => { const k = l[l.length - 1].arr; if (seen.has(k)) return false; seen.add(k); return true; });
    return limit ? unique.slice(0, limit) : unique;
  }

  const transitReady = () => { const tr = state.data.transit; return tr && tr.generated && tr.window_start; };
  const inWindow = (date) => { const tr = state.data.transit; return date >= tr.window_start && date <= addDays(tr.window_start, tr.window_days - 1); };

  // Last date each segment's timetable covers (operators publish theirs at different times).
  const segEndCache = {};
  function segEnd(seg) {
    if (seg in segEndCache) return segEndCache[seg];
    const tr = state.data.transit, s = tr.segments[seg];
    let last = -1;
    if (s) for (const idx of new Set(s.trips.map((x) => x[2]))) last = Math.max(last, (tr.services[idx] || "").lastIndexOf("1"));
    return (segEndCache[seg] = last < 0 ? null : addDays(tr.window_start, last));
  }
  const chainsCovered = (airport, destId, date) => chainsFor(airport, destId).flat().every((seg) => segEnd(seg) && date <= segEnd(seg));

  function typicalWeekday(airport, destId) {
    const tr = state.data.transit;
    const ok = (d) => isoWeekday(d) === 3 && !isTransportHoliday(d) && inWindow(d) && (!airport || chainsCovered(airport, destId, d));
    let d = today() > tr.window_start ? today() : tr.window_start;
    for (let i = 0; i < 60; i++, d = addDays(d, 1)) if (ok(d)) return d;
    d = today();   // nothing ahead yet: use the most recent published weekday
    for (let i = 0; i < 120; i++) { d = addDays(d, -1); if (d < tr.window_start) break; if (ok(d)) return d; }
    return null;
  }

  // The day to use for a journey: the chosen date if its timetables are published, else a typical weekday.
  function effectiveDay(airport, destId, date) {
    if (date && inWindow(date) && chainsCovered(airport, destId, date)) return { day: date, fallback: false };
    return { day: typicalWeekday(airport, destId), fallback: !!date };
  }

  // ---------- rendering ----------
  const legIcon = (mode) => (mode === "train" ? "🚆" : "🚌");
  function placeName(code) {
    const ap = state.data.site.airports.find((a) => a.code === code);
    if (ap) return ap.short || ap.name;
    const d = (state.data.destinations.destinations || []).find((x) => x.id.toUpperCase() === code);
    if (d) return tx(d.name);
    const pl = ((state.data.transitConfig || {}).places || {})[code];
    if (pl) return pl.name;
    return code.charAt(0) + code.slice(1).toLowerCase();
  }

  function renderStatic() {
    document.documentElement.lang = state.lang;
    if (has("#map-hint")) $("#map-hint").textContent = t("map_hint");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n, destName()); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang)));
    const site = state.data.site;
    const brand = tx(site.title) || "travel2sardinia";
    if (state.dest) {
      $("#site-title").textContent = destName();
      $("#tagline").textContent = tx(state.dest.tagline);
      $("#brand-name").textContent = brand;
      $("#home-link").href = new URL(`?${qs()}`, BASE).href;
      document.title = `${destName()} · ${brand}`;
      $("#orgs-link").href = `organisations/?lang=${state.lang}`;
    } else {
      $("#site-title").textContent = brand;
      $("#tagline").textContent = tx(site.tagline);
      document.title = brand;
      $("#orgs-link").href = `organisations/?lang=${state.lang}`;
    }

    // origin search box (phones) — the map handles choosing on bigger screens
    const inp = $("#origin-input");
    inp.placeholder = t("all_cities");
    if (document.activeElement !== inp) inp.value = state.origin ? `${originCity()} (${state.origin})` : "";
    $("#origin-clear").hidden = !state.origin;

    if (has("#transfer-airport")) {
      const ta = $("#transfer-airport");
      const keep = ta.value;
      const aps = site.airports.filter((a) => !state.dest.airports || state.dest.airports.includes(a.code));
      ta.innerHTML = aps.map((a) => `<option value="${a.code}">${esc(a.name)} (${a.code})</option>`).join("");
      if (keep && aps.some((a) => a.code === keep)) ta.value = keep;
      $("#transfer-time-field").hidden = !state.date;
    }
    $("#date").value = state.date;
    $("#clear-date").hidden = !state.date;
  }

  function renderBanner() {
    const b = $("#holiday-banner");
    const hol = state.date ? eventsBetween(state.date, state.date).filter((e) => e.type === "holiday" && e.transport === "holiday_timetable") : [];
    b.hidden = !hol.length;
    if (hol.length) b.textContent = `${hol.map((e) => tx(e.title)).join(" · ")} · ${t("holiday_warning")}`;
  }

  // One line for the journey card: the period on the chosen date (or the next one), and how many more.
  function scheduleShort(r) {
    if (isTbc(r)) return t("days_tbc");
    const s = state.date ? (seasonOn(r, state.date) || null) : nextSeason(r);
    if (!s) return state.date ? t("not_on_date") : "";
    const one = scheduleText(Object.assign({}, r, { seasons: [s] }));
    const more = (r.seasons || []).filter((x) => (hasDays(x) || isTbc(r)) && x.end >= today()).length - 1;
    return more > 0 ? `${one} (${t("more_periods", more)})` : one;
  }

  function scheduleText(r) {
    return [...(r.seasons || [])].filter((x) => (hasDays(x) || isTbc(r)) && x.end >= today()).sort((x, y) => x.start.localeCompare(y.start)).map((s) => {
      const a = parseDate(s.start), b = parseDate(s.end);
      const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
      const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
      const days = String(s.days || "").split("").filter((d) => /[1-7]/.test(d));
      const dayTxt = !days.length ? t("days_tbc") : days.length === 7 ? (state.lang === "it" ? "tutti i giorni" : "daily") : days.map(dayName).join(", ");
      let when;
      if (s.start === s.end) when = fmtDay(s.start, { year: "numeric" });                       // a single date
      else if (sameMonth) when = `${a.getUTCDate()}–${fmtDay(s.end, { weekday: undefined, year: "numeric" })}`; // 22–29 Dec 2026
      else {
        const from = monthName(a.getUTCFullYear(), a.getUTCMonth(), "short") + (sameYear ? "" : " " + a.getUTCFullYear());
        const to = monthName(b.getUTCFullYear(), b.getUTCMonth(), "short") + " " + b.getUTCFullYear();
        when = `${from}–${to}`;
      }
      const time = arrTime(r, s);
      return [when, s.start === s.end ? "" : dayTxt, time ? `${t("arrives")} ${time}` : ""].filter(Boolean).join(" · ");
    }).join(" / ");
  }

  function renderFlights() {
    const site = state.data.site;
    const list = visibleRoutes();
    $("#flights-intro").textContent = state.origin ? t("intro_city", originCity()) : state.date ? t("intro_date") : t("intro_all");
    const body = $("#flights-body");
    if (!list.length) { body.innerHTML = `<p class="empty">${esc(t("no_flights"))}</p>`; return; }

    let html = list.some((r) => r.sample) ? `<p class="notice">${esc(t("sample_notice"))}</p>` : "";
    for (const ap of site.airports) {
      const rows = list.filter((r) => r.to === ap.code).sort((a, b) => cityName(a).localeCompare(cityName(b), locale()));
      if (!rows.length) continue;
      html += `<h3><i class="ap-dot" style="background:${esc(ap.color || "#2f6f8f")}"></i>${esc(ap.name)} <span class="code">${ap.code}</span> <span class="count">${esc(t("flights_count", rows.length))}</span></h3><ul class="cards">`;
      for (const r of rows) {
        const season = state.date ? seasonOn(r, state.date) : null;
        const flies = state.date ? !!season : null;
        const nxt = state.date && !flies ? nextFlight(r, state.date) : null;
        const when = flies ? state.date : nxt;
        const sky = `https://www.skyscanner.net/transport/flights/${r.from_iata.toLowerCase()}/${r.to.toLowerCase()}/` + (when ? when.slice(2).replace(/-/g, "") + "/" : "");
        const goo = `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${r.from_iata} to ${r.to}` + (when ? ` on ${when}` : ""))}`;
        const status = state.date && !flies && isTbc(r) && inPeriod(r, state.date)
          ? `<span class="badge soft">${esc(t("days_tbc_check"))}</span>`
          : state.date
          ? (flies ? `<span class="badge ok">${esc(t("flies_on_date"))}</span>` : `<span class="badge soft">${esc(t("not_on_date"))}</span>${nxt ? ` <span class="meta">${esc(t("next_flight", fmtDay(nxt)))}</span>` : ""}`)
          : "";
        const connect = state.dest ? `<button type="button" class="btn ghost" data-connect="${esc(r.to)}" data-time="${esc(arrTime(r, season || nextSeason(r)))}">${esc(t("show_connection", destName()))}</button>` : "";
        html += `<li class="card">
          <div class="card-main">
            <strong>${esc(cityName(r))}</strong> <span class="code">${esc(r.from_iata)} → ${esc(r.to)}</span>
            ${r.sample ? `<span class="badge">${esc(t("sample"))}</span>` : ""}
            <div class="meta">${esc(r.airline)}${flightNo(r, season) ? ` · ${esc(flightNo(r, season))}` : ""}${season && arrTime(r, season) ? ` · ${esc(t("arrives"))} ${esc(arrTime(r, season))}` : ""}</div>
            <div class="meta sched">${esc(scheduleText(r))}</div>
            ${status ? `<div class="status">${status}</div>` : ""}
          </div>
          <div class="actions">
            <a class="btn" href="${sky}" target="_blank" rel="noopener">${esc(t("search_skyscanner"))}</a>
            <a class="btn ghost" href="${goo}" target="_blank" rel="noopener">${esc(t("search_google"))}</a>
            ${connect}
          </div></li>`;
      }
      html += "</ul>";
    }
    body.innerHTML = html;
    body.querySelectorAll("[data-connect]").forEach((b) => b.addEventListener("click", () => {
      $("#transfer-airport").value = b.dataset.connect;
      if (b.dataset.time) $("#transfer-time").value = b.dataset.time;
      renderTransfer();
      $("#transfer").scrollIntoView({ behavior: "smooth" });
    }));
  }

  function qs(extra) {
    const p = new URLSearchParams();
    p.set("lang", state.lang);
    if (state.origin) p.set("from", state.origin);
    if (state.date) p.set("date", state.date);
    for (const [k, v] of Object.entries(extra || {})) p.set(k, v);
    return p.toString();
  }

  function renderDestinations() {
    const site = state.data.site;
    const list = destinations();
    const reachable = state.origin ? new Set(allRoutes().filter((r) => r.from_iata === state.origin).map((r) => r.to)) : null;
    $("#destinations-body").innerHTML = '<ul class="cards dests">' + list.map((d) => {
      const aps = (d.airports || []).map((c) => {
        const ap = site.airports.find((a) => a.code === c);
        const on = !reachable || reachable.has(c);
        return `<span class="ap ${on ? "" : "off"}">${esc(ap ? ap.code : c)}</span>`;
      }).join(" ");
      return `<li class="card"><div class="card-main"><strong class="dest-name">${esc(tx(d.name))}</strong> <span class="meta">${esc(d.province || "")}</span>
        <p>${esc(tx(d.tagline))}</p><div class="meta">${esc(t("from_airports"))}: ${aps}</div></div>
        <div class="actions"><a class="btn" href="${esc(new URL(`${d.id}/?${qs()}`, BASE).href)}">${esc(t("open_dest", tx(d.name)))}</a></div></li>`;
    }).join("") + "</ul>";
  }

  function pathText(chain) {
    return chain.map((seg) => {
      const s = state.data.transit.segments[seg] || {};
      const [a, b] = seg.split("-");
      return `${legIcon(s.mode)} ${esc(placeName(a))} → ${esc(placeName(b))} <span class="meta">${esc(s.operator || "")}</span>`;
    }).join("<br>");
  }

  function opButtons(ops) {
    const l = links();
    const opLink = { ARST: l.arst, Trenitalia: l.trenitalia, ASPO: l.aspo };
    return ops.filter((o) => opLink[o]).map((o) => `<a class="btn ghost" href="${esc(opLink[o])}" target="_blank" rel="noopener">${esc(t("buy_ticket"))} ${esc(o)}</a>`).join("");
  }

  function renderTransfer() {
    const tr = state.data.transit;
    const body = $("#transfer-body");
    const airport = $("#transfer-airport").value;
    if (!transitReady()) { body.innerHTML = `<p class="empty">${esc(t("transit_missing"))}</p>`; return; }
    if (!chainsFor(airport).length) { body.innerHTML = `<p class="empty">${esc(t("transit_no_route"))}</p>`; return; }
    const updated = `<p class="small">${esc(t("transit_updated", fmtDay(tr.generated.slice(0, 10), { weekday: undefined, year: "numeric" })))}</p>`;

    // No date: the usual route and how often it runs.
    if (!state.date) {
      const d = typicalWeekday();
      const its = d ? itineraries(airport, d, -AIRPORT_EXIT_MIN) : [];
      const usedChain = its.length ? its[0].map((l) => l.seg) : chainsFor(airport)[0];
      let html = `<div class="itin"><div class="itin-head"><strong>${esc(t("route_path"))}</strong></div><div class="legs">${pathText(usedChain)}</div>`;
      if (its.length) {
        const durs = its.map((l) => l[l.length - 1].arr - l[0].dep).sort((a, b) => a - b);
        html += `<p>${esc(t("typical_day", its.length, hm(its[0][0].dep), hm(its[its.length - 1][0].dep)))} ${esc(t("typical_time", dur(durs[Math.floor(durs.length / 2)])))}</p>`;
        html += `<div class="actions">${opButtons([...new Set(its[0].map((l) => l.operator))])}</div>`;
      }
      body.innerHTML = html + `</div><p class="notice">${esc(t("pick_date_for_times"))}</p>${updated}`;
      return;
    }

    const eff = effectiveDay(airport, DEST, state.date);
    if (!eff.day) { body.innerHTML = `<p class="empty">${esc(t("transit_outside"))}</p>`; return; }
    const time = $("#transfer-time").value || "12:00";
    const its = itineraries(airport, eff.day, toMin(time), 3);
    let html = eff.fallback ? `<p class="notice">${esc(t("times_not_published", fmtDay(state.date)))}</p>` : "";
    if (isTransportHoliday(state.date)) html += `<p class="notice">${esc(t("holiday_warning"))}</p>`;
    if (!its.length) html += `<p class="empty">${esc(t("transit_none", time, destName()))}</p>`;
    html += '<ol class="itins">';
    for (const legs of its) {
      const last = legs[legs.length - 1];
      html += `<li class="itin"><div class="itin-head"><strong>${hm(legs[0].dep)} → ${hm(last.arr)}</strong> <span class="meta">${esc(t("arrive_dest", destName()))} · ${esc(t("total"))} ${dur(last.arr - toMin(time))}</span></div><ul class="legs">`;
      legs.forEach((l, i) => {
        const [a, b] = l.seg.split("-");
        html += `<li><span class="mode">${legIcon(l.mode)}</span> ${hm(l.dep)}–${hm(l.arr)} · ${esc(placeName(a))} → ${esc(placeName(b))} <span class="meta">${esc(l.operator)}${l.route ? " " + esc(l.route) : ""}${i > 0 ? ` · ${esc(t("change_at"))}` : ""}</span></li>`;
      });
      html += `</ul><div class="actions">${opButtons([...new Set(legs.map((l) => l.operator))])}</div></li>`;
    }
    body.innerHTML = html + "</ol>" + updated;
  }

  function renderStays() {
    const stays = ((state.data.stays || {}).stays || []).filter(published);
    const l = links();
    const body = $("#stays-body");
    const signup = l.hodlstay_host_signup_url;
    if (!stays.length) {
      body.innerHTML = `<p class="empty">${esc(t("no_stays", destName()))}</p>` +
        (signup ? `<a class="btn" href="${esc(signup)}" target="_blank" rel="noopener">${esc(t("become_host"))}</a>` : "");
      return;
    }
    body.innerHTML = '<ul class="cards">' + stays.map((s) => {
      const url = s.url || l.hodlstay_base_url;
      return `<li class="card"><div class="card-main"><strong>${esc(s.name)}</strong>
        <div class="meta">${[s.type, s.area, (s.languages || []).join(", ")].filter(Boolean).map(esc).join(" · ")}</div>
        ${tx(s.notes) ? `<p>${esc(tx(s.notes))}</p>` : ""}</div>
        ${url ? `<div class="actions"><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${esc(t("view_hodlstay"))}</a></div>` : ""}</li>`;
    }).join("") + "</ul>" +
      (signup ? `<p><a class="link-btn" href="${esc(signup)}" target="_blank" rel="noopener">${esc(t("become_host"))}</a></p>` : "");
  }

  function eventItem(e, compact) {
    const range = e.start === (e.end || e.start) ? fmtDay(e.start) : `${fmtDay(e.start)} – ${fmtDay(e.end)}`;
    const status = e.status === "pattern" ? `<span class="badge soft">${esc(t("status_pattern"))}</span>` : e.status === "tbc" ? `<span class="badge">${esc(t("status_tbc"))}</span>` : "";
    const kind = e.type === "holiday" ? `<span class="badge hol">${esc(t("holiday"))}</span>` : "";
    const main = !compact && e.highlight_days && e.highlight_days.length ? `<div class="meta">${esc(t("main_days"))}: ${e.highlight_days.map((d) => fmtDay(d)).join(", ")}</div>` : "";
    const note = !compact && tx(e.note) ? `<div class="meta">${esc(tx(e.note))}</div>` : "";
    const org = !compact && e.organiser ? `<div class="meta">${esc(t("organiser"))}: ${esc(e.organiser)}</div>` : "";
    const link = isUrl(e.url) ? `<div class="actions"><a class="btn ghost small-btn" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(t("website"))}</a></div>` : "";
    return `<li class="event ${e.type}"><div><button type="button" class="when" data-pick="${esc(e.start)}">${esc(range)}</button> ${kind}${status}</div>
      <strong>${esc(tx(e.title))}</strong>${note}${main}${org}${link}</li>`;
  }

  function renderEvents() {
    let html = "";
    if (state.date) {
      const d = state.date;
      const on = eventsBetween(d, d);
      const near = eventsBetween(addDays(d, -7), addDays(d, 14)).filter((e) => !on.includes(e));
      html += `<h3>${esc(t("on_date"))} · ${esc(fmtDay(d, { weekday: "long" }))}</h3>`;
      html += on.length ? `<ul class="events">${on.map((e) => eventItem(e)).join("")}</ul>` : `<p class="empty">${esc(t("no_events"))}</p>`;
      if (near.length) html += `<h3>${esc(t("nearby"))}</h3><ul class="events">${near.map((e) => eventItem(e)).join("")}</ul>`;
    }
    $("#events-body").innerHTML = html;

    // The year at a glance
    const year = state.data.year || Number(today().slice(0, 4));
    const all = allEvents();
    const flightMonths = new Set();
    if (state.origin) visibleRoutes().forEach((r) => routeMonths(r, year).forEach((m) => flightMonths.add(m)));
    $("#year-title").textContent = state.dest ? t("year_title", year, destName()) : t("holidays_title", year);
    $("#year-intro").textContent = state.dest ? (state.origin ? t("year_intro_city", originCity()) : t("year_intro")) : t("holidays_intro") + (state.origin ? " " + t("flights_marks", originCity()) : "");

    let yh = '<div class="months">';
    for (let m = 0; m < 12; m++) {
      const [first, last] = monthBounds(year, m);
      const items = all.filter((e) => e.start && e.start >= first && e.start <= last);
      const fly = state.origin ? (flightMonths.has(m) ? `<span class="fly yes">✈ ${esc(t("flights_month"))}</span>` : `<span class="fly no">✈ —</span>`) : "";
      const current = state.date && state.date >= first && state.date <= last ? " current" : "";
      yh += `<section class="month${current}"><h4>${esc(monthName(year, m))} ${fly}</h4>` +
        (items.length ? `<ul class="events">${items.map((e) => eventItem(e, true)).join("")}</ul>` : `<p class="empty">${esc(t("no_month_events"))}</p>`) + "</section>";
    }
    yh += "</div>";
    const tbc = all.filter((e) => !e.start);
    if (tbc.length) {
      yh += `<h4>${esc(t("tbc_title"))}</h4><ul class="events">` + tbc.map((e) =>
        `<li class="event"><strong>${esc(tx(e.title))}</strong>${e.approx ? ` <span class="meta">${esc(tx(e.approx))}</span>` : ""}${isUrl(e.url) ? `<div class="actions"><a class="btn ghost small-btn" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(t("website"))}</a></div>` : ""}</li>`).join("") + "</ul>";
    }
    $("#year-body").innerHTML = yh;

    document.querySelectorAll("#events [data-pick]").forEach((b) => b.addEventListener("click", () => {
      setDate(b.dataset.pick);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));
  }

  function renderInfo() {
    const tips = (state.data.tips || []).filter(published);
    $("#info-body").innerHTML = '<ul class="tips">' + tips.map((x) =>
      `<li><strong>${esc(tx(x.title))}</strong>${x.verified === false ? ` <span class="badge soft">${esc(t("unverified"))}</span>` : ""}<p>${esc(tx(x.body))}</p></li>`).join("") + "</ul>";
  }

  // ---------- origin search (combobox) ----------
  const norm = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const nameIn = (code, lang) => { try { return new Intl.DisplayNames([lang], { type: "region" }).of(code); } catch (e) { return code; } };
  const combo = { items: [], active: -1 };

  function originIndex() {
    const seen = new Map();
    for (const r of allRoutes()) {
      if (state.dest && state.dest.airports && !state.dest.airports.includes(r.to)) continue;
      if (seen.has(r.from_iata)) {
        const o = seen.get(r.from_iata);
        o.place += " " + norm(`${r.from_city} ${r.from_city_en || ""}`);
        if (r.from_city_en && !o.hasEn) { o.city = cityName(r); o.hasEn = true; }
        continue;
      }
      const c = r.country || "";
      seen.set(r.from_iata, {
        iata: r.from_iata, city: cityName(r), hasEn: !!r.from_city_en, country: c, countryLabel: countryName(c),
        place: norm(`${r.from_city} ${r.from_city_en || ""} ${r.from_iata}`),
        countryWords: norm([c, c === "GB" ? "uk" : "", nameIn(c, "it"), nameIn(c, "en")].join(" ")).split(/[\s-]+/).filter(Boolean)
      });
    }
    return [...seen.values()];
  }

  function yearRoundItalian(idx) {
    const year = state.data.year || Number(today().slice(0, 4));
    const ok = new Set(allRoutes().filter((r) => r.country === "IT" && (!state.dest || !state.dest.airports || state.dest.airports.includes(r.to)))
      .filter((r) => { const m = routeMonths(r, year); return m.has(0) && m.has(6); }).map((r) => r.from_iata));
    return idx.filter((o) => ok.has(o.iata));
  }

  function optionHTML(o, i) {
    return `<div class="combo-opt" role="option" id="opt-${esc(o.iata)}" data-iata="${esc(o.iata)}" data-i="${i}" aria-selected="false">${esc(o.city)} <span class="code">${esc(o.iata)}</span></div>`;
  }

  function groupedHTML(list, offset) {
    const groups = {};
    list.forEach((o) => (groups[o.countryLabel] = groups[o.countryLabel] || []).push(o));
    let html = "", i = offset || 0;
    for (const c of Object.keys(groups).sort((a, b) => a.localeCompare(b, locale()))) {
      html += `<div class="combo-group" role="presentation">${esc(c)}</div>`;
      for (const o of groups[c].sort((a, b) => a.city.localeCompare(b.city, locale()))) { combo.items[i] = o; html += optionHTML(o, i++); }
    }
    return html;
  }

  function renderCombo(q) {
    const box = $("#origin-list"), inp = $("#origin-input");
    const idx = originIndex();
    const words = norm(q).split(/\s+/).filter(Boolean);
    const matches = words.length ? idx.filter((o) => words.every((w) => o.place.includes(w) || o.countryWords.some((cw) => cw.startsWith(w)))) : idx;
    combo.items = []; combo.active = -1;
    let html = "";
    if (matches.length) {
      html = groupedHTML(matches, 0);
    } else {
      // No direct flight from what they typed: offer countries, then Italian year-round connections.
      const countries = [...new Set(idx.map((o) => o.country))].sort((a, b) => countryName(a).localeCompare(countryName(b), locale()));
      html = `<div class="combo-msg">${esc(t("no_direct", q.trim()))}</div>
        <div class="combo-msg small">${esc(t("which_country"))}</div>
        <div class="chips">${countries.map((c) => `<button type="button" class="chip" data-country="${esc(c)}">${esc(countryName(c))}</button>`).join("")}</div>`;
      const hubs = yearRoundItalian(idx);
      if (hubs.length) html += `<div class="combo-msg small">${esc(t("connect_via"))}</div>` + groupedHTML(hubs, 0);
    }
    box.innerHTML = html;
    box.hidden = false;
    inp.setAttribute("aria-expanded", "true");
    box.querySelectorAll("[data-iata]").forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); chooseOrigin(el.dataset.iata); }));
    box.querySelectorAll("[data-country]").forEach((el) => el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      inp.value = countryName(el.dataset.country);
      renderCombo(inp.value);
    }));
  }

  function closeCombo() {
    $("#origin-list").hidden = true;
    $("#origin-input").setAttribute("aria-expanded", "false");
    $("#origin-input").removeAttribute("aria-activedescendant");
  }

  function moveActive(step) {
    if (!combo.items.length) return;
    combo.active = (combo.active + step + combo.items.length) % combo.items.length;
    document.querySelectorAll("#origin-list .combo-opt").forEach((el) => el.setAttribute("aria-selected", String(Number(el.dataset.i) === combo.active)));
    const el = document.querySelector(`#origin-list .combo-opt[data-i="${combo.active}"]`);
    if (el) { el.scrollIntoView({ block: "nearest" }); $("#origin-input").setAttribute("aria-activedescendant", el.id); }
  }

  function chooseOrigin(iata) {
    closeCombo();
    $("#origin-input").blur();
    setOrigin(iata);
  }

  function initCombo() {
    const inp = $("#origin-input");
    inp.addEventListener("focus", () => { inp.select(); renderCombo(""); });
    inp.addEventListener("input", () => renderCombo(inp.value));
    inp.addEventListener("blur", () => setTimeout(() => { closeCombo(); renderStatic(); }, 120));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if ($("#origin-list").hidden) renderCombo(inp.value); moveActive(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const pick = combo.items[combo.active] || (combo.items.length === 1 ? combo.items[0] : null);
        if (pick) chooseOrigin(pick.iata);
      } else if (e.key === "Escape") { closeCombo(); inp.blur(); }
    });
    $("#origin-clear").addEventListener("click", () => { setOrigin(""); $("#origin-input").focus(); });
  }

  // ---------- the whole journey: flight → airport → town ----------
  function nodePos(code, destId) {
    const ap = state.data.site.airports.find((a) => a.code === code);
    if (ap) return [ap.lat, ap.lon];
    const d = (state.data.destinations.destinations || []).find((x) => x.id.toUpperCase() === code || x.id === destId && code === destId.toUpperCase());
    if (d) return [d.lat, d.lon];
    const pl = ((state.data.transitConfig || {}).places || {})[code];
    return pl ? [pl.lat, pl.lon] : null;
  }

  const groundCache = new Map();
  // Typical (or chosen-date) connections from an airport to a town: the usual route, how many, first/last, duration.
  function groundSummary(airport, destId, date) {
    const key = `${airport}|${destId}|${date || ""}`;
    if (groundCache.has(key)) return groundCache.get(key);
    let res = { its: [], chain: chainsFor(airport, destId)[0] || null, day: null, fallback: false };
    if (transitReady() && chainsFor(airport, destId).length) {
      const { day, fallback } = effectiveDay(airport, destId, date);
      if (day) {
        const its = itineraries(airport, day, -AIRPORT_EXIT_MIN, 0, destId);
        const counts = {};
        its.forEach((l) => { const k = l.map((x) => x.seg).join(">"); counts[k] = (counts[k] || 0) + 1; });
        const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        const durs = its.map((l) => l[l.length - 1].arr - l[0].dep).sort((a, b) => a - b);
        const firsts = its.map((l) => l[0].dep).sort((a, b) => a - b);
        res = { its, day, fallback, chain: top ? top.split(">") : res.chain, count: its.length,
                first: firsts[0], last: firsts[firsts.length - 1], dur: durs.length ? durs[Math.floor(durs.length / 2)] : null };
      }
    }
    groundCache.set(key, res);
    return res;
  }

  function routeSteps(chain) {
    return (chain || []).map((seg) => {
      const s = state.data.transit.segments[seg] || {};
      const [, b] = seg.split("-");
      return `${legIcon(s.mode)} ${esc(t(s.mode === "train" ? "by_train_to" : "by_bus_to", placeName(b)))}`;
    }).join(" → ");
  }

  // One row per leg of the trip on land: both ends, operator, boarding stop, usual time.
  const titleCase = (x) => x.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  function legRows(chain) {
    const tr = state.data.transit;
    return (chain || []).map((seg) => {
      const s = tr.segments[seg] || {};
      const [a, b] = seg.split("-");
      const d = (s.trips || []).map((x) => x[1] - x[0]).sort((x, y) => x - y);
      const typical = d.length ? d[Math.floor(d.length / 2)] : null;
      const from = ((tr.matched_stops || {})[seg] || {}).from || [];
      const meta = [s.operator, t(s.mode === "train" ? "mode_train" : "mode_bus"),
        from.length === 1 && !placeName(a).toLowerCase().includes(from[0].toLowerCase()) ? t("board_at", titleCase(from[0])) : "",
        typical != null ? `${t("about")} ${dur(typical)}` : ""].filter(Boolean).join(" · ");
      return `<li class="jleg"><span class="jicon">${legIcon(s.mode)}</span><div><strong>${esc(placeName(a))} → ${esc(placeName(b))}</strong>
        <div class="meta">${esc(meta)}</div></div></li>`;
    }).join("");
  }

  // landing time for a route on the chosen date, or for its next period
  function landingTime(r) {
    if (state.date) { const s = seasonOn(r, state.date); return s ? arrTime(r, s) : ""; }
    return arrTime(r, nextSeason(r));
  }

  // With a date: only routes that fly that day (or whose days aren't confirmed yet).
  const fliesOrMaybe = (r, date) => fliesOn(r, date) || (isTbc(r) && inPeriod(r, date));
  function journeyOptions(dest, onlyDate) {
    let routes = allRoutes().filter((r) => r.from_iata === state.origin && (!dest.airports || dest.airports.includes(r.to)));
    if (onlyDate) routes = routes.filter((r) => fliesOrMaybe(r, state.date));
    const byAirport = {};
    routes.forEach((r) => (byAirport[r.to] = byAirport[r.to] || []).push(r));
    return Object.entries(byAirport).map(([airport, rs]) => ({ airport, routes: rs, ground: groundSummary(airport, dest.id, state.date) }))
      .sort((a, b) => (a.ground.dur ?? 1e9) - (b.ground.dur ?? 1e9));
  }

  function connectionCheck(opt, dest) {
    const g = opt.ground;
    if (!g.count) return `<div class="jw warn">${esc(t("no_ground_data"))}</div>`;
    const times = [...new Set(opt.routes.map(landingTime).filter(Boolean))].sort();
    const day = g.day;
    const note = g.fallback ? `<div class="jw info">${esc(t("times_not_published", fmtDay(state.date)))}</div>` : "";
    if (!times.length) return note + `<div class="jw info">${esc(t("check_landing", hm(g.last)))}</div>`;
    return note + times.map((tm) => {
      const its = itineraries(opt.airport, day, toMin(tm), 1, dest.id);
      if (its.length) {
        const l = its[0];
        return `<div class="jw ok">✓ ${esc(t("lands_next", tm, hm(l[0].dep), hm(l[l.length - 1].arr), tx(dest.name)))}</div>`;
      }
      return `<div class="jw warn">⚠ ${esc(t("lands_too_late", tm, hm(g.last), tx(dest.name), placeName(opt.airport)))}</div>`;
    }).join("");
  }

  function renderJourney() {
    const box = $("#journey");
    if (!box) return;
    if (!state.origin) { box.hidden = true; return; }
    const dests = state.dest ? [state.dest] : destinations();
    let html = "";
    for (const dest of dests) {
      let opts = state.date ? journeyOptions(dest, true) : journeyOptions(dest);
      if (state.date && !opts.length) {
        opts = journeyOptions(dest);
        if (opts.length) html += `<p class="notice">${esc(t("no_flight_on_date", originCity()))}</p>`;
      }
      if (!opts.length) continue;
      if (!state.dest && dests.length > 1) html += `<h3 class="jdest">→ ${esc(tx(dest.name))}</h3>`;
      opts.forEach((o, i) => {
        const ap = state.data.site.airports.find((a) => a.code === o.airport) || {};
        const airlines = [...new Set(o.routes.map((r) => r.airline))].join(", ");
        const g = o.ground;
        const groundLine = g.count
          ? `${esc(t("on_land_total", dur(g.dur)))} · ${esc(t(state.date && !g.fallback ? "connections_on_date" : "connections_day", g.count, hm(g.first), hm(g.last)))}`
          : "";
        html += `<div class="jopt" style="--ap:${esc(ap.color || "#2f6f8f")}">
          ${opts.length > 1 && i === 0 ? `<span class="badge ok jbest">${esc(t("quickest_on_land"))}</span>` : ""}
          <ol class="jsteps">
            <li><span class="jicon">✈</span><div><strong>${esc(cityName(o.routes[0]))} → ${esc(ap.name || o.airport)}</strong>
              <div class="meta">${esc(airlines)} · ${esc(o.routes.map(scheduleShort).filter(Boolean).join(" / ") || t("days_tbc"))}</div></div></li>
            ${legRows(g.chain)}
            <li class="jsum"><span class="jicon">⏱</span><div>${groundLine ? `<div class="meta">${groundLine}</div>` : ""}${connectionCheck(o, dest)}</div></li>
          </ol></div>`;
      });
    }
    $("#journey-title").textContent = t("journey_title");
    $("#journey-body").innerHTML = html || `<p class="empty">${esc(t("no_flights"))}</p>`;
    box.hidden = false;
  }

  // ---------- home: Accommodation and Events cards (one block per town) ----------
  const destLink = (dest, hash) => new URL(`${dest.id}/?${qs()}${hash}`, BASE).href;

  function renderHomeCards() {
    const sc = $("#stays-card"), ec = $("#events-card");
    if (!sc || !ec) return;
    const show = !!state.origin;
    sc.hidden = ec.hidden = !show;
    if (!show) return;
    const dests = destinations().filter((d) => journeyOptions(d).length);
    const many = dests.length > 1;
    let sh = "", eh = "";
    for (const dest of dests) {
      const dd = (state.data.destData || {})[dest.id] || {};
      const name = tx(dest.name);
      if (many) { sh += `<h3 class="jdest">${esc(name)}</h3>`; eh += `<h3 class="jdest">${esc(name)}</h3>`; }

      const stays = (dd.stays || []).filter(published);
      sh += stays.length
        ? `<ul class="cards">${stays.slice(0, 3).map((s) => `<li class="card"><div class="card-main"><strong>${esc(s.name)}</strong>
            <div class="meta">${[s.type, s.area].filter(Boolean).map(esc).join(" · ")}</div></div></li>`).join("")}</ul>`
        : `<p class="empty">${esc(t("no_stays", name))}</p>`;
      sh += `<p><a class="btn small-btn" href="${esc(destLink(dest, "#stays"))}">${esc(t("all_stays", name, stays.length))}</a></p>`;

      const evs = (dd.events || []).filter((e) => published(e) && e.start);
      let list, head;
      if (state.date) {
        const from = addDays(state.date, -7), to = addDays(state.date, 14);
        list = evs.filter((e) => e.start <= to && (e.end || e.start) >= from);
        head = t("around_date", fmtDay(state.date));
      } else {
        list = evs.filter((e) => (e.end || e.start) >= today());
        head = t("coming_up");
      }
      list = list.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5);
      eh += `<h4 class="evhead">${esc(head)}</h4>` + (list.length
        ? `<ul class="events">${list.map((e) => eventItem(e, true)).join("")}</ul>`
        : `<p class="empty">${esc(t("no_events_near"))}</p>`);
      eh += `<p><a class="btn small-btn" href="${esc(destLink(dest, "#events"))}">${esc(t("full_calendar", name))}</a></p>`;
    }
    $("#stays-card-body").innerHTML = sh;
    $("#events-card-body").innerHTML = eh;
    document.querySelectorAll("#events-card [data-pick]").forEach((b) => b.addEventListener("click", () => {
      setDate(b.dataset.pick);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }));
  }

  // ---------- feedback (report an error) ----------
  // Goes to the town's feedback/coordinator link, else the island's. mailto: and wa.me links get the message prefilled.
  function feedbackChannel() {
    const d = (state.data.destSettings || {}).links || {};
    const s = state.data.site.links || {};
    return [d.feedback_url, d.coordinator_contact_url, s.feedback_url, s.network_contact_url]
      .find((u) => /^(https?:\/\/|mailto:)/.test(u || "")) || "";
  }

  function renderFeedback() {
    const btn = $("#feedback-open");
    if (!btn) return;
    btn.hidden = !feedbackChannel();
    const opts = t(state.dest ? "fb_sections_dest" : "fb_sections_home");
    const sel = $("#fb-section");
    const keep = sel.selectedIndex;
    sel.innerHTML = opts.map((o) => `<option>${esc(o)}</option>`).join("");
    if (keep > 0) sel.selectedIndex = keep;
  }

  function sendFeedback() {
    const url = feedbackChannel();
    const text = $("#fb-text").value.trim();
    if (!url || !text) return;
    const brand = tx(state.data.site.title) || "travel2sardinia";
    const place = state.dest ? destName() : (state.lang === "it" ? "Sardegna" : "Sardinia");
    const subject = `[${brand}] ${place} · ${$("#fb-section").value}`;
    const body = `${text}\n\n— ${location.href}`;
    let target = url;
    if (url.startsWith("mailto:")) {
      target = url + (url.includes("?") ? "&" : "?") + `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    } else if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(url)) {
      const u = new URL(url);
      u.searchParams.set("text", `${subject}\n\n${body}`);
      target = u.href;
    }
    window.open(target, "_blank", "noopener");
    $("#fb-text").value = "";
    $("#feedback").close();
  }

  // ---------- map ----------
  function initMap() {
    if (!window.L) return;
    state.map = L.map("map", { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(state.map);
    state.layers = L.layerGroup().addTo(state.map);
    const Legend = L.Control.extend({ onAdd() { const d = L.DomUtil.create("div", "map-legend"); d.id = "map-legend"; return d; } });
    new Legend({ position: "topright" }).addTo(state.map);
    // On tablets and computers the map is a way to choose a city; phones use the search box.
    if (window.matchMedia && window.matchMedia("(min-width: 700px) and (hover: hover), (min-width: 700px) and (pointer: coarse)").matches) {
      const Hint = L.Control.extend({ onAdd() { const d = L.DomUtil.create("div", "map-hint"); d.id = "map-hint"; d.textContent = t("map_hint"); return d; } });
      new Hint({ position: "bottomleft" }).addTo(state.map);
    }
    const c = state.dest || state.data.site.center || { lat: 40.05, lon: 9.0 };
    state.map.setView([c.lat, c.lon], 7);
  }

  // Each Sardinian airport has its own colour; a departure city takes the colour of the airport it
  // flies to, or the "several" colour when it flies to more than one.
  const MULTI_COLOR = "#5b5450";
  const airportColor = (code) => ((state.data.site.airports || []).find((a) => a.code === code) || {}).color || "#2f6f8f";
  const originColor = (codes) => (codes.size === 1 ? airportColor([...codes][0]) : MULTI_COLOR);

  function legendHTML() {
    const aps = (state.data.site.airports || []).filter((a) => !state.dest || !state.dest.airports || state.dest.airports.includes(a.code));
    return aps.map((a) => `<span class="lg"><i style="background:${esc(a.color || "#2f6f8f")}"></i>${esc(a.short || a.name)}</span>`).join("") +
      `<span class="lg"><i style="background:${MULTI_COLOR}"></i>${esc(t("several_airports"))}</span>`;
  }

  function renderMap(fit) {
    if (!state.map) return;
    const site = state.data.site;
    const g = state.layers;
    g.clearLayers();
    if (has("#map-legend")) $("#map-legend").innerHTML = legendHTML();
    const apPos = Object.fromEntries(site.airports.map((a) => [a.code, [a.lat, a.lon]]));
    const routes = visibleRoutes().filter((r) => r.lat != null && r.lon != null && apPos[r.to]);
    const used = state.origin ? new Set(routes.map((r) => r.to)) : new Set(state.dest && state.dest.airports ? state.dest.airports : Object.keys(apPos));

    // which Sardinian airports each departure city flies to (for its colour)
    const reach = (list) => {
      const m = new Map();
      for (const r of list) { if (r.lat == null) continue; if (!m.has(r.from_iata)) m.set(r.from_iata, { r, to: new Set() }); m.get(r.from_iata).to.add(r.to); }
      return m;
    };
    const allReach = reach(allRoutes().filter((r) => !state.dest || !state.dest.airports || state.dest.airports.includes(r.to)));
    const shownReach = reach(routes);

    // every other departure city as a small, faded clickable dot, so another city can be chosen from the map
    for (const [iata, o] of allReach) {
      if (shownReach.has(iata)) continue;
      const c = originColor(o.to);
      L.circleMarker([o.r.lat, o.r.lon], { radius: 4, color: c, fillColor: c, fillOpacity: 0.35, weight: 1.5, opacity: 0.7 })
        .bindTooltip(`${cityName(o.r)} (${iata}) · ${t("pick_on_map")}`, { direction: "top" })
        .on("click", () => setOrigin(iata)).addTo(g);
    }
    // routes: each line in the colour of the airport it flies to
    for (const r of routes) {
      L.polyline([[r.lat, r.lon], apPos[r.to]], { color: airportColor(r.to), weight: state.origin ? 2.5 : 1.5, opacity: state.origin ? 0.9 : 0.55 }).addTo(g);
    }
    for (const [iata, o] of shownReach) {
      const c = originColor(o.to);
      L.circleMarker([o.r.lat, o.r.lon], { radius: state.origin ? 7 : 5, color: "#fff", fillColor: c, fillOpacity: 1, weight: 1.5 })
        .bindTooltip(`${cityName(o.r)} (${iata}) → ${[...o.to].join(", ")}`, { permanent: !!state.origin, direction: "top" })
        .on("click", () => setOrigin(iata)).addTo(g);
    }
    const dests = state.dest ? [state.dest] : destinations();
    // the journey on land, following the real route: train solid, bus dashed, a dot where you change
    const groundPairs = [];
    for (const d of dests) {
      const aps = state.origin ? [...used].filter((c) => !d.airports || d.airports.includes(c)) : (state.dest ? (d.airports || []) : []);
      aps.forEach((c) => groundPairs.push([c, d]));
    }
    const changePoints = new Map();
    for (const [code, d] of groundPairs) {
      const chain = groundSummary(code, d.id, state.date).chain;
      if (!chain) continue;
      const dim = state.origin && !used.has(code);
      chain.forEach((seg, i) => {
        const [a, b] = seg.split("-");
        const pa = nodePos(a, d.id), pb = nodePos(b, d.id);
        if (!pa || !pb) return;
        const mode = (state.data.transit.segments[seg] || {}).mode;
        L.polyline([pa, pb], { color: airportColor(code), weight: 3, opacity: dim ? 0.3 : 0.95, dashArray: mode === "bus" ? "6 6" : null }).addTo(g);
        if (i > 0) changePoints.set(a, pa);
      });
    }
    for (const [code, pos] of changePoints) {
      L.circleMarker(pos, { radius: 4, color: "#2b2622", fillColor: "#fff", fillOpacity: 1, weight: 1.5 })
        .bindTooltip(t("change_at_place", placeName(code)), { direction: "top" }).addTo(g);
    }
    for (const a of site.airports) {
      const on = used.has(a.code);
      L.circleMarker(apPos[a.code], { radius: 9, color: "#2b2622", fillColor: a.color || "#2f6f8f", fillOpacity: on ? 1 : 0.3, weight: 2, opacity: on ? 1 : 0.4 })
        .bindTooltip(`${a.name} (${a.code})`, { permanent: !!state.dest && on, direction: "left", className: "ap-label" }).addTo(g);
    }
    for (const d of dests) {
      // a soft pulsing ring behind the town's dot; the name shows on hover/tap
      L.circleMarker([d.lat, d.lon], { radius: 8, stroke: false, fillColor: "#000", fillOpacity: 0.5, interactive: false, className: "dest-pulse" }).addTo(g);
      const m = L.circleMarker([d.lat, d.lon], { radius: 8, color: "#000", fillColor: "#fff", fillOpacity: 1, weight: 2.5 })
        .bindTooltip(tx(d.name), { direction: "right", className: "dest-label" }).addTo(g);
      if (!state.dest) m.on("click", () => { location.href = new URL(`${d.id}/?${qs()}`, BASE).href; });
    }

    const island = [...Object.values(apPos), ...dests.map((d) => [d.lat, d.lon])];
    if (fit === "everything") {
      // "All routes" button: show every origin city so another one can be picked on the map
      const pts = [...allReach.values()].map((o) => [o.r.lat, o.r.lon]);
      state.map.fitBounds(L.latLngBounds([...island, ...pts]).pad(0.1));
    } else if (fit === "sardinia" || !routes.length) state.map.fitBounds(L.latLngBounds(island).pad(0.2));
    else if (fit) state.map.fitBounds(L.latLngBounds([...dests.map((d) => [d.lat, d.lon]), ...routes.map((r) => [r.lat, r.lon])]).pad(0.15));
  }

  // ---------- wiring ----------
  function syncURL() {
    const u = new URL(location.href);
    for (const [k, v] of [["lang", state.lang], ["from", state.origin], ["date", state.date]]) {
      if (v) u.searchParams.set(k, v); else u.searchParams.delete(k);
    }
    history.replaceState(null, "", u);
  }

  function renderAll(fit) {
    renderStatic();
    renderBanner();
    renderFlights();
    if (has("#destinations-body")) renderDestinations();
    renderJourney();
    renderHomeCards();
    if (has("#transfer-body")) renderTransfer();
    if (has("#stays-body")) renderStays();
    renderEvents();
    renderInfo();
    renderFeedback();
    renderMap(fit === undefined ? "all" : fit);
  }

  function setDate(d) { state.date = d || ""; syncURL(); renderAll(); }

  function setOrigin(o) {
    state.origin = o || "";
    store.set("t2s-from", state.origin);
    const r = visibleRoutes()[0];
    if (r && has("#transfer-airport")) { $("#transfer-airport").value = r.to; const tm = arrTime(r, state.date ? seasonOn(r, state.date) : nextSeason(r)); if (tm) $("#transfer-time").value = tm; }
    syncURL();
    renderAll();
  }

  function setLang(l) {
    state.lang = I18N[l] ? l : "en";
    store.set("t2s-lang", state.lang);
    syncURL();
    renderAll(null);
  }

  function defaultLang() {
    const host = location.hostname;
    if (/sardegna/i.test(host)) return "it";   // travel2sardegna.com
    if (/sardinia/i.test(host)) return "en";   // travel2sardinia.com
    return (navigator.language || "en").slice(0, 2) === "it" ? "it" : "en";
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    state.lang = params.get("lang") || store.get("t2s-lang") || defaultLang();
    if (!I18N[state.lang]) state.lang = "en";
    const d = params.get("date") || "";
    state.date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";

    const [site, flights, holidays, dests, tips, transit, transitConfig] = await Promise.all([
      loadJSON("site", { airports: [], links: {} }),
      loadJSON("flights", { routes: [] }),
      loadJSON("holidays", { events: [] }),
      loadJSON("destinations", { destinations: [] }),
      loadJSON("info", { tips: [] }),
      loadJSON("transit", { generated: null, segments: {}, services: [], chains: {} }),
      loadJSON("transit-config", { places: {} })
    ]);
    state.data = { site, flights, destinations: dests, transit, transitConfig, events: holidays.events || [], tips: tips.tips || [], year: holidays.year };

    if (!DEST) {
      // The home page shows each town's stays and events in its own cards.
      state.data.destData = {};
      await Promise.all((dests.destinations || []).filter(published).map(async (d) => {
        const [events, stays] = await Promise.all([
          loadJSON(`destinations/${d.id}/events`, { events: [] }),
          loadJSON(`destinations/${d.id}/stays`, { stays: [] })
        ]);
        state.data.destData[d.id] = { events: events.events || [], stays: stays.stays || [] };
      }));
    }

    if (DEST) {
      state.dest = (dests.destinations || []).find((x) => x.id === DEST) || { id: DEST, name: { it: DEST, en: DEST }, lat: 40.05, lon: 9.0 };
      const [destSettings, events, stays, info] = await Promise.all([
        loadJSON(`destinations/${DEST}/destination`, { links: {} }),
        loadJSON(`destinations/${DEST}/events`, { events: [] }),
        loadJSON(`destinations/${DEST}/stays`, { stays: [] }),
        loadJSON(`destinations/${DEST}/info`, { tips: [] })
      ]);
      state.data.destSettings = destSettings;
      state.data.stays = stays;
      state.data.events = state.data.events.concat(events.events || []);
      state.data.tips = (info.tips || []).concat(state.data.tips);
      state.data.year = events.year || state.data.year;
    }

    const from = params.get("from") || store.get("t2s-from") || "";
    state.origin = allRoutes().some((r) => r.from_iata === from && (!state.dest || !state.dest.airports || state.dest.airports.includes(r.to))) ? from : "";

    $("#date").addEventListener("change", (e) => setDate(e.target.value));
    $("#clear-date").addEventListener("click", () => setDate(""));
    initCombo();
    document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
    if (has("#transfer-airport")) {
      $("#transfer-airport").addEventListener("change", renderTransfer);
      $("#transfer-time").addEventListener("change", renderTransfer);
    }
    $("#fit-all").addEventListener("click", () => renderMap("everything"));
    if (has("#feedback")) {
      $("#feedback-open").addEventListener("click", () => {
        $("#feedback").showModal();
        $("#fb-text").focus();
      });
      $("#fb-cancel").addEventListener("click", () => $("#feedback").close());
      $("#feedback-form").addEventListener("submit", (e) => { e.preventDefault(); sendFeedback(); });
    }
    $("#fit-sardinia").addEventListener("click", () => renderMap("sardinia"));

    initMap();
    renderStatic();
    const r = visibleRoutes()[0];
    if (r && state.origin && has("#transfer-airport")) {
      $("#transfer-airport").value = r.to;
      const tm = arrTime(r, state.date ? seasonOn(r, state.date) : nextSeason(r));
      if (tm) $("#transfer-time").value = tm;
    }
    renderAll();
  }

  init();
})();
