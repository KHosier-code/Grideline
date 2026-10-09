"""Probable's brand for the generated images and video: colors, fonts and the logo.

Fonts are the Google Fonts variable files the Weekly picks workflow downloads
into GRIDLINE_FONT_DIR (SpaceGrotesk.ttf, InstrumentSans.ttf); without them
the drawings fall back to DejaVu.
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

NAVY = (11, 26, 44)        # background
CARD = (16, 36, 59)
LINE = (28, 51, 80)
TEXT = (232, 238, 245)
WHITE = (255, 255, 255)
MUTED = (142, 163, 186)
SOFT = (184, 199, 216)
CORAL = (255, 138, 91)     # what you can act on: bars, numbers, links
MINT = (91, 228, 180)      # wins and value only

FONT_DIR = os.environ.get("GRIDLINE_FONT_DIR", "fonts")
_cache = {}


def font(size, weight="Bold", family="SpaceGrotesk"):
    """Space Grotesk for headlines and numbers; family="InstrumentSans" for small text.
    Weights: Space Grotesk Light/Regular/Medium/Bold, Instrument Sans Regular/Medium/SemiBold/Bold."""
    key = (family, weight, size)
    if key not in _cache:
        path = f"{FONT_DIR}/{family}.ttf"
        if os.path.exists(path):
            loaded = ImageFont.truetype(path, size)
            try:
                loaded.set_variation_by_name(weight)
            except (OSError, ValueError):
                pass
        else:
            fallback = ("/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf" if weight in ("Bold", "SemiBold")
                        else "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf")
            loaded = ImageFont.truetype(fallback, size) if os.path.exists(fallback) else ImageFont.load_default(size)
        _cache[key] = loaded
    return _cache[key]


def icon(size, bg=CORAL, fg=NAVY):
    """The logo: a "p" whose bowl is a probability ring, on a rounded tile (RGBA)."""
    k = 8
    n = size * k
    u = n / 52
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, n - 1, n - 1), radius=13 * u, fill=bg)
    box = (15 * u, 11 * u, 37 * u, 33 * u)
    width = round(5 * u)
    track = tuple(round(b * 0.7 + f * 0.3) for b, f in zip(bg, fg))
    d.ellipse(box, outline=track, width=width)
    sweep = 360 * 48 / (2 * math.pi * 11)
    d.arc(box, start=-90, end=-90 + sweep, fill=fg, width=width)
    for angle in (-90, -90 + sweep):  # round the arc's ends
        x = 26 * u + (11 * u - width / 2) * math.cos(math.radians(angle))
        y = 22 * u + (11 * u - width / 2) * math.sin(math.radians(angle))
        r = width / 2 - 1
        d.ellipse((x - r, y - r, x + r, y + r), fill=fg)
    d.rounded_rectangle((13 * u, 16 * u, 18 * u, 42 * u), radius=2.5 * u, fill=fg)
    return im.resize((size, size), Image.LANCZOS)


def wordmark(img, x, y, size, color=WHITE):
    """Logo tile plus "probable", vertically centred on y. Returns the right edge."""
    tile = icon(size)
    img.paste(tile, (int(x), int(y - size / 2)), tile)
    draw = ImageDraw.Draw(img)
    text_x = x + size * 1.25
    draw.text((text_x, y + size * 0.04), "probable", font=font(round(size * 0.9)), fill=color, anchor="lm")
    return text_x + draw.textlength("probable", font=font(round(size * 0.9)))
