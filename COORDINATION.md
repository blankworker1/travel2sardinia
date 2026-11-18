# Coordination layer

The app is kept up to date by people, not scrapers. It's organised at two levels.

- **Island**: the network coordinator maintains flight routes, public holidays, the bus and train set-up and the list of towns, and helps new towns join (`/organisations/`).
- **Town**: each town has its own **WhatsApp coordination group** of local businesses, authorities and cultural groups, and a **local coordinator**. The coordinator collects updates once a month and enters them in the town's section of the admin dashboard (`/admin`). Their page for local organisations is `/<town>/organisations/`.

The next section is for the network coordinator; the rest is for local coordinators.

## Updating flights (network coordinator)

Twice a year (the timetables change on the last Sunday of March and of October), and whenever an airport announces new routes:

1. **On your phone, open the airport's flight list:**
   - Alghero: https://www.aeroportodialghero.it/voli/tutti-i-voli/?arr=AHO
   - Olbia: https://www.geasar.it/voli/tutti-i-voli/?arr=OLB (the same site format, with a toggle to switch airport)
   - Cagliari: https://www.sogaer.it/en/live-flights-info (a live board for today and tomorrow only; see below)
2. **Filter** to *Arrivals* and *Type of flight: Line*, so charters are left out.
3. **Scroll to the very bottom** so every flight has loaded.
4. **Save the page:** in Chrome, tap ⋮ and then the download arrow ⬇. Android saves it as an `.mhtml` file.
5. **Rename it to `.txt`:** in the Files app, go to Downloads, long-press the file, choose Rename and change `.mhtml` to `.txt`. Confirm the warning. (If renaming isn't allowed, use *Compress* to make a `.zip`.)
6. **Send it in** (or run `python3 scripts/import_airport_page.py the-file.txt`). The routes are imported with their days, times and flight numbers.

Saving the page is better than screenshots. The file has every flight exactly, including which days are highlighted, while screenshots can miss rows between them.

**Cagliari** shows only today and tomorrow, with no days of the week. Save its board (Arrivals) every second day for a week (four saves cover eight days) to work out each route's days and times. Until then its routes show as "days to be confirmed". The full seasonal timetable can only come from SOGAER or the airlines.

The rest of this guide is for local coordinators.

## Who's in the group

- Local businesses: hosts, bars, restaurants, shops
- Authorities: Comune di Bosa, Pro Loco, tourist office
- Cultural groups: festival committees, associations, galleries, churches and confraternities

## Monthly cycle

| When | Who | What |
|---|---|---|
| 1st of the month | Coordinator | Posts the reminder below in the group |
| 1st–10th | Members | Reply with new events, date changes, cancellations, new tips |
| By the 15th | Coordinator | Enters the updates in the town's section of `/admin`, setting each event's status and website link. Each save publishes automatically |
| By the 15th | Coordinator | Posts a short "updated" message with the app link |

When entering an event, the coordinator:

1. Sets **Status**: `fixed` once the organiser confirms the date, `pattern` if it follows the yearly rule, `tbc` if not yet known.
2. Adds the **Website link**: the organiser's own page, Facebook page or the Comune/Pro Loco page. It appears as a button on the event.
3. Adds the **Organiser** name.
4. Sets **Transport effect** to "Holiday timetables" for a local holiday that changes bus times. National and regional holidays are already handled at island level.
5. Updates **Last updated** at the top of the file.

## Reminder message (copy and paste)

> 🇮🇹 **Promemoria mensile: travel2sardegna · <paese>**
> Ciao a tutti! È il momento dell'aggiornamento mensile dell'app.
> Avete eventi, cambi di data, cancellazioni o novità per i visitatori nei prossimi mesi?
> Rispondete qui entro il 10 con: **nome dell'evento, date, organizzazione, link al sito o alla pagina**.
> Grazie! L'app sarà aggiornata entro il 15.
>
> 🇬🇧 **Monthly reminder: travel2sardinia · <town>**
> Hi all! Time for the app's monthly update.
> Do you have events, date changes, cancellations or news for visitors in the coming months?
> Reply here by the 10th with: **event name, dates, organiser, link to your website or page**.
> Thank you! The app will be updated by the 15th.

## "Updated" message

> ✅ App aggiornata / App updated: https://travel2sardinia.com/<town>/
> Controllate che i vostri eventi siano corretti. / Please check your events are correct.

## Joining

The footer of each town page links to **For organisations** (`/<town>/organisations/`). That bilingual page explains the app, who can take part, the monthly cycle and what to send. Point people there when you invite them.

Its **Contact the coordinator** button uses the link in the admin: *<Town> → links and coordinator → Coordinator contact link*. Use a link to the coordinator (e.g. `https://wa.me/39…` or a `mailto:` address) rather than the group's invite link, so the coordinator can check who joins. Until a link is set, the page says the contact will be published soon.

## A new town

Towns that want to join start at `/organisations/` and contact the network coordinator (the link in *Site settings → Links*). The network coordinator then follows "Adding a town" in the README.

## Error reports from the public

Every page has a **Report an error** button (bottom right). Visitors choose a section, describe the problem, and the message opens in their own email or WhatsApp, already filled in with the town, section and page link. There's no server and no form storage.

- **On a town page** it goes to the town's *Report an error link* if set, otherwise to the coordinator's contact link (*<Town> → links and coordinator*).
- **On the island pages** it goes to the island *Report an error link*, otherwise to the network contact (*Site settings → Links*).

The button is hidden until one of these links is set. Coordinators handle reports in the next monthly update, or straight away if something is badly wrong (a wrong date, a broken link).
