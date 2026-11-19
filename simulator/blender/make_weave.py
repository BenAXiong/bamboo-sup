"""
Generate a tileable woven-bark sail texture (1 m x 1 m tile) with numpy.

2/2 twill of flat bark strips about 21 mm wide, matched to the Palafang sail
photos: straw to light-brown strips, warp a touch darker than weft, fibres
along each strip, shading where a strip dives under its neighbours, and small
pin-holes of light at strip corners.

Usage: python make_weave.py OUT_DIR [--px 2048] [--seed 7]
Writes sail_weave_diff.png (sRGB), sail_weave_height.png, sail_weave_alpha.png.
"""

import argparse
import os

import numpy as np
from PIL import Image


def fft_noise(rng, n, fx, fy):
    """Periodic gaussian-filtered noise; fx, fy are cut-off frequencies in cycles per tile."""
    w = rng.standard_normal((n, n))
    kx = np.fft.fftfreq(n) * n
    ky = np.fft.fftfreq(n) * n
    KX, KY = np.meshgrid(kx, ky)
    filt = np.exp(-0.5 * ((KX / fx) ** 2 + (KY / fy) ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
    out -= out.mean()
    return out / (out.std() + 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--px", type=int, default=2048)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    n = a.px
    S = 40  # strips per tile, multiple of 4 for the twill to tile
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n  # tile units, y down

    # Strips of uneven width (hand-split bark) that wander a little.
    def bounds():
        w = rng.uniform(0.6, 1.4, S)
        b = np.concatenate([[0.0], np.cumsum(w)])
        return b / b[-1] * S

    def locate(coord, b):
        c = np.mod(coord, S)
        k = np.clip(np.searchsorted(b, c, side="right") - 1, 0, S - 1)
        f = (c - b[k]) / (b[k + 1] - b[k])
        return k, f

    xw = xx * S + 0.18 * fft_noise(rng, n, 2.5, 6)
    yw = yy * S + 0.18 * fft_noise(rng, n, 6, 2.5)
    i, fx = locate(xw, bounds())
    j, fy = locate(yw, bounds())

    # 2/2 twill whose diagonal flips direction in bands of uneven height
    # (herringbone), so the weave never reads as a regular grid.
    T = np.zeros((S, S), bool)
    band_dir = np.ones(S, int)
    r = 0
    d = 1
    while r < S:
        h = int(rng.integers(5, 13))
        band_dir[r : r + h] = d
        d = -d
        r += h
    for jj in range(S):
        for ii in range(S):
            T[jj, ii] = (((ii + band_dir[jj] * jj) // 2) % 2) == 0

    def warp_top(ii, jj):
        return T[jj % S, ii % S]

    top_w = warp_top(i, j)
    # Does the same strip stay on top in the neighbouring cell along its length?
    w_prev = warp_top(i, (j - 1) % S)
    w_next = warp_top(i, (j + 1) % S)
    f_prev = ~warp_top((i - 1) % S, j)
    f_next = ~warp_top((i + 1) % S, j)

    def dive(f, stays_prev, stays_next):
        d = np.ones_like(f)
        d = np.where(~stays_prev, d * np.clip(f / 0.35, 0, 1) ** 0.5, d)
        d = np.where(~stays_next, d * np.clip((1 - f) / 0.35, 0, 1) ** 0.5, d)
        return d

    # Along-strip shading for whichever strip is on top.
    along = np.where(top_w, dive(fy, w_prev, w_next), dive(fx, f_prev, f_next))
    across_f = np.where(top_w, fx, fy)
    across = np.sin(np.pi * np.clip(across_f, 0, 1)) ** 0.35

    # Per-strip and per-cell tone.
    strip_tone_w = rng.uniform(0, 1, S)
    strip_tone_f = rng.uniform(0, 1, S)
    cell = rng.uniform(-1, 1, (S, S))
    tone = 0.2 + 0.7 * np.where(top_w, strip_tone_w[i] * 0.85, strip_tone_f[j]) + 0.1 * cell[j, i]
    dark_strip = np.where(top_w, strip_tone_w[i] < 0.05, strip_tone_f[j] < 0.05)

    # Fibres run along each strip.
    fib_w = fft_noise(rng, n, 420, 18)  # varies fast across x: for warp (vertical) strips
    fib_f = fft_noise(rng, n, 18, 420)
    fib = np.where(top_w, fib_w, fib_f)
    fib_fine = np.where(top_w, fft_noise(rng, n, 900, 60), fft_noise(rng, n, 60, 900))

    pal_t = [0.0, 0.35, 0.7, 1.0]
    pal_c = [(140, 104, 68), (180, 142, 98), (204, 168, 122), (224, 198, 154)]
    t = np.clip(tone, 0, 1)
    col = np.zeros((n, n, 3), np.float32)
    for c in range(3):
        col[..., c] = np.interp(t, pal_t, [p[c] for p in pal_c])
    col[dark_strip] *= np.array([0.84, 0.8, 0.76])
    col *= (1 + 0.10 * fib + 0.05 * fib_fine)[..., None]
    shade = (0.68 + 0.32 * along) * (0.78 + 0.22 * across)
    col *= shade[..., None]
    # Grey weathering blotches, more on the warp.
    wx = np.clip(fft_noise(rng, n, 5, 5) * 0.5 + 0.1, 0, 1) * 0.25
    grey = col.mean(-1, keepdims=True) * np.array([0.92, 0.9, 0.86])
    col = col * (1 - wx[..., None]) + grey * wx[..., None]
    col = np.clip(col, 0, 255)

    # Height: top strip bulge plus fibres.
    h = 0.55 + 0.45 * along * across + 0.04 * fib_fine + 0.03 * fib
    h = np.clip(h, 0, 1)

    # Pin-holes at strip corners, only some of them.
    cx = np.minimum(fx, 1 - fx)
    cy = np.minimum(fy, 1 - fy)
    corner = np.hypot(cx, cy)
    holes_on = rng.uniform(0, 1, (S, S)) > 0.9
    alpha = np.where((corner < 0.05) & holes_on[j, i], 0.0, 1.0)

    os.makedirs(a.out, exist_ok=True)
    Image.fromarray(col.astype(np.uint8)).save(os.path.join(a.out, "sail_weave_diff.png"))
    Image.fromarray((h * 65535).astype(np.uint16)).save(os.path.join(a.out, "sail_weave_height.png"))
    Image.fromarray((alpha * 255).astype(np.uint8)).save(os.path.join(a.out, "sail_weave_alpha.png"))
    print("wrote", a.out)


if __name__ == "__main__":
    main()
