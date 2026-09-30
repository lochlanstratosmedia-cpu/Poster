#!/usr/bin/env python3
"""Cover shot: turn a good property photo into an image-led social post.

Drop photos in inbox/ first, then run the steps in order:

  intake   move every photo in inbox/ into its own covers/<name>/ folder
  analyse  read a photo's exposure, colour and palette, and find calm areas for text
  prompt   build the Nano Banana Pro edit prompt and write job.json for Higgsfield
  finish   crop the render to a social format and set a small caption on it
  compare  put the original and the render side by side for an integrity check

The generation itself runs through the Higgsfield connector in Claude Code, so
this script never calls an API. See .claude/skills/cover-shot/SKILL.md.

Needs Python 3 and Pillow (pip install pillow). iPhone HEIC files also need
pillow-heif (pip install pillow-heif).
"""

import argparse
import colorsys
import json
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageStat
except ImportError:
    sys.exit("cover_shot.py needs Pillow: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"

MODEL = "nano_banana_pro"
# Aspect ratios nano_banana_pro accepts, as width / height.
MODEL_RATIOS = {
    "1:1": 1.0, "3:2": 1.5, "2:3": 2 / 3, "4:3": 4 / 3, "3:4": 0.75,
    "4:5": 0.8, "5:4": 1.25, "9:16": 9 / 16, "16:9": 16 / 9, "21:9": 21 / 9,
}

# Social formats for the finish step, as (width, height) in pixels.
FORMATS = {
    "4:5": (1440, 1800),    # Instagram and Facebook feed
    "9:16": (1440, 2560),   # Stories and Reels covers
    "1:1": (1440, 1440),
    "3:4": (1440, 1920),
}

LABELS = {
    "just-listed": "Just listed",
    "coming-soon": "Coming soon",
    "just-sold": "Just sold",
    "for-lease": "For lease",
    "open-home": "Open home",
}

INK_DARK = (31, 29, 26)
INK_LIGHT = (246, 242, 234)


# ---------------------------------------------------------------- analyse

def load(path):
    enable_heic()
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def describe_colour(rgb):
    """Plain-words name for a colour, e.g. 'muted warm beige'."""
    r, g, b = (c / 255 for c in rgb)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    deg = h * 360
    if s < 0.08 or (l > 0.93) or (l < 0.08):
        if l > 0.88:
            return "off-white"
        if l < 0.15:
            return "near-black"
        return "light grey" if l > 0.6 else "mid grey" if l > 0.35 else "charcoal"
    if deg < 15 or deg >= 345:
        hue = "red"
    elif deg < 28:
        hue = "terracotta" if l < 0.5 else "peach"
    elif deg < 55:
        if l < 0.4:
            hue = "brown"
        else:
            hue = "honey" if s > 0.35 else "tan" if l < 0.6 else "beige"
    elif deg < 70:
        hue = "sand" if s < 0.4 else "ochre"
    elif deg < 160:
        hue = "sage" if s < 0.3 else "green"
    elif deg < 200:
        hue = "teal"
    elif deg < 255:
        hue = "blue"
    elif deg < 290:
        hue = "violet"
    else:
        hue = "dusty pink" if s < 0.5 else "pink"
    tone = "pale" if l > 0.75 else "light" if l > 0.58 else "deep" if l < 0.3 else "mid"
    sat = "muted" if s < 0.25 else "rich" if s > 0.6 else ""
    return " ".join(w for w in (tone, sat, hue) if w)


def palette(img, n=6):
    small = img.copy()
    small.thumbnail((240, 240))
    q = small.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: n * 3]
    counts = sorted(q.getcolors(), reverse=True)
    total = sum(c for c, _ in counts)
    out = []
    for count, idx in counts:
        rgb = tuple(pal[idx * 3: idx * 3 + 3])
        out.append({
            "hex": "#%02x%02x%02x" % rgb,
            "name": describe_colour(rgb),
            "share": round(count / total, 3),
        })
    return out


def zone_boxes(w, h):
    """Candidate caption zones: top and bottom bands, split into thirds."""
    band = int(h * 0.16)
    third = w // 3
    zones = {}
    for vname, y0 in (("top", 0), ("bottom", h - band)):
        zones[f"{vname}-left"] = (0, y0, third, y0 + band)
        zones[f"{vname}-center"] = (third, y0, 2 * third, y0 + band)
        zones[f"{vname}-right"] = (2 * third, y0, w, y0 + band)
    return zones


def busyness(gray, edges, box):
    """Lower is calmer. Mix of edge density and tonal spread."""
    e = ImageStat.Stat(edges.crop(box)).mean[0] / 255
    s = ImageStat.Stat(gray.crop(box)).stddev[0] / 128
    return 0.7 * e + 0.3 * s


def quiet_zones(img):
    small = img.copy()
    small.thumbnail((600, 600))
    gray = small.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(2))
    scores = {}
    for name, box in zone_boxes(*small.size).items():
        scores[name] = {
            "busyness": round(busyness(gray, edges, box), 3),
            "luma": round(ImageStat.Stat(gray.crop(box)).mean[0] / 255, 3),
        }
    return dict(sorted(scores.items(), key=lambda kv: kv[1]["busyness"]))


def analyse(img):
    w, h = img.size
    small = img.copy()
    small.thumbnail((800, 800))
    gray = small.convert("L")
    hist = gray.histogram()
    px = sum(hist)
    clip_hi = sum(hist[250:]) / px
    clip_lo = sum(hist[:6]) / px
    luma = ImageStat.Stat(gray).mean[0] / 255
    contrast = ImageStat.Stat(gray).stddev[0] / 255
    r, g, b = ImageStat.Stat(small).mean
    hsv = small.convert("HSV")
    sat = ImageStat.Stat(hsv).mean[1] / 255
    ratio = w / h
    gen_ratio = min(MODEL_RATIOS, key=lambda k: abs(MODEL_RATIOS[k] - ratio))

    fixes = []
    if clip_hi > 0.02:
        fixes.append("recover the blown highlights (%.0f%% of the frame is clipped white)" % (clip_hi * 100))
    if clip_lo > 0.03:
        fixes.append("open up the crushed shadows so detail shows")
    if luma < 0.38:
        fixes.append("lift overall exposure, it reads dark")
    elif luma > 0.7:
        fixes.append("bring exposure down slightly, it reads washed out")
    if contrast > 0.27:
        fixes.append("soften the harsh contrast into a longer tonal range")
    elif contrast < 0.14:
        fixes.append("add depth, the tones are flat")
    if sat > 0.45:
        fixes.append("pull saturation back to natural, especially greens and blues")
    if (r - b) / 255 > 0.12:
        warmth = "warm"
    elif (b - r) / 255 > 0.04:
        warmth = "cool"
        fixes.append("neutralise the cool cast so whites read clean")
    else:
        warmth = "neutral"

    return {
        "size": [w, h],
        "aspect": round(ratio, 3),
        "generate_aspect": gen_ratio,
        "luma": round(luma, 3),
        "contrast": round(contrast, 3),
        "saturation": round(sat, 3),
        "warmth": warmth,
        "clipped_highlights": round(clip_hi, 4),
        "clipped_shadows": round(clip_lo, 4),
        "palette": palette(img),
        "quiet_zones": quiet_zones(img),
        "fixes": fixes,
    }


def cmd_analyse(a):
    info = analyse(load(a.image))
    if a.json:
        print(json.dumps(info, indent=2))
        return
    print(f"{a.image}: {info['size'][0]}x{info['size'][1]}, generate at {info['generate_aspect']}")
    print(f"  luma {info['luma']}  contrast {info['contrast']}  saturation {info['saturation']}  cast {info['warmth']}")
    print("  palette: " + ", ".join(f"{p['name']} {p['hex']} ({p['share']:.0%})" for p in info["palette"]))
    calm = list(info["quiet_zones"])[:3]
    print("  calmest caption zones: " + ", ".join(calm))
    for f in info["fixes"] or ["no obvious exposure or colour problems"]:
        print("  - " + f)


# ---------------------------------------------------------------- prompt

SOURCE = {
    "phone": (
        "This is a phone photo. Undo the phone processing: HDR flatness and halos, "
        "over-sharpening, smeared noise, oversaturated greens and skies, crushed blacks, "
        "and wide-angle stretching near the edges. It should look like it was shot on a "
        "full-frame camera with a tilt-shift lens, on a tripod, by an architectural photographer."
    ),
    "camera": (
        "This is a camera photo. Change only what it needs (light, grade and perspective) "
        "and keep the lens rendering and depth of field as they are."
    ),
}

LIGHT = {
    "keep": (
        "Keep the sun direction and time of day, but give it the quality of the best moment "
        "of that day: warmer, cleaner sunlight, crisp shadow edges that still hold detail, "
        "highlights that roll off softly instead of clipping."
    ),
    "golden": (
        "Relight the scene as late-afternoon golden hour: low, warm sun raking across the "
        "surfaces so every texture reads, long soft-edged shadows following the sun direction "
        "already in the photo, a warm glow on sunlit surfaces and cool blue-grey open shade."
    ),
    "soft": (
        "Relight the scene with bright, soft overcast daylight: even and diffused, gentle "
        "falloff from windows and openings, no hard shadows, clean neutral whites."
    ),
    "morning": (
        "Relight the scene as clear early morning: low side sun, cool-neutral and crisp, an "
        "airy feel. Shadows follow the sun direction already in the photo."
    ),
    "dusk": (
        "Relight the scene at blue hour: deep even blue sky, and warm light glowing from the "
        "light fittings and windows already in the photo. Do not add light fittings that are not there."
    ),
}

GRADE = {
    "film": (
        "A warm, filmic editorial grade in the manner of Kodak Portra 400: creamy highlights, "
        "slightly lifted blacks, gentle warmth in the midtones, greens pulled toward olive, "
        "oranges and reds softened toward terracotta. Lower saturation and a softer contrast "
        "curve than the phone original."
    ),
    "clean": (
        "A clean, bright architectural grade: neutral whites, crisp but not harsh contrast, "
        "true colours slightly desaturated, airy highlights."
    ),
    "moody": (
        "A deep, moody grade: rich shadows with detail, controlled highlights, earthy "
        "desaturated colour, cinematic contrast."
    ),
}

FRAME = {
    "subtle": "Straighten verticals and level horizontals. Crop in slightly only if it helps.",
    "editorial": (
        "Reframe for a stronger composition. Crop in (up to about a quarter of the frame) toward "
        "the most graphic part of the scene, such as leading lines, repeating shapes or the fall "
        "of light, and place it on the thirds. Straighten verticals as a shift lens would and "
        "level horizontals. Trim distracting edges."
    ),
    "bold": (
        "Reframe decisively. Crop in hard (up to about 40 percent) to the single strongest "
        "graphic idea in the scene and build the frame around it. Straighten verticals as a "
        "shift lens would and level horizontals."
    ),
}

SHOT = {
    "exterior": (
        "Exterior. Facade, roof, gutters, fence, paths, steps, letterbox and garden are the real "
        "property. Lawn and foliage a healthy natural green, never neon."
    ),
    "interior": (
        "Interior. Balance the windows so the view outside is visible but softer than the room. "
        "Walls keep their true paint colour, ceilings read clean rather than grey."
    ),
    "detail": (
        "Detail and texture shot. The material, grain and fall of light are the subject. "
        "Let the light pattern carry the frame and keep the background quiet."
    ),
    "kitchen": (
        "Kitchen. Benchtops, cabinetry, splashback, handles, tapware and appliances keep their "
        "exact finish and shape. Clean reflections, no smudges, benches as they are."
    ),
    "bathroom": (
        "Bathroom. Tiles, grout lines, vanity, tapware, glass and mirrors keep their exact finish. "
        "Clean reflections, no smudges."
    ),
    "garden": (
        "Garden or outdoor living. Plants, trees, paving, decking and furniture stay exactly where "
        "they are. Foliage a healthy natural green, never neon."
    ),
}
SHOT["living"] = SHOT["bedroom"] = SHOT["interior"]


def build_prompt(a, info):
    change = [
        f"Light: {LIGHT[a.light]}",
        f"Grade: {GRADE[a.grade]}",
    ]
    frame = FRAME[a.strength]
    space = a.text_space
    if space == "auto":
        space = next(iter(info["quiet_zones"])).split("-")[0]
    if space in ("top", "bottom"):
        frame += (
            f" Leave the {space} sixth of the final frame calm and uncluttered (whatever is "
            "already there: sky, wall, floor, lawn) so a small caption can sit on it later."
        )
    change.append(f"Frame: {frame}")
    camera = SOURCE[a.source]
    if info["fixes"]:
        camera += " Measured problems to fix: " + "; ".join(info["fixes"]) + "."
    change.append(f"Camera: {camera}")

    keep = [
        "Every wall, window, door, step, railing, roofline, fixture, tree and plant that stays "
        "in frame keeps its position, size, shape and count.",
        "Surfaces keep their real material and base colour under the new light and grade: red "
        "brick stays red brick, a cream wall stays cream, a green awning stays green.",
        "Honest wear stays (chips, patina, grain). Better photography, not a renovated building.",
    ]
    if a.tidy:
        keep.append(
            "Nothing is added. Only small temporary clutter may go (hoses, bins, loose leaves, "
            "cables, personal items on benches). Nothing fixed or built in is removed."
        )
    else:
        keep.append("Nothing is added or removed: no objects, furniture, plants, fittings, people or signs.")
    keep.append(
        "The sky may be cleaned up to a clear natural blue with light cloud."
        if a.sky else "The sky changes only in tone."
    )

    lines = [
        "Re-photograph this scene the way a leading architectural photographer would for the "
        "cover of an architecture and interiors magazine. The result must look clearly and "
        "visibly better than the input: new light, a real colour grade and a stronger frame. "
        "A result that looks like the input with small tweaks is a failure.",
        "",
        "CHANGE:",
        *[f"{i}. {c}" for i, c in enumerate(change, 1)],
        "- Finish: soft highlight roll-off, fine natural grain, no HDR halos, no over-sharpening, "
        "no plastic or CGI look.",
        "",
        f"SUBJECT: {SHOT[a.shot]}",
        "",
        "KEEP TRUE (the property must stay honest):",
        *[f"- {k}" for k in keep],
    ]
    if a.notes:
        lines += ["", f"NOTES: {a.notes}"]
    lines += ["", "Do not add any text, watermark, logo or border. House numbers and signs already in the photo stay as they are."]
    return "\n".join(lines)


def cmd_prompt(a):
    img = load(a.image)
    info = analyse(img)
    prompt = build_prompt(a, info)
    job = {
        "source_image": str(Path(a.image)),
        "settings": {
            "source": a.source, "shot": a.shot, "light": a.light,
            "grade": a.grade, "strength": a.strength,
            "text_space": a.text_space, "tidy": a.tidy, "sky": a.sky, "notes": a.notes,
        },
        "higgsfield": {
            "model": MODEL,
            "aspect_ratio": info["generate_aspect"],
            "resolution": a.resolution,
            "count": a.count,
            "prompt": prompt,
            "medias": [{"role": "image_references", "value": "<media_id of the uploaded source>"}],
        },
        "analysis": info,
    }
    src = Path(a.image).resolve()
    if a.out:
        out = Path(a.out)
    elif src.parent.parent == ROOT / "covers":
        out = src.parent / "job.json"
    else:
        out = ROOT / "covers" / slugify(src.stem) / "job.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(job, indent=2) + "\n")
    print(prompt)
    print(f"\n[wrote {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}]", file=sys.stderr)


# ---------------------------------------------------------------- finish

def font(kind, size, weight):
    path = FONTS / ("Inter.ttf" if kind == "sans" else "CormorantGaramond.ttf")
    try:
        f = ImageFont.truetype(str(path), size)
        try:
            f.set_variation_by_name(weight)
        except (OSError, ValueError):
            pass
        return f
    except OSError:
        return ImageFont.load_default(size)


def crop_to(img, ratio, focus):
    w, h = img.size
    fx, fy = focus
    if w / h > ratio:
        nw = int(h * ratio)
        x = int(min(max(fx * w - nw / 2, 0), w - nw))
        return img.crop((x, 0, x + nw, h))
    nh = int(w / ratio)
    y = int(min(max(fy * h - nh / 2, 0), h - nh))
    return img.crop((0, y, w, y + nh))


def tracked_width(draw, text, f, tracking):
    return sum(draw.textlength(ch, font=f) for ch in text) + tracking * max(len(text) - 1, 0)


def draw_tracked(draw, xy, text, f, fill, tracking):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + tracking


def layout(draw, W, label, line, scale, serif_label):
    """Return drawable parts and the block size."""
    parts = []
    if label:
        size = max(int(W * 0.019 * scale), 12)
        if serif_label:
            f = font("serif", int(size * 1.5), b"Medium")
            text, track = label, 0
        else:
            f = font("sans", size, b"Medium")
            text, track = label.upper(), size * 0.24
        parts.append(("label", text, f, track))
    if line:
        f = font("serif", max(int(W * 0.03 * scale), 16), b"Regular")
        parts.append(("line", line, f, 0))
    gap = int(W * 0.012 * scale)
    widths, heights = [], []
    for _, text, f, track in parts:
        widths.append(tracked_width(draw, text, f, track))
        box = f.getbbox("Hg")
        heights.append(box[3] - box[1])
    bw = max(widths) if widths else 0
    bh = sum(heights) + gap * max(len(parts) - 1, 0)
    return parts, widths, heights, gap, bw, bh


def block_origin(pos, W, H, bw, bh, margin):
    v, hpos = pos.split("-")
    y = margin if v == "top" else H - margin - bh
    x = {"left": margin, "center": (W - bw) / 2, "right": W - margin - bw}[hpos]
    return int(x), int(y)


def cmd_finish(a):
    img = load(a.image)
    if a.format != "original":
        W, H = FORMATS[a.format]
        img = crop_to(img, W / H, a.focus).resize((W, H), Image.LANCZOS)
    W, H = img.size

    label = LABELS.get(a.label, a.label) if a.label else None
    draw = ImageDraw.Draw(img)
    parts, widths, heights, gap, bw, bh = layout(draw, W, label, a.line, a.size, a.serif_label)
    margin = int(W * 0.06)

    gray = img.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(3))
    candidates = [a.position] if a.position != "auto" else [
        "bottom-left", "top-left", "bottom-center", "top-center", "bottom-right", "top-right"]
    scored = []
    for pos in candidates:
        x, y = block_origin(pos, W, H, bw, bh, margin)
        pad = int(W * 0.02)
        box = (max(x - pad, 0), max(y - pad, 0), min(x + int(bw) + pad, W), min(y + bh + pad, H))
        scored.append((busyness(gray, edges, box), pos, box))
    score, pos, box = min(scored)
    luma = ImageStat.Stat(gray.crop(box)).mean[0] / 255
    tone = a.tone if a.tone != "auto" else ("dark" if luma > 0.58 else "light")
    ink = INK_DARK if tone == "dark" else INK_LIGHT

    if a.scrim or score > 0.22:
        # Busy spot: lay a very soft gradient under the text so it stays legible.
        shade = Image.new("L", (W, H), 0)
        sd = ImageDraw.Draw(shade)
        sd.rectangle(box, fill=90 if tone == "light" else 70)
        shade = shade.filter(ImageFilter.GaussianBlur(W * 0.04))
        tint = Image.new("RGB", (W, H), (0, 0, 0) if tone == "light" else (255, 255, 255))
        img = Image.composite(tint, img, shade)
        draw = ImageDraw.Draw(img)

    x0, y = block_origin(pos, W, H, bw, bh, margin)
    align = pos.split("-")[1]
    for (_, text, f, track), tw, th in zip(parts, widths, heights):
        x = {"left": x0, "center": (W - tw) / 2, "right": x0 + bw - tw}[align]
        top_offset = f.getbbox("Hg")[1]
        draw_tracked(draw, (x, y - top_offset), text, f, ink, track)
        y += th + gap

    if a.mark:
        mpos = {"left": "right", "right": "left", "center": "center"}[align]
        mv = "top" if pos.startswith("bottom") else "bottom"
        f = font("sans", max(int(W * 0.015 * a.size), 11), b"Regular")
        text = a.mark.upper()
        track = f.size * 0.2
        mw = tracked_width(draw, text, f, track)
        mh = f.getbbox("Hg")[3] - f.getbbox("Hg")[1]
        mx, my = block_origin(f"{mv}-{mpos}", W, H, mw, mh, margin)
        mbox = (mx, my, mx + int(mw), my + mh)
        mgray = img.convert("L")
        mluma = ImageStat.Stat(mgray.crop(mbox)).mean[0] / 255
        mink = INK_DARK if mluma > 0.58 else INK_LIGHT
        medges = mgray.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(3))
        if busyness(mgray, medges, mbox) > 0.22:
            shade = Image.new("L", (W, H), 0)
            ImageDraw.Draw(shade).rectangle(mbox, fill=90 if mink == INK_LIGHT else 70)
            shade = shade.filter(ImageFilter.GaussianBlur(W * 0.03))
            tint = Image.new("RGB", (W, H), (0, 0, 0) if mink == INK_LIGHT else (255, 255, 255))
            img = Image.composite(tint, img, shade)
            draw = ImageDraw.Draw(img)
        draw_tracked(draw, (mx, my - f.getbbox("Hg")[1]), text, f, mink, track)

    out = Path(a.out) if a.out else Path(a.image).with_name(Path(a.image).stem + f"-post-{a.format.replace(':', 'x')}.jpg")
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "JPEG", quality=95, subsampling=0, optimize=True)
    print(f"{out}  ({W}x{H}, caption {pos}, {tone} ink)")


# ---------------------------------------------------------------- cover

PAPER = (243, 239, 232)


def fit_font(draw, text, kind, weight, max_w, max_size, tracking_em=0.0):
    """Largest font size that keeps text within max_w."""
    size = max_size
    while size > 10:
        f = font(kind, size, weight)
        if tracked_width(draw, text, f, size * tracking_em) <= max_w:
            return f
        size = int(size * 0.94)
    return font(kind, 10, weight)


def text_h(f):
    box = f.getbbox("Hg")
    return box[3] - box[1]


def put(draw, x, y, text, f, ink, tracking=0.0, align="left", width=None):
    """Draw text with its visual top at y. Returns the bottom y."""
    tw = tracked_width(draw, text, f, tracking)
    if align == "center":
        x = x + (width - tw) / 2
    elif align == "right":
        x = x + width - tw
    draw_tracked(draw, (x, y - f.getbbox("Hg")[1]), text, f, ink, tracking)
    return y + text_h(f)


def band_shade(img, top, bottom, dark, strength):
    """Soft vertical gradient behind a text band, fading toward the middle."""
    W, H = img.size
    mask = Image.new("L", (1, H), 0)
    px = mask.load()
    for y in range(H):
        if top is not None and y < top:
            px[0, y] = int(strength * (1 - y / top) ** 1.6)
        if bottom is not None and y > bottom:
            px[0, y] = int(strength * ((y - bottom) / (H - bottom)) ** 1.6)
    mask = mask.resize((W, H))
    tint = Image.new("RGB", (W, H), (0, 0, 0) if dark else (255, 255, 255))
    return Image.composite(tint, img, mask)


def region_ink(img, box):
    luma = ImageStat.Stat(img.convert("L").crop(box)).mean[0] / 255
    return (INK_DARK, False) if luma > 0.58 else (INK_LIGHT, True)


def cover_masthead(img, a):
    W, H = img.size
    m = int(W * 0.055)
    top_box = (0, 0, W, int(H * 0.2))
    bot_box = (0, int(H * 0.72), W, H)
    ink_t, light_t = region_ink(img, top_box) if a.tone == "auto" else ((INK_LIGHT, True) if a.tone == "light" else (INK_DARK, False))
    ink_b, light_b = region_ink(img, bot_box) if a.tone == "auto" else (ink_t, light_t)
    if not a.no_shade:
        img = band_shade(img, int(H * 0.26), None, light_t, 110)
        if a.lines:
            img = band_shade(img, None, int(H * 0.66), light_b, 120)
    d = ImageDraw.Draw(img)

    y = m
    if a.kicker:
        f = font("sans", int(W * 0.017), b"Medium")
        y = put(d, 0, y, a.kicker.upper(), f, ink_t, f.size * 0.3, "center", W) + int(W * 0.018)
    title = a.title.upper() if a.caps else a.title
    tf = fit_font(d, title, "serif", b"Medium", W - 2 * m, int(W * 0.24), 0.02 if a.caps else 0)
    y = put(d, m, y, title, tf, ink_t, tf.size * (0.02 if a.caps else 0), "center", W - 2 * m) + int(W * 0.02)
    if a.issue_left or a.issue_right:
        f = font("sans", int(W * 0.0145), b"Medium")
        d.line((m, y, W - m, y), fill=ink_t, width=max(1, W // 900))
        y += int(W * 0.014)
        if a.issue_left:
            put(d, m, y, a.issue_left.upper(), f, ink_t, f.size * 0.25)
        if a.issue_right:
            put(d, m, y, a.issue_right.upper(), f, ink_t, f.size * 0.25, "right", W - 2 * m)

    if a.lines:
        lead = font("serif", int(W * 0.052), b"Medium")
        rest = font("sans", int(W * 0.0175), b"Medium")
        blocks = [(a.lines[0], lead, 0)] + [(ln.upper(), rest, rest.size * 0.25) for ln in a.lines[1:]]
        gap = int(W * 0.014)
        total = sum(text_h(f) for _, f, _ in blocks) + gap * (len(blocks) - 1)
        y = H - m - total
        for text, f, tr in blocks:
            y = put(d, m, y, text, f, ink_b, tr) + gap
    if a.footer:
        f = font("sans", int(W * 0.013), b"Regular")
        put(d, m, H - m - text_h(f), a.footer.upper(), f, ink_b, f.size * 0.25, "right", W - 2 * m)
    return img


def cover_monograph(img, a, W, H):
    page = Image.new("RGB", (W, H), PAPER)
    side = int(W * 0.075)
    photo_h = int(H * 0.76)
    photo = crop_to(img, (W - 2 * side) / photo_h, a.focus).resize((W - 2 * side, photo_h), Image.LANCZOS)
    page.paste(photo, (side, side))
    d = ImageDraw.Draw(page)
    y = side + photo_h + int(H * 0.03)
    tf = fit_font(d, a.title, "serif", b"Regular", int((W - 2 * side) * 0.62), int(W * 0.075))
    put(d, side, y, a.title, tf, INK_DARK)
    small = font("sans", int(W * 0.0145), b"Medium")
    ry = y
    for text in [a.kicker, *(a.lines or [])]:
        if text:
            ry = put(d, side, ry, text.upper(), small, INK_DARK, small.size * 0.25, "right", W - 2 * side) + int(W * 0.012)
    bottom = H - side + int(side * 0.35)
    left = " ".join(t for t in (a.issue_left,) if t)
    if left or a.issue_right or a.footer:
        d.line((side, bottom - int(W * 0.03), W - side, bottom - int(W * 0.03)), fill=INK_DARK, width=max(1, W // 900))
        f = font("sans", int(W * 0.013), b"Regular")
        if left:
            put(d, side, bottom - text_h(f), left.upper(), f, INK_DARK, f.size * 0.25)
        right = a.issue_right or a.footer
        if right:
            put(d, side, bottom - text_h(f), right.upper(), f, INK_DARK, f.size * 0.25, "right", W - 2 * side)
    return page


def cover_minimal(img, a):
    W, H = img.size
    m = int(W * 0.06)
    ink_t, light_t = region_ink(img, (0, 0, W, int(H * 0.12)))
    ink_b, light_b = region_ink(img, (0, int(H * 0.86), W, H))
    if not a.no_shade:
        img = band_shade(img, int(H * 0.14), None, light_t, 120)
        if a.lines:
            img = band_shade(img, None, int(H * 0.84), light_b, 130)
    d = ImageDraw.Draw(img)
    f = font("sans", int(W * 0.022), b"Medium")
    put(d, 0, m, (a.title or "").upper(), f, ink_t, f.size * 0.45, "center", W)
    if a.lines:
        lf = font("serif", int(W * 0.036), b"Regular")
        put(d, 0, H - m - text_h(lf), a.lines[0], lf, ink_b, 0, "center", W)
    return img


def cmd_cover(a):
    img = load(a.image)
    W, H = FORMATS[a.format]
    if a.layout == "monograph":
        out_img = cover_monograph(img, a, W, H)
    else:
        img = crop_to(img, W / H, a.focus).resize((W, H), Image.LANCZOS)
        out_img = cover_masthead(img, a) if a.layout == "masthead" else cover_minimal(img, a)
    out = Path(a.out) if a.out else Path(a.image).with_name(f"cover-{a.layout}-{a.format.replace(':', 'x')}.jpg")
    out.parent.mkdir(parents=True, exist_ok=True)
    out_img.save(out, "JPEG", quality=95, subsampling=0, optimize=True)
    print(f"{out}  ({W}x{H}, {a.layout})")


# ---------------------------------------------------------------- compare

def cmd_compare(a):
    before, after = load(a.before), load(a.after)
    h = 1400
    before = before.resize((int(before.width * h / before.height), h), Image.LANCZOS)
    after = after.resize((int(after.width * h / after.height), h), Image.LANCZOS)
    gutter, head = 24, 70
    sheet = Image.new("RGB", (before.width + after.width + gutter * 3, h + head + gutter), (245, 243, 238))
    sheet.paste(before, (gutter, head))
    sheet.paste(after, (before.width + gutter * 2, head))
    d = ImageDraw.Draw(sheet)
    f = font("sans", 26, b"Medium")
    draw_tracked(d, (gutter, 24), "ORIGINAL", f, INK_DARK, 5)
    draw_tracked(d, (before.width + gutter * 2, 24), "RENDER", f, INK_DARK, 5)
    out = Path(a.out) if a.out else Path(a.after).with_name(Path(a.after).stem + "-compare.jpg")
    sheet.save(out, "JPEG", quality=90)
    print(out)


# ---------------------------------------------------------------- intake

INBOX = ROOT / "inbox"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff"}
PHONE_MAKES = ("apple", "samsung", "google", "huawei", "xiaomi", "oneplus", "oppo", "vivo", "motorola", "nothing")
CAMERA_MAKES = ("canon", "nikon", "sony", "fujifilm", "panasonic", "olympus", "om digital", "leica",
                "hasselblad", "pentax", "ricoh", "sigma", "dji")


def enable_heic():
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
        return True
    except ImportError:
        return False


def slugify(name):
    out = "".join(c if c.isalnum() else "-" for c in name.lower())
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-") or "photo"


def detect_source(img):
    """Phone or camera, from the EXIF maker. Unknown counts as phone."""
    exif = img.getexif()
    make = str(exif.get(0x010F, "")).strip().lower()
    model = str(exif.get(0x0110, "")).strip()
    if any(m in make for m in CAMERA_MAKES):
        return "camera", f"{make} {model}".strip()
    if any(m in make for m in PHONE_MAKES):
        return "phone", f"{make} {model}".strip()
    return "phone", (f"{make} {model}".strip() or "no camera data")


def filename_hints(stem):
    """Pick settings out of a filename like 'kitchen golden just-sold.jpg'."""
    s = stem.lower().replace("_", "-").replace(" ", "-")
    hints = {}
    for label in LABELS:
        if label in s:
            hints["label"] = label
    tokens = set(s.split("-"))
    for shot in SHOT:
        if shot in tokens:
            hints["shot"] = shot
    for light in LIGHT:
        if light in tokens and light != "keep":
            hints["light"] = light
    for src in SOURCE:
        if src in tokens:
            hints["source"] = src
    return hints


def cmd_intake(a):
    inbox = Path(a.inbox)
    heic = enable_heic()
    files = sorted(p for p in inbox.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES) if inbox.exists() else []
    if not files:
        print(f"Nothing to take in: {inbox} has no photos.")
        return
    for f in files:
        if f.suffix.lower() in (".heic", ".heif") and not heic:
            print(f"skip {f.name}: HEIC needs pillow-heif (pip install pillow-heif)")
            continue
        raw = Image.open(f)
        source, device = detect_source(raw)
        img = ImageOps.exif_transpose(raw).convert("RGB")
        base = slugify(f.stem)
        slug, n = base, 2
        while (ROOT / "covers" / slug).exists():
            slug, n = f"{base}-{n}", n + 1
        folder = ROOT / "covers" / slug
        folder.mkdir(parents=True)
        img.save(folder / "source.jpg", "JPEG", quality=95, subsampling=0)
        f.rename(folder / f"original{f.suffix.lower()}")
        hints = filename_hints(f.stem)
        hints.setdefault("source", source)
        (folder / "intake.json").write_text(json.dumps({
            "original_name": f.name, "device": device, "size": list(img.size), "settings": hints,
        }, indent=2) + "\n")
        extra = ", ".join(f"{k}={v}" for k, v in hints.items())
        print(f"covers/{slug}/  {img.size[0]}x{img.size[1]}  {device}  [{extra}]")


# ---------------------------------------------------------------- cli

def focus_arg(s):
    x, y = (float(v) for v in s.split(","))
    return (x, y)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("intake", help="move every photo in inbox/ into its own covers/<name>/ job")
    s.add_argument("--inbox", default=str(INBOX))
    s.set_defaults(func=cmd_intake)

    s = sub.add_parser("analyse", help="exposure, colour, palette and calm caption zones")
    s.add_argument("image")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_analyse)

    s = sub.add_parser("prompt", help="build the Nano Banana Pro prompt and job.json")
    s.add_argument("image")
    s.add_argument("--source", choices=SOURCE, default="phone")
    s.add_argument("--shot", choices=sorted(SHOT), default="interior")
    s.add_argument("--light", choices=LIGHT, default="keep")
    s.add_argument("--grade", choices=GRADE, default="film")
    s.add_argument("--strength", choices=FRAME, default="editorial",
                   help="how far the frame may change: subtle, editorial, bold")
    s.add_argument("--text-space", choices=["auto", "top", "bottom", "none"], default="auto")
    s.add_argument("--tidy", action="store_true", help="allow removing small temporary clutter")
    s.add_argument("--sky", action="store_true", help="allow cleaning up the sky")
    s.add_argument("--notes", help="extra direction, e.g. 'keep the shadow of the frangipani on the wall'")
    s.add_argument("--resolution", choices=["1k", "2k", "4k"], default="2k")
    s.add_argument("--count", type=int, default=2, help="variants to generate (1-4)")
    s.add_argument("--out")
    s.set_defaults(func=cmd_prompt)

    s = sub.add_parser("finish", help="crop to a social format and add a small caption")
    s.add_argument("image")
    s.add_argument("--format", choices=[*FORMATS, "original"], default="4:5")
    s.add_argument("--focus", type=focus_arg, default=(0.5, 0.5), help="crop centre as x,y fractions, e.g. 0.4,0.5")
    s.add_argument("--label", help="just-listed, coming-soon, just-sold, for-lease, open-home, or any text")
    s.add_argument("--line", help="second line, e.g. the suburb. Only use details you were given.")
    s.add_argument("--mark", help="tiny mark in the opposite corner, e.g. the agency name")
    s.add_argument("--position", default="auto", choices=[
        "auto", "top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"])
    s.add_argument("--tone", choices=["auto", "light", "dark"], default="auto")
    s.add_argument("--size", type=float, default=1.0, help="scale the caption, 1.0 is small")
    s.add_argument("--serif-label", action="store_true", help="set the label in serif instead of tracked caps")
    s.add_argument("--scrim", action="store_true", help="force a soft shade under the caption")
    s.add_argument("--out")
    s.set_defaults(func=cmd_finish)

    s = sub.add_parser("cover", help="lay the image out as a magazine or book cover")
    s.add_argument("image")
    s.add_argument("--layout", choices=["masthead", "monograph", "minimal"], default="masthead")
    s.add_argument("--title", required=True, help="the masthead, e.g. the agency name or 'Just listed'")
    s.add_argument("--caps", action="store_true", help="set the masthead in capitals")
    s.add_argument("--kicker", help="small line above the masthead")
    s.add_argument("--issue-left", help="small line under the masthead, left")
    s.add_argument("--issue-right", help="small line under the masthead, right")
    s.add_argument("--line", dest="lines", action="append",
                   help="cover line, repeatable. The first is set large. Only use details you were given.")
    s.add_argument("--footer", help="tiny line bottom right, e.g. the agency")
    s.add_argument("--format", choices=list(FORMATS), default="4:5")
    s.add_argument("--focus", type=focus_arg, default=(0.5, 0.5))
    s.add_argument("--tone", choices=["auto", "light", "dark"], default="auto")
    s.add_argument("--no-shade", action="store_true", help="skip the soft gradients behind text")
    s.add_argument("--out")
    s.set_defaults(func=cmd_cover)

    s = sub.add_parser("compare", help="original and render side by side")
    s.add_argument("before")
    s.add_argument("after")
    s.add_argument("--out")
    s.set_defaults(func=cmd_compare)

    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
