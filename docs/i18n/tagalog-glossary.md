# Tagalog (Filipino) glossary and style guide

Source locale: `en`. Target locale: `tl` (BCP-47; canonicalised by ICU to `fil`).

This glossary is the single source of truth for domain terms in
`apps/web/messages/tl.json`. The machine-drafted pass (#327, I-104) applied it
consistently; human reviewers should change the term here first, then the
catalogue, so the next pass does not reintroduce a variant.

## Style

- Natural, contemporary Tagalog ("Taglish" where that is what farmers and
  operators actually say). Do not invent deep literary Tagalog for technical
  concepts.
- Second person singular: `mo`, `iyong`, `ka`. Imperatives use the `i-` /
  `mag-` forms (`I-save`, `Mag-sign in`, `Kanselahin`).
- Sentence case for headings, labels and buttons; keep the English catalogue's
  punctuation and trailing colon/ellipsis.
- Keep ICU placeholders (`{count}`, `{pond}`), plural blocks (`{count, plural,
  one {…} other {…}}`) and rich-text tags (`<bold>`, `<highlight>`, `<br />`)
  exactly as they are in `en.json`.
- Do not translate brand names, product names, proper nouns, units or
  identifiers: PakaonAI, Pakoy, ESP32, Wi-Fi, MAC, ABW, FCR, SGR, DO, pH, kg,
  g, %, °C, dBm, RSSI, IP, API, ID, RTC, PDF, CSV.
- Keep established English technical loans where the domain uses them; see the
  table. Do not alternate between a loan and a native coinage for the same
  term.

## Domain terms

| English | Tagalog (`tl`) | Notes |
| --- | --- | --- |
| pond | pond | Established loan in the product; never `palaisdaan` in UI. |
| farm | bukid | `Farm ID` stays `Farm ID` (identifier). |
| farmer / operator | magsasaka / operator | `operator` is the role name. |
| feeder | feeder | The physical machine. |
| hopper | hopper | Feed container on the feeder. |
| auger | auger | |
| motor / relay / sensor / controller | motor / relay / sensor / controller | |
| feed (noun) | pakain | `pellet ng pakain` = feed pellet. |
| feed (verb) / feeding | magpakain / pagpapakain | `Feed Now` = `Magpakain Ngayon`. |
| dispense / dispensed | maglabas / nailabas | `Dispense Now` = `Maglabas Ngayon`. |
| ration | rasyon | Daily ration = `pang-araw-araw na rasyon`. |
| daily feed ceiling | pang-araw-araw na hangganan ng pakain | Decision E38: the only gram cap. |
| limit / cap / ceiling | hangganan | Numeric upper bound. |
| threshold | threshold | Behaviour/connectivity configuration value (e.g. offline threshold); keep the loan so it is distinct from `hangganan`. |
| feeding rate | rate ng pagpapakain | |
| schedule | iskedyul | |
| calibration | kalibrasyon | |
| biomass | biomass | |
| sample / sampling | sample / sampling | Existing reviewed keys use the loans. |
| average body weight (ABW) | karaniwang timbang ng katawan (ABW) | Explain on first use, then `ABW`. |
| feed conversion ratio (FCR) | FCR | Keep the acronym; explain as `kilo ng pakain sa bawat kilo ng paglaki`. |
| specific growth rate (SGR) | SGR | Keep the acronym. |
| growth | paglaki | |
| harvest | ani | |
| grow-out cycle | grow-out cycle | Domain loan; `siklo ng grow-out` when a full noun phrase is needed. |
| stocking / stocked | stocking / naka-stock | |
| population | populasyon | |
| mortality | mortalidad | |
| fingerling | fingerling | |
| water temperature | temperatura ng tubig | |
| dissolved oxygen (DO) | dissolved oxygen (DO) | |
| ammonia / turbidity | ammonia / turbidity | |
| device | device | |
| firmware | firmware | |
| telemetry | telemetry | |
| online / offline | online / offline | |
| weak signal | mahinang signal | Decision E31 state, distinct from offline. |
| Wi-Fi signal / RSSI | signal ng Wi-Fi / RSSI | |
| reconnect | muling kumonekta | |
| heartbeat | heartbeat | Device beat; keep the loan. |
| dashboard | dashboard | |
| settings | mga setting | Confirmed against Firefox `tl` (`settings-page-title = Mga setting`). |
| notification | abiso | `Mga Abiso`; confirmed against Firefox `tl` (`permissions-notification2 = Mga Abiso`). |
| alert | alert | |
| audit trail | talaan ng audit | |
| organization | organisasyon | |
| member | miyembro | |
| user | user | |
| role | role | |
| permission | pahintulot | |
| tenant / platform / superadmin | tenant / platform / superadmin | |
| invite / invitation | imbitasyon | |
| email | email | |
| password | password | |
| sign in / sign out | mag-sign in / mag-sign out | Confirmed against Firefox `tl`. |
| save | i-save | Confirmed against Firefox `tl`. |
| cancel | kanselahin | Confirmed against Firefox `tl`. |
| delete / remove | tanggalin / alisin | `Alisin` for removing an item; `Tanggalin` for destructive delete. |
| edit / update | i-edit / i-update | |
| add / create | magdagdag / gumawa | |
| search | maghanap | `Paghanap` for the noun; confirmed against Firefox `tl`. |
| open / close | buksan / isara | |
| enable / disable | i-enable / i-disable | |
| required / optional | kinakailangan / opsyonal | |
| loading | naglo-load | |
| error / warning | error / babala | |
| success | tagumpay | |
| today / yesterday / tomorrow | ngayon / kahapon / bukas | |
| date / time | petsa / oras | |
| version | bersyon | |

## Dates, numbers, plurals

- Dates and numbers are formatted by `Intl` with the active locale. `tl` is
  canonicalised to `fil`, so CLDR's Filipino data supplies month/day names,
  grouping and decimal separators (comma grouping, period decimal).
- Month names (short keys in `dates.months`): Ene, Peb, Mar, Abr, May, Hun,
  Hul, Ago, Set, Okt, Nob, Dis. Day names (`dates.days`): Lin, Lun, Mar, Miy,
  Huw, Biy, Sab. These are the CLDR `fil` abbreviations; the parity test checks
  them against `Intl.DateTimeFormat("fil")`.
- Tagalog cardinal plurals have two CLDR categories, `one` and `other` (the
  `one` category covers 0, 1, 2, 3, 5, 7, 8, 10…, and `other` covers 4, 6, 9,
  14, 16, 19…). Tagalog nouns are not inflected for plural; `mga` marks
  plurality. Keep both ICU branches supplied even when the text is identical,
  so changing `#` never falls through to a missing branch.
- Relative time uses `Intl.RelativeTimeFormat("fil")`, e.g. `2 araw ang
  nakalipas`. Do not hand-build relative-time strings.

## Sources and attribution

- **Existing reviewed keys**: the 331 strings present in `tl.json` before this
  pass are human-reviewed; the machine pass did not modify them.
- **Mozilla Firefox Tagalog/Filipino localisation** (`tl`, MPL-2.0): common UI
  terminology and verb style were reused and cross-checked (`Mga setting`,
  `Mga Abiso`, `Kanselahin`, `I-save`, `Maghanap`, `Mag-sign in`). No Firefox
  string was copied verbatim into a message. Attribution: see
  `THIRD_PARTY.md`.
- **Unicode CLDR** (Unicode License v3): date, number and plural conventions.
  `Intl`/ICU at runtime is the implementation; no CLDR text is copied into the
  catalogue.
- Reference only, not copied (licence not confirmed for reuse): Koha, DocBook
  and Debian Tagalog translations.
