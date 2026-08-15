#!/usr/bin/env python3
"""Regenerates the raster branding assets from the vector mark.

`python3 build/appicon.py` writes build/appicon.png, the four menu-bar marks
under build/tray/, the two DMG assets under build/darwin/, and — on macOS —
darwin/dmg-file-icon.icns through iconutil. darwin/icons.icns and
windows/icon.ico come from `wails3 task common:generate:icons`, which reads
appicon.png and appicon.icon; run that after this. The webapp's own favicon
(webapp/static/favicon.svg) draws the same shape by hand.

The renderer is written out here rather than pulled from a library because this
machine has no SVG rasteriser at all (no rsvg, no ImageMagick, no PIL), and the
mark is only rounded rectangles — a signed distance field with a one-pixel
anti-aliasing band draws them exactly. The geometry is the same as
webapp/src/widgets/icons/appLogo.tsx and build/appicon.icon: three board
columns, tallest first.
"""
import math
import os
import struct
import zlib

# The product colours: white columns on deep navy.
NAVY = (0x1B, 0x2A, 0x4A)
WHITE = (0xFF, 0xFF, 0xFF)

# The amber the board keeps for "an agent is asking" (--warning-rgb in
# webapp/src/styles/_tokens.scss), in both of its values: the paper theme's on a
# light menu bar, the screen theme's on a dark one.
AMBER_ON_LIGHT = (0xA8, 0x70, 0x14)
AMBER_ON_DARK = (0xFF, 0xB4, 0x4C)

# The menu bar scales whatever it is handed to its own thickness, so 44px is
# 22pt drawn at 2x: crisp on a retina display and right-sized on one that is not.
TRAY_PX = 44

ROOT = os.path.dirname(os.path.abspath(__file__))


def rounded_rect_sdf(px, py, x, y, w, h, r):
    dx = abs(px - (x + w / 2)) - (w / 2 - r)
    dy = abs(py - (y + h / 2)) - (h / 2 - r)
    return (math.hypot(max(dx, 0.0), max(dy, 0.0)) +
            min(max(dx, dy), 0.0) - r)


def coverage(sdf):
    return min(max(0.5 - sdf, 0.0), 1.0)


def columns(size, left, top, width):
    """The three columns of the mark, in the proportions of appLogo.tsx."""
    s = width / 560.0
    return [
        (left, top, 147 * s, 471 * s, 44 * s),
        (left + 206 * s, top, 147 * s, 324 * s, 44 * s),
        (left + 412 * s, top, 147 * s, 177 * s, 44 * s),
    ]


def blend(dst, src, a):
    return tuple(round(dst[i] + (src[i] - dst[i]) * a) for i in range(3))


def render_icon(size):
    # 22.37% of the side is the corner radius Apple's icon grid uses, and the
    # shape has to be baked in: .icns and .ico carry no mask of their own.
    radius = size * 0.2237
    mark_w = size * 0.547
    cols = columns(size, (size - mark_w) / 2, (size - size * 0.46) / 2, mark_w)

    out = bytearray(size * size * 4)
    for py in range(size):
        yc = py + 0.5
        base = py * size * 4
        for px in range(size):
            xc = px + 0.5
            a = coverage(rounded_rect_sdf(xc, yc, 0, 0, size, size, radius))
            if a <= 0:
                continue
            rgb = NAVY
            for (cx, cy, cw, ch, cr) in cols:
                ca = coverage(rounded_rect_sdf(xc, yc, cx, cy, cw, ch, cr))
                if ca > 0:
                    rgb = blend(rgb, WHITE, ca)
            out[base + px * 4:base + px * 4 + 4] = bytes(rgb + (round(a * 255),))
    return out


def circle_sdf(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def render_tray(ink, dot):
    """The mark for the system tray: the three columns in `ink`, plus — when
    `dot` is a colour — a badge saying an agent is waiting for a person.

    Two inks rather than one template icon, because the badge is the point: a
    macOS template icon is drawn from its alpha alone, so the amber would come
    out the same grey as the columns and the one thing worth noticing across a
    menu bar would stop being noticeable. The badge sits bottom-right, which is
    the corner the descending columns leave empty, so it needs no gap punched
    around it to read as a badge rather than as a fourth column."""
    size = TRAY_PX
    cols = columns(size, 4.0, 6.0, 36.0)

    out = bytearray(size * size * 4)
    for py in range(size):
        yc = py + 0.5
        base = py * size * 4
        for px in range(size):
            xc = px + 0.5
            a, rgb = 0.0, ink
            for (cx, cy, cw, ch, cr) in cols:
                a = max(a, coverage(rounded_rect_sdf(xc, yc, cx, cy, cw, ch, cr)))
            if dot:
                da = coverage(circle_sdf(xc, yc, 36.5, 35.5, 6.5))
                if da > a:
                    a, rgb = da, dot
            if a <= 0:
                continue
            out[base + px * 4:base + px * 4 + 4] = bytes(rgb + (round(a * 255),))
    return out


def render_dmg_background(w, h):
    """The window behind the drag-to-Applications shortcut: a diagonal navy
    wash with the mark small in the bottom-right, where Wails put its own."""
    mark_w = w * 0.17
    mark_h = mark_w * 471 / 560
    cols = columns(w, w - mark_w - w * 0.06, h - mark_h - h * 0.09, mark_w)

    out = bytearray(w * h * 4)
    for py in range(h):
        yc = py + 0.5
        base = py * w * 4
        for px in range(w):
            xc = px + 0.5
            t = min(max((xc / w * 0.75 + yc / h * 0.25), 0.0), 1.0)
            rgb = blend(NAVY, (0xEF, 0xF2, 0xF7), t ** 0.85)
            for (cx, cy, cw, ch, cr) in cols:
                ca = coverage(rounded_rect_sdf(xc, yc, cx, cy, cw, ch, cr))
                if ca > 0:
                    rgb = blend(rgb, NAVY, ca * 0.85)
            out[base + px * 4:base + px * 4 + 4] = bytes(rgb + (255,))
    return out


def write_png(path, w, h, rgba):
    raw = b''.join(b'\x00' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' +
                chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) +
                chunk(b'IDAT', zlib.compress(raw, 9)) +
                chunk(b'IEND', b''))


# The sizes an .iconset has to carry, as (pixels, iconutil name).
ICONSET = [
    (16, 'icon_16x16'), (32, 'icon_16x16@2x'),
    (32, 'icon_32x32'), (64, 'icon_32x32@2x'),
    (128, 'icon_128x128'), (256, 'icon_128x128@2x'),
    (256, 'icon_256x256'), (512, 'icon_256x256@2x'),
    (512, 'icon_512x512'), (1024, 'icon_512x512@2x'),
]


def build_icns(png, icns):
    """sips downscales better than this renderer does at 16px, so the small
    sizes are resampled from the 1024 rather than drawn again."""
    import shutil
    import subprocess
    import tempfile

    if not shutil.which('iconutil'):
        return False
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'icon.iconset')
        os.mkdir(iconset)
        for size, name in ICONSET:
            out = os.path.join(iconset, name + '.png')
            if size == 1024:
                shutil.copyfile(png, out)
            else:
                subprocess.run(['sips', '-z', str(size), str(size), png, '--out', out],
                               check=True, stdout=subprocess.DEVNULL)
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns], check=True)
    return True


if __name__ == '__main__':
    icon = render_icon(1024)
    write_png(os.path.join(ROOT, 'appicon.png'), 1024, 1024, icon)

    tray = os.path.join(ROOT, 'tray')
    os.makedirs(tray, exist_ok=True)
    for name, ink, dot in (('idle-light', NAVY, None),
                           ('idle-dark', WHITE, None),
                           ('waiting-light', NAVY, AMBER_ON_LIGHT),
                           ('waiting-dark', WHITE, AMBER_ON_DARK)):
        write_png(os.path.join(tray, name + '.png'), TRAY_PX, TRAY_PX,
                  render_tray(ink, dot))
    print('wrote tray/{idle,waiting}-{light,dark}.png')

    dmg_icon = os.path.join(ROOT, 'darwin', 'dmg-file-icon.png')
    write_png(dmg_icon, 1024, 1024, icon)
    write_png(os.path.join(ROOT, 'darwin', 'dmg-background.png'), 540, 380,
              render_dmg_background(540, 380))
    print('wrote appicon.png, darwin/dmg-file-icon.png, darwin/dmg-background.png')

    if build_icns(dmg_icon, os.path.join(ROOT, 'darwin', 'dmg-file-icon.icns')):
        print('wrote darwin/dmg-file-icon.icns')
    print('now run: wails3 task common:generate:icons')
