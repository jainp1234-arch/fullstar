"""Plan 9.3: the family app's home-screen icons from the vendored owl (Fluent Emoji, MIT).

The owl sits in the middle 60% of a --color-primary-600 square, inside the maskable safe zone,
so every launcher shape keeps it whole. Runs in python:3.12.15-slim with requirements.txt
(`make app-icons`); writes apps/family-app/public/icons/icon-<n>x<n>.png.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OWL = ROOT / "libs" / "ui" / "assets" / "illustrations" / "mascot-owl.webp"
OUT = ROOT / "apps" / "family-app" / "public" / "icons"
PRIMARY_600 = (0x4F, 0x52, 0xBD, 255)
SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
OWL_SHARE = 0.6


def icon(owl: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), PRIMARY_600)
    side = round(size * OWL_SHARE)
    art = owl.resize((side, side), Image.Resampling.LANCZOS)
    offset = (size - side) // 2
    canvas.alpha_composite(art, (offset, offset))
    return canvas.convert("RGB")


def main() -> int:
    owl = Image.open(OWL).convert("RGBA")
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT / f"icon-{size}x{size}.png"
        icon(owl, size).save(path, optimize=True)
        print(f"ok  {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
