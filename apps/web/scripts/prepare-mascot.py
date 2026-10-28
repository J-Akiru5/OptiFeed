"""Prepare Pakoy's mascot crops from Jeff's character sheet (#193, #232).

The sheet is a single 1254 x 1254 PNG. This script cuts every pose out of it,
keys the near-uniform light card background to transparency, and writes the
WebP files the app ships in `public/mascot/`. It is deliberately plain (Pillow
only) so the art can be redone from Jeff's final sheet without a design tool.

    python -I scripts/prepare-mascot.py path/to/pakoy-character-sheet.png

Crop boxes are in the source's pixel coordinates and are documented in
`public/mascot/README.md`.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# left, top, right, bottom on the 1254 x 1254 character sheet.
POSE_BOXES: dict[str, tuple[int, int, int, int]] = {
    "pakoy-idle": (20, 467, 156, 640),
    "pakoy-dispensing": (166, 464, 307, 643),
    "pakoy-offline": (326, 475, 458, 639),
    "pakoy-low-hopper": (474, 473, 612, 641),
    "pakoy-wrong-token": (780, 474, 912, 641),
    "pakoy-power-fault": (933, 473, 1069, 640),
    "pakoy-first-setup": (1090, 473, 1222, 640),
}

# The hero pose shares its panel with the PakaonAI wordmark: everything left of
# x=64 and above y=305 is text, not character.
HERO_BOX = (152, 0, 558, 446)
HERO_TEXT_BOX = (0, 0, 63, 305)

# The 512 px navy tile in the "head-only mark" row.
HEAD_BOX = (867, 782, 1015, 943)
ICON_SIZE = 512
HEAD_SIZE = 256


def flood_transparent(image: Image.Image, tolerance: int = 42) -> Image.Image:
    """Key the near-uniform light background to transparency from the corners."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    sentinel = (255, 0, 255, 255)
    for corner in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
        ImageDraw.floodfill(rgba, corner, sentinel, thresh=tolerance)
    pixels = rgba.load()
    for y in range(height):
        for x in range(width):
            if pixels[x, y] == sentinel:
                pixels[x, y] = (255, 255, 255, 0)
    # Feather by half a pixel so the cut edge does not look scissored.
    rgba.putalpha(rgba.getchannel("A").filter(ImageFilter.GaussianBlur(0.6)))
    return rgba


def trim(image: Image.Image, pad: int = 4) -> Image.Image:
    box = image.getchannel("A").getbbox()
    if not box:
        return image
    left, top, right, bottom = box
    width, height = image.size
    return image.crop(
        (max(0, left - pad), max(0, top - pad), min(width, right + pad), min(height, bottom + pad))
    )


def crop_to_head(image: Image.Image) -> Image.Image:
    """Crop the navy tile to a square centred on the pale head mark."""
    pixels = image.load()
    width, height = image.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a and r + g + b > 330:  # pale helmet against the navy tile
                xs.append(x)
                ys.append(y)
    if not xs:
        return image
    cx = (min(xs) + max(xs)) // 2
    cy = (min(ys) + max(ys)) // 2
    side = int(max(max(xs) - min(xs), max(ys) - min(ys)) * 1.18)
    side = min(side, width, height)
    left = max(0, min(width - side, cx - side // 2))
    top = max(0, min(height - side, cy - side // 2))
    return image.crop((left, top, left + side, top + side))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheet", type=Path, help="path to the 1254x1254 character sheet")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "public" / "mascot",
        help="output directory (defaults to apps/web/public/mascot)",
    )
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGB")
    args.out.mkdir(parents=True, exist_ok=True)

    for name, box in POSE_BOXES.items():
        cut = trim(flood_transparent(sheet.crop(box)))
        cut.save(args.out / f"{name}.webp", "WEBP", quality=90, method=6)
        print(f"{name}.webp {cut.width}x{cut.height}")

    hero = sheet.crop(HERO_BOX).convert("RGB")
    ImageDraw.Draw(hero).rectangle(HERO_TEXT_BOX, fill=(255, 255, 255))
    hero_cut = trim(flood_transparent(hero))
    hero_cut.save(args.out / "pakoy-hero.webp", "WEBP", quality=90, method=6)
    print(f"pakoy-hero.webp {hero_cut.width}x{hero_cut.height}")

    head = crop_to_head(sheet.crop(HEAD_BOX).convert("RGBA")).resize(
        (HEAD_SIZE, HEAD_SIZE), Image.LANCZOS
    )
    head.save(args.out / "pakoy-head.webp", "WEBP", quality=92, method=6)
    icon = head.convert("RGB").resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    icon.quantize(colors=128, method=Image.MEDIANCUT, dither=Image.Dither.NONE).save(
        args.out / "pakoy-icon-512.png", optimize=True
    )
    print(f"pakoy-head.webp {HEAD_SIZE}x{HEAD_SIZE}, pakoy-icon-512.png {ICON_SIZE}x{ICON_SIZE}")


if __name__ == "__main__":
    main()
