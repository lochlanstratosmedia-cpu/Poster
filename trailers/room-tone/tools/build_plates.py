"""Build clean background plates from the Room Tone screenshots.

The screenshots carry the app's controls and a test title baked into the
desk photo. The trailer redraws those controls live, so this script lifts
the baked text out of the photo and lines the light-off shot up with the
light-on shot so the light toggle can cross-fade between them.

    pip install opencv-python-headless numpy
    python3 trailers/room-tone/tools/build_plates.py

Reads source/*.webp, writes plates/*.jpg and plates/plates.json.
Only thin text and outlines are removed. Nothing in the photograph is
added, moved or recoloured.
"""
import json
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / "source"
OUT = HERE / "plates"

# Regions (source pixels, light-on shot) that hold baked UI or test text.
# kind: "light" finds strokes brighter than the surrounding photo,
#       "dark" finds strokes darker than the surrounding paper.
REGIONS = [
    ("top nav", (785, 31, 1160, 54), "light", 16),
    ("light/sound switches", (1780, 8, 2000, 66), "light", 14),
    ("saved note", (0, 905, 140, 921), "light", 10),
    ("page nav + zoom", (790, 905, 1180, 921), "light", 10),
    ("title page text", (860, 400, 1115, 482), "dark", 8),
]


PAD_BOTTOM = 24


def detect(gray, box, kind, thr):
    x0, y0, x1, y1 = box
    # A top-hat with a small kernel only responds to strokes thinner than the
    # kernel, so UI lettering is caught and the edges of real objects are not.
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    op = cv2.MORPH_TOPHAT if kind == "light" else cv2.MORPH_BLACKHAT
    diff = cv2.morphologyEx(gray, op, k)[y0:y1, x0:x1]
    m = (diff > thr).astype(np.uint8) * 255
    m = cv2.dilate(m, np.ones((3, 3), np.uint8), iterations=2)
    full = np.zeros(gray.shape, np.uint8)
    full[y0:y1, x0:x1] = m
    return full


def clean(img, regions, shift=(0, 0), gain=1.0):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = np.zeros(gray.shape, np.uint8)
    dx, dy = shift
    for _, (x0, y0, x1, y1), kind, thr in regions:
        box = (max(0, x0 + dx), max(0, y0 + dy), min(img.shape[1], x1 + dx), min(img.shape[0], y1 + dy))
        mask |= detect(gray, box, kind, thr * gain)
    return cv2.inpaint(img, mask, 5, cv2.INPAINT_TELEA), mask


def register(moving, fixed):
    """Similarity transform taking `moving` onto `fixed`, from SIFT matches."""
    clahe = cv2.createCLAHE(3.0, (8, 8))
    a = clahe.apply(cv2.cvtColor(moving, cv2.COLOR_BGR2GRAY))
    b = clahe.apply(cv2.cvtColor(fixed, cv2.COLOR_BGR2GRAY))
    sift = cv2.SIFT_create(6000)
    ka, da = sift.detectAndCompute(a, None)
    kb, db = sift.detectAndCompute(b, None)
    matches = cv2.BFMatcher().knnMatch(da, db, k=2)
    good = [m for m, n in matches if m.distance < 0.7 * n.distance]
    pa = np.float32([ka[m.queryIdx].pt for m in good])
    pb = np.float32([kb[m.trainIdx].pt for m in good])
    M, inl = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=2.0)
    return M, int(inl.sum()), len(good)


def main():
    OUT.mkdir(exist_ok=True)
    on = cv2.imread(str(SRC / "desk1-light-on.webp"))
    off = cv2.imread(str(SRC / "desk1-light-off.webp"))
    h, w = on.shape[:2]

    M, inliers, total = register(off, on)
    scale = float(np.hypot(M[0, 0], M[1, 0]))
    print(f"light-off -> light-on: scale {scale:.4f}, shift ({M[0, 2]:.1f}, {M[1, 2]:.1f}), {inliers}/{total} inliers")

    # Clean each shot in its own coordinates, then warp the light-off one.
    on_clean, on_mask = clean(on, REGIONS)
    inv = cv2.invertAffineTransform(M)
    shift = (int(round(inv[0, 2])), int(round(inv[1, 2])))
    # The light-off shot is darker, so its lettering has less contrast.
    off_clean, off_mask = clean(off, REGIONS, shift, gain=0.55)
    off_aligned = cv2.warpAffine(off_clean, M, (w, h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE)

    # The screenshots stop a few pixels under the page-nav pill. A 16:9 frame
    # needs a little more room below it, so mirror a thin strip of the wood.
    pad = lambda im: cv2.copyMakeBorder(im, 0, PAD_BOTTOM, 0, 0, cv2.BORDER_REFLECT)
    on_clean, off_aligned = pad(on_clean), pad(off_aligned)
    cv2.imwrite(str(OUT / "desk1-on.jpg"), on_clean, [cv2.IMWRITE_JPEG_QUALITY, 96])
    cv2.imwrite(str(OUT / "desk1-off.jpg"), off_aligned, [cv2.IMWRITE_JPEG_QUALITY, 96])
    cv2.imwrite(str(OUT / "mask-on.png"), on_mask)
    cv2.imwrite(str(OUT / "mask-off.png"), off_mask)

    meta = {
        "desk1": {
            "size": [w, h + PAD_BOTTOM],
            # Paper edges measured from brightness gradients in the light-on shot.
            "page": {"left": 689, "top": 144, "right": 1252, "bottom": 889},
            "light_off_transform": M.tolist(),
        }
    }
    (OUT / "plates.json").write_text(json.dumps(meta, indent=2))
    print("wrote", ", ".join(p.name for p in sorted(OUT.iterdir())))


if __name__ == "__main__":
    main()
