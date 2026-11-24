import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const api = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const web = (f) => readFileSync(new URL(`../../web/${f}`, import.meta.url), 'utf8');

describe('Google Tag Manager', () => {
  it('a variável só aceita o formato GTM-XXXX e vem vazia por padrão', () => {
    const cfg = api('config.ts');
    assert.match(cfg, /GOOGLE_TAG_MANAGER_ID: tagId\(\/\^GTM-\[A-Z0-9\]\{4,10\}\$\/\)/);
    assert.match(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'), /^GOOGLE_TAG_MANAGER_ID=$/m);
  });

  it('o servidor repassa o ID e só abre o CSP extra quando o GTM está ligado', () => {
    const srv = api('server.ts');
    assert.match(srv, /gtmId: env\.GOOGLE_TAG_MANAGER_ID/);
    assert.match(srv, /const gtmOn = Boolean\(env\.GOOGLE_TAG_MANAGER_ID\)/);
    assert.match(srv, /\.\.\.\(gtmOn \? GTM_SCRIPT : \[\]\)/);
    assert.match(srv, /\.\.\.\(gtmOn \? \{ frameSrc:/);
    assert.match(srv, /googleadservices\.com/);
  });

  it('o app só carrega o GTM depois do aceite e usa o dataLayer com ele', () => {
    const a = web('src/client/analytics.ts');
    assert.match(a, /meta\('pnm-gtm'\)/);
    assert.match(a, /gtm\.js\?id=/);
    // o carregamento fica dentro de load(), que só roda no aceite
    assert.match(a, /if \(value === 'granted'\) \{ load\(\)/);
    assert.match(a, /initAnalytics[^\n]*storedConsent\(\) === 'granted'\) load\(\)/);
    // com GTM, o evento de compra leva valor e ID do pedido, e não duplica a conversão do gtag
    assert.match(a, /event: 'purchase', transaction_id: opts\.id, currency: 'BRL'/);
    assert.match(a, /dl\.push\(\{ ecommerce: null \}\)/);
  });

  it('sem GTM o caminho do gtag continua igual', () => {
    const a = web('src/client/analytics.ts');
    assert.match(a, /gtag\/js\?id=/);
    assert.match(a, /window\.gtag\('event', 'purchase'/);
    assert.match(a, /send_to: `\$\{ads\}\/\$\{adsLabel\}`/);
  });
});
