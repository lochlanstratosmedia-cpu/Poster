#!/usr/bin/env python3
"""Pull the exterior card out of a reel frame or screenshot, for make_cover.py.

The reel draws fine vertical stripes over everything, photos included. This
crops the card, measures how much each stripe column darkens the image and
divides that back out, so the stripes don't show inside the cover's card.

  python3 reels/from_frame.py frame.jpg --box 110 560 1080 1400 --out exterior.png

--box is left top right bottom in frame pixels. Keep it about 30 px inside
the card's rounded corners. Any address text baked into the frame stays.
"""

import argparse
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("from_frame.py needs numpy and Pillow: pip install numpy pillow")


def destripe(rgb, period_max=8):
    lum = rgb.mean(2) + 1.0
    # each pixel against the mean of its row neighbourhood, then the median down
    # each column: photo detail averages out, the stripe gain does not
    k = 9
    pad = np.pad(lum, ((0, 0), (k // 2, k // 2)), mode="edge")
    local = np.lib.stride_tricks.sliding_window_view(pad, k, axis=1).mean(2)
    gain = np.median(lum / local, axis=0)
    # the stripes are periodic; fold the gain onto the best period to drop noise
    best, best_var = None, 0
    for p in range(3, period_max + 1):
        folded = np.array([gain[i::p].mean() for i in range(p)])
        if folded.var() > best_var:
            best, best_var = p, folded.var()
    folded = np.array([np.median(gain[i::best]) for i in range(best)])
    g = np.resize(folded, rgb.shape[1])
    out = rgb / g[None, :, None]
    return np.clip(out, 0, 255), best


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("frame")
    p.add_argument("--box", nargs=4, type=int, required=True, metavar=("L", "T", "R", "B"))
    p.add_argument("--out", required=True)
    args = p.parse_args()

    rgb = np.asarray(Image.open(args.frame).convert("RGB").crop(tuple(args.box))).astype(float)
    clean, period = destripe(rgb)
    Image.fromarray(clean.round().astype(np.uint8)).save(args.out, optimize=True)
    print(f"{args.out} (stripe period {period} px)")


if __name__ == "__main__":
    main()
