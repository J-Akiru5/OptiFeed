# Third-party notices

This file records third-party material whose **terms, conventions or data**
were used to build Project PakaonAI. It complements `ATTRIBUTIONS.md`, which
covers assets (icons, photos, components) and their licences. Entries here are
attribution notices, not licence grants for the application itself.

## Mozilla Firefox Tagalog/Filipino localisation (`tl`)

- Source: Mozilla localisation repositories, Firefox `tl` locale
  (<https://github.com/mozilla-l10n/firefox-l10n>, `tl/`).
- Licence: Mozilla Public License 2.0 (MPL-2.0),
  <https://mozilla.org/MPL/2.0/>.
- Used for: **terminology and style reference only** for the Tagalog message
  catalogue (`apps/web/messages/tl.json`) — common UI terms and verb forms such
  as `Mga setting`, `Mga Abiso`, `Kanselahin`, `I-save`, `Maghanap` and
  `Mag-sign in`, recorded in `docs/i18n/tagalog-glossary.md`.
- No Firefox string was copied verbatim into a PakaonAI message, and no MPL
  source file is redistributed. The glossary records the individual terms that
  were cross-checked so a reviewer can re-verify them.

## Unicode CLDR (Common Locale Data Repository)

- Source: Unicode CLDR project, <https://cldr.unicode.org/>.
- Licence: Unicode License v3,
  <https://www.unicode.org/license.txt>.
- Used for: Filipino (`fil`) date, number, relative-time and plural
  conventions. The application does not copy CLDR text into the catalogue; it
  consumes the data through JavaScript `Intl`/ICU at runtime. `tl` is
  canonicalised by ICU to `fil`. Month and day abbreviations in
  `apps/web/messages/tl.json` (`dates.*`) follow CLDR `fil` and are checked
  against `Intl.DateTimeFormat("fil")` by
  `apps/web/lib/__tests__/tagalog-locale.test.ts`.

## Reference only — not reused

The following Tagalog sources were consulted for terminology comparison but
**no text was copied**, because their reuse terms were not confirmed for this
project:

- Koha ILS Tagalog translation
- DocBook Tagalog translation
- Debian Tagalog translation

## Human-reviewed Tagalog strings

The 331 Tagalog strings that existed in `apps/web/messages/tl.json` before the
2026-10-31 machine pass are the project's own human-reviewed copy and are not
third-party material. The machine-drafted strings are listed in
`apps/web/messages/tl.draft-keys.json` until a human reviewer clears them.
