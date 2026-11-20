"""Composite studio frames (transparent film + shadow catcher) over a soft
vertical gradient, then encode MP4 and GIF with ffmpeg.

Usage: python compose_frames.py FRAMES_DIR OUT_BASENAME
"""
import glob
import os
import subprocess
import sys

import numpy as np
from PIL import Image

src, base = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(src, "frame_*.png")))
outd = os.path.join(src, "comp")
os.makedirs(outd, exist_ok=True)
for f in files:
    im = Image.open(f).convert("RGBA")
    w, h = im.size
    t = np.linspace(0, 1, h)[:, None, None]
    top = np.array([236, 233, 228])
    bot = np.array([196, 191, 184])
    bg = (top * (1 - t) + bot * t) * np.ones((1, w, 1))
    a = np.asarray(im, dtype=np.float32) / 255.0
    rgb = a[..., :3] * 255.0
    al = a[..., 3:4]
    out = rgb * al + bg * (1 - al)  # PNG from Cycles holds straight (unpremultiplied) alpha
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(os.path.join(outd, os.path.basename(f)))
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "24", "-i", os.path.join(outd, "frame_%04d.png"),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", base + ".mp4"], check=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", base + ".mp4", "-vf",
                "fps=24,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", base + ".gif"], check=True)
print("wrote", base + ".mp4", base + ".gif")
