"""Renders the sample book pages for book-reader's real-OCR test (Plan 5.3).

Output: services/book-reader/src/test/resources/pages/{english-page.png, hindi-page.png,
blurry-photo.jpg}. Text is set in Poppins (Latin + Devanagari, vendored in libs/ui/assets/fonts).
Run: make test-pages (python:3.12.15-slim with pillow, fonttools and brotli from the Tech Stack).
"""

from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageEnhance, ImageFilter, ImageFont, ImageDraw, features

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "libs" / "ui" / "assets" / "fonts"
OUT = ROOT / "services" / "book-reader" / "src" / "test" / "resources" / "pages"
WIDTH, HEIGHT = 1240, 1754  # A4 at 150 dpi
MARGIN = 110

ENGLISH = [
    ("Chapter 1", 64),
    ("Plants around us", 52),
    ("", 30),
    ("Look around you. Trees, bushes and grass", 38),
    ("are all plants. The roots grow under the", 38),
    ("soil and take in water. The stem holds the", 38),
    ("plant up. Leaves make food using sunlight,", 38),
    ("air and water.", 38),
]

HINDI = [
    ("पाठ 1", 64),
    ("मेरा गाँव", 56),
    ("", 30),
    ("मेरा गाँव बहुत सुंदर है। गाँव के पास", 40),
    ("एक छोटी नदी बहती है। नदी के किनारे", 40),
    ("बड़े-बड़े पेड़ हैं। सुबह चिड़ियाँ मीठे", 40),
    ("गीत गाती हैं।", 40),
]


def font_file(weight: int) -> Path:
    """The vendored WOFF2 as a TTF Pillow can read."""
    ttf = OUT / f".poppins-{weight}.ttf"
    if not ttf.exists():
        font = TTFont(FONTS / f"poppins-{weight}.woff2")
        font.flavor = None
        font.save(ttf)
    return ttf


def page(lines: list[tuple[str, int]]) -> Image.Image:
    image = Image.new("L", (WIDTH, HEIGHT), 255)
    draw = ImageDraw.Draw(image)
    y = MARGIN
    for index, (text, size) in enumerate(lines):
        font = ImageFont.truetype(
            str(font_file(600 if index < 2 else 400)), size, layout_engine=ImageFont.Layout.RAQM
        )
        if text:
            draw.text((MARGIN, y), text, font=font, fill=20)
        y += int(size * 1.7)
    return image


def main() -> None:
    if not features.check("raqm"):
        raise SystemExit("Pillow without libraqm cannot shape Devanagari")
    OUT.mkdir(parents=True, exist_ok=True)
    page(ENGLISH).save(OUT / "english-page.png", optimize=True)
    page(HINDI).save(OUT / "hindi-page.png", optimize=True)
    # A photo taken badly: small, blurred and low contrast, so OCR confidence is low
    blurry = page(ENGLISH).resize((WIDTH // 4, HEIGHT // 4)).filter(ImageFilter.GaussianBlur(3))
    blurry = ImageEnhance.Contrast(blurry).enhance(0.25).resize((WIDTH, HEIGHT))
    blurry.convert("RGB").save(OUT / "blurry-photo.jpg", quality=60)
    for ttf in OUT.glob(".poppins-*.ttf"):
        ttf.unlink()


if __name__ == "__main__":
    main()
