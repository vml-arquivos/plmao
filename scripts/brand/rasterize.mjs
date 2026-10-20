// Gera os PNGs da marca (ícones PWA, apple-touch, imagem de compartilhamento) a partir dos SVGs em apps/web/public/brand.
// Rode `python3 scripts/brand/build-logos.py` antes, se alterar o logo. Requer Playwright + Chromium.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const pub = path.join(root, 'apps/web/public');
const brand = path.join(pub, 'brand');
mkdirSync(brand, { recursive: true });
const svg = (p) => readFileSync(p, 'utf8');
const b64 = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
const font = (f) => 'data:font/woff2;base64,' + readFileSync(path.join(pub, 'fonts', f)).toString('base64');
const FONTCSS = `<style>@font-face{font-family:'Nunito';font-weight:800;src:url(${font('nunito-latin-800-normal.woff2')})}@font-face{font-family:'Nunito';font-weight:600;src:url(${font('nunito-latin-600-normal.woff2')})}</style>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
async function shot(html, w, h, out, transparent = false) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><head>${FONTCSS}</head><body style="margin:0;background:${transparent ? 'transparent' : '#040B1B'}">${html}</body></html>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: out, omitBackground: transparent });
  await page.close();
  console.log('ok', path.relative(root, out));
}

const icon = b64(svg(path.join(brand, 'logo-app-icon.svg')));
const maskable = b64(svg(path.join(here, '_icon-maskable.svg')));
for (const s of [192, 512]) {
  await shot(`<img src="${icon}" width="${s}" height="${s}" style="display:block">`, s, s, path.join(brand, `icon-${s}.png`), true);
  await shot(`<img src="${maskable}" width="${s}" height="${s}" style="display:block">`, s, s, path.join(brand, `icon-maskable-${s}.png`));
}
await shot(`<img src="${maskable}" width="180" height="180" style="display:block">`, 180, 180, path.join(brand, 'apple-touch-icon.png'));

// Imagem de compartilhamento 1200x630: capa noturna + logo + chamada.
const hero = b64(svg(path.join(brand, 'hero-night.svg')));
const logo = b64(svg(path.join(brand, 'logo-horizontal-dark.svg')));
await shot(`<div style="width:1200px;height:630px;position:relative;overflow:hidden;font-family:'Nunito',system-ui,sans-serif;color:#fff">
  <img src="${hero}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:75% center">
  <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,11,27,.96) 0%,rgba(4,11,27,.82) 45%,rgba(4,11,27,.1) 100%)"></div>
  <img src="${logo}" style="position:absolute;left:72px;top:64px;height:70px">
  <div style="position:absolute;left:72px;top:210px;width:640px;font-size:64px;line-height:1.06;font-weight:800;letter-spacing:-.02em">Conheça a história do carro <span style="color:#6AA7F7">antes de decidir.</span></div>
  <div style="position:absolute;left:72px;top:500px;font-size:27px;font-weight:600;color:#C3D3F0;width:620px">Consulte pela placa. Relatório claro, com PDF.</div>
</div>`, 1200, 630, path.join(brand, 'og-image.png'));
await browser.close();
