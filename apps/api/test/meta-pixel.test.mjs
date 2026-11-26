import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const api = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const web = (f) => readFileSync(new URL(`../../web/${f}`, import.meta.url), 'utf8');
const root = (f) => readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8');

describe('Pixel do Meta', () => {
  it('a variável só aceita o número do Pixel e vem vazia por padrão', () => {
    assert.match(api('config.ts'), /META_PIXEL_ID: tagId\(\/\^\\d\{8,20\}\$\/\)/);
    assert.match(root('.env.example'), /^META_PIXEL_ID=$/m);
  });

  it('o servidor repassa o número como meta tag e só abre o CSP quando o Pixel está ligado', () => {
    const srv = api('server.ts');
    assert.match(srv, /metaPixelId: env\.META_PIXEL_ID/);
    assert.match(srv, /const metaOn = Boolean\(env\.META_PIXEL_ID\)/);
    assert.match(srv, /\.\.\.\(metaOn \? META_SCRIPT : \[\]\)/);
    assert.match(srv, /\.\.\.\(metaOn \? META_CONNECT : \[\]\)/);
    assert.match(srv, /connect\.facebook\.net/);
    assert.match(api('seo.ts'), /name="pnm-meta"/);
  });

  it('o app só carrega o Pixel depois do aceite, sem coleta automática', () => {
    const a = web('src/client/analytics.ts');
    assert.match(a, /meta\('pnm-meta'\)/);
    assert.match(a, /fbevents\.js/);
    assert.match(a, /'set', 'autoConfig', false/);
    // o carregamento do Pixel fica dentro de load(), que só roda no aceite
    assert.match(a, /function load\(\): void \{\s*loadMeta\(\);/);
    assert.match(a, /if \(value === 'granted'\) \{ load\(\)/);
    assert.match(a, /fbq\('consent', 'revoke'\)/);
    assert.match(a, /i\.gtm \|\| i\.ga \|\| i\.ads \|\| i\.meta/);
    // todo evento do Pixel exige o aceite
    assert.match(a, /function metaTrack[^\n]*\n[^\n]*storedConsent\(\) !== 'granted'\) return/);
  });

  it('eventos do funil e compra com valor, moeda e código do pedido (sem dado pessoal)', () => {
    const a = web('src/client/analytics.ts');
    assert.match(a, /metaTrack\('PageView'\)/);
    assert.match(a, /FIPE_RESULT_VIEWED: 'ViewContent', ACCOUNT_CREATED: 'CompleteRegistration'/);
    assert.match(a, /CHECKOUT_STARTED: 'InitiateCheckout'/);
    assert.match(a, /metaTrack\('Purchase', \{ value, currency: 'BRL'/);
    assert.match(a, /\{ eventID: eventId \}/);
    // a placa e a query nunca vão para o Meta: o PageView não leva parâmetros
    assert.doesNotMatch(a, /metaTrack\('PageView', /);
  });

  it('o caminho do Google continua igual', () => {
    const a = web('src/client/analytics.ts');
    assert.match(a, /gtag\/js\?id=/);
    assert.match(a, /gtm\.js\?id=/);
    assert.match(a, /window\.gtag\('event', 'purchase'/);
    assert.match(a, /send_to: `\$\{ads\}\/\$\{adsLabel\}`/);
  });

  it('a política de privacidade cita o Pixel do Meta', () => {
    assert.match(web('src/client/pages/Public.tsx'), /Pixel do Meta \(Facebook e Instagram\)/);
  });
});
