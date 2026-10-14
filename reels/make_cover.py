#!/usr/bin/env python3
"""Instagram reel cover in the Love card style (1080x1920).

One rounded exterior card with the address on it, a lavender stats pill
(bed, bath, car) over its bottom edge, and the love. logo below, on the
striped white background from the reel end card.

  python3 reels/make_cover.py photo.jpg \
      --address "295 Main Road" --address "Fennell Bay" \
      --bed 4 --bath 1 --car 6 \
      --out reels/295-main-road/cover.png

Leave out any of --bed/--bath/--car to drop that stat. --focus X Y picks
which part of the photo the card keeps (0 to 1 each, default 0.5 0.4).
Everything that matters sits inside the middle 3:4 (y 240 to 1680), which is
what the profile grid shows. --guides writes a second file with that band
marked.

Needs Python 3 and Pillow (pip install pillow).
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
except ImportError:
    sys.exit("make_cover.py needs Pillow: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "reels" / "assets"
INTER = ROOT / "assets" / "fonts" / "Inter.ttf"

W, H = 1080, 1920
GRID_TOP, GRID_BOTTOM = 240, 1680
LAVENDER = (158, 150, 186)
SHADOW = (110, 100, 150)

CARD = (80, 280, 1000, 1280)
CARD_RADIUS = 56
PILL_TOP = 1220
PILL_H = 154
LOGO_W = 340
LOGO_TOP = 1450


def inter(weight, size):
    f = ImageFont.truetype(str(INTER), size)
    try:
        f.set_variation_by_name(weight)
    except (OSError, ValueError):
        pass
    return f


def cover_fit(img, w, h, fx, fy):
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x = round((img.width - w) * fx)
    y = round((img.height - h) * fy)
    return img.crop((x, y, x + w, y + h))


def card(canvas, fill, box, r):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((x0 + 6, y0 + 26, x1 - 6, y1 + 26), r, fill=SHADOW + (95,))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(34)))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=255)
    tile = Image.new("RGBA", (w, h), fill + (255,)) if isinstance(fill, tuple) else fill.convert("RGBA")
    canvas.paste(tile, (x0, y0), mask)


def address(canvas, lines, x, y, size=68):
    f = inter("SemiBold", size)
    step = round(size * 1.12)
    for i, line in enumerate(lines):
        # soft dark halo so white type holds up over bright sky
        halo = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(halo).text((x, y + i * step), line, font=f, fill=(20, 30, 50, 110))
        canvas.alpha_composite(halo.filter(ImageFilter.GaussianBlur(10)))
        ImageDraw.Draw(canvas).text((x, y + i * step), line, font=f, fill="white")


def stats_pill(canvas, stats):
    icon_h, gap, group_gap, pad = 58, 22, 60, 84
    f = inter("SemiBold", 58)
    parts = []
    for name, value in stats:
        icon = Image.open(ASSETS / f"icon-{name}.png").convert("RGBA")
        icon = icon.resize((round(icon.width * icon_h / icon.height), icon_h), Image.LANCZOS)
        tw = round(f.getlength(str(value)))
        parts.append((icon, str(value), tw))
    inner = sum(i.width + gap + tw for i, _, tw in parts) + group_gap * (len(parts) - 1)
    width = max(520, inner + 2 * pad)
    x0 = (W - width) // 2
    card(canvas, LAVENDER, (x0, PILL_TOP, x0 + width, PILL_TOP + PILL_H), PILL_H // 3)
    x = (W - inner) // 2
    cy = PILL_TOP + PILL_H // 2
    d = ImageDraw.Draw(canvas)
    for icon, text, tw in parts:
        canvas.alpha_composite(icon, (x, cy - icon.height // 2))
        x += icon.width + gap
        d.text((x, cy), text, font=f, fill="white", anchor="lm")
        x += tw + group_gap


def logo(canvas):
    lg = Image.open(ASSETS / "love-dark.png").convert("RGBA")
    lg = lg.resize((LOGO_W, round(lg.height * LOGO_W / lg.width)), Image.LANCZOS)
    canvas.alpha_composite(lg, ((W - lg.width) // 2, LOGO_TOP))
    return LOGO_TOP + lg.height


def build(args):
    photo = ImageOps.exif_transpose(Image.open(args.photo)).convert("RGB")
    canvas = Image.open(ASSETS / "stripe-bg.png").convert("RGBA")
    x0, y0, x1, y1 = CARD
    card(canvas, cover_fit(photo, x1 - x0, y1 - y0, *args.focus), CARD, CARD_RADIUS)
    if args.address:
        address(canvas, args.address, x0 + 56, y0 + 56)
    stats = [(n, v) for n, v in (("bed", args.bed), ("bath", args.bath), ("car", args.car)) if v is not None]
    if stats:
        stats_pill(canvas, stats)
    bottom = logo(canvas)
    if bottom > GRID_BOTTOM:
        print(f"warning: logo ends at y={bottom}, below the grid crop at {GRID_BOTTOM}", file=sys.stderr)
    return canvas


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("photo", help="exterior photo")
    p.add_argument("--address", action="append", default=[], help="one address line; repeat for each line")
    p.add_argument("--bed", type=int)
    p.add_argument("--bath", type=int)
    p.add_argument("--car", type=int)
    p.add_argument("--focus", nargs=2, type=float, default=[0.5, 0.4], metavar=("X", "Y"))
    p.add_argument("--out", required=True)
    p.add_argument("--guides", action="store_true", help="also write <out>-guides.png with the 3:4 grid crop marked")
    args = p.parse_args()

    img = build(args)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out, optimize=True)
    print(out)
    if args.guides:
        g = img.convert("RGB")
        d = ImageDraw.Draw(g)
        for y in (GRID_TOP, GRID_BOTTOM):
            d.line((0, y, W, y), fill=(255, 0, 90), width=4)
        gp = out.with_name(out.stem + "-guides.png")
        g.save(gp, optimize=True)
        print(gp)


if __name__ == "__main__":
    main()
