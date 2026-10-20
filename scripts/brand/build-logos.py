#!/usr/bin/env python3
"""Gera o kit de logos SVG do Placa na Mão (textos convertidos em curvas com Plus Jakarta Sans / DM Sans).
Uso: python3 scripts/brand/build-logos.py  → apps/web/public/brand/*.svg
Depois: node scripts/brand/rasterize.mjs gera os PNGs (ícones PWA, apple-touch, OG)."""
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONTS = os.path.join(ROOT, 'apps', 'api', 'assets', 'fonts')
OUT = os.path.join(ROOT, 'apps', 'web', 'public', 'brand')
os.makedirs(OUT, exist_ok=True)

VIOLET, LILAC, BLUE, INK, WHITE = '#8B5CF6', '#C084FC', '#3B82F6', '#0F0F14', '#FFFFFF'
JAK800 = TTFont(os.path.join(FONTS, 'plus-jakarta-sans-latin-800-normal.woff'))
JAK700 = TTFont(os.path.join(FONTS, 'plus-jakarta-sans-latin-700-normal.woff'))
DM700 = TTFont(os.path.join(FONTS, 'dm-sans-latin-700-normal.woff'))


def text_path(font, text, size, x=0.0, y=0.0, tracking=0.0):
    """Converte texto em um único path SVG. y = linha de base. Devolve (d, largura)."""
    gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
    scale = size / upm; cursor = x; parts = []
    hmtx = font['hmtx']
    for ch in text:
        name = cmap.get(ord(ch))
        if name is None:
            cursor += size * 0.3; continue
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (scale, 0, 0, -scale, cursor, y))
        gs[name].draw(tp)
        d = pen.getCommands()
        if d: parts.append(d)
        cursor += hmtx[name][0] * scale + tracking
    return ' '.join(parts), cursor - x - tracking


def mark(grad_id='g', stroke=None, accent=None, w=11):
    """P estilizado com 'mão' (curva inferior). viewBox 64x64."""
    s = stroke or f'url(#{grad_id})'
    a = accent or LILAC
    return (f'<path d="M20 51V22C20 15.4 25.2 11 32 11H38.5C47 11 52.5 17 52.5 25.5C52.5 34 46.5 40 38.5 40H20" fill="none" stroke="{s}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="M11 57.5C21 62.5 36 61 46 50" fill="none" stroke="{a}" stroke-width="5.5" stroke-linecap="round"/>')


def defs(grad_id='g'):
    return f'<defs><linearGradient id="{grad_id}" x1="14" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{LILAC}"/><stop offset=".45" stop-color="{VIOLET}"/><stop offset="1" stop-color="{BLUE}"/></linearGradient></defs>'


def svg(w, h, body, title='Placa na Mão'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'


def write(name, content):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        f.write(content)
    print('ok', name)

# --- Marca e ícone ---
write('logo-mark.svg', svg(64, 64, defs() + mark()))
app_bg = f'<defs><linearGradient id="bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#A78BFA"/><stop offset=".55" stop-color="{VIOLET}"/><stop offset="1" stop-color="#5B3FD6"/></linearGradient></defs>'
app_icon = app_bg + '<rect width="64" height="64" rx="15" fill="url(#bg)"/><g transform="translate(5.6 3.2) scale(.82)">' + mark(stroke=WHITE, accent='#E9D5FF') + '</g>'
write('logo-app-icon.svg', svg(64, 64, app_icon))
write('favicon.svg', svg(64, 64, app_icon).replace('width="64" height="64" ', ''))
# ícone escuro (como a referência "ícone/app")
dark_icon = '<rect width="64" height="64" rx="15" fill="#0F0F14"/>' + defs() + '<g transform="translate(5.6 3.2) scale(.82)">' + mark() + '</g>'
write('logo-app-icon-dark.svg', svg(64, 64, dark_icon))

# --- Wordmark ---
def wordmark_two_lines(color_main, color_accent_fill, tag_color, size=30):
    d1, w1 = text_path(JAK800, 'Placa', size, 0, size * 0.86)
    d2a, w2a = text_path(JAK800, 'na ', size, 0, size * 1.86)
    d2b, w2b = text_path(JAK800, 'Mão', size, w2a, size * 1.86)
    dt, wt = text_path(DM700, 'CONSULTA VEICULAR COMPLETA', size * 0.255, 0, size * 2.5, tracking=size * 0.075)
    width = max(w1, w2a + w2b, wt)
    body = (f'<path d="{d1}" fill="{color_main}"/><path d="{d2a}" fill="{color_accent_fill}"/><path d="{d2b}" fill="{color_accent_fill}"/>'
            f'<path d="{dt}" fill="{tag_color}"/>')
    return body, width, size * 2.62

def build_primary(name, main, accent, tag, dark=False):
    body, ww, wh = wordmark_two_lines(main, 'url(#gt)', tag)
    mark_size = 78
    total_w = mark_size + 18 + ww
    height = max(mark_size, wh)
    my = (height - mark_size) / 2
    grad_text = f'<linearGradient id="gt" x1="0" y1="0" x2="{ww}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{LILAC if dark else VIOLET}"/><stop offset="1" stop-color="{BLUE}"/></linearGradient>'
    content = (defs() + f'<defs>{grad_text}</defs>' +
               f'<g transform="translate(0 {my:.2f}) scale({mark_size/64:.4f})">{mark()}</g>' +
               f'<g transform="translate({mark_size+18} {max((height-wh)/2,0):.2f})">{body}</g>')
    write(name, svg(round(total_w), round(height), content))

build_primary('logo-primary.svg', INK, VIOLET, '#6B7280')
build_primary('logo-primary-dark.svg', WHITE, LILAC, '#C9C9D6', dark=True)

def build_horizontal(name, main, dark=False, mono=None):
    size = 34
    da, wa = text_path(JAK800, 'Placa ', size, 0, size * 0.78)
    db, wb = text_path(JAK800, 'na Mão', size, wa, size * 0.78)
    mark_size = 46
    total_w = mark_size + 12 + wa + wb
    height = mark_size
    ty = (height - size) / 2 + 3
    grad_text = f'<linearGradient id="gh" x1="{wa}" y1="0" x2="{wa+wb}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{LILAC if dark else VIOLET}"/><stop offset="1" stop-color="{BLUE}"/></linearGradient>'
    accent_fill = mono or 'url(#gh)'
    m = mark(stroke=mono, accent=mono) if mono else mark()
    content = ((defs() if not mono else '') + f'<defs>{grad_text}</defs>' +
               f'<g transform="scale({mark_size/64:.4f})">{m}</g>' +
               f'<g transform="translate({mark_size+12} {ty:.2f})"><path d="{da}" fill="{mono or main}"/><path d="{db}" fill="{accent_fill}"/></g>')
    write(name, svg(round(total_w), height, content))

build_horizontal('logo-horizontal.svg', INK)
build_horizontal('logo-horizontal-dark.svg', WHITE, dark=True)
build_horizontal('logo-mono.svg', '#1F2937', mono='#1F2937')
build_horizontal('logo-mono-white.svg', WHITE, mono=WHITE)

# --- Vertical ---
def build_vertical(name, main, dark=False):
    size = 36
    d1, w1 = text_path(JAK800, 'Placa na Mão', size, 0, size * 0.8)
    dt, wt = text_path(DM700, 'CONSULTA VEICULAR COMPLETA', size * 0.24, 0, size * 1.55, tracking=size * 0.06)
    width = max(w1, wt) + 8
    mark_size = 92
    grad_text = f'<linearGradient id="gv" x1="0" y1="0" x2="{w1}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{main}"/><stop offset=".5" stop-color="{main}"/><stop offset="1" stop-color="{main}"/></linearGradient>'
    cx = width / 2
    content = (defs() +
               f'<g transform="translate({cx-mark_size/2:.2f} 0) scale({mark_size/64:.4f})">{mark()}</g>' +
               f'<g transform="translate({(width-w1)/2:.2f} {mark_size+14})"><path d="{d1}" fill="{main}"/></g>' +
               f'<g transform="translate({(width-wt)/2:.2f} {mark_size+14})"><path d="{dt}" fill="{"#C9C9D6" if dark else "#6B7280"}"/></g>')
    write(name, svg(round(width), round(mark_size + 14 + size * 1.7), content))

build_vertical('logo-vertical.svg', INK)
build_vertical('logo-vertical-dark.svg', WHITE, dark=True)
