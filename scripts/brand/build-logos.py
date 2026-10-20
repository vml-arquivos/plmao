#!/usr/bin/env python3
"""Gera os SVGs da marca Placa na Mão (carro em linhas + lupa com placa + marca-nome).

O nome é desenhado como contornos (Plus Jakarta Sans 800, inclinação -12°) guardados em wordmark.json,
para o logo não depender de fonte instalada.
Uso: python3 scripts/brand/build-logos.py  → apps/web/public/brand/*.svg e apps/web/public/favicon.svg
Depois: node scripts/brand/rasterize.mjs gera os PNGs (ícones PWA, apple-touch, OG)."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, '../../apps/web/public')
OUT = os.path.join(PUB, 'brand')
os.makedirs(OUT, exist_ok=True)
W = json.load(open(os.path.join(HERE, 'wordmark.json')))
NAVY = '#040B1B'


def grad(gid, dark):
    a, b = ('#2F6FE4', '#5CAEF0') if dark else ('#1D58D8', '#3C8FE8')
    return f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'


def mark(ink, gid, mid):
    """Marca 244x164: frente do carro em linhas, vazada ao redor da lupa; placa azul dentro da lupa."""
    return f'''<g>
<mask id="{mid}"><rect width="244" height="170" fill="#fff"/><circle cx="122" cy="92" r="47" fill="#000"/><path d="M155 126 L190 160" stroke="#000" stroke-width="28" stroke-linecap="round"/></mask>
<g mask="url(#{mid})" fill="none" stroke="{ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
<path d="M42 62 L62 28 C68 20 78 15 92 14 H152 C166 15 176 20 182 28 L202 62"/>
<path d="M10 52 C10 46 16 45 24 45 L44 47"/><path d="M234 52 C234 46 228 45 220 45 L200 47"/>
<path d="M30 72 C48 68 70 66 100 68"/><path d="M214 72 C196 68 174 66 144 68"/>
<path d="M18 80 C30 84 42 88 52 98"/><path d="M226 80 C214 84 202 88 192 98"/>
<path d="M12 90 C8 105 8 122 12 138"/><path d="M232 90 C236 105 236 122 232 138"/>
<path d="M12 140 H66"/><path d="M232 140 H178"/>
</g></g>
<circle cx="122" cy="92" r="36" fill="none" stroke="url(#{gid})" stroke-width="10"/>
<path d="M148 118 L180 152" stroke="url(#{gid})" stroke-width="14" stroke-linecap="round"/>
<rect x="97" y="78" width="50" height="29" rx="5" fill="url(#{gid})"/>
<rect x="97.5" y="78.5" width="49" height="28" rx="4.5" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="1"/>
<g fill="#0A1A3F"><ellipse cx="112" cy="92.5" rx="3.2" ry="3.6"/><ellipse cx="122" cy="92.5" rx="3.2" ry="3.6"/><ellipse cx="132" cy="92.5" rx="3.2" ry="3.6"/></g>
<g fill="#fff" fill-opacity=".9"><circle cx="102" cy="83" r="1.5"/><circle cx="142" cy="83" r="1.5"/><circle cx="102" cy="102" r="1.5"/><circle cx="142" cy="102" r="1.5"/></g>'''


def word(ink, gid, sc):
    return (f'<g transform="scale({sc}) skewX(-12)"><path d="{W["Placa"]}" fill="{ink}"/>'
            f'<path d="{W["na"]}" fill="url(#{gid})"/><path d="{W["Mao"]}" fill="url(#{gid})"/></g>')


def svg(vb, body, defs, label='Placa na Mão'):
    w, h = vb.split()[2:]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{float(w):.0f}" height="{float(h):.0f}" role="img" aria-label="{label}"><title>{label}</title><defs>{defs}</defs>{body}</svg>\n'


def variant(kind, dark):
    ink = '#FFFFFF' if dark else '#0B1633'
    t = 'd' if dark else 'l'
    gid, mid = f'g{t}', f'm{t}'
    defs = grad(gid, dark)
    if kind == 'mark':
        return svg('0 0 244 164', mark(ink, gid, mid), defs)
    if kind == 'horizontal':
        ms, sc = 0.78, 0.062
        x0 = 244 * ms + 14
        body = (f'<g transform="scale({ms})">{mark(ink, gid, mid)}</g>'
                f'<g transform="translate({x0:.1f},{164 * ms * 0.5 + 14:.1f})">{word(ink, gid, sc)}'
                f'<text x="{W["width"] * sc + 4:.1f}" y="-34" font-family="Arial,sans-serif" font-size="13" fill="{ink}">®</text></g>')
        return svg(f'0 0 {x0 + W["width"] * sc + 24:.0f} {164 * ms:.0f}', body, defs)
    if kind == 'vertical':
        sc = 0.062
        w = W['width'] * sc
        body = (f'<g transform="translate({(w - 244) / 2:.1f},0)">{mark(ink, gid, mid)}</g>'
                f'<g transform="translate(0,{164 + 8 + 745 * sc:.1f})">{word(ink, gid, sc)}</g>')
        return svg(f'0 0 {w + 14:.0f} {164 + 8 + 745 * sc + 14:.0f}', body, defs)
    raise ValueError(kind)


def app_icon(pad=0.0, radius=56):
    """Ícone quadrado 256: fundo azul-marinho + marca centralizada (pad = recuo extra para ícone maskable)."""
    gid, mid = 'gi', 'mi'
    s = (176 - pad * 2) / 244
    tx, ty = (256 - 244 * s) / 2, (256 - 164 * s) / 2 + 2
    body = (f'<rect width="256" height="256" rx="{radius}" fill="{NAVY}"/>'
            f'<rect width="256" height="256" rx="{radius}" fill="url(#bg)"/>'
            f'<g transform="translate({tx:.1f},{ty:.1f}) scale({s:.4f})">{mark("#FFFFFF", gid, mid)}</g>')
    defs = grad(gid, True) + '<radialGradient id="bg" cx=".75" cy=".1" r=".9"><stop offset="0" stop-color="#2F6FE4" stop-opacity=".45"/><stop offset="1" stop-color="#2F6FE4" stop-opacity="0"/></radialGradient>'
    return svg('0 0 256 256', body, defs)


def mono(color):
    gid, mid = 'gm', 'mm'
    body = mark(color, gid, mid)
    defs = f'<linearGradient id="{gid}"><stop offset="0" stop-color="{color}"/><stop offset="1" stop-color="{color}"/></linearGradient>'
    return svg('0 0 244 164', body, defs)


def favicon():
    """Favicon legível em 16px: só a lupa com a placa, sobre fundo azul-marinho."""
    gid = 'gf'
    defs = grad(gid, True)
    body = (f'<rect width="64" height="64" rx="14" fill="{NAVY}"/>'
            f'<circle cx="28" cy="28" r="15" fill="none" stroke="url(#{gid})" stroke-width="6.5"/>'
            f'<path d="M39 39 L52 52" stroke="url(#{gid})" stroke-width="8" stroke-linecap="round"/>'
            f'<rect x="19" y="21" width="18" height="14" rx="3" fill="#fff"/><g fill="{NAVY}"><circle cx="24" cy="28" r="1.8"/><circle cx="28" cy="28" r="1.8"/><circle cx="32" cy="28" r="1.8"/></g>')
    return svg('0 0 64 64', body, defs)


files = {}
for k in ['horizontal', 'vertical', 'mark']:
    files[f'logo-{k}.svg'] = variant(k, False)
    files[f'logo-{k}-dark.svg'] = variant(k, True)
files['logo-app-icon.svg'] = app_icon()
files['logo-app-icon-dark.svg'] = app_icon()
files['logo-mono.svg'] = mono('#0B1633')
files['logo-mono-white.svg'] = mono('#FFFFFF')
for name, content in files.items():
    open(os.path.join(OUT, name), 'w').write(content)
open(os.path.join(PUB, 'favicon.svg'), 'w').write(favicon())
open(os.path.join(HERE, '_icon-maskable.svg'), 'w').write(app_icon(pad=14, radius=0))
print('ok', len(files) + 1, 'svgs')
