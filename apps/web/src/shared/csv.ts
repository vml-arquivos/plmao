/** CSV em português (separador ponto e vírgula, com BOM) para abrir direto no Excel. */
export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    // Evita que o Excel trate texto como fórmula.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}

export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
