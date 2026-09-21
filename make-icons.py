"""Generate Gambit's launcher icons — a rook, because it reads at 48px where a
knight turns to mush. Pure stdlib: a small PNG encoder plus polygon fills, so
the build needs no image libraries."""
import zlib, struct

BG   = (0x8a, 0x5c, 0x32, 255)   # warm wood
MARK = (0xf7, 0xf1, 0xe6, 255)   # near-white

def rook_polys(inset):
    def S(x, y):
        return (0.5 + (x - 0.5) * inset, 0.5 + (y - 0.5) * inset)
    def box(x0, y0, x1, y1):
        return [S(x0, y0), S(x1, y0), S(x1, y1), S(x0, y1)]
    return [
        box(0.18, 0.16, 0.32, 0.30),   # left merlon
        box(0.43, 0.16, 0.57, 0.30),   # middle merlon
        box(0.68, 0.16, 0.82, 0.30),   # right merlon
        box(0.18, 0.27, 0.82, 0.39),   # top band
        [S(0.31, 0.39), S(0.69, 0.39), S(0.63, 0.67), S(0.37, 0.67)],  # tapered body
        box(0.27, 0.65, 0.73, 0.73),   # collar
        box(0.17, 0.73, 0.83, 0.84),   # foot
    ]

def inside(poly, x, y):
    c = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xint = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xint:
                c = not c
    return c

def render(size, radius_frac, supersample=3):
    polys = rook_polys(0.80)
    r = radius_frac * size
    px = bytearray()
    ss = supersample
    for py in range(size):
        px.append(0)                                   # PNG filter byte: none
        for pxi in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    fx = pxi + (sx + .5) / ss
                    fy = py + (sy + .5) / ss
                    cx = min(max(fx, r), size - r)
                    cy = min(max(fy, r), size - r)
                    d = ((fx - cx) ** 2 + (fy - cy) ** 2) ** .5
                    if d > r:
                        col = (0, 0, 0, 0)
                    else:
                        nx, ny = fx / size, fy / size
                        col = MARK if any(inside(p, nx, ny) for p in polys) else BG
                    for k in range(4):
                        acc[k] += col[k]
            px.extend(bytes(a // (ss * ss) for a in acc))
    return bytes(px)

def png(size, path, radius_frac):
    raw = render(size, radius_frac)
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    out = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    open(path, 'wb').write(out)
    print(path, '%dx%d' % (size, size), len(out), 'bytes')

png(192, 'icon-192.png', 0.22)
png(512, 'icon-512.png', 0.22)
png(512, 'icon-maskable.png', 0.5)    # full-bleed, safe under Android's crop
png(180, 'apple-touch-icon.png', 0.22)
