# Coordination layer

The app is kept up to date by people, not scrapers. Local businesses, authorities and cultural groups belong to one **WhatsApp coordination group**. The app coordinator collects their updates once a month and enters them in the admin dashboard (`/admin`).

## Who's in the group

- Local businesses: hosts, bars, restaurants, shops
- Authorities: Comune di Bosa, Pro Loco, tourist office
- Cultural groups: festival committees, associations, galleries, churches and confraternities

## Monthly cycle

| When | Who | What |
|---|---|---|
| 1st of the month | Coordinator | Posts the reminder below in the group |
| 1st–10th | Members | Reply with new events, date changes, cancellations, new tips |
| By the 15th | Coordinator | Enters the updates in `/admin`, setting each event's status and website link. Each save publishes automatically |
| By the 15th | Coordinator | Posts a short "updated" message with the app link |

When entering an event, the coordinator:

1. Sets **Status**: `fixed` once the organiser confirms the date, `pattern` if it follows the yearly rule, `tbc` if not yet known.
2. Adds the **Website link**: the organiser's own page, Facebook page or the Comune/Pro Loco page. It appears as a button on the event.
3. Adds the **Organiser** name.
4. Sets **Transport effect** to "Holiday timetables" for any public holiday.
5. Updates **Last updated** at the top of the file.

## Reminder message (copy and paste)

> 🇮🇹 **Promemoria mensile: Travel to Bosa**
> Ciao a tutti! È il momento dell'aggiornamento mensile dell'app.
> Avete eventi, cambi di data, cancellazioni o novità per i visitatori nei prossimi mesi?
> Rispondete qui entro il 10 con: **nome dell'evento, date, organizzazione, link al sito o alla pagina**.
> Grazie! L'app sarà aggiornata entro il 15.
>
> 🇬🇧 **Monthly reminder: Travel to Bosa**
> Hi all! Time for the app's monthly update.
> Do you have events, date changes, cancellations or news for visitors in the coming months?
> Reply here by the 10th with: **event name, dates, organiser, link to your website or page**.
> Thank you! The app will be updated by the 15th.

## "Updated" message

> ✅ App aggiornata / App updated: <link to the app>
> Controllate che i vostri eventi siano corretti. / Please check your events are correct.

## Joining

Every page of the app has a footer link, **For organisations**, that leads to `/organisations/`. That bilingual page explains the app, who can take part, the monthly cycle and what to send. Point people there when you invite them.

The page's **Contact the coordinator** button uses the link in **Site settings → Links → Coordinator contact link**. Use a link to the coordinator (e.g. `https://wa.me/39…` or a `mailto:` address) rather than the group's invite link, so the coordinator can check who joins. Until a link is set, the page says the contact will be published soon.
