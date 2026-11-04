import { Icon } from './icons';
import { money } from './format';
import type { VehicleSheet } from './reportTypes';
import './report.css';

const pct = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2).replace('.', ',')}%`);
const tone = (n: number | null | undefined) => (n == null || n === 0 ? '' : n > 0 ? 'rv-up' : 'rv-down');

function Rows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return <dl className="rv-grid">{rows.map((r) => <div key={r.label} className="rv-item info"><dt>{r.label}</dt><dd><span>{r.value}</span></dd></div>)}</dl>;
}

export interface FreeDetails { plate?: string; brand?: string; model?: string; fullModel?: string; manufactureYear?: string; modelYear?: string; color?: string; fuel?: string; power?: string; displacement?: string; type?: string; species?: string; category?: string; body?: string; passengers?: string; loadCapacity?: string; origin?: string; city?: string; state?: string; chassis?: string; engine?: string }
const clean = (v: string | undefined) => (v && v.trim() && !/^(n[ãa]o informado|0)$/i.test(v.trim()) ? v.trim() : '');

/** Identificação e características do veículo na consulta gratuita por placa (chassi e motor completos, sem máscara). */
export function FreeIdentity({ details }: { details: FreeDetails }) {
  const ident = [['Placa', details.plate], ['Marca', details.brand], ['Modelo', details.fullModel || details.model], ['Ano de fabricação', details.manufactureYear], ['Ano do modelo', details.modelYear], ['Cor', details.color], ['Chassi', details.chassis], ['Motor (número)', details.engine], ['Município/UF', [details.city, details.state].filter(Boolean).join('/')]] as Array<[string, string | undefined]>;
  const chars = [['Combustível', details.fuel], ['Tipo', details.type], ['Espécie', details.species], ['Categoria', details.category], ['Carroceria', details.body], ['Passageiros', details.passengers], ['Cilindradas', details.displacement], ['Potência', details.power], ['Capacidade de carga', details.loadCapacity], ['Procedência', details.origin]] as Array<[string, string | undefined]>;
  const rows = (list: Array<[string, string | undefined]>) => list.map(([label, value]) => ({ label, value: clean(value) })).filter((r) => r.value);
  const a = rows(ident); const b = rows(chars);
  if (!a.length && !b.length) return null;
  return (
    <section className="card rv-card">
      {a.length > 0 && <><h3><Icon name="car" size={20} /> Identificação</h3><Rows rows={a} /></>}
      {b.length > 0 && <><h3 style={{ marginTop: 14 }}><Icon name="wrench" size={20} /> Características</h3><Rows rows={b} /></>}
    </section>
  );
}

/** Ficha gratuita do veículo: decodificador do chassi, Tabela FIPE (por ano e 24 meses), financiamento e ficha técnica do guia. */
export default function SheetView({ sheet }: { sheet: VehicleSheet }) {
  const f = sheet.fipe;
  const fin = sheet.financing;
  const simHref = fin ? `/simulador?v=${fin.vehicleCents}&e=${fin.downPaymentCents}&m=${fin.months}&mod=CDC` : '';
  return (
    <div className="rv-sheet">
      {sheet.decoder.length > 0 && (
        <section className="card rv-card">
          <h3><Icon name="car" size={20} /> Decodificador do chassi e do modelo</h3>
          <Rows rows={sheet.decoder} />
        </section>
      )}
      {f && (
        <section className="card rv-card">
          <h3><Icon name="dollar" size={20} /> Tabela FIPE</h3>
          <p className="muted" style={{ margin: '0 0 8px' }}>{f.model ? `${f.model} · ` : ''}código {f.code}{f.referenceLabel ? ` · referência ${f.referenceLabel}` : ''}</p>
          <p className="rv-fipe-now"><span className="muted">Valor atual</span> <b className="num">{money(f.currentCents)}</b></p>
          {f.annual.length > 0 && (
            <details open>
              <summary>Valor por ano</summary>
              <div className="rv-table-wrap"><table className="rv-table"><thead><tr><th>Ano</th><th>Valor</th><th>Variação sobre o ano anterior</th></tr></thead>
                <tbody>{f.annual.map((a) => <tr key={a.year}><td data-label="Ano">{a.year}</td><td data-label="Valor" className="num">{money(a.cents)}</td><td data-label="Variação" className={tone(a.pct)}>{pct(a.pct)}</td></tr>)}</tbody></table></div>
            </details>
          )}
          {f.monthly.length > 0 && (
            <details>
              <summary>Histórico dos últimos {f.monthly.length} meses</summary>
              <div className="rv-table-wrap"><table className="rv-table"><thead><tr><th>Mês</th><th>Valor</th><th>% mês anterior</th><th>% no período</th></tr></thead>
                <tbody>{f.monthly.map((m) => <tr key={m.label}><td data-label="Mês">{m.label}</td><td data-label="Valor" className="num">{money(m.cents)}</td><td data-label="% mês anterior" className={tone(m.pctMonth)}>{pct(m.pctMonth)}</td><td data-label="% no período" className={tone(m.pctPeriod)}>{pct(m.pctPeriod)}</td></tr>)}</tbody></table></div>
            </details>
          )}
        </section>
      )}
      {fin && (
        <section className="card rv-card">
          <h3><Icon name="credit-card" size={20} /> Financie</h3>
          <p className="rv-fin"><span>Entrada de {money(fin.downPaymentCents)} +</span> <b className="num">{fin.months} × {money(fin.installmentCents)}</b></p>
          <small className="muted">Simulação estimada com taxa média de mercado. A proposta real depende da análise do banco.</small>
          <p style={{ margin: '10px 0 0' }}><a className="btn" href={simHref}>Simular com outros valores</a></p>
        </section>
      )}
      {sheet.specs && (
        <section className="card rv-card">
          <h3><Icon name="wrench" size={20} /> Ficha técnica</h3>
          <p className="muted" style={{ margin: '0 0 8px' }}>{sheet.specs.title} · do nosso guia de veículos</p>
          <Rows rows={sheet.specs.rows} />
        </section>
      )}
    </div>
  );
}
