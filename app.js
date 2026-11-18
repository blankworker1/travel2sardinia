/* travel2bosa — static information app. No backend: everything is read from /data. */
(function () {
  "use strict";

  const AIRPORT_EXIT_MIN = 30; // time from landing to the first bus/train
  const state = { lang: "it", date: null, airport: "ALL", data: {}, map: null, layers: null, showCal: false };

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const t = (k, ...a) => { const v = (I18N[state.lang] || I18N.en)[k]; return typeof v === "function" ? v(...a) : (v ?? k); };
  const tx = (o) => (o && typeof o === "object") ? (o[state.lang] || o.en || o.it || "") : (o || "");
  const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmtISO = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return fmtISO(d); };
  const isoWeekday = (s) => ((parseDate(s).getUTCDay() + 6) % 7) + 1; // 1=Mon … 7=Sun
  const locale = () => (state.lang === "it" ? "it-IT" : "en-GB");
  const fmtDay = (s, opts) => parseDate(s).toLocaleDateString(locale(), Object.assign({ weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }, opts));
  const hm = (m) => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  const toMin = (s) => { if (!s) return null; const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} ${t("min")}`);
  const published = (x) => x && x.published !== false;
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
  function flightsOn(date) {
    const wd = String(isoWeekday(date));
    return (state.data.flights.routes || []).filter((r) => published(r) &&
      (r.seasons || []).some((s) => s.start <= date && date <= s.end && String(s.days || "").includes(wd)));
  }

  function eventsBetween(from, to) {
    return (state.data.events.events || []).filter((e) => published(e) && e.start && e.start <= to && (e.end || e.start) >= from);
  }

  function isTransportHoliday(date) {
    return eventsBetween(date, date).some((e) => e.transport === "holiday_timetable");
  }

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

  function itineraries(airport, date, landedMin) {
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
    // earliest arrival first, one option per arrival time
    results.sort((a, b) => a[a.length - 1].arr - b[b.length - 1].arr || b[0].dep - a[0].dep);
    const seen = new Set();
    return results.filter((l) => { const k = l[l.length - 1].arr; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  }

  // ---------- rendering ----------
  function renderStatic() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang)));
    const site = state.data.site;
    $("#site-title").textContent = tx(site.title) || "Travel to Bosa";
    $("#tagline").textContent = tx(site.tagline);
    document.title = tx(site.title) || "Travel to Bosa";

    const af = $("#airport-filter");
    af.innerHTML = `<option value="ALL">${esc(t("all_airports"))}</option>` +
      site.airports.map((a) => `<option value="${a.code}">${esc(a.name)} (${a.code})</option>`).join("");
    af.value = state.airport;
    const ta = $("#transfer-airport");
    const keep = ta.value;
    ta.innerHTML = site.airports.map((a) => `<option value="${a.code}">${esc(a.name)} (${a.code})</option>`).join("");
    if (keep) ta.value = keep;
  }

  function renderBanner() {
    const b = $("#holiday-banner");
    const hol = eventsBetween(state.date, state.date).filter((e) => e.type === "holiday");
    if (isTransportHoliday(state.date) && hol.length) {
      b.hidden = false;
      b.textContent = `${hol.map((e) => tx(e.title)).join(" · ")} — ${t("holiday_warning")}`;
    } else b.hidden = true;
  }

  function renderFlights() {
    const site = state.data.site;
    const list = flightsOn(state.date).filter((r) => state.airport === "ALL" || r.to === state.airport);
    const body = $("#flights-body");
    if (!list.length) { body.innerHTML = `<p class="empty">${esc(t("no_flights"))}</p>`; return; }
    const yymmdd = state.date.slice(2).replace(/-/g, "");
    let html = "";
    if (list.some((r) => r.sample)) html += `<p class="notice">${esc(t("sample_notice"))}</p>`;
    for (const ap of site.airports) {
      const rows = list.filter((r) => r.to === ap.code).sort((a, b) => a.from_city.localeCompare(b.from_city));
      if (!rows.length) continue;
      html += `<h3>${esc(ap.name)} <span class="code">${ap.code}</span> <span class="count">${esc(t("flights_count", rows.length))}</span></h3><ul class="cards">`;
      for (const r of rows) {
        const sky = `https://www.skyscanner.net/transport/flights/${r.from_iata.toLowerCase()}/${r.to.toLowerCase()}/${yymmdd}/`;
        const goo = `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${r.from_iata} to ${r.to} on ${state.date}`)}`;
        html += `<li class="card">
          <div class="card-main">
            <strong>${esc(r.from_city)}</strong> <span class="code">${esc(r.from_iata)} → ${esc(r.to)}</span>
            ${r.sample ? `<span class="badge">${esc(t("sample"))}</span>` : ""}
            <div class="meta">${esc(r.airline)}${r.arr_time ? ` · ${esc(t("arrives"))} ${esc(r.arr_time)}` : ""}</div>
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

  function renderTransfer() {
    const tr = state.data.transit;
    const body = $("#transfer-body");
    const airport = $("#transfer-airport").value;
    const time = $("#transfer-time").value || "12:00";
    if (!tr || !tr.generated) { body.innerHTML = `<p class="empty">${esc(t("transit_missing"))}</p>`; return; }
    const endDate = addDays(tr.window_start, tr.window_days - 1);
    if (state.date < tr.window_start || state.date > endDate) { body.innerHTML = `<p class="empty">${esc(t("transit_outside"))}</p>`; return; }

    const its = itineraries(airport, state.date, toMin(time));
    const links = state.data.site.links || {};
    const opLink = { ARST: links.arst, Trenitalia: links.trenitalia, ASPO: links.aspo };
    let html = "";
    if (isTransportHoliday(state.date)) html += `<p class="notice">${esc(t("holiday_warning"))}</p>`;
    if (!its.length) html += `<p class="empty">${esc(t("transit_none", time))}</p>`;
    html += '<ol class="itins">';
    for (const legs of its) {
      const last = legs[legs.length - 1];
      const ops = [...new Set(legs.map((l) => l.operator))];
      html += `<li class="itin"><div class="itin-head"><strong>${hm(legs[0].dep)} → ${hm(last.arr)}</strong> <span class="meta">${esc(t("arrive_bosa"))} · ${esc(t("total"))} ${dur(last.arr - toMin(time))}</span></div><ul class="legs">`;
      legs.forEach((l, i) => {
        const [a, b] = l.seg.split("-");
        html += `<li><span class="mode ${l.mode}">${l.mode === "train" ? "🚆" : "🚌"}</span> ${hm(l.dep)}–${hm(l.arr)} · ${esc(cap(a))} → ${esc(cap(b))} <span class="meta">${esc(l.operator)}${l.route ? " " + esc(l.route) : ""}${i > 0 ? ` · ${esc(t("change_at"))}` : ""}</span></li>`;
      });
      html += `</ul><div class="actions">${ops.filter((o) => opLink[o]).map((o) => `<a class="btn ghost" href="${esc(opLink[o])}" target="_blank" rel="noopener">${esc(t("buy_ticket"))} ${esc(o)}</a>`).join("")}</div></li>`;
    }
    html += "</ol>";
    const gen = tr.generated ? fmtDay(tr.generated.slice(0, 10), { weekday: undefined, year: "numeric" }) : "";
    html += `<p class="small">${esc(t("transit_updated", gen))}</p>`;
    body.innerHTML = html;
  }

  const AIRPORT_NAMES = { AHO: "Alghero Aeroporto", CAG: "Cagliari Aeroporto", OLB: "Olbia Aeroporto" };
  const cap = (s) => AIRPORT_NAMES[s] || (s.charAt(0) + s.slice(1).toLowerCase());

  function renderStays() {
    const stays = (state.data.stays.stays || []).filter(published);
    const links = state.data.site.links || {};
    const body = $("#stays-body");
    if (!stays.length) {
      body.innerHTML = `<p class="empty">${esc(t("no_stays"))}</p>` +
        (links.hodlstay_host_signup_url ? `<a class="btn" href="${esc(links.hodlstay_host_signup_url)}" target="_blank" rel="noopener">${esc(t("become_host"))}</a>` : "");
      return;
    }
    body.innerHTML = '<ul class="cards">' + stays.map((s) => {
      const url = s.url || links.hodlstay_base_url;
      return `<li class="card"><div class="card-main"><strong>${esc(s.name)}</strong>
        <div class="meta">${[s.type, s.area, (s.languages || []).join(", ")].filter(Boolean).map(esc).join(" · ")}</div>
        ${tx(s.notes) ? `<p>${esc(tx(s.notes))}</p>` : ""}</div>
        ${url ? `<div class="actions"><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${esc(t("view_hodlstay"))}</a></div>` : ""}</li>`;
    }).join("") + "</ul>" +
      (links.hodlstay_host_signup_url ? `<p><a class="link-btn" href="${esc(links.hodlstay_host_signup_url)}" target="_blank" rel="noopener">${esc(t("become_host"))}</a></p>` : "");
  }

  function eventItem(e) {
    const range = e.start === (e.end || e.start) ? fmtDay(e.start) : `${fmtDay(e.start)} – ${fmtDay(e.end)}`;
    const status = e.status === "pattern" ? `<span class="badge soft">${esc(t("status_pattern"))}</span>` : e.status === "tbc" ? `<span class="badge">${esc(t("status_tbc"))}</span>` : "";
    const kind = e.type === "holiday" ? `<span class="badge hol">${esc(t("holiday"))}</span>` : "";
    const main = e.highlight_days ? `<div class="meta">${esc(t("main_days"))}: ${e.highlight_days.map((d) => fmtDay(d)).join(", ")}</div>` : "";
    return `<li class="event ${e.type}"><div><span class="when">${esc(range)}</span> ${kind}${status}</div>
      <strong>${esc(tx(e.title))}</strong>${tx(e.note) ? `<div class="meta">${esc(tx(e.note))}</div>` : ""}${main}</li>`;
  }

  function renderEvents() {
    const d = state.date;
    const on = eventsBetween(d, d);
    const near = eventsBetween(addDays(d, -7), addDays(d, 14)).filter((e) => !on.includes(e));
    let html = `<h3>${esc(t("on_date"))} · ${esc(fmtDay(d, { weekday: "long" }))}</h3>`;
    html += on.length ? `<ul class="events">${on.map(eventItem).join("")}</ul>` : `<p class="empty">${esc(t("no_events"))}</p>`;
    if (near.length) html += `<h3>${esc(t("nearby"))}</h3><ul class="events">${near.map(eventItem).join("")}</ul>`;
    $("#events-body").innerHTML = html;

    const all = (state.data.events.events || []).filter(published);
    const dated = all.filter((e) => e.start).sort((a, b) => a.start.localeCompare(b.start));
    const tbc = all.filter((e) => !e.start);
    $("#calendar-body").innerHTML = `<ul class="events">${dated.map(eventItem).join("")}</ul>` +
      (tbc.length ? `<h3>${esc(t("tbc_title"))}</h3><ul class="events">${tbc.map((e) => `<li class="event"><strong>${esc(tx(e.title))}</strong>${e.approx ? ` <span class="meta">${esc(tx(e.approx))}</span>` : ""}</li>`).join("")}</ul>` : "");
    $("#calendar-body").hidden = !state.showCal;
    $("#toggle-calendar").textContent = t(state.showCal ? "hide_calendar" : "show_calendar");
  }

  function renderInfo() {
    const tips = (state.data.info.tips || []).filter(published);
    $("#info-body").innerHTML = '<ul class="tips">' + tips.map((x) =>
      `<li><strong>${esc(tx(x.title))}</strong>${x.verified === false ? ` <span class="badge soft">${esc(t("unverified"))}</span>` : ""}<p>${esc(tx(x.body))}</p></li>`).join("") + "</ul>";
  }

  // ---------- map ----------
  function initMap() {
    if (!window.L) return;
    state.map = L.map("map", { scrollWheelZoom: false, attributionControl: true });
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
    const routes = flightsOn(state.date).filter((r) => state.airport === "ALL" || r.to === state.airport);

    for (const r of routes) {
      if (r.lat == null || r.lon == null || !apPos[r.to]) continue;
      L.polyline([[r.lat, r.lon], apPos[r.to]], { color: "#2f6f8f", weight: 1.5, opacity: 0.6 }).addTo(g);
      L.circleMarker([r.lat, r.lon], { radius: 5, color: "#2f6f8f", fillColor: "#fff", fillOpacity: 1, weight: 2 })
        .bindTooltip(`${r.from_city} (${r.from_iata}) → ${r.to}`).addTo(g);
    }
    for (const a of site.airports) {
      L.polyline([apPos[a.code], bosa], { color: "#c4573a", weight: 2, dashArray: "5 6" }).addTo(g);
      L.circleMarker(apPos[a.code], { radius: 7, color: "#2b2622", fillColor: "#d9a441", fillOpacity: 1, weight: 2 })
        .bindTooltip(`${a.name} (${a.code})`).addTo(g);
    }
    L.circleMarker(bosa, { radius: 9, color: "#2b2622", fillColor: "#c4573a", fillOpacity: 1, weight: 2 })
      .bindTooltip("Bosa", { permanent: true, direction: "right", className: "bosa-label" }).addTo(g);

    if (fit === "sardinia" || !routes.length) state.map.fitBounds(L.latLngBounds([bosa, ...Object.values(apPos)]).pad(0.25));
    else if (fit) state.map.fitBounds(L.latLngBounds([bosa, ...routes.filter((r) => r.lat != null).map((r) => [r.lat, r.lon])]).pad(0.1));
  }

  // ---------- wiring ----------
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

  function setLang(l) {
    state.lang = I18N[l] ? l : "en";
    store.set("t2b-lang", state.lang);
    const u = new URL(location.href);
    u.searchParams.set("lang", state.lang);
    history.replaceState(null, "", u);
    renderAll(null);
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    const browserLang = (navigator.language || "it").slice(0, 2);
    state.lang = params.get("lang") || store.get("t2b-lang") || (browserLang === "it" ? "it" : "en");
    if (!I18N[state.lang]) state.lang = "en";
    state.date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "") ? params.get("date") : fmtISO(new Date());

    const [site, flights, events, stays, info, transit] = await Promise.all([
      loadJSON("site", { airports: [], bosa: { lat: 40.2981, lon: 8.4979 }, links: {} }),
      loadJSON("flights", { routes: [] }),
      loadJSON("events", { events: [] }),
      loadJSON("stays", { stays: [] }),
      loadJSON("info", { tips: [] }),
      loadJSON("transit", { generated: null, segments: {}, services: [], chains: {} })
    ]);
    state.data = { site, flights, events, stays, info, transit };

    $("#date").value = state.date;
    $("#date").addEventListener("change", (e) => {
      if (!e.target.value) return;
      state.date = e.target.value;
      const u = new URL(location.href);
      u.searchParams.set("date", state.date);
      history.replaceState(null, "", u);
      renderAll();
    });
    document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
    $("#airport-filter").addEventListener("change", (e) => { state.airport = e.target.value; renderFlights(); renderMap("all"); });
    $("#transfer-airport").addEventListener("change", renderTransfer);
    $("#transfer-time").addEventListener("change", renderTransfer);
    $("#toggle-calendar").addEventListener("click", () => { state.showCal = !state.showCal; renderEvents(); });
    $("#fit-all").addEventListener("click", () => renderMap("all"));
    $("#fit-sardinia").addEventListener("click", () => renderMap("sardinia"));

    initMap();
    renderAll();
  }

  init();
})();
