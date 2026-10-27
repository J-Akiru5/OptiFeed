# Feeder hero photo (task I-29)

The pond detail and feeder settings pages show a hero with our feeder in the
middle (`apps/web/components/feeder/feeder-hero.tsx`). This folder holds the
photo it should show.

## What to add

Save one file here, exactly this name:

```
feeder-hero.webp
```

- **A cut-out**: the feeder only, on a **transparent** background. No pond, no
  person, no shadow baked into the pixels.
- **About 1200 × 1200 px** (square). Smaller is fine; much larger only makes the
  file heavy.
- **Framed the way the illustration is**: the unit centred, shot at eye level in
  daylight, a little empty space above the hopper and below the spout. The
  callout leader lines point at fixed spots (hopper at the top, motor housing in
  the middle, spout and water line at the bottom), so keeping the feeder
  upright and centred keeps the lines on the right parts.
- **WebP with alpha**, ideally under ~300 KB. A transparent PNG re-exported as
  WebP is the easiest path.

Export from a phone photo: remove the background first (iOS/Android "lift
subject", Photoshop "Remove background", or a free tool such as
<https://www.remove.bg>), then export as WebP with transparency.

## What happens until the file exists

The hero draws a stylised SVG illustration of a pond-side feeder instead
(`components/feeder/feeder-illustration.tsx`). Nothing breaks:

- the illustration is the base layer, so the hero is never empty;
- if the photo is missing, the browser remembers that for the rest of the
  session (`sessionStorage`) and stops asking for it, so a missing file costs at
  most one request per session instead of one per page view;
- as soon as the file is committed and deployed, the photo fades in over the
  illustration. **No code change is needed.**

The hero stays dark in light and dark mode by design; the photo is displayed
with `object-contain`, so a transparent cut-out sits directly on the dark
surface.
