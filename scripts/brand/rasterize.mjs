// Gera PNGs da marca (ícones PWA, apple-touch, OG) a partir dos SVGs. Requer Playwright + Chromium.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pub = path.join(root, 'apps/web/public');
const brand = path.join(pub, 'brand');
mkdirSync(brand, { recursive: true });
const svg = (n) => readFileSync(path.join(brand, n), 'utf8');
const font = (f) => 'data:font/woff2;base64,' + readFileSync(path.join(pub, 'fonts', f)).toString('base64');
const FONTCSS = `<style>@font-face{font-family:'Plus Jakarta Sans';font-weight:800;src:url(${font('plus-jakarta-sans-latin-800-normal.woff2')})}@font-face{font-family:'DM Sans';font-weight:500;src:url(${font('dm-sans-latin-500-normal.woff2')})}</style>`;
const b64 = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
async function shot(html, w, h, out, transparent = false) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><head>${FONTCSS}</head><body style="margin:0;background:${transparent ? 'transparent' : '#fff'}">${html}</body></html>`);
  await page.screenshot({ path: out, omitBackground: transparent });
  await page.close();
  console.log('ok', path.relative(root, out));
}

const icon = b64(svg('logo-app-icon.svg'));
for (const s of [192, 512]) await shot(`<img src="${icon}" width="${s}" height="${s}" style="display:block">`, s, s, path.join(brand, `icon-${s}.png`), true);
// maskable: fundo cheio + marca na zona segura (80%)
const markDark = b64(svg('logo-mark.svg').replace(/<svg /, '<svg '));
for (const s of [192, 512]) {
  const m = Math.round(s * 0.56);
  await shot(`<div style="width:${s}px;height:${s}px;background:linear-gradient(135deg,#A78BFA,#8B5CF6 55%,#5B3FD6);display:flex;align-items:center;justify-content:center"><img src="${b64(svg('logo-mono-white.svg').length ? markWhite() : '')}" width="${m}" height="${m}"></div>`, s, s, path.join(brand, `icon-maskable-${s}.png`));
}
function markWhite() {
  return svg('logo-mark.svg').replace(/url\(#g\)/g, '#ffffff').replace(/stroke="#C084FC"/g, 'stroke="#E9D5FF"');
}
// apple-touch (sem transparência, sem cantos arredondados — iOS arredonda)
await shot(`<div style="width:180px;height:180px;background:linear-gradient(135deg,#A78BFA,#8B5CF6 55%,#5B3FD6);display:flex;align-items:center;justify-content:center"><img src="${b64(markWhite())}" width="104" height="104"></div>`, 180, 180, path.join(brand, 'apple-touch-icon.png'));
// OG 1200x630
const logoDark = b64(svg('logo-horizontal-dark.svg'));
await shot(`<div style="width:1200px;height:630px;position:relative;overflow:hidden;background:radial-gradient(900px 500px at 85% 20%,rgba(139,92,246,.55),transparent 60%),radial-gradient(700px 500px at 0% 100%,rgba(59,130,246,.35),transparent 60%),#0F0F14;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#fff">
  <img src="${logoDark}" style="position:absolute;left:72px;top:64px;height:64px">
  <div style="position:absolute;left:72px;top:200px;width:640px;font-size:60px;line-height:1.08;font-weight:800;letter-spacing:-.02em">Tudo o que você precisa saber sobre o veículo, <span style="background:linear-gradient(90deg,#C084FC,#3B82F6);-webkit-background-clip:text;color:transparent">em um só lugar.</span></div>
  <div style="position:absolute;left:72px;top:520px;font-size:26px;font-family:'DM Sans';font-weight:500;color:#C9C9D6;width:620px">Consulte pela placa. Relatório completo em PDF.</div>
  <div style="position:absolute;right:72px;bottom:72px;width:330px;height:100px;border-radius:14px;background:#fff;border:6px solid #1c2b6b;box-shadow:0 20px 60px rgba(0,0,0,.5);display:flex;flex-direction:column;align-items:center;justify-content:center">
    <div style="position:absolute;top:0;left:0;right:0;height:26px;background:#1c4fd8;border-radius:6px 6px 0 0"></div>
    <div style="margin-top:22px;font-size:56px;font-weight:800;letter-spacing:.08em;color:#111">ABC1D23</div></div>
</div>`, 1200, 630, path.join(brand, 'og-image.png'));
await browser.close();
