#!/usr/bin/env python3
"""Draw the Resonance Studio app icon and write the .ico + PNGs.

Design: the site's favicon grown up — an amber core on charcoal, with the ripples it sends out
standing clear of each other. Legible at 16 px (dot + two rings survive), which is the only test
that matters for a taskbar icon.

Outputs (windows/icons/):
  resonancestudio.ico            16/24/32/48/64/128/256 multi-size, for the exe, shortcuts, installer
  resonancestudio-icon-512.png   the downloads-page icon + press/README use
  resonancestudio-icon-116.png / -58.png
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.normpath(os.path.join(HERE, "..", "icons"))
S = 1024

PLATE_TOP = (30, 26, 20)
PLATE_BOT = (12, 10, 8)
EDGE = (98, 84, 58)
AMBER = (224, 185, 111)
AMBER_HOT = (248, 214, 150)
CREAM = (238, 228, 205)


def rounded_mask(size, radius, aa=4):
    m = Image.new("L", (size * aa, size * aa), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size * aa - 1, size * aa - 1], radius=radius * aa, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def build():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # charcoal plate with a vertical gradient + a warm 1px-class edge highlight
    plate = Image.new("RGBA", (S, S))
    d = ImageDraw.Draw(plate)
    for y in range(S):
        t = y / (S - 1)
        d.line([(0, y), (S, y)], fill=tuple(int(PLATE_TOP[i] + (PLATE_BOT[i] - PLATE_TOP[i]) * t) for i in range(3)) + (255,))
    d.rounded_rectangle([6, 6, S - 7, S - 7], radius=int(S * 0.20), outline=EDGE + (170,), width=8)
    img.paste(plate, (0, 0), rounded_mask(S, int(S * 0.21)))

    d = ImageDraw.Draw(img)
    cx, cy = int(S * 0.42), int(S * 0.50)

    # soft amber glow under the core
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - int(S * 0.16), cy - int(S * 0.16), cx + int(S * 0.16), cy + int(S * 0.16)], fill=AMBER + (66,))
    glow = glow.filter(ImageFilter.GaussianBlur(S // 26))
    img.alpha_composite(glow)

    # the ripples: three rings, thinning and cooling outward
    rings = [(0.175, 0.0360, AMBER_HOT + (255,)),
             (0.280, 0.0300, AMBER + (220,)),
             (0.385, 0.0250, CREAM + (160,))]
    for radius, width, colour in rings:
        r = int(radius * S)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=colour, width=int(width * S))

    # the core: the amber dot the whole thing is phase-locked to
    dr = int(S * 0.083)
    d.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=AMBER + (255,))
    d.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], outline=AMBER_HOT + (255,), width=max(4, S // 160))

    os.makedirs(ICONS, exist_ok=True)
    ico = os.path.join(ICONS, "resonancestudio.ico")
    sizes = [16, 24, 32, 48, 64, 128, 256]
    img.save(ico, format="ICO", sizes=[(s, s) for s in sizes])
    img.resize((512, 512), Image.LANCZOS).save(os.path.join(ICONS, "resonancestudio-icon-512.png"))
    for s in (58, 116):
        img.resize((s, s), Image.LANCZOS).save(os.path.join(ICONS, f"resonancestudio-icon-{s}.png"))
    print("wrote", ico, "and PNGs to", ICONS)
    return ico


if __name__ == "__main__":
    build()
