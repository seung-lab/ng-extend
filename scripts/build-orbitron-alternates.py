"""
Two clearer letters for Orbitron (Ames 2026-10-06).

In Orbitron a capital D is an O with two square corners, and a small h is a k
with a slightly different arm: at tab and button sizes "2D EM" read as "2O EM"
and "Attach screenshot" as "Attack screenshot". The font stays Orbitron. This
script redraws only those two letters, from Orbitron's own outlines and at
its own stroke widths and advance widths, for the three weights the app
loads (500, 600, 700):

  D   the right side becomes a real bowl (a large radius top and bottom)
      while the left stays a square stem, so it can not be taken for an O
  h   the shoulder becomes a round arch, so it can not be taken for a k

The result is src/orbitron_alternates.css: three tiny fonts, as data URIs,
declared as more faces of the family 'Orbitron' limited to U+0044 and
U+0068. A later face wins where ranges overlap, so every existing
font-family: 'Orbitron' picks the two letters up with no other change.

Input: the Orbitron variable font the app already loads from Google Fonts
(SIL Open Font License 1.1, The Orbitron Project Authors). The derived fonts
carry the same licence and a different internal name.

  python scripts/build-orbitron-alternates.py path/to/orbitron-latin.woff2
"""
import base64, io, math, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.subset import Subsetter, Options
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.recordingPen import RecordingPen

WEIGHTS = (500, 600, 700)
OUT = 'src/orbitron_alternates.css'


def arc(pen, cx, cy, r, a0, a1):
    """A quarter circle as two quadratic pieces, from angle a0 to a1 (degrees)."""
    steps = 2
    da = math.radians(a1 - a0) / steps
    k = r / math.cos(da / 2)
    a = math.radians(a0)
    for _ in range(steps):
        ctrl = (round(cx + k * math.cos(a + da / 2)), round(cy + k * math.sin(a + da / 2)))
        a += da
        pen.qCurveTo(ctrl, (round(cx + r * math.cos(a)), round(cy + r * math.sin(a))))


def bounds(contour):
    pts = [p for op, args in contour for p in args]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def contours(glyphset, name):
    rec = RecordingPen(); glyphset[name].draw(rec)
    out, cur = [], []
    for op, args in rec.value:
        cur.append((op, args))
        if op == 'closePath': out.append(cur); cur = []
    return out


def draw_D(glyphset):
    outer, inner = sorted(contours(glyphset, 'D'), key=lambda c: -(bounds(c)[2] - bounds(c)[0]))
    x0, y0, x1, y1 = bounds(outer)
    ix0, iy0, ix1, iy1 = bounds(inner)
    R = round((y1 - y0) * 0.43)          # the bowl
    r = R - (x1 - ix1)                    # same stroke all the way round
    s = 19                                # Orbitron's own small inner corner
    pen = TTGlyphPen(None)
    pen.moveTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1 - R, y1))
    arc(pen, x1 - R, y1 - R, R, 90, 0)
    pen.lineTo((x1, y0 + R))
    arc(pen, x1 - R, y0 + R, R, 0, -90)
    pen.closePath()
    pen.moveTo((ix0 + s, iy0)); pen.lineTo((ix1 - r, iy0))
    arc(pen, ix1 - r, iy0 + r, r, -90, 0)
    pen.lineTo((ix1, iy1 - r))
    arc(pen, ix1 - r, iy1 - r, r, 0, 90)
    pen.lineTo((ix0 + s, iy1))
    pen.qCurveTo((ix0, iy1), (ix0, iy1 - s))
    pen.lineTo((ix0, iy0 + s))
    pen.qCurveTo((ix0, iy0), (ix0 + s, iy0))
    pen.closePath()
    return pen.glyph()


def draw_h(glyphset):
    (c,) = contours(glyphset, 'h')
    pts = [p for op, args in c for p in args]
    x0, y0, x1, asc = bounds(c)
    xs = sorted({p[0] for p in pts}); ys = sorted({p[1] for p in pts})
    stem_r = min(x for x in xs if x > x0 + 60)            # right edge of the left stem
    leg_l = max(x for x in xs if x < x1 - 60)             # left edge of the right leg
    top = max(y for y in ys if y < asc - 60)              # top of the shoulder
    under = max(y for y in ys if y < top - 60)            # its underside
    R = round((x1 - stem_r) * 0.56)                       # the arch
    r = R - (x1 - leg_l)
    s = stem_r - min(x for x in xs if stem_r - 30 < x < stem_r) if any(stem_r - 30 < x < stem_r for x in xs) else 0
    s = 19
    pen = TTGlyphPen(None)
    pen.moveTo((x0, y0)); pen.lineTo((x0, asc)); pen.lineTo((stem_r, asc)); pen.lineTo((stem_r, top))
    pen.lineTo((x1 - R, top))
    arc(pen, x1 - R, top - R, R, 90, 0)
    pen.lineTo((x1, y0)); pen.lineTo((leg_l, y0)); pen.lineTo((leg_l, under - r))
    arc(pen, leg_l - r, under - r, r, 0, 90)
    pen.lineTo((stem_r + s, under))
    pen.qCurveTo((stem_r, under), (stem_r, under - s))
    pen.lineTo((stem_r, y0))
    pen.closePath()
    return pen.glyph()


def build(src, weight):
    f = TTFont(src); f.flavor = None
    instantiateVariableFont(f, {'wght': weight}, inplace=True)
    opts = Options(); opts.hinting = False; opts.layout_features = []; opts.name_IDs = [0, 13, 14]; opts.notdef_outline = True
    sub = Subsetter(opts); sub.populate(unicodes=[0x44, 0x68]); sub.subset(f)
    gs = f.getGlyphSet()
    new = {'D': draw_D(gs), 'h': draw_h(gs)}
    for name, glyph in new.items():
        f['glyf'][name] = glyph            # advance widths (hmtx) are untouched
    for rec in list(f['name'].names):
        if rec.nameID in (1, 4, 6, 16): f['name'].removeNames(nameID=rec.nameID)
    for nid, text in ((1, 'EyeWire Orbitron Alternates'), (2, 'Regular'), (4, f'EyeWire Orbitron Alternates {weight}'), (6, f'EyeWireOrbitronAlternates-{weight}')):
        f['name'].setName(text, nid, 3, 1, 0x409)
    f.flavor = 'woff2'
    buf = io.BytesIO(); f.save(buf)
    return buf.getvalue()


def main():
    src = sys.argv[1]
    css = ['/* Generated by scripts/build-orbitron-alternates.py. Do not edit by hand.',
           '   A clearer D and h for Orbitron (Ames 2026-10-06): the D has a real bowl so it is',
           '   not an O, the h a round arch so it is not a k. Still Orbitron everywhere else.',
           '   Derived from Orbitron, SIL Open Font License 1.1, The Orbitron Project Authors. */']
    for w in WEIGHTS:
        data = build(src, w)
        css.append("@font-face { font-family: 'Orbitron'; font-style: normal; font-weight: %d; font-display: swap; "
                   "src: url(data:font/woff2;base64,%s) format('woff2'); unicode-range: U+0044, U+0068; }"
                   % (w, base64.b64encode(data).decode()))
        print(w, len(data), 'bytes')
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(css) + '\n')


if __name__ == '__main__':
    main()
