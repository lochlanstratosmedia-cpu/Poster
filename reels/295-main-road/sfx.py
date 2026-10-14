"""Synthesise a UI sound-effects track for the 295 Main Road reel."""
import sys, wave
import numpy as np

SR = 48000
DUR = 21.1
rng = np.random.default_rng(7)
out = np.zeros((int(SR * DUR), 2))


def svf_bandpass(x, fc, q=1.2):
    """State-variable bandpass with per-sample cutoff (array)."""
    lp = bp = 0.0
    y = np.empty_like(x)
    f = 2 * np.sin(np.pi * np.clip(fc, 20, SR / 6) / SR)
    d = 1 / q
    for i in range(len(x)):
        hp = x[i] - lp - d * bp
        bp += f[i] * hp
        lp += f[i] * bp
        y[i] = bp
    return y


def place(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    n = min(len(sig), len(out) - i)
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    out[i:i + n, 0] += sig[:n] * gain * l * 1.414
    out[i:i + n, 1] += sig[:n] * gain * r * 1.414


def whoosh(length, peak_frac=0.6, f0=300, f1=2600):
    n = int(length * SR)
    t = np.linspace(0, 1, n)
    env = np.where(t < peak_frac, (t / peak_frac) ** 2,
                   np.exp(-((t - peak_frac) / (1 - peak_frac)) * 4))
    fc = f0 + (f1 - f0) * np.where(t < peak_frac, t / peak_frac, 1 - (t - peak_frac) / (1 - peak_frac) * 0.6)
    s = svf_bandpass(rng.standard_normal(n), fc, q=1.5)
    s *= env
    return s / np.abs(s).max()


def click(freq=2400, length=0.035):
    t = np.arange(int(length * SR)) / SR
    s = np.sin(2 * np.pi * freq * t) * np.exp(-t * 160)
    s += 0.4 * rng.standard_normal(len(t)) * np.exp(-t * 900)
    return s / np.abs(s).max()


def pop(f_start=900, f_end=380, length=0.09):
    t = np.arange(int(length * SR)) / SR
    f = f_end + (f_start - f_end) * np.exp(-t * 60)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 45)
    return s / np.abs(s).max()


def sweep_down(length=0.3, f_start=1800, f_end=120):
    t = np.arange(int(length * SR)) / SR
    f = f_end + (f_start - f_end) * (1 - t / length) ** 2
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / length) ** 0.7
    return s / np.abs(s).max()


def chime(notes=(880.0, 1318.5), gap=0.09, length=1.8):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k, f in enumerate(notes):
        tt = np.clip(t - k * gap, 0, None)
        on = t >= k * gap
        tone = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt) * np.exp(-tt * 6)
                + 0.12 * np.sin(2 * np.pi * 3.01 * f * tt) * np.exp(-tt * 9))
        s += on * tone * np.exp(-tt * 3.2) * np.minimum(tt / 0.004, 1)
    return s / np.abs(s).max()


# (start time, length, peak fraction, gain, pan) for each scroll move
WHOOSHES = [
    (0.85, 0.85, 0.70, 0.30, 0.0),
    (3.15, 0.45, 0.55, 0.32, -0.3),
    (3.55, 1.05, 0.45, 0.42, 0.3),
    (6.38, 0.70, 0.55, 0.55, -0.4),
    (7.80, 1.05, 0.55, 0.52, 0.4),
    (9.70, 0.75, 0.45, 0.36, -0.2),
    (11.36, 0.70, 0.55, 0.48, 0.3),
    (12.95, 0.50, 0.65, 0.45, -0.3),
    (14.25, 0.45, 0.55, 0.28, 0.2),
    (14.95, 1.65, 0.45, 0.42, -0.2),
    (16.70, 1.10, 0.75, 0.42, 0.2),
]
for t, ln, pk, g, p in WHOOSHES:
    place(whoosh(ln, pk), t, g, p)

for t, f, g in [(1.75, 2600, 0.16), (7.02, 2400, 0.22), (8.88, 2300, 0.24),
                (12.08, 2500, 0.22), (14.04, 2600, 0.14), (16.64, 2300, 0.22)]:
    place(click(f), t, g * 1.6)

place(pop(), 13.40, 0.30)
place(sweep_down(), 18.22, 0.26)
place(chime(), 18.58, 0.30)
place(click(3000), 18.98, 0.18)  # "listed with" lands

out /= max(1.0, np.abs(out).max() / 0.89)  # keep peaks at about -1 dBFS
pcm = (out * 32767).astype("<i2")
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
