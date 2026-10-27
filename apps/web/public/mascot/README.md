# Pakoy mascot art

Pakoy is the PakaonAI mascot (issues #193, #232). The name is **Pakoy** — the
original character sheet labelled him "Paka", and that name is never used in the
app.

## Source

`pakoy-character-sheet.png`, 1254 × 1254, supplied by Jeff (curated with GPT).
The sheet contains a hero pose, eight state poses, turnarounds, monochrome
versions, the head-only mark and example empty/error states.

## Files

| File | Shown as | Size |
| --- | --- | --- |
| `pakoy-head.webp` | round avatar: chat header, chat bubbles, alert icons, PWA icon | 256 × 256 |
| `pakoy-hero.webp` | hero art: the tour's welcome step | 406 × 440 |
| `pakoy-idle.webp` | online idle: dashboard greeting, empty states, greeting bubble | 132 × 173 |
| `pakoy-dispensing.webp` | dispensing | 141 × 179 |
| `pakoy-offline.webp` | offline page and offline alerts | 132 × 164 |
| `pakoy-low-hopper.webp` | low-hopper reminder | 138 × 168 |
| `pakoy-wrong-token.webp` | wrong device token | 132 × 167 |
| `pakoy-power-fault.webp` | power fault, error pages | 136 × 167 |
| `pakoy-first-setup.webp` | first setup | 132 × 167 |
| `pakoy-icon-512.png` | 512 px PWA/OS icon on navy (PNG fallback) | 512 × 512 |

Every WebP is under 120 KB. The component that renders them is
`components/assistant/mascot.tsx` (`<Mascot pose="…" />`); add a pose there and
in `MASCOT_POSES` when new art lands.

## Crop boxes (source pixel coordinates, left/top/right/bottom)

| Output | Box |
| --- | --- |
| `pakoy-idle` | 20, 467, 156, 640 |
| `pakoy-dispensing` | 166, 464, 307, 643 |
| `pakoy-offline` | 326, 475, 458, 639 |
| `pakoy-low-hopper` | 474, 473, 612, 641 |
| `pakoy-wrong-token` | 780, 474, 912, 641 |
| `pakoy-power-fault` | 933, 473, 1069, 640 |
| `pakoy-first-setup` | 1090, 473, 1222, 640 |
| `pakoy-hero` | 152, 0, 558, 446, with the wordmark area 0, 0, 63, 305 painted white first |
| `pakoy-head` | 867, 782, 1015, 943 (the navy tile), then centre-cropped to the pale head and resized to 256 px |

## Redoing the crops

The sheet's tiles have a light card background. The script keys that background
to transparency with a corner flood fill (tolerance 42), feathers the alpha by
0.6 px, and trims the transparent margin with a 4 px pad. If a future sheet has
shadows or gradients that survive the key, keep a soft rounded light card
behind the figure instead — the components accept any square-ish image.

```bash
cd apps/web
python -I scripts/prepare-mascot.py path/to/pakoy-character-sheet.png
```

Requires Pillow (`pip install pillow`). The script writes straight into
`public/mascot/`.
