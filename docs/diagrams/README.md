# Diagram sources

Mermaid sources for the OptiFeed system figures. These files are the **source of
truth** — the rendered PNGs next to them are a convenience artefact for
documents and slide decks.

| Figure | Type | Source | Rendered |
|---|---|---|---|
| 3.1 | Use Case Diagram (User) | [`01-use-case-user.mmd`](01-use-case-user.mmd) | [`figure-3.1-use-case-user.png`](figure-3.1-use-case-user.png) |
| 3.2 | Use Case Diagram (System) | [`02-use-case-system.mmd`](02-use-case-system.mmd) | [`figure-3.2-use-case-system.png`](figure-3.2-use-case-system.png) |
| 3.3 | Activity Diagram of System Hardware | [`03-activity-hardware.mmd`](03-activity-hardware.mmd) | [`figure-3.3-activity-hardware.png`](figure-3.3-activity-hardware.png) |
| 3.4 | Sequence Diagram | [`04-sequence.mmd`](04-sequence.mmd) | [`figure-3.4-sequence.png`](figure-3.4-sequence.png) |
| 3.5 | Circuit Diagram | [`05-circuit.mmd`](05-circuit.mmd) | [`figure-3.5-circuit.png`](figure-3.5-circuit.png) |

The figures are embedded in
[`docs/multi-tenancy-system-diagrams.md`](../multi-tenancy-system-diagrams.md),
which also carries the multi-tenancy walkthrough, the permission matrix, the
refusal-code table, the pin map and the traceability table back to source files.

## Rebuilding

```bash
# splice the .mmd sources into the document
node scripts/build-diagram-doc.mjs

# re-render the PNGs (needs network access; renders through mermaid.ink)
node scripts/render-diagrams.mjs
node scripts/render-diagrams.mjs 05   # one figure only
```

Both scripts are idempotent and fail loudly: an unknown figure number, an HTTP
failure from the renderer or a missing `<!--FIG:NN-->` marker in the template
exits non-zero instead of writing a broken artefact.

## Conventions

- **Figure numbers** are `3.1` – `3.5`, matching the chapter numbering used in
  the diagram audit (`docs/diagram-audit-report.md`).
- **Colours** follow the existing system-functions portal palette: `#0a3d62`
  (deep blue) for actors and boundaries, `#e85a2a` (accent orange) for platform
  and safety behaviour, `#eef3f1` (soft green) for passive hardware and
  supporting services, `#fde8e8` for refusal paths.
- **Rendering** uses Mermaid's flowchart and sequence diagrams with UML-style
  shapes. Mermaid has no native UML use-case diagram, so use cases are drawn as
  rectangles, actors as stadium shapes (`([…])`), and `<<include>>` /
  `<<extend>>` as dashed edge labels.

## When to update

Re-render after any change to the firmware (`firmware/firmware-main/`) or to the
tenancy model (`apps/web/lib/auth/`, `apps/web/prisma/schema.prisma`). The
traceability table in `docs/multi-tenancy-system-diagrams.md` §7 lists the
source file for every element, so a reviewer can check a figure against the
code without guessing.
