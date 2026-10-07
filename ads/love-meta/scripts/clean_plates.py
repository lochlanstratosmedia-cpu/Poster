"""Lift the baked-in text off the Drive designs so it can be animated live.

    python3 ads/love-meta/scripts/clean_plates.py

Reads designs/<n>.png, writes designs/clean/<n>.jpg. Text strokes are found
inside known boxes (bright or lilac pixels), grown a little, and inpainted.
The solid pill in 13 is filled whole; 17 borrows 18's photo. Needs opencv-python-headless.
"""
from pathlib import Path
import cv2
import numpy as np

here = Path(__file__).resolve().parent.parent / "designs"
(here / "clean").mkdir(exist_ok=True)

PILL = (60, 1226, 808, 1316)
# x0, y0, x1, y1 boxes per design; "fill" boxes are masked whole
BOXES = {
    9:  {"strokes": [(55, 630, 810, 1195), PILL], "fill": []},
    11: {"strokes": [(55, 630, 810, 1195), PILL], "fill": []},
    13: {"strokes": [(70, 860, 910, 1190)], "fill": [PILL]},   # this pill is solid
    16: {"strokes": [(60, 905, 1000, 1178)], "fill": [PILL]},   # solid too
    18: {"strokes": [(60, 878, 985, 1150), PILL], "fill": []},
}

for n, b in BOXES.items():
    img = cv2.imread(str(here / f"{n}.png"))
    lum = img.mean(2)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask = np.zeros(lum.shape, np.uint8)
    for x0, y0, x1, y1 in b["strokes"]:
        roi = lum[y0:y1, x0:x1]
        base = np.percentile(roi, 40)
        m = (roi > base + 38) | ((hsv[y0:y1, x0:x1, 1] > 40) & (roi > base + 22))
        mask[y0:y1, x0:x1] = m.astype(np.uint8) * 255
    mask = cv2.dilate(mask, np.ones((7, 7), np.uint8), iterations=2)
    for x0, y0, x1, y1 in b["fill"]:
        mask[y0:y1, x0:x1] = 255
    out = cv2.inpaint(img, mask, 9, cv2.INPAINT_TELEA)
    # soften the filled areas so the inpaint does not read as smears
    soft = cv2.GaussianBlur(out, (0, 0), 6)
    edge = cv2.GaussianBlur(mask, (0, 0), 8).astype(float)[..., None] / 255
    out = (out * (1 - edge) + soft * edge).astype(np.uint8)
    cv2.imwrite(str(here / "clean" / f"{n}.jpg"), out, [cv2.IMWRITE_JPEG_QUALITY, 93])
    print(n, "masked %.1f%%" % (100 * (mask > 0).mean()))

# 17 is the same photo as 18 with a card over it: take the card area from
# 18's plate and feather it in.
a = cv2.imread(str(here / "17.png")).astype(float)
b = cv2.imread(str(here / "clean" / "18.jpg")).astype(float)
m = np.zeros(a.shape[:2], np.float32); m[455:1345, 95:990] = 1
m = cv2.GaussianBlur(m, (0, 0), 18)[..., None]
cv2.imwrite(str(here / "clean" / "17.jpg"), (a * (1 - m) + b * m).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 93])
print(17, "from 18")
