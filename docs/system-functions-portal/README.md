# PakaonAI — System Functions & Evaluation Dossier

A single-file, self-contained documentation portal covering the PakaonAI system: architecture,
every implemented function by domain, the ISO/IEC 25010 engineering self-assessment, operations,
and the plan for the five-minute explainer film.

**Open:** `index.html` in any modern browser. No build step, server, CDN, or network access is
required. The logo, diagrams, styles, and scripts are all inlined.

## Baseline

| | |
|---|---|
| Repository | `optifeed` |
| Branch / commit | `origin/develop` at `fdfc830` |
| Application version | `1.30.3` (on `develop`, not tagged) |
| Inspected | 29 October 2026 |
| Document version | 1.0.0, prepared 30 October 2026 |
| Feature freeze | 31 October 2026 |

If the application moves, the dossier is stale. Re-check the function catalog against the new
`develop` before quoting it.

## Contents

```
docs/system-functions-portal/
├── index.html                              the deliverable (self-contained)
├── README.md                               this file
├── assets/
│   └── pakaonai-explainer-v0.1.srt         draft caption file for the film
└── diagrams/
    ├── system.mmd                          Mermaid source — system context
    ├── loop.mmd                            Mermaid source — feeding loop
    ├── offline.mmd                         Mermaid source — offline contract
    └── provisioning.mmd                    Mermaid source — provisioning path
```

The tenancy figure is built in HTML/CSS rather than Mermaid, because the hierarchy is narrow and a
graph layout engine either collapses it to an unreadable column or stretches it past the measure.

## Editing

`index.html` is the source of truth for the document. Edit it directly, or regenerate it from the
build parts if you have them. Keep these rules:

1. **Do not add a feature that is not on `develop` at the stated baseline.** Mark it `planned` or
   `in flight` instead.
2. **Every function needs an evidence path.** If you cannot point at a file, the function is not
   verified.
3. **Numbers come from CI, not from prose.** When the repository's own documents disagree with CI,
   CI wins and the discrepancy is recorded in the Evaluation tab.
4. **The claims ledger is binding.** If a sentence is not in the allowed column, it needs a
   qualifier or it does not ship.

## Regenerating a diagram

The SVGs are inlined into `index.html`. To change one, edit the `.mmd` source, render it, and
replace the corresponding `<svg>` element.

```bash
mmdc -i diagrams/system.mmd -o system.svg -c mermaid-light.json -b white
```

The light theme used here:

```json
{
  "theme": "base",
  "themeVariables": {
    "background": "#ffffff",
    "primaryColor": "#ffffff",
    "primaryTextColor": "#0a2b45",
    "primaryBorderColor": "#c6d3ce",
    "lineColor": "#7a8c85",
    "clusterBkg": "#f7f9f8",
    "clusterBorder": "#dde5e2",
    "edgeLabelBackground": "#ffffff",
    "fontFamily": "Inter, Segoe UI, system-ui, sans-serif",
    "fontSize": "15px"
  },
  "flowchart": { "curve": "basis", "htmlLabels": false, "nodeSpacing": 40, "rankSpacing": 48, "padding": 12 }
}
```

When inlining, remove the XML prolog, strip the `width="100%"` attribute and the inline
`style="max-width: …; background-color: white;"`, and make the SVG `id` unique. Mermaid's embedded
`<style>` block targets that id, so rename it in both places.

## The film

The Film tab contains the full five-minute plan: nine beats, a timed voiceover script, a 28-shot
list, the 3D render specification, the app-capture plan, sound and music direction, and the SRT
rules. `assets/pakaonai-explainer-v0.1.srt` is a **timing draft** generated from the script. Re-time
it against the recorded voice before delivery.

## What this document is not

- Not an ISO certification. ISO/IEC 25010 is a product quality model, not a certifiable management
  system.
- Not a respondent evaluation. The instrument targets 20 farmers and 10 IT professionals; no
  dataset exists in the repository.
- Not a statement of growth or FCR outcomes. Those results are under owner review and are not
  reported here.
- Not a commercial production claim. This is a capstone research prototype; accounts are issued by
  the team.

## Verification

The portal was tested at 1440×900 and 390×844 in Chromium: tab switching, keyboard arrows, sidebar
scroll spy, read-progress ring, function search and filters, command palette, mobile drawer, and
horizontal overflow. 33 assertions, 0 failures. axe-core reports zero violations across all seven
tabs at both widths. The content was verified separately against the repository at `fdfc830`.
