import { createHash } from 'node:crypto';
import { redactPrivateFields } from './privacy.js';
const privateKey = /^(owner|ownername|ownerdocument|ownerdocumenttype|propriet|nomeproprietario|cpfcnpjproprietario|cpf|cnpj|document|address|endereco|street|logradouro|phone|telefone|email|chassi|chassis|renavam|engine|motor)$/i;
function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function safeColor(value, fallback) {
    return value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback;
}
function safeLogo(value) {
    return value && /^https?:\/\//i.test(value) ? value : '';
}
function valueAt(input, key) {
    const normalizedKey = key.trim();
    if (!normalizedKey || normalizedKey.split('.').some((part) => privateKey.test(part.replace(/[^A-Za-z0-9]/g, ''))))
        return undefined;
    return normalizedKey.split('.').reduce((current, part) => {
        if (!current || typeof current !== 'object' || Array.isArray(current))
            return undefined;
        return current[part];
    }, input);
}
function displayValue(value) {
    if (value === null || value === undefined || value === '')
        return 'Não informado';
    if (Array.isArray(value))
        return value.length ? value : 'Nenhum registro';
    if (typeof value === 'object')
        return value;
    return value;
}
function printableValue(value) {
    const safe = redactPrivateFields(displayValue(value));
    if (typeof safe === 'string' || typeof safe === 'number' || typeof safe === 'boolean')
        return String(safe);
    return JSON.stringify(safe);
}
export function defaultReportTemplate(productId, productName) {
    return {
        id: `default-${productId}`,
        productId,
        version: 1,
        name: `${productName} — relatório padrão`,
        status: 'PUBLISHED',
        title: productName,
        subtitle: 'Relatório veicular Placa na Mão',
        sections: [
            { key: 'identification', label: 'Identificação do veículo', order: 10, visible: true, fields: [
                    { key: 'identification.plate', label: 'Placa', visible: true },
                    { key: 'identification.brand', label: 'Marca', visible: true },
                    { key: 'identification.model', label: 'Modelo', visible: true },
                    { key: 'characteristics.modelYear', label: 'Ano do modelo', visible: true },
                    { key: 'characteristics.color', label: 'Cor', visible: true },
                    { key: 'characteristics.fuel', label: 'Combustível', visible: true }
                ] },
            { key: 'registration', label: 'Registro e situação', order: 15, visible: true, fields: [
                    { key: 'registration.city', label: 'Município', visible: true },
                    { key: 'registration.state', label: 'UF', visible: true },
                    { key: 'registration.status', label: 'Situação', visible: true },
                    { key: 'registration.licensingYear', label: 'Ano de licenciamento', visible: true }
                ] },
            { key: 'coverage', label: 'Cobertura da consulta', order: 20, visible: true, fields: [
                    { key: 'coverage', label: 'Cobertura', visible: true },
                    { key: 'debts', label: 'Débitos', visible: true },
                    { key: 'restrictions', label: 'Restrições', visible: true },
                    { key: 'recall', label: 'Recall', visible: true }
                ] }
        ]
    };
}
export function buildGenericReport(template, input, generatedAt = new Date().toISOString()) {
    const sections = [...template.sections]
        .filter((section) => section.visible !== false)
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map((section) => ({
        key: section.key,
        label: section.label,
        fields: section.fields.filter((field) => field.visible !== false && !privateKey.test(field.key.replace(/[^A-Za-z0-9]/g, ''))).map((field) => ({
            key: field.key,
            label: field.label,
            value: redactPrivateFields(displayValue(valueAt(input, field.key)))
        }))
    }));
    const content = JSON.stringify({ template: template.id, version: template.version, sections });
    return {
        schema: 'placanamao.generic.report.v1',
        template: { id: template.id, productId: template.productId, version: template.version, name: template.name },
        title: template.title || template.name,
        subtitle: template.subtitle || 'Relatório veicular Placa na Mão',
        generatedAt,
        validation: createHash('sha256').update(content).digest('hex'),
        sections
    };
}
export function reportPrintHtml(report, branding = {}) {
    const primary = safeColor(branding.primaryColor, '#168579');
    const accent = safeColor(branding.accentColor, '#C99A3D');
    const logoUrl = safeLogo(branding.logoUrl);
    const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" style="max-height:42px;max-width:220px;object-fit:contain;margin-bottom:8px">` : '';
    const sections = report.sections.map((section) => `<section><h2>${escapeHtml(section.label)}</h2><div class="grid">${section.fields.map((field) => `<div class="field"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(printableValue(field.value))}</strong></div>`).join('')}</div></section>`).join('');
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title><style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;color:#1f2937;line-height:1.45;max-width:760px;margin:0 auto}header{border-bottom:3px solid ${primary};padding-bottom:12px;margin-bottom:22px}h1{font-size:22px;margin:0;color:${primary}}h2{font-size:15px;margin-top:24px;color:${primary}}.muted{color:#6b7280;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.field{border:1px solid #e5e7eb;border-radius:6px;padding:9px;break-inside:avoid}.field span{display:block;color:#6b7280;font-size:11px}.field strong{display:block;margin-top:3px;font-size:13px;white-space:pre-wrap;word-break:break-word}.notice{background:#f0fdfa;border-left:4px solid ${accent};padding:12px}.print{margin:20px 0;padding:10px 16px;border:0;background:${primary};color:white;border-radius:6px}@media print{.print{display:none}}@media(max-width:560px){.grid{grid-template-columns:1fr}}</style></head><body><header>${logo}<h1>${escapeHtml(branding.name || 'Placa na Mão')} — ${escapeHtml(report.title)}</h1><div class="muted">${escapeHtml(report.subtitle)} · Template ${escapeHtml(report.template.version)} · Validação ${escapeHtml(report.validation)}</div></header>${sections}<p class="muted">Gerado em ${escapeHtml(new Date(report.generatedAt).toLocaleString('pt-BR'))}</p><div class="notice">Este relatório apresenta somente dados veiculares autorizados para a modalidade contratada. Dados pessoais do proprietário são omitidos.</div><button class="print" onclick="window.print()">Imprimir</button></body></html>`;
}
function pdfText(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll(/[^\x20-\x7E]/g, '').replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}
export function reportPdf(report, branding = {}) {
    const lines = [
        `${branding.name || 'Placa na Mão'} — ${report.title}`,
        report.subtitle,
        `Template ${report.template.version} · Validacao ${report.validation.slice(0, 24)}`,
        ''
    ];
    for (const section of report.sections) {
        lines.push(section.label.toUpperCase());
        for (const field of section.fields)
            lines.push(`${field.label}: ${printableValue(field.value)}`);
        lines.push('');
    }
    lines.push('Dados pessoais do proprietario sao omitidos deste relatorio.');
    const content = ['BT', '/F1 9 Tf', '50 780 Td', ...lines.flatMap((line) => [`(${pdfText(line).slice(0, 120)}) Tj`, '0 -16 Td']), 'ET'].join('\n');
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => { offsets[index + 1] = Buffer.byteLength(pdf, 'latin1'); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= objects.length; index += 1)
        pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, 'latin1');
}
