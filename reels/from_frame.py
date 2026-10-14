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


def destripe(rgb):
    lum = rgb.mean(2) + 1.0
    # each pixel against the mean of its row neighbourhood, then the median down
    # each column: photo detail averages out, the stripe gain does not
    k = 9
    pad = np.pad(lum, ((0, 0), (k // 2, k // 2)), mode="edge")
    local = np.lib.stride_tricks.sliding_window_view(pad, k, axis=1).mean(2)
    gain = np.median(lum / local, axis=0) - 1.0
    # A screenshot may be scaled, so the period need not be a whole number of
    # pixels. Find the stripe frequency, keep it and its harmonics, and divide
    # out only that periodic part.
    n = len(gain)
    spec = np.fft.rfft(gain)
    freqs = np.fft.rfftfreq(n)
    band = freqs > 1 / 12  # stripes repeat every 12 px or less
    peak = np.argmax(np.abs(spec) * band)
    keep = np.zeros_like(spec)
    for h in (1, 2, 3):
        b = peak * h
        if b < len(spec):
            keep[max(b - 2, 0):b + 3] = spec[max(b - 2, 0):b + 3]
    g = 1.0 + np.fft.irfft(keep, n)
    out = rgb / g[None, :, None]
    return np.clip(out, 0, 255), 1 / freqs[peak]


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("frame")
    p.add_argument("--box", nargs=4, type=int, required=True, metavar=("L", "T", "R", "B"))
    p.add_argument("--out", required=True)
    args = p.parse_args()

    rgb = np.asarray(Image.open(args.frame).convert("RGB").crop(tuple(args.box))).astype(float)
    clean, period = destripe(rgb)
    Image.fromarray(clean.round().astype(np.uint8)).save(args.out, optimize=True)
    print(f"{args.out} (stripe period {period:.2f} px)")


if __name__ == "__main__":
    main()
