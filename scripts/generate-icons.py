#!/usr/bin/env python3
"""
Generate icon assets for Sleiz Studio desktop app.
Creates:
  - apps/desktop/assets/icon.png (512x512, for Linux + Windows fallback)
  - apps/desktop/assets/icon.ico (multi-size, for Windows)
  - apps/desktop/assets/icon.iconset/ (PNGs for macOS iconset)
"""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'apps' / 'desktop' / 'assets'
ICONSET = ASSETS / 'icon.iconset'
ASSETS.mkdir(parents=True, exist_ok=True)
ICONSET.mkdir(parents=True, exist_ok=True)

# Sleiz Studio brand colors
BG = (124, 58, 237)      # violet-600
BG2 = (217, 70, 239)     # fuchsia-500
FG = (255, 255, 255)

def make_png(size: int) -> bytes:
    """Generate a violet→fuchsia gradient PNG with 'S' letter centered."""
    pixels = bytearray()
    for y in range(size):
        row = bytearray()
        row.extend(b'\x00')  # filter byte
        for x in range(size):
            # Radial gradient (violet center → fuchsia edge)
            cx, cy = size / 2, size / 2
            dx, dy = (x - cx) / cx, (y - cy) / cy
            dist = min(1.0, (dx * dx + dy * dy) ** 0.5)
            r = int(BG[0] + (BG2[0] - BG[0]) * dist)
            g = int(BG[1] + (BG2[1] - BG[1]) * dist)
            b = int(BG[2] + (BG2[2] - BG[2]) * dist)

            # Draw 'S' letter using a simple bitmap font
            s = size / 16
            # S shape: top arc, middle bar, bottom arc
            in_s = False
            if size >= 32:
                # Define S as union of 3 rectangles + corners (very rough)
                tx, ty = x - size * 0.3, y - size * 0.3
                tw, th = size * 0.6, size * 0.6
                if 0 <= tx < tw and 0 <= ty < th:
                    # S = top bar + middle bar + bottom bar + left mid + right top + right bottom
                    sy = ty / th
                    sx = tx / tw
                    if 0.05 <= sy <= 0.20 and 0.10 <= sx <= 0.90:  # top bar
                        in_s = True
                    elif 0.42 <= sy <= 0.55 and 0.10 <= sx <= 0.90:  # middle bar
                        in_s = True
                    elif 0.80 <= sy <= 0.95 and 0.10 <= sx <= 0.90:  # bottom bar
                        in_s = True
                    elif 0.20 <= sy <= 0.55 and 0.10 <= sx <= 0.30:  # left mid-top
                        in_s = True
                    elif 0.55 <= sy <= 0.80 and 0.70 <= sx <= 0.90:  # right mid-bot
                        in_s = True
            if in_s:
                r, g, b = FG

            row.extend((r, g, b))
        pixels.extend(row)

    # PNG encoding
    def png_chunk(typ: bytes, data: bytes) -> bytes:
        chunk = typ + data
        crc = zlib.crc32(chunk) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', crc)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # RGB
    compressed = zlib.compress(bytes(pixels), 9)
    return sig + png_chunk(b'IHDR', ihdr) + png_chunk(b'IDAT', compressed) + png_chunk(b'IEND', b'')


def make_ico(sizes=(16, 32, 48, 64, 128, 256)) -> bytes:
    """Multi-size ICO file."""
    images = [make_png(s) for s in sizes]
    # ICO header
    header = struct.pack('<HHH', 0, 1, len(sizes))
    entries = b''
    offset = 6 + len(sizes) * 16
    for s, img in zip(sizes, images):
        # ICONDIR entry: width, height, colors, reserved, planes, bitcount, size, offset
        w = 0 if s == 256 else s
        h = w
        entries += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(img), offset)
        offset += len(img)
    return header + entries + b''.join(images)


# Generate all sizes
sizes = [16, 32, 64, 128, 256, 512, 1024]
print('Generating icons...')
for s in sizes:
    png = make_png(s)
    if s <= 512:
        (ASSETS / f'icon-{s}.png').write_bytes(png)
    # macOS iconset uses specific naming
    if s in [16, 32, 128, 256, 512]:
        (ICONSET / f'icon_{s}x{s}.png').write_bytes(png)
        if s <= 512:
            (ICONSET / f'icon_{s}x{s}@2x.png').write_bytes(make_png(s * 2))

# Main icon.png (512x512, used by Linux + Windows fallback)
(ASSETS / 'icon.png').write_bytes(make_png(512))
print(f'  wrote {ASSETS / "icon.png"}')

# icon.ico (multi-size, Windows)
ico = make_ico()
(ASSETS / 'icon.ico').write_bytes(ico)
print(f'  wrote {ASSETS / "icon.ico"} ({len(ico)} bytes, {len(sizes)} sizes)')

print('Done.')
