"""Draws the Bookative launcher icon: an index card (blue rules, red head rule)
on blue-black ink. Writes legacy PNG mipmaps plus an adaptive-icon foreground."""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

INK = (45, 62, 140)
CARD = (250, 250, 246)
RULE = (150, 175, 220)
RED = (210, 80, 74)
PEN = (30, 34, 48)

res = sys.argv[1] if len(sys.argv) > 1 else "android/res"
S = 4  # supersampling


def card_layer(size, scale):
    """Card drawn centred on a transparent canvas of `size`; `scale` = card width / size."""
    big = size * S
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    w = int(big * scale)
    h = int(w * 0.68)
    x0 = (big - w) // 2
    y0 = (big - h) // 2 + int(big * 0.01)
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    r = int(w * 0.045)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=CARD)
    # red head rule
    top = int(h * 0.24)
    lw = max(2, int(h * 0.028))
    d.rectangle([0, top, w, top + lw], fill=RED)
    # blue rules
    gap = int(h * 0.15)
    y = top + gap
    while y < h - gap * 0.4:
        d.rectangle([0, y, w, y + max(1, lw // 2)], fill=RULE)
        y += gap
    # handwritten-ish stroke: a title line in ink
    tw = int(w * 0.52)
    th = max(3, int(h * 0.05))
    ty = int(h * 0.11)
    d.rounded_rectangle([int(w * 0.09), ty, int(w * 0.09) + tw, ty + th], radius=th // 2, fill=PEN)
    # shadow
    shadow = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    off = int(big * 0.018)
    sd.rounded_rectangle([x0 + off, y0 + off * 2, x0 + w + off, y0 + h + off * 2], radius=r, fill=(0, 0, 20, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(big * 0.02))
    rotated = card.rotate(6, resample=Image.BICUBIC, expand=True)
    rx = (big - rotated.width) // 2
    ry = (big - rotated.height) // 2
    shadow = shadow.rotate(6, resample=Image.BICUBIC)
    layer = Image.alpha_composite(layer, shadow)
    layer.alpha_composite(rotated, (rx, ry))
    return layer.resize((size, size), Image.LANCZOS)


def legacy(size):
    big = size * S
    base = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)
    m = int(big * 0.04)
    d.rounded_rectangle([m, m, big - m, big - m], radius=int(big * 0.22), fill=INK)
    base = base.resize((size, size), Image.LANCZOS)
    base.alpha_composite(card_layer(size, 0.66))
    return base


densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for name, f in densities.items():
    d = os.path.join(res, "mipmap-" + name)
    os.makedirs(d, exist_ok=True)
    legacy(int(48 * f)).save(os.path.join(d, "ic_launcher.png"))
    # adaptive foreground: 108dp canvas, card within the 66dp safe zone
    fg = card_layer(int(108 * f), 0.56)
    fg.save(os.path.join(d, "ic_launcher_fg.png"))

os.makedirs(os.path.join(res, "mipmap-anydpi-v26"), exist_ok=True)
with open(os.path.join(res, "mipmap-anydpi-v26", "ic_launcher.xml"), "w") as fh:
    fh.write('<?xml version="1.0" encoding="utf-8"?>\n'
             '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
             '    <background android:drawable="@color/ic_launcher_bg" />\n'
             '    <foreground android:drawable="@mipmap/ic_launcher_fg" />\n'
             '</adaptive-icon>\n')
os.makedirs(os.path.join(res, "values"), exist_ok=True)
with open(os.path.join(res, "values", "colors.xml"), "w") as fh:
    fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
             '    <color name="ic_launcher_bg">#2D3E8C</color>\n</resources>\n')
legacy(512).save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon-512.png"))
print("icons written")
