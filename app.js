/* travel2bosa: static information app. No backend: everything is read from /data.
   Level 1 (travellers): start from your city; the date is optional. */
(function () {
  "use strict";

  const AIRPORT_EXIT_MIN = 30; // time from landing to the first bus/train
  const state = { lang: "it", origin: "", date: "", data: {}, map: null, layers: null };

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
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
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };

  async function loadJSON(name, fallback) {
    try {
      const r = await fetch(`data/${name}.json`, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) {
      console.warn("could not load", name, e);
      return fallback;
    }
  }

  // ---------- data queries ----------
  const allRoutes = () => (state.data.flights.routes || []).filter(published);
  const airportName = (code) => (state.data.site.airports.find((a) => a.code === code) || { name: code }).name;

  function fliesOn(r, date) {
    const wd = String(isoWeekday(date));
    return (r.seasons || []).some((s) => s.start <= date && date <= s.end && String(s.days || "").includes(wd));
  }

  function nextFlight(r, from, maxDays) {
    for (let i = 1; i <= (maxDays || 120); i++) { const d = addDays(from, i); if (fliesOn(r, d)) return d; }
    return null;
  }

  function routeMonths(r, year) {
    const months = new Set();
    for (const s of r.seasons || []) {
      if (!String(s.days || "").trim()) continue;
      for (let m = 0; m < 12; m++) {
        const first = `${year}-${String(m + 1).padStart(2, "0")}-01`;
        const last = addDays(m === 11 ? `${year + 1}-01-01` : `${year}-${String(m + 2).padStart(2, "0")}-01`, -1);
        if (s.start <= last && s.end >= first) months.add(m);
      }
    }
    return months;
  }

  function visibleRoutes() {
    let list = allRoutes();
    if (state.origin) list = list.filter((r) => r.from_iata === state.origin);
    else if (state.date) list = list.filter((r) => fliesOn(r, state.date));
    return list;
  }

  function originCity() {
    const r = allRoutes().find((x) => x.from_iata === state.origin);
    return r ? r.from_city : "";
  }

  function eventsBetween(from, to) {
    return (state.data.events.events || []).filter((e) => published(e) && e.start && e.start <= to && (e.end || e.start) >= from);
  }

  const isTransportHoliday = (date) => eventsBetween(date, date).some((e) => e.transport === "holiday_timetable");

  // ---------- transit routing ----------
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

  function itineraries(airport, date, landedMin, limit) {
    const tr = state.data.transit;
    const chains = (tr.chains || {})[airport] || [];
    const gap = tr.min_transfer_minutes || 10;
    const results = [];
    for (const chain of chains) {
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

  function transitReady() {
    const tr = state.data.transit;
    return tr && tr.generated && tr.window_start;
  }

  function inWindow(date) {
    const tr = state.data.transit;
    return date >= tr.window_start && date <= addDays(tr.window_start, tr.window_days - 1);
  }

  function typicalWeekday() {
    const tr = state.data.transit;
    let d = today() > tr.window_start ? today() : tr.window_start;
    for (let i = 0; i < 60; i++, d = addDays(d, 1)) {
      if (isoWeekday(d) === 3 && !isTransportHoliday(d) && inWindow(d)) return d;
    }
    return null;
  }

  // ---------- rendering ----------
  const AIRPORT_NAMES = { AHO: "Alghero Aeroporto", CAG: "Cagliari Aeroporto", OLB: "Olbia Aeroporto" };
  const cap = (s) => AIRPORT_NAMES[s] || (s.charAt(0) + s.slice(1).toLowerCase());
  const legIcon = (mode) => (mode === "train" ? "🚆" : "🚌");

  function renderStatic() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang)));
    const site = state.data.site;
    $("#site-title").textContent = tx(site.title) || "Travel to Bosa";
    $("#tagline").textContent = tx(site.tagline);
    document.title = tx(site.title) || "Travel to Bosa";
    $("#orgs-link").href = `organisations/?lang=${state.lang}`;

    // origin picker: unique cities grouped by country
    const byCountry = {};
    for (const r of allRoutes()) {
      const c = countryName(r.country || "");
      (byCountry[c] = byCountry[c] || new Map()).set(r.from_iata, r.from_city);
    }
    const sel = $("#origin");
    sel.innerHTML = `<option value="">${esc(t("all_cities"))}</option>` +
      Object.keys(byCountry).sort((a, b) => a.localeCompare(b, locale())).map((c) =>
        `<optgroup label="${esc(c)}">` + [...byCountry[c]].sort((a, b) => a[1].localeCompare(b[1], locale()))
          .map(([iata, city]) => `<option value="${esc(iata)}">${esc(city)} (${esc(iata)})</option>`).join("") + "</optgroup>").join("");
    sel.value = state.origin;

    const ta = $("#transfer-airport");
    const keep = ta.value;
    ta.innerHTML = site.airports.map((a) => `<option value="${a.code}">${esc(a.name)} (${a.code})</option>`).join("");
    if (keep) ta.value = keep;

    $("#date").value = state.date;
    $("#clear-date").hidden = !state.date;
    $("#transfer-time-field").hidden = !state.date;
  }

  function renderBanner() {
    const b = $("#holiday-banner");
    const hol = state.date ? eventsBetween(state.date, state.date).filter((e) => e.type === "holiday") : [];
    if (hol.length && isTransportHoliday(state.date)) {
      b.hidden = false;
      b.textContent = `${hol.map((e) => tx(e.title)).join(" · ")} · ${t("holiday_warning")}`;
    } else b.hidden = true;
  }

  function scheduleText(r) {
    return (r.seasons || []).map((s) => {
      const a = parseDate(s.start), b = parseDate(s.end);
      const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
      const from = monthName(a.getUTCFullYear(), a.getUTCMonth(), "short") + (sameYear ? "" : " " + a.getUTCFullYear());
      const to = monthName(b.getUTCFullYear(), b.getUTCMonth(), "short") + " " + b.getUTCFullYear();
      const days = String(s.days || "").split("").filter((d) => /[1-7]/.test(d));
      const dayTxt = days.length === 7 ? (state.lang === "it" ? "tutti i giorni" : "daily") : days.map(dayName).join(", ");
      return `${from}–${to} · ${dayTxt}`;
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
      const rows = list.filter((r) => r.to === ap.code).sort((a, b) => a.from_city.localeCompare(b.from_city, locale()));
      if (!rows.length) continue;
      html += `<h3>${esc(ap.name)} <span class="code">${ap.code}</span> <span class="count">${esc(t("flights_count", rows.length))}</span></h3><ul class="cards">`;
      for (const r of rows) {
        const flies = state.date ? fliesOn(r, state.date) : null;
        const nxt = state.date && !flies ? nextFlight(r, state.date) : null;
        const when = flies ? state.date : nxt;
        const sky = `https://www.skyscanner.net/transport/flights/${r.from_iata.toLowerCase()}/${r.to.toLowerCase()}/` + (when ? when.slice(2).replace(/-/g, "") + "/" : "");
        const goo = `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${r.from_iata} to ${r.to}` + (when ? ` on ${when}` : ""))}`;
        const status = state.date
          ? (flies ? `<span class="badge ok">${esc(t("flies_on_date"))}</span>` : `<span class="badge soft">${esc(t("not_on_date"))}</span>${nxt ? ` <span class="meta">${esc(t("next_flight", fmtDay(nxt)))}</span>` : ""}`)
          : "";
        html += `<li class="card">
          <div class="card-main">
            <strong>${esc(r.from_city)}</strong> <span class="code">${esc(r.from_iata)} → ${esc(r.to)}</span>
            ${r.sample ? `<span class="badge">${esc(t("sample"))}</span>` : ""}
            <div class="meta">${esc(r.airline)}${r.arr_time ? ` · ${esc(t("arrives"))} ${esc(r.arr_time)}` : ""}</div>
            <div class="meta sched">${esc(scheduleText(r))}</div>
            ${status ? `<div class="status">${status}</div>` : ""}
          </div>
          <div class="actions">
            <a class="btn" href="${sky}" target="_blank" rel="noopener">${esc(t("search_skyscanner"))}</a>
            <a class="btn ghost" href="${goo}" target="_blank" rel="noopener">${esc(t("search_google"))}</a>
            <button type="button" class="btn ghost" data-connect="${esc(r.to)}" data-time="${esc(r.arr_time || "")}">${esc(t("show_connection"))}</button>
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

  function pathText(chain) {
    return chain.map((seg) => {
      const s = state.data.transit.segments[seg] || {};
      const [a, b] = seg.split("-");
      return `${legIcon(s.mode)} ${esc(cap(a))} → ${esc(cap(b))} <span class="meta">${esc(s.operator || "")}</span>`;
    }).join("<br>");
  }

  function opButtons(ops) {
    const links = state.data.site.links || {};
    const opLink = { ARST: links.arst, Trenitalia: links.trenitalia, ASPO: links.aspo };
    return ops.filter((o) => opLink[o]).map((o) => `<a class="btn ghost" href="${esc(opLink[o])}" target="_blank" rel="noopener">${esc(t("buy_ticket"))} ${esc(o)}</a>`).join("");
  }

  function renderTransfer() {
    const tr = state.data.transit;
    const body = $("#transfer-body");
    const airport = $("#transfer-airport").value;
    if (!transitReady()) { body.innerHTML = `<p class="empty">${esc(t("transit_missing"))}</p>`; return; }
    const updated = `<p class="small">${esc(t("transit_updated", fmtDay(tr.generated.slice(0, 10), { weekday: undefined, year: "numeric" })))}</p>`;

    // No date: a plain overview of the usual route and how often it runs.
    if (!state.date) {
      const d = typicalWeekday();
      const its = d ? itineraries(airport, d, -AIRPORT_EXIT_MIN) : [];
      const chains = (tr.chains || {})[airport] || [];
      const usedChain = its.length ? its[0].map((l) => l.seg) : chains[0] || [];
      let html = `<div class="itin"><div class="itin-head"><strong>${esc(t("route_path"))}</strong></div><div class="legs">${pathText(usedChain)}</div>`;
      if (its.length) {
        const durs = its.map((l) => l[l.length - 1].arr - l[0].dep).sort((a, b) => a - b);
        html += `<p>${esc(t("typical_day", its.length, hm(its[0][0].dep), hm(its[its.length - 1][0].dep)))} ${esc(t("typical_time", dur(durs[Math.floor(durs.length / 2)])))}</p>`;
        html += `<div class="actions">${opButtons([...new Set(its[0].map((l) => l.operator))])}</div>`;
      }
      html += `</div><p class="notice">${esc(t("pick_date_for_times"))}</p>${updated}`;
      body.innerHTML = html;
      return;
    }

    if (!inWindow(state.date)) { body.innerHTML = `<p class="empty">${esc(t("transit_outside"))}</p>`; return; }
    const time = $("#transfer-time").value || "12:00";
    const its = itineraries(airport, state.date, toMin(time), 3);
    let html = "";
    if (isTransportHoliday(state.date)) html += `<p class="notice">${esc(t("holiday_warning"))}</p>`;
    if (!its.length) html += `<p class="empty">${esc(t("transit_none", time))}</p>`;
    html += '<ol class="itins">';
    for (const legs of its) {
      const last = legs[legs.length - 1];
      html += `<li class="itin"><div class="itin-head"><strong>${hm(legs[0].dep)} → ${hm(last.arr)}</strong> <span class="meta">${esc(t("arrive_bosa"))} · ${esc(t("total"))} ${dur(last.arr - toMin(time))}</span></div><ul class="legs">`;
      legs.forEach((l, i) => {
        const [a, b] = l.seg.split("-");
        html += `<li><span class="mode">${legIcon(l.mode)}</span> ${hm(l.dep)}–${hm(l.arr)} · ${esc(cap(a))} → ${esc(cap(b))} <span class="meta">${esc(l.operator)}${l.route ? " " + esc(l.route) : ""}${i > 0 ? ` · ${esc(t("change_at"))}` : ""}</span></li>`;
      });
      html += `</ul><div class="actions">${opButtons([...new Set(legs.map((l) => l.operator))])}</div></li>`;
    }
    body.innerHTML = html + "</ol>" + updated;
  }

  function renderStays() {
    const stays = (state.data.stays.stays || []).filter(published);
    const links = state.data.site.links || {};
    const body = $("#stays-body");
    const signup = links.hodlstay_host_signup_url;
    if (!stays.length) {
      body.innerHTML = `<p class="empty">${esc(t("no_stays"))}</p>` +
        (signup ? `<a class="btn" href="${esc(signup)}" target="_blank" rel="noopener">${esc(t("become_host"))}</a>` : "");
      return;
    }
    body.innerHTML = '<ul class="cards">' + stays.map((s) => {
      const url = s.url || links.hodlstay_base_url;
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
    // Around the chosen date
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
    const ev = state.data.events;
    const year = ev.year || Number(today().slice(0, 4));
    const all = (ev.events || []).filter(published);
    const flightMonths = new Set();
    if (state.origin) allRoutes().filter((r) => r.from_iata === state.origin).forEach((r) => routeMonths(r, year).forEach((m) => flightMonths.add(m)));
    $("#year-title").textContent = t("year_title", year);
    $("#year-intro").textContent = state.origin ? t("year_intro_city", originCity()) : t("year_intro");

    let yh = '<div class="months">';
    for (let m = 0; m < 12; m++) {
      const first = `${year}-${String(m + 1).padStart(2, "0")}-01`;
      const last = addDays(m === 11 ? `${year + 1}-01-01` : `${year}-${String(m + 2).padStart(2, "0")}-01`, -1);
      const items = all.filter((e) => e.start && e.start <= last && (e.end || e.start) >= first && e.start >= first);
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
    const tips = (state.data.info.tips || []).filter(published);
    $("#info-body").innerHTML = '<ul class="tips">' + tips.map((x) =>
      `<li><strong>${esc(tx(x.title))}</strong>${x.verified === false ? ` <span class="badge soft">${esc(t("unverified"))}</span>` : ""}<p>${esc(tx(x.body))}</p></li>`).join("") + "</ul>";
  }

  // ---------- map ----------
  function initMap() {
    if (!window.L) return;
    state.map = L.map("map", { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(state.map);
    state.layers = L.layerGroup().addTo(state.map);
    const site = state.data.site;
    state.map.setView([site.bosa.lat, site.bosa.lon], 7);
  }

  function renderMap(fit) {
    if (!state.map) return;
    const site = state.data.site;
    const g = state.layers;
    g.clearLayers();
    const bosa = [site.bosa.lat, site.bosa.lon];
    const apPos = Object.fromEntries(site.airports.map((a) => [a.code, [a.lat, a.lon]]));
    const routes = visibleRoutes().filter((r) => r.lat != null && r.lon != null && apPos[r.to]);
    const usedAirports = state.origin ? new Set(routes.map((r) => r.to)) : new Set(Object.keys(apPos));

    for (const r of routes) {
      L.polyline([[r.lat, r.lon], apPos[r.to]], { color: "#2f6f8f", weight: state.origin ? 2.5 : 1.5, opacity: 0.7 }).addTo(g);
      L.circleMarker([r.lat, r.lon], { radius: state.origin ? 7 : 5, color: "#2f6f8f", fillColor: "#fff", fillOpacity: 1, weight: 2 })
        .bindTooltip(`${r.from_city} (${r.from_iata}) → ${r.to}`, { permanent: !!state.origin, direction: "top" }).addTo(g);
    }
    for (const a of site.airports) {
      const on = usedAirports.has(a.code);
      L.polyline([apPos[a.code], bosa], { color: "#c4573a", weight: 2, dashArray: "5 6", opacity: on ? 1 : 0.25 }).addTo(g);
      L.circleMarker(apPos[a.code], { radius: 7, color: "#2b2622", fillColor: on ? "#d9a441" : "#e9dfc9", fillOpacity: 1, weight: 2 })
        .bindTooltip(`${a.name} (${a.code})`).addTo(g);
    }
    L.circleMarker(bosa, { radius: 9, color: "#2b2622", fillColor: "#c4573a", fillOpacity: 1, weight: 2 })
      .bindTooltip("Bosa", { permanent: true, direction: "right", className: "bosa-label" }).addTo(g);

    if (fit === "sardinia" || !routes.length) state.map.fitBounds(L.latLngBounds([bosa, ...Object.values(apPos)]).pad(0.25));
    else if (fit) state.map.fitBounds(L.latLngBounds([bosa, ...routes.map((r) => [r.lat, r.lon])]).pad(0.15));
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
    renderTransfer();
    renderStays();
    renderEvents();
    renderInfo();
    renderMap(fit === undefined ? "all" : fit);
  }

  function setDate(d) {
    state.date = d || "";
    syncURL();
    renderAll();
  }

  function setOrigin(o) {
    state.origin = o || "";
    store.set("t2b-from", state.origin);
    const r = allRoutes().find((x) => x.from_iata === state.origin);
    if (r) { $("#transfer-airport").value = r.to; if (r.arr_time) $("#transfer-time").value = r.arr_time; }
    syncURL();
    renderAll();
  }

  function setLang(l) {
    state.lang = I18N[l] ? l : "en";
    store.set("t2b-lang", state.lang);
    syncURL();
    renderAll(null);
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    const browserLang = (navigator.language || "it").slice(0, 2);
    state.lang = params.get("lang") || store.get("t2b-lang") || (browserLang === "it" ? "it" : "en");
    if (!I18N[state.lang]) state.lang = "en";
    const d = params.get("date") || "";
    state.date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";

    const [site, flights, events, stays, info, transit] = await Promise.all([
      loadJSON("site", { airports: [], bosa: { lat: 40.2981, lon: 8.4979 }, links: {} }),
      loadJSON("flights", { routes: [] }),
      loadJSON("events", { events: [] }),
      loadJSON("stays", { stays: [] }),
      loadJSON("info", { tips: [] }),
      loadJSON("transit", { generated: null, segments: {}, services: [], chains: {} })
    ]);
    state.data = { site, flights, events, stays, info, transit };

    const from = params.get("from") || store.get("t2b-from") || "";
    state.origin = allRoutes().some((r) => r.from_iata === from) ? from : "";

    $("#date").addEventListener("change", (e) => setDate(e.target.value));
    $("#clear-date").addEventListener("click", () => setDate(""));
    $("#origin").addEventListener("change", (e) => setOrigin(e.target.value));
    document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
    $("#transfer-airport").addEventListener("change", renderTransfer);
    $("#transfer-time").addEventListener("change", renderTransfer);
    $("#fit-all").addEventListener("click", () => renderMap("all"));
    $("#fit-sardinia").addEventListener("click", () => renderMap("sardinia"));

    initMap();
    renderStatic();
    const r = allRoutes().find((x) => x.from_iata === state.origin);
    if (r) $("#transfer-airport").value = r.to;
    renderAll();
  }

  init();
})();
