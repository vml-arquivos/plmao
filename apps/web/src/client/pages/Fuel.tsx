import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { EmptyState, Field, Input, LinkButton, PageLoading, Select, usePageTitle } from '../../shared/ui';
import { FuelCalc, kmlText, useEconomy, type EconomyItem } from '../guide';

/* ========================================================================== */
/*  /combustivel — etanol ou gasolina e custo mensal                            */
/* ========================================================================== */
const label = (e: EconomyItem) => `${e.brand} ${e.model} ${e.version}${e.yearModel ? ` ${e.yearModel}` : ''}`;
const num = (t: string): number | null => { const n = Number(t.trim().replace(',', '.')); return t.trim() && Number.isFinite(n) && n > 0 && n <= 60 ? n : null; };

export function FuelPage() {
  usePageTitle('Etanol ou gasolina? Quanto o seu carro gasta por mês');
  const { items, error } = useEconomy();
  const [pick, setPick] = useState('');
  const [gasKml, setGasKml] = useState('');
  const [ethKml, setEthKml] = useState('');
  const chosen = items?.find((e) => e.versionId === pick) ?? null;
  const brands = useMemo(() => [...new Set((items ?? []).map((e) => e.brand))].sort(), [items]);
  const manualG = num(gasKml); const manualE = num(ethKml);

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <span className="eyebrow">Combustível</span>
          <h1 style={{ maxWidth: '22ch' }}>Etanol ou gasolina? Descubra para o seu carro.</h1>
          <p className="lead">A regra dos 70% não vale para todo carro: o consumo de cada modelo muda o ponto de equilíbrio. Escolha o veículo, digite os preços do posto e veja o custo por mês.</p>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 8 }}>
        <div className="container fuel-page">
          <div className="card card-pad stack">
            <Field label="Veículo" hint="Consumo de ensaio (Inmetro ou ficha de referência do guia). Prefere usar o consumo que você mede no seu carro? Escolha “Digitar o consumo”.">
              <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Veículo">
                <option value="">Digitar o consumo manualmente</option>
                {brands.map((b) => <optgroup key={b} label={b}>{(items ?? []).filter((e) => e.brand === b).map((e) => <option key={e.versionId} value={e.versionId}>{label(e)}</option>)}</optgroup>)}
              </Select>
            </Field>
            {error && <p className="muted">Não foi possível carregar a lista de veículos agora. Você ainda pode digitar o consumo.</p>}
            {!items && !error && <PageLoading />}
            {!pick && (
              <div className="form-grid cols-2">
                <Field label="Consumo com gasolina (km/l)"><Input inputMode="decimal" value={gasKml} onChange={(e) => setGasKml(e.target.value.replace(/[^\d.,]/g, '').slice(0, 5))} placeholder="ex.: 12,5" /></Field>
                <Field label="Consumo com etanol (km/l)"><Input inputMode="decimal" value={ethKml} onChange={(e) => setEthKml(e.target.value.replace(/[^\d.,]/g, '').slice(0, 5))} placeholder="ex.: 8,6" /></Field>
              </div>
            )}
          </div>

          {chosen ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                <b>{label(chosen)}</b>: {[chosen.cityGasKml != null && `gasolina ${kmlText(chosen.cityGasKml)} cidade / ${chosen.roadGasKml != null ? kmlText(chosen.roadGasKml) : '—'} estrada`, chosen.cityEthKml != null && `etanol ${kmlText(chosen.cityEthKml)} / ${chosen.roadEthKml != null ? kmlText(chosen.roadEthKml) : '—'}`, chosen.cityDieselKml != null && `diesel ${kmlText(chosen.cityDieselKml)} / ${chosen.roadDieselKml != null ? kmlText(chosen.roadDieselKml) : '—'}`].filter(Boolean).join(' · ')} km/l.
                {' '}{chosen.official ? 'Conferido com a tabela do Inmetro.' : 'Valor da ficha de referência do guia.'} <Link to={`/veiculos/${chosen.slug}?versao=${chosen.versionId}`}>Ver ficha</Link>
              </p>
              <FuelCalc
                key={chosen.versionId} title="Custo por mês"
                gas={chosen.cityGasKml != null || chosen.roadGasKml != null ? { city: chosen.cityGasKml, road: chosen.roadGasKml } : undefined}
                eth={chosen.cityEthKml != null || chosen.roadEthKml != null ? { city: chosen.cityEthKml, road: chosen.roadEthKml } : undefined}
                diesel={chosen.cityDieselKml != null || chosen.roadDieselKml != null ? { city: chosen.cityDieselKml, road: chosen.roadDieselKml } : undefined}
              />
            </>
          ) : manualG != null || manualE != null ? (
            <FuelCalc key="manual" title="Custo por mês" gas={manualG != null ? { city: manualG, road: manualG } : undefined} eth={manualE != null ? { city: manualE, road: manualE } : undefined} />
          ) : (
            <EmptyState icon="car" title="Escolha um veículo ou digite o consumo">Com o consumo em mãos, a conta de etanol contra gasolina aparece aqui.</EmptyState>
          )}

          <div className="card card-pad guide-cta">
            <div><h3>Quer ver os mais econômicos?</h3><p className="muted">O ranking mostra o consumo de cada versão com a fonte à vista.</p></div>
            <div className="row"><LinkButton to="/veiculos/mais-economicos" variant="primary" iconRight="arrow-right">Ranking de consumo</LinkButton><LinkButton to="/veiculos">Guia de veículos</LinkButton></div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ========================================================================== */
/*  /veiculos/mais-economicos — ranking                                         */
/* ========================================================================== */
type Fuel = 'gas' | 'eth' | 'diesel';
type Cycle = 'city' | 'road';
const FIELD: Record<Fuel, Record<Cycle, keyof EconomyItem>> = {
  gas: { city: 'cityGasKml', road: 'roadGasKml' },
  eth: { city: 'cityEthKml', road: 'roadEthKml' },
  diesel: { city: 'cityDieselKml', road: 'roadDieselKml' }
};

export function EconomyPage() {
  usePageTitle('Carros mais econômicos: ranking de consumo por versão');
  const { items, error } = useEconomy();
  const [fuel, setFuel] = useState<Fuel>('gas');
  const [cycle, setCycle] = useState<Cycle>('city');
  const [body, setBody] = useState('');
  const bodies = useMemo(() => [...new Set((items ?? []).map((e) => e.bodyType).filter(Boolean) as string[])].sort(), [items]);
  const rows = useMemo(() => {
    const key = FIELD[fuel][cycle];
    return (items ?? []).filter((e) => (!body || e.bodyType === body) && typeof e[key] === 'number').sort((a, b) => (b[key] as number) - (a[key] as number));
  }, [items, fuel, cycle, body]);
  const key = FIELD[fuel][cycle];
  const max = rows.length ? (rows[0]![key] as number) : 1;

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <Link to="/veiculos" className="back-link"><Icon name="arrow-left" size={16} /> Guia de veículos</Link>
          <h1 style={{ maxWidth: '24ch' }}>Carros mais econômicos, por versão.</h1>
          <p className="lead">Ranking do guia pelo consumo de ensaio, em km/l. Cada linha mostra se o número foi conferido com a tabela oficial do Inmetro ou vem da ficha de referência do modelo.</p>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 8 }}>
        <div className="container stack-lg">
          <div className="card card-pad stack">
            <div className="guide-filters econ-filters">
              <Select value={fuel} onChange={(e) => setFuel(e.target.value as Fuel)} aria-label="Combustível"><option value="gas">Gasolina</option><option value="eth">Etanol</option><option value="diesel">Diesel</option></Select>
              <Select value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)} aria-label="Ciclo"><option value="city">Cidade</option><option value="road">Estrada</option></Select>
              <Select value={body} onChange={(e) => setBody(e.target.value)} aria-label="Carroceria"><option value="">Todas as carrocerias</option>{bodies.map((b) => <option key={b} value={b}>{b}</option>)}</Select>
            </div>
          </div>
          {!items && !error && <PageLoading />}
          {error && <EmptyState icon="alert-triangle" title="Não foi possível carregar o ranking">Tente novamente em instantes.</EmptyState>}
          {items && !rows.length && <EmptyState icon="car" title="Nenhuma versão com esse consumo">Troque o combustível, o ciclo ou a carroceria.</EmptyState>}
          {rows.length > 0 && (
            <div className="card card-pad stack">
              <div className="table-scroll">
                <table className="obs-table econ-table">
                  <thead><tr><th>#</th><th>Veículo</th><th>km/l</th><th>Fonte</th></tr></thead>
                  <tbody>
                    {rows.map((e, i) => (
                      <tr key={e.versionId}>
                        <td className="muted">{i + 1}</td>
                        <td><Link to={`/veiculos/${e.slug}?versao=${e.versionId}`}><b>{e.brand} {e.model}</b></Link><div className="muted obs-src">{e.version}{e.yearModel ? ` · ${e.yearModel}` : ''}{e.bodyType ? ` · ${e.bodyType}` : ''}</div></td>
                        <td><span className="kml-cell wide"><b>{kmlText(e[key] as number)}</b><i className="kml-bar" style={{ width: `${((e[key] as number) / max) * 100}%` }} aria-hidden="true" /></span></td>
                        <td>{e.official ? <span className="src-tag inmetro">Inmetro</span> : <span className="src-tag outra">Ficha de referência</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>O ranking cobre só os veículos que já estão no guia, não o mercado inteiro. “Inmetro” = número conferido com a tabela PBE Veicular; “Ficha de referência” = valor da ficha do modelo, ainda sem conferência com a tabela oficial. Híbridos e flex podem ter ciclos diferentes: compare sempre o mesmo combustível. O consumo real depende de trânsito, carga e condução.</p>
            </div>
          )}
          <div className="card card-pad guide-cta">
            <div><h3>Quanto isso custa por mês?</h3><p className="muted">Digite o preço do posto e veja o gasto mensal e se etanol ou gasolina compensa.</p></div>
            <div className="row"><LinkButton to="/combustivel" variant="primary" iconRight="arrow-right">Calcular o custo</LinkButton><LinkButton to="/comparar">Comparar versões</LinkButton></div>
          </div>
        </div>
      </section>
    </>
  );
}
