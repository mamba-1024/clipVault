#!/usr/bin/env python3
"""Generate ClipVault PNG icons from design spec (gradient ring + C)."""
import math
import struct
import zlib
from pathlib import Path

CYAN = (0, 212, 255)
MID = (91, 141, 255)
PURPLE = (124, 92, 255)
BG = (10, 14, 26, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def conic_color(deg):
    t = (deg % 360) / 360.0
    if t < 0.5:
        return lerp(CYAN, PURPLE, t * 2)
    return lerp(PURPLE, CYAN, (t - 0.5) * 2)


def png_chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, pixels, w, h):
    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            raw += bytes(pixels[y * w + x])
    compressed = zlib.compress(raw, 9)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    data = b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', ihdr) + png_chunk(b'IDAT', compressed) + png_chunk(b'IEND', b'')
    path.write_bytes(data)


def inside_circle(x, y, cx, cy, r):
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def draw_icon(size):
    cx = cy = (size - 1) / 2.0
    outer_r = size * 0.46
    inner_r = size * 0.34
    ring_inner = size * 0.30
    pixels = [(0, 0, 0, 0)] * (size * size)

    for y in range(size):
        for x in range(size):
            dx, dy = x - cx, y - cy
            dist = math.hypot(dx, dy)
            angle = math.degrees(math.atan2(dy, dx)) % 360

            if dist <= inner_r:
                pixels[y * size + x] = BG
            elif dist <= outer_r:
                c = conic_color(angle + 25)
                # 环带高光
                alpha = 255
                if dist > ring_inner:
                    fade = min(1.0, (outer_r - dist) / (outer_r - ring_inner) * 0.4 + 0.6)
                else:
                    fade = min(1.0, (dist - inner_r) / (ring_inner - inner_r) * 0.5 + 0.5)
                pixels[y * size + x] = (
                    int(c[0] * fade),
                    int(c[1] * fade),
                    int(c[2] * fade),
                    alpha,
                )
            else:
                pixels[y * size + x] = (0, 0, 0, 0)

    # 绘制 C 字（开口圆弧）
    c_r = inner_r * 0.58
    stroke = max(2, size * 0.11)
    for y in range(size):
        for x in range(size):
            if not inside_circle(x, y, cx, cy, inner_r - 0.5):
                continue
            dx, dy = x - cx + size * 0.02, y - cy
            dist = math.hypot(dx, dy)
            ang = math.degrees(math.atan2(dy, dx)) % 360
            on_arc = abs(dist - c_r) <= stroke / 2 and 52 <= ang <= 308
            if on_arc:
                t = (ang - 52) / 256
                c = lerp(CYAN, PURPLE, min(1, max(0, t)))
                pixels[y * size + x] = (*c, 255)

    return pixels


def main():
    root = Path(__file__).parent
    for s in (16, 48, 128):
        write_png(root / f'icon{s}.png', draw_icon(s), s, s)
        print(f'Wrote icon{s}.png ({s}x{s})')


if __name__ == '__main__':
    main()
