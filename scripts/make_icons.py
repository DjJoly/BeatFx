#!/usr/bin/env python3
"""Generate BeatFX icons with the Python standard library only.

Lime scheme: yellow-green to emerald-teal gradient rounded square with a white waveform line.
The glyph occupies ~82.8% of the canvas, matching the macOS system app icon size in the Dock.
"""
import os
import struct
import subprocess
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
ICONSET = os.path.join(ASSETS, "icon.iconset")

SUPERSAMPLE = 3
INSET = 0.086
CORNER = 0.22
STROKE = 0.026
STROKE2 = STROKE * STROKE

WAVE = [
    (0.158, 0.500), (0.263, 0.500), (0.342, 0.276), (0.447, 0.724),
    (0.553, 0.355), (0.632, 0.500), (0.842, 0.500),
]
WAVE_SEGS = []
for (ax, ay), (bx, by) in zip(WAVE, WAVE[1:]):
    dx, dy = bx - ax, by - ay
    WAVE_SEGS.append((ax, ay, dx, dy, 1.0 / (dx * dx + dy * dy)))


def lerp(a, b, t):
    return a + (b - a) * t


def gradient(nx, ny):
    t = nx * 0.55 + ny * 0.45
    if t < 0.5:
        k = t * 2
        return (lerp(163, 74, k), lerp(230, 207, k), lerp(53, 107, k))
    k = (t - 0.5) * 2
    return (lerp(74, 20, k), lerp(207, 166, k), lerp(107, 140, k))


def in_rounded(nx, ny):
    r = CORNER
    if nx < r and ny < r:
        return (nx - r) ** 2 + (ny - r) ** 2 <= r * r
    if nx > 1 - r and ny < r:
        return (nx - (1 - r)) ** 2 + (ny - r) ** 2 <= r * r
    if nx < r and ny > 1 - r:
        return (nx - r) ** 2 + (ny - (1 - r)) ** 2 <= r * r
    if nx > 1 - r and ny > 1 - r:
        return (nx - (1 - r)) ** 2 + (ny - (1 - r)) ** 2 <= r * r
    return True


def on_wave(nx, ny, stroke2=STROKE2):
    if ny < 0.24 or ny > 0.76 or nx < 0.12 or nx > 0.88:
        return False
    for ax, ay, dx, dy, inv in WAVE_SEGS:
        t = ((nx - ax) * dx + (ny - ay) * dy) * inv
        if t < 0:
            t = 0
        elif t > 1:
            t = 1
        ex = nx - (ax + t * dx)
        ey = ny - (ay + t * dy)
        if ex * ex + ey * ey <= stroke2:
            return True
    return False


def make_png(size, inset=INSET, stroke=STROKE):
    raw = bytearray()
    left = size * inset
    span = size * (1 - 2 * inset)
    sub = 1.0 / SUPERSAMPLE
    total = SUPERSAMPLE * SUPERSAMPLE
    for y in range(size):
        raw.append(0)
        for x in range(size):
            if x < left - 2 or x > left + span + 2 or y < left - 2 or y > left + span + 2:
                raw.extend((0, 0, 0, 0))
                continue
            cr = cg = cb = 0.0
            cover = 0
            for sy in range(SUPERSAMPLE):
                py = y + (sy + 0.5) * sub
                ny = (py - left) / span
                if ny < 0 or ny > 1:
                    continue
                for sx in range(SUPERSAMPLE):
                    px = x + (sx + 0.5) * sub
                    nx = (px - left) / span
                    if nx < 0 or nx > 1 or not in_rounded(nx, ny):
                        continue
                    r, g, b = gradient(nx, ny)
                    if on_wave(nx, ny, stroke * stroke):
                        r, g, b = 255, 255, 255
                    cr += r
                    cg += g
                    cb += b
                    cover += 1
            if cover == 0:
                raw.extend((0, 0, 0, 0))
            else:
                alpha = int(cover * 255 / total)
                raw.extend((int(cr / cover), int(cg / cover), int(cb / cover), alpha))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def write_ico(sizes):
    # Windows 任务栏图标很小（16/24/32px），需要让图形尽量铺满画布、波形更粗才看得清；
    # macOS Dock 图标仍用原来的 INSET/STROKE，保持一致。
    pngs = {s: make_png(s, inset=0.015, stroke=0.036) for s in sizes}
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries = b""
    for s in sizes:
        w = 0 if s >= 256 else s
        entries += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(pngs[s]), offset)
        offset += len(pngs[s])
    with open(os.path.join(ASSETS, "icon.ico"), "wb") as f:
        f.write(header + entries + b"".join(pngs[s] for s in sizes))


def main():
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(ICONSET, exist_ok=True)
    mapping = {
        "icon_16x16.png": 16, "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32, "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128, "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256, "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512, "icon_512x512@2x.png": 1024,
    }
    for name, size in mapping.items():
        with open(os.path.join(ICONSET, name), "wb") as f:
            f.write(make_png(size))
    with open(os.path.join(ASSETS, "icon.png"), "wb") as f:
        f.write(make_png(512))
    write_ico([16, 32, 48, 64, 128, 256])
    try:
        subprocess.run(["iconutil", "-c", "icns", ICONSET, "-o", os.path.join(ASSETS, "icon.icns")], check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass
    print("Icons generated in", ASSETS)


if __name__ == "__main__":
    main()
