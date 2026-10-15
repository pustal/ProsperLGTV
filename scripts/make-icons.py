"""Generates the webOS launcher icons and splash screen in assets/icons/.

Run from the project root:  python3 scripts/make-icons.py   (or: npm run icons)
Needs Pillow.

The artwork is original to Prosper LG TV and drawn here in code (no source
image): a television with two antennas on the app's graphite background,
its screen lit in the app's signal yellow with a play mark. It does not
reuse ProsperoTV's icon or any channel or brand artwork.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path("assets/icons")
BG = (14, 16, 19)          # --bg in src/styles/app.css
SIGNAL = (255, 210, 63)    # --signal
INK = (31, 24, 6)          # --signal-ink
BODY = (62, 69, 82)        # a lighter --surface-2, so the cabinet reads on --bg
SCALE = 8                  # draw large, then downsample for smooth edges


def mark(size):
    """The TV mark on a transparent square of `size` px."""
    s = size * SCALE
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = s / 100.0  # 1 unit = 1% of the icon

    # Antennas
    w = int(4 * u)
    d.line([(50 * u, 30 * u), (34 * u, 12 * u)], fill=SIGNAL, width=w)
    d.line([(50 * u, 30 * u), (66 * u, 12 * u)], fill=SIGNAL, width=w)
    r = 4 * u
    for x in (34, 66):
        d.ellipse([x * u - r, 12 * u - r, x * u + r, 12 * u + r], fill=SIGNAL)

    # Cabinet and screen
    d.rounded_rectangle([12 * u, 28 * u, 88 * u, 84 * u], radius=10 * u, fill=BODY)
    d.rounded_rectangle([18 * u, 34 * u, 82 * u, 78 * u], radius=6 * u, fill=SIGNAL)

    # Play mark
    d.polygon([(43 * u, 45 * u), (43 * u, 67 * u), (61 * u, 56 * u)], fill=INK)

    # Feet
    d.rounded_rectangle([26 * u, 84 * u, 34 * u, 90 * u], radius=2 * u, fill=BODY)
    d.rounded_rectangle([66 * u, 84 * u, 74 * u, 90 * u], radius=2 * u, fill=BODY)
    return im.resize((size, size), Image.LANCZOS)


def icon(size):
    """Launcher icon: the mark on the app background."""
    im = Image.new("RGB", (size, size), BG)
    m = mark(size)
    im.paste(m, (0, 0), m)
    return im


def splash():
    """Full-screen splash: the mark centred on the app background."""
    im = Image.new("RGB", (1920, 1080), BG)
    m = mark(360)
    im.paste(m, ((1920 - 360) // 2, (1080 - 360) // 2), m)
    return im


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    icon(80).save(OUT / "icon.png", optimize=True)
    icon(130).save(OUT / "largeIcon.png", optimize=True)
    splash().save(OUT / "splash.png", optimize=True)
    print("icons written to", OUT)
