#!/usr/bin/env node
/**
 * Auditoria das consultas SEM CUSTO: roda o caminho real do sistema (provedor da Credify, camadas, contrato de APIs,
 * normalização, recorte do produto e PDF) contra uma Credify de mentira que responde no formato publicado na documentação.
 * Nenhuma chamada sai da máquina e nada é cobrado. Mostra, por consulta: quais APIs foram chamadas, o que o cliente recebe
 * e o que o modelo do PDF promete e não chegou.
 *
 * Uso:  AUDIT_DATABASE_URL=postgresql://... node scripts/auditoria-consultas.mjs [saida.md]
 *        (opcional: AUDIT_PDF_DIR=pasta para guardar o PDF de cada consulta e cenário)
 * Precisa do build (npm run build) e de um banco vazio de teste.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbUrl = process.env.AUDIT_DATABASE_URL || process.env.TEST_DATABASE_URL;
if (!dbUrl) { console.error('Defina AUDIT_DATABASE_URL (banco de teste vazio).'); process.exit(2); }
Object.assign(process.env, {
  DATABASE_URL: dbUrl, NODE_ENV: 'test', RATE_LIMIT_ENABLED: 'false', AUDIT_LOG_ENABLED: 'false',
  JWT_SECRET: 'audit-jwt-secret-audit-jwt-secret-audit-jwt-secret-0001', ADMIN_JWT_SECRET: 'audit-admin-secret-audit-admin-secret-audit-admin-0002',
  DATA_ENCRYPTION_KEY: 'audit-data-encryption-key-0123456789abcdef'
});
const dist = (p) => import(path.join(root, 'apps/api/dist', p));
const { ensureSchema } = await dist('schema.js');
const { pool } = await dist('db.js');
const { CredifyVehicleProvider, resetCredifyTokenCache } = await dist('providers/credifyProvider.js');
const { executeVehicleLookup } = await dist('vehicleLookup.js');
const { normalizeBdrp } = await dist('normalizer.js');
const { viewReport, tierForProductCode } = await dist('report/normalizeV2.js');
const { renderVehiclePdf } = await dist('report/pdf.js');
const { refreshScopes, scopeForProduct } = await dist('lib/reportScope.js');
const { sampleViewFor } = await dist('report/sample.js');
const { sourcesForProduct } = await dist('lib/dataSources.js');
const { guaranteedPaths, allowedPaths, contractFor } = await dist('lib/productContract.js');
const { CREDIFY_CONSULTA_CODES } = await dist('config.js');
const { parseFipeByPlate } = await dist('fipePlate.js');
const { enrichWithSheet } = await dist('lib/sheetEnrich.js');
const { SHEET_PRODUCTS } = await dist('lib/fipeRefresh.js');

await ensureSchema();
await refreshScopes();

const { IDENT, SCENARIOS, fipePublic, jwt } = await import(path.join(root, 'apps/api/test/fixtures/credify-respostas.mjs'));

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    const p = new URL(String(url)).pathname;
    if (p === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
    calls.push(p);
    const h = routes[p];
    if (!h) return new Response(JSON.stringify({ Message: `sem resposta de teste para ${p}` }), { status: 404 });
    return new Response(JSON.stringify(h), { status: 200 });
  };
  fn.paid = () => calls;
  return fn;
}

const PRODUCTS = [
  ['FIPE_FREE', 'FIPE grátis'], ['CADASTRAL', 'Dados Cadastrais'], ['LIEN', 'Gravame'], ['AUCTION', 'Leilão e Dados do Veículo'],
  ['BASIC', 'Consulta Avançada'], ['COMPLETE', 'Consulta Completa'], ['PREMIUM', 'Consulta Premium']
];
const names = (await pool.query('SELECT id,name,active FROM query_products')).rows;
const nameOf = (id, fallback) => names.find((r) => r.id === id)?.name ?? fallback;
const FORBIDDEN = /credify|anycar|provedor|fornecedor|api |custo|plano contratado|pacote|token|bdrp/i;

const rows = [];
const problems = [];
for (const [pid, label] of PRODUCTS) {
  for (const [scn, routes] of Object.entries(SCENARIOS)) {
    resetCredifyTokenCache();
    const f = fakeFetch(routes);
    const provider = new CredifyVehicleProvider({ baseUrl: 'https://api.credify.test', clientId: 'cid', clientSecret: 'sec', method: 'post', timeoutMs: 5000, fetchImpl: f });
    let out; let error = null; const entry0 = {};
    if (pid === 'FIPE_FREE') {
      // FIPE grátis tem leitura própria (só a FIPE pela placa): uma API, sem cadastro.
      try {
        const o = await provider.queryByPlate('AAA0000', { productId: pid });
        const r = parseFipeByPlate(o.raw, 'AAA0000');
        entry0.fipe = { valor: r.valueLabel, codigoFipe: r.fipeCode, marca: r.brand?.name, modelo: r.model?.name, ano: r.modelYear, combustivel: r.fuel, mes: r.referenceMonth };
        if (JSON.stringify(r).includes(IDENT.CHASSI)) problems.push('FIPE grátis devolveu o chassi');
        if (!r.valueCents) problems.push('FIPE grátis sem valor');
      } catch (e) { error = `${e.code ?? 'ERRO'}: ${e.detail ?? e.message}`; }
    } else try {
      // Mesmo caminho da consulta do cliente (server.ts): provedor, complemento da FIPE pública e normalização.
      const r = await executeVehicleLookup({ provider, plate: 'AAA0000', productId: pid, sources: sourcesForProduct(pid), enrich: SHEET_PRODUCTS.includes(pid) ? (raw) => enrichWithSheet(raw, { fipeHistory: true, fetchImpl: fipePublic }) : undefined, timeoutMs: 20000, normalize: normalizeBdrp });
      out = { result: r.normalized };
    } catch (e) { error = `${e.code ?? 'ERRO'}: ${e.detail ?? e.message}`; }
    const paid = f.paid();
    const entry = { pid, label: nameOf(pid, label), scn, paid: [...new Set(paid)], dup: paid.length - new Set(paid).size, error, ...entry0 };
    if (out?.result?.v2) {
      const scope = scopeForProduct(pid, new Date());
      const view = viewReport(out.result.v2, { audience: 'client', tier: tierForProductCode(pid), sections: scope.sections, template: scope.template });
      entry.sections = view.sections.map((s) => ({ key: s.key, label: s.label, items: s.items.filter((i) => i.state !== 'NOT_PROVIDED').map((i) => ({ label: i.label, state: i.state, display: String(i.display ?? i.value ?? '').slice(0, 90) })), missing: s.items.filter((i) => i.state === 'NOT_PROVIDED').map((i) => i.label) }));
      entry.verdict = `${view.verdict.level} - ${view.verdict.title}`;
      const buf = await renderVehiclePdf(view, { productName: entry.label, verificationCode: 'AUDITORIA', verificationUrl: 'https://placanamao.com.br/validar', consultedAt: new Date(), brandName: 'Placa na Mão' });
      entry.pdfBytes = buf.length;
      if (process.env.AUDIT_PDF_DIR) { fs.mkdirSync(process.env.AUDIT_PDF_DIR, { recursive: true }); fs.writeFileSync(path.join(process.env.AUDIT_PDF_DIR, `${pid.toLowerCase()}-${scn.replace(/\s+/g, '-')}.pdf`), buf); }
      try { const tmp = path.join(process.env.TMPDIR || '/tmp', `aud-${pid}-${scn.replace(/\s/g, '_')}.pdf`); fs.writeFileSync(tmp, buf); entry.pdfText = execFileSync('pdftotext', ['-layout', tmp, '-'], { encoding: 'utf8' }); fs.unlinkSync(tmp); } catch { entry.pdfText = ''; }
      const leaked = entry.pdfText.match(FORBIDDEN);
      if (leaked) problems.push(`${entry.label} (${scn}): o PDF cita "${leaked[0]}"`);
      const clientText = JSON.stringify(view);
      const leakedClient = clientText.match(/credify|anycar|bdrp/i);
      if (leakedClient) problems.push(`${entry.label} (${scn}): o relatório do cliente cita "${leakedClient[0]}"`);
      // O que o modelo do PDF promete (dados fictícios completos) e que a consulta não entregou nesta resposta.
      const promised = sampleViewFor(pid).sections.flatMap((s) => s.items.filter((i) => i.state !== 'NOT_PROVIDED').map((i) => `${s.key}/${i.key}`));
      const delivered = new Set(view.sections.flatMap((s) => s.items.filter((i) => i.state !== 'NOT_PROVIDED').map((i) => `${s.key}/${i.key}`)));
      entry.promisedCount = promised.length; entry.deliveredCount = delivered.size;
      entry.promisedMissing = promised.filter((k) => !delivered.has(k));
    }
    // Conferência do contrato: placa limpa tem de chamar tudo que é garantido e nada fora da lista.
    if (pid !== 'FIPE_FREE') {
      const allowed = allowedPaths(pid, []);
      const outside = entry.paid.filter((p) => !allowed.has(p));
      if (outside.length) problems.push(`${entry.label} (${scn}): chamou fora do contrato: ${outside.join(', ')}`);
      if (scn === 'placa limpa') { const missing = guaranteedPaths(pid).filter((p) => !entry.paid.includes(p)); if (missing.length) problems.push(`${entry.label}: não chamou o que é garantido: ${missing.join(', ')}`); }
    } else if (entry.paid.join() !== '/precificadorfipe') problems.push(`FIPE grátis chamou ${entry.paid.join(', ')}`);
    if (entry.dup) problems.push(`${entry.label} (${scn}): ${entry.dup} chamada(s) repetida(s) à mesma API`);
    if (error) problems.push(`${entry.label} (${scn}): falhou: ${error}`);
    rows.push(entry);
  }
}

const code = (p) => `${p} (${CREDIFY_CONSULTA_CODES[p] ?? '?'})`;
let md = '# Auditoria das consultas (sem custo)\n\n';
md += 'Gerado por `scripts/auditoria-consultas.mjs`. Usa o caminho real do sistema com respostas de exemplo no formato publicado pela Credify. **Nenhuma chamada real, nenhum custo.** Prova que o sistema chama as APIs certas e lê e mostra bem o formato documentado. Não prova o conteúdo real da Credify para uma placa real: isso só uma consulta real mostra.\n\n';
md += `## Resultado\n\n${problems.length ? problems.map((p) => `- ❌ ${p}`).join('\n') : '- ✅ Nenhum problema encontrado: contrato de APIs respeitado, sem chamada repetida, sem consulta falha, sem texto de fonte/custo no relatório nem no PDF.'}\n\n`;
const scns = Object.keys(SCENARIOS);
md += `## APIs chamadas por consulta\n\n| Consulta | ${scns.join(' | ')} |\n|---|${scns.map(() => '---').join('|')}|\n`;
for (const [pid] of PRODUCTS) md += `| ${rows.find((r) => r.pid === pid).label} | ${scns.map((n) => rows.find((r) => r.pid === pid && r.scn === n).paid.map(code).join('<br>')).join(' | ')} |\n`;
md += '\n- **placa limpa**: cadastro sem alertas; só as APIs obrigatórias.\n- **alienação sem detalhe no cadastro**: o cadastro indica financiamento mas não traz banco/contrato/data; as consultas que têm gravame no contrato buscam o detalhe.\n- **placa com ocorrências**: o cadastro acusa recall, furto/roubo, alienação (com banco e contrato) e restrição judicial; só então as APIs condicionais (recall, roubo/furto, Renajud) são chamadas.\n\n';
md += '## Modelo do PDF × entregue\n\n| Consulta | Cenário | Itens no modelo | Itens entregues | Prometidos que não vieram |\n|---|---|---|---|---|\n';
for (const r of rows) if (r.promisedCount != null) md += `| ${r.label} | ${r.scn} | ${r.promisedCount} | ${r.deliveredCount} | ${r.promisedMissing.length ? r.promisedMissing.join(', ') : '–'} |\n`;
md += '\n## O que cada consulta mostra ao cliente (placa com ocorrências)\n';
const fr = rows.find((x) => x.pid === 'FIPE_FREE' && x.fipe); if (fr) md += `\n### ${fr.label}\n\n${Object.entries(fr.fipe).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`;
for (const r of rows.filter((x) => x.scn === 'placa com ocorrências' && x.sections)) {
  md += `\n### ${r.label}\n\nParecer: ${r.verdict} · PDF: ${Math.round(r.pdfBytes / 1024)} KB\n\n`;
  for (const s of r.sections) { if (!s.items.length) continue; md += `**${s.label}**\n\n`; for (const i of s.items) md += `- ${i.label}: ${i.display || '–'} _(${i.state})_\n`; md += '\n'; }
}
const outFile = process.argv[2] || path.join(root, 'docs/AUDITORIA-CONSULTAS.md');
fs.writeFileSync(outFile, md);
console.log(md.split('## APIs chamadas')[0]);
console.log(`Relatório completo: ${outFile}`);
await pool.end();
process.exit(problems.length ? 1 : 0);
