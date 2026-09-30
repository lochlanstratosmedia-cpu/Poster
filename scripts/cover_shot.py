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
        "Keep the direction, colour and time of day of the existing light. Refine it: "
        "recover highlights, open shadows gently, and keep every shadow shape where it falls."
    ),
    "golden": (
        "Late-afternoon sun, low and warm, raking across surfaces so texture reads. Long, "
        "soft-edged shadows that follow the sun direction already in the photo. Warm glow "
        "on sunlit surfaces, cool open shade in the shadows."
    ),
    "soft": (
        "Bright, soft overcast daylight. Even and diffused, gentle falloff from windows and "
        "openings, no hard shadows, clean neutral whites."
    ),
    "morning": (
        "Clear early-morning light: low side sun, cool-neutral and crisp, an airy feel. "
        "Shadows follow the sun direction already in the photo."
    ),
    "dusk": (
        "Blue-hour twilight: deep even blue sky, and warm light glowing from the light "
        "fittings and windows already in the photo. Do not add light fittings that are not there."
    ),
}

SHOT = {
    "exterior": (
        "Exterior. The facade, roof, gutters, fence, paths, steps, letterbox and garden stay "
        "exactly as they are. Lawn and foliage a healthy natural green, never neon."
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


def colour_line(pal):
    parts = [f"{p['name']} ({p['hex']})" for p in pal if p["share"] >= 0.04][:5]
    return "Keep the palette of the original: " + ", ".join(parts) + "."


def build_prompt(a, info):
    keep = [
        "The same place, camera position and viewpoint. Every wall, opening, window, door, "
        "step, railing, roofline, fixture, tree and plant stays where it is, at the same size and shape.",
        "True materials and colours. Paint, timber, stone, metal and fabric look like the real "
        "thing in good light. Do not recolour any surface.",
        "Real character: grain, knots, patina and honest wear stay. Better light, not a newer building.",
    ]
    if a.tidy:
        keep.append(
            "Do not add anything. You may remove only small temporary clutter (hoses, bins, loose "
            "leaves, cables, personal items on benches). Never remove anything fixed or built in."
        )
    else:
        keep.append("Do not add or remove any object, furniture, artwork, plant, light fitting, person or sign.")
    keep.append(
        "You may clean up the sky to a clear natural blue with light cloud. Nothing below the roofline changes."
        if a.sky else "Keep the sky as it is apart from tone."
    )

    comp = (
        "Straighten verticals as a shift lens would and level the horizontals. You may tighten "
        "the crop slightly if it strengthens the frame, but never extend the scene past the original edges."
    )
    space = a.text_space
    if space == "auto":
        calm = next(iter(info["quiet_zones"]))
        space = calm.split("-")[0]
    if space in ("top", "bottom"):
        comp += (
            f" Keep the {space} sixth of the frame calm and uncluttered (whatever is already there: "
            "sky, wall, floor, lawn) so a small caption can sit on it later."
        )

    tone = [SOURCE[a.source]]
    if info["fixes"]:
        tone.append("From measuring this photo: " + "; ".join(info["fixes"]) + ".")
    tone.append(colour_line(info["palette"]))

    lines = [
        "Edit this exact photograph into a finished editorial image fit for the cover of an "
        "architecture and interiors magazine: calm, considered, natural light, restrained colour.",
        "",
        "KEEP EXACTLY:",
        *[f"- {k}" for k in keep],
        "",
        "IMPROVE:",
        f"- Light: {LIGHT[a.light]}",
        f"- Composition: {comp}",
        f"- Tone and colour: {' '.join(tone)}",
        "- Finish: soft highlight roll-off, deep clean shadows with detail, fine natural grain, "
        "no HDR halos, no over-sharpening, no plastic or CGI look.",
        "",
        f"SUBJECT: {SHOT[a.shot]}",
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
    out = Path(a.out) if a.out else ROOT / "covers" / Path(a.image).stem / "job.json"
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

    s = sub.add_parser("compare", help="original and render side by side")
    s.add_argument("before")
    s.add_argument("after")
    s.add_argument("--out")
    s.set_defaults(func=cmd_compare)

    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
