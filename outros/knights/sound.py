"""Sound design for the simple Knights outro, synthesised from scratch.

    python3 outros/knights/sound.py

Writes renders/knights-outro-simple-sfx.wav (the effects on their own, for
mixing under the song) and renders/knights-outro-simple-sound.mp4 (the video
with the effects laid in). Needs numpy, scipy and ffmpeg.

Every cue is placed on the animation's own timing in outro.html, so if the
timings there change, change CUES here to match.
"""

import subprocess
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, sosfiltfilt

HERE = Path(__file__).parent
RENDERS = HERE / "renders"
SR = 48000
LENGTH = 8.0
rng = np.random.default_rng(7)

# seconds, taken from VARIANTS.simple in outro.html
CUES = {
    "stripes": 0.0,     # stripes start sliding in, about 1.3 s to settle
    "card": 1.22,       # card lands (easeOutBack peak)
    "love": 1.52,       # Love logo pops
    "knights": 1.72,    # Knights logo pops
    "tagline": 2.1,     # "Go the Knights" fades up
}


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def place(buf, sig, at, gain=1.0, pan=0.0):
    """Mix a mono signal into the stereo buffer at `at` seconds."""
    i = int(at * SR)
    n = min(len(sig), buf.shape[0] - i)
    left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + n, 0] += sig[:n] * gain * left
    buf[i:i + n, 1] += sig[:n] * gain * right


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), x)


def lowpass(x, f, order=2):
    return sosfiltfilt(butter(order, f, "lowpass", fs=SR, output="sos"), x)


def whoosh(dur=1.5):
    """Noise swept up and back through a band-pass, swelling then fading."""
    t = t_axis(dur)
    noise = rng.standard_normal(len(t))
    out = np.zeros_like(noise)
    block = 1024
    centre = 300 + 2200 * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    for s in range(0, len(t), block):
        c = centre[s]
        seg = noise[max(0, s - 2048):s + block]
        f = bandpass(seg, c * 0.6, min(c * 1.6, SR / 2 - 100))
        out[s:s + block] = f[-len(noise[s:s + block]):]
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    # a light flutter, one bump per stripe passing
    env *= 0.8 + 0.2 * np.sin(2 * np.pi * 9 * t)
    return out * env


def thump(dur=0.9):
    """Soft low impact: a falling sine with a short filtered transient."""
    t = t_axis(dur)
    freq = 45 + 50 * np.exp(-t * 18)
    body = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 6)
    click = lowpass(rng.standard_normal(len(t)), 1800) * np.exp(-t * 90)
    return body + 0.5 * click


def pop(base, dur=0.18):
    """Rounded bubble pop: a quick downward pitch blip."""
    t = t_axis(dur)
    freq = base * (0.6 + 0.4 * np.exp(-t * 40))
    sig = np.sin(2 * np.pi * np.cumsum(freq) / SR)
    env = (1 - np.exp(-t * 900)) * np.exp(-t * 28)
    return sig * env


def chime(dur=3.6):
    """Warm major chord, notes entering one after another, long soft tail."""
    t = t_axis(dur)
    out = np.zeros_like(t)
    notes = [440.0, 554.37, 659.25, 880.0]          # A major
    for k, f in enumerate(notes):
        d = k * 0.07
        tt = np.clip(t - d, 0, None)
        on = (t >= d).astype(float)
        env = on * (1 - np.exp(-tt * 40)) * np.exp(-tt * 1.4)
        tone = np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt) * np.exp(-tt * 3)
        out += tone * env * (1 - 0.15 * k)
    shimmer = bandpass(rng.standard_normal(len(t)), 6000, 12000) * np.exp(-t * 2.5) * (1 - np.exp(-t * 20))
    return out * 0.5 + shimmer * 0.06


def reverb(x, mix=0.22):
    """Small room: a few feedback comb filters into an all-pass, per channel."""
    out = np.zeros_like(x)
    for ch in range(x.shape[1]):
        dry = x[:, ch]
        wet = np.zeros_like(dry)
        for ms, g in [(29.7, .78), (37.1, .76), (41.1, .74), (43.7, .72)]:
            d = int(ms * SR / 1000) + ch * 37
            y = dry.copy()
            for i in range(d, len(y), d):
                y[i:i + d] += g * y[i - d:i][:len(y[i:i + d])]
            wet += y
        out[:, ch] = dry + mix * lowpass(wet / 4, 5000)
    return out


def main():
    buf = np.zeros((int(LENGTH * SR), 2))
    place(buf, whoosh(), CUES["stripes"], gain=0.45, pan=-0.3)
    place(buf, whoosh(1.2), CUES["stripes"] + 0.15, gain=0.3, pan=0.35)
    place(buf, thump(), CUES["card"], gain=0.9)
    place(buf, pop(620), CUES["love"], gain=0.35, pan=-0.35)
    place(buf, pop(760), CUES["knights"], gain=0.35, pan=0.35)
    place(buf, chime(), CUES["tagline"], gain=0.3)
    buf = reverb(buf)

    fade = int(0.6 * SR)
    buf[-fade:] *= np.linspace(1, 0, fade)[:, None]
    buf /= np.abs(buf).max() / 0.7

    RENDERS.mkdir(exist_ok=True)
    raw = RENDERS / "sfx-raw.wav"
    wav = RENDERS / "knights-outro-simple-sfx.wav"
    wavfile.write(raw, SR, (buf * 32767).astype(np.int16))
    # level for social: about -16 LUFS, peaks under -1.5 dBTP
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw,
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(SR), wav], check=True)
    raw.unlink()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error",
                    "-i", RENDERS / "knights-outro-simple.mp4", "-i", wav,
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                    "-shortest", "-movflags", "+faststart",
                    RENDERS / "knights-outro-simple-sound.mp4"], check=True)
    print("wrote", wav.name, "and knights-outro-simple-sound.mp4")


if __name__ == "__main__":
    main()
