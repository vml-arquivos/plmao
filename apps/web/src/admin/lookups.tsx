import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { errorMessage } from '../shared/api';

/**
 * Preenchimento automático por CNPJ e por CEP no painel. As buscas passam pelo servidor (nunca direto do navegador) e o que volta
 * é só um pré-preenchimento: a pessoa revisa e edita antes de salvar. Ao abrir um cadastro já existente nada é buscado de novo.
 */
export interface CepAddress { street: string | null; district: string | null; city: string | null; state: string | null }
export interface CnpjFound {
  cnpj: string; legalName: string | null; tradeName: string | null; situation: string | null;
  address: { zip: string | null; street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null };
}
export interface LookupStatus { text: string; tone: 'info' | 'ok' | 'warn' }

const digitsOf = (v: string) => v.replace(/\D/g, '');

/** Confere os dígitos verificadores do CNPJ, para só chamar a fonte quando o número pode ser real. */
export function cnpjLooksValid(value: string): boolean {
  const d = digitsOf(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0; let weight = len - 7;
    for (let i = 0; i < len; i++) { sum += Number(d[i]) * weight--; if (weight < 2) weight = 9; }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Busca o endereço quando o CEP chega a 8 números. `mark` avisa que um CEP já foi preenchido por outra busca (CNPJ). */
export function useCepAutofill(zip: string, apply: (a: CepAddress) => void): { status: LookupStatus | null; busy: boolean; mark: (zip: string) => void } {
  const last = useRef(digitsOf(zip));
  const cb = useRef(apply); cb.current = apply;
  const [status, setStatus] = useState<LookupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = digitsOf(zip);
    if (d.length !== 8) { if (d.length < 8) setStatus(null); return undefined; }
    if (last.current === d) return undefined;
    last.current = d;
    let alive = true;
    setBusy(true); setStatus({ text: 'Buscando o endereço do CEP…', tone: 'info' });
    api.get<{ data: CepAddress; source: string }>(`/admin/cep/${d}`)
      .then((r) => { if (!alive) return; cb.current(r.data); setStatus({ text: `Endereço preenchido pelo CEP (${r.source}). Confira o número e o complemento.`, tone: 'ok' }); })
      .catch((e) => { if (alive) setStatus({ text: errorMessage(e), tone: 'warn' }); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [zip]);
  return { status, busy, mark: (z: string) => { last.current = digitsOf(z); } };
}

/** Busca os dados da empresa quando o CNPJ completa 14 números válidos. `run` repete a busca sob demanda (botão). */
export function useCnpjAutofill(doc: string, apply: (c: CnpjFound, meta: { source: string; fetchedAt: string }) => void): { status: LookupStatus | null; busy: boolean; run: () => void } {
  const last = useRef(digitsOf(doc));
  const cb = useRef(apply); cb.current = apply;
  const [status, setStatus] = useState<LookupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const fetchNow = (d: string, alive: () => boolean) => {
    setBusy(true); setStatus({ text: 'Buscando os dados da empresa na Receita…', tone: 'info' });
    api.get<{ data: CnpjFound; source: string; fetchedAt: string }>(`/admin/cnpj/${d}`)
      .then((r) => {
        if (!alive()) return;
        cb.current(r.data, { source: r.source, fetchedAt: r.fetchedAt });
        const sit = r.data.situation && !/ativa/i.test(r.data.situation) ? ` Situação cadastral: ${r.data.situation}.` : '';
        setStatus({ text: `Dados da empresa preenchidos (${r.source}). Revise antes de salvar.${sit}`, tone: sit ? 'warn' : 'ok' });
      })
      .catch((e) => { if (alive()) setStatus({ text: errorMessage(e), tone: 'warn' }); })
      .finally(() => { if (alive()) setBusy(false); });
  };
  useEffect(() => {
    const d = digitsOf(doc);
    if (d.length < 14) { if (d.length < 11) setStatus(null); return undefined; }
    if (d.length !== 14 || last.current === d || !cnpjLooksValid(d)) return undefined;
    last.current = d;
    let alive = true;
    fetchNow(d, () => alive);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  return { status, busy, run: () => { const d = digitsOf(doc); if (cnpjLooksValid(d)) { last.current = d; fetchNow(d, () => true); } } };
}

/** Linha de aviso sob o campo: o que a busca fez ou por que não preencheu. */
export function LookupNote({ status }: { status: LookupStatus | null }) {
  if (!status) return null;
  const color = status.tone === 'warn' ? 'var(--warn-ink)' : status.tone === 'ok' ? 'var(--ok-ink)' : 'var(--muted)';
  return <small role="status" style={{ color, display: 'block', marginTop: 4 }}>{status.text}</small>;
}
