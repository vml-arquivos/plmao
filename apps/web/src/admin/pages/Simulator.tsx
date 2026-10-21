import { useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Switch, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, money, num } from '../../shared/format';
import { Card, Kpi, PageHead } from '../parts';

interface Settings {
  rates: { cdcPf: number; cdcPj: number; leasingPf: number | null; leasingPj: number };
  referenceMonth: string; source: string; autoRefresh: boolean; refreshedAt: string | null; refreshError: string | null;
  fees: { cadastroCents: number; avaliacaoCents: number; registroCents: number };
  iof: { pfDailyPct: number; pjDailyPct: number; additionalPct: number; capDays: number };
  updatedAt: string;
}
interface Sim {
  id: string; code: string; modality: string; vehicleKind: string; personType: string; vehicleValueCents: number; downPaymentCents: number; months: number;
  monthlyRatePct: number; installmentCents: number; totalPaidCents: number; cetAnnualPct: number | null; createdAt: string; customer: { id: string; name: string; email: string } | null;
}
interface BankRate { pct: number; source: 'manual' | 'bcb'; institution: string | null; period: string | null }
interface Bank {
  id: string; name: string; bcbMatch: string; cdcPfPct: number | null; cdcPjPct: number | null; leasingPjPct: number | null;
  fees: { cadastroCents: number | null; avaliacaoCents: number | null; registroCents: number | null }; notes: string; active: boolean; displayOrder: number;
  current: { cdcPf: BankRate | null; cdcPj: BankRate | null; leasingPj: BankRate | null };
}
interface BanksResponse { items: Bank[]; bcb: { institutions: number; refreshedAt: string | null; error: string | null } }
interface SimList { stats: { total: number; last30: number; volume30Cents: number }; items: Sim[] }

const KIND: Record<string, string> = { CAR: 'Carro', MOTORCYCLE: 'Moto', TRUCK: 'Caminhão', UTILITY: 'Utilitário' };
const MODALITY: Record<string, string> = { CDC: 'CDC', LEASING: 'Leasing', BOTH: 'CDC e leasing' };
const toStr = (n: number | null | undefined, d = 2) => (n == null ? '' : n.toFixed(d).replace('.', ','));
const toNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const monthLabel = (m: string) => { const [y, mo] = m.split('-'); return `${mo}/${y}`; };

export default function Simulator() {
  usePageTitle('Simulador de financiamento');
  const toast = useToast();
  const settings = useAsync(() => api.get<{ settings: Settings }>('/admin/simulator/settings'));
  const sims = useAsync(() => api.get<SimList>('/admin/simulator/simulations?limit=50'));
  const banks = useAsync(() => api.get<BanksResponse>('/admin/simulator/banks'));
  const [editBank, setEditBank] = useState<Bank | 'new' | null>(null);
  const [delBank, setDelBank] = useState<Bank | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = (s: Settings) => {
    setAuto(s.autoRefresh);
    setF({
      cdcPf: toStr(s.rates.cdcPf), cdcPj: toStr(s.rates.cdcPj), leasingPj: toStr(s.rates.leasingPj), leasingPf: toStr(s.rates.leasingPf),
      cadastro: toStr(s.fees.cadastroCents / 100), avaliacao: toStr(s.fees.avaliacaoCents / 100), registro: toStr(s.fees.registroCents / 100),
      iofPf: toStr(s.iof.pfDailyPct, 4), iofPj: toStr(s.iof.pjDailyPct, 4), iofAdd: toStr(s.iof.additionalPct), iofCap: String(s.iof.capDays)
    });
  };
  useEffect(() => { if (settings.data) load(settings.data.settings); }, [settings.data]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    const body = {
      cdcPf: toNum(f.cdcPf), cdcPj: toNum(f.cdcPj), leasingPj: toNum(f.leasingPj),
      leasingPf: f.leasingPf.trim() ? toNum(f.leasingPf) : null,
      autoRefresh: auto,
      fees: { cadastroCents: Math.round(toNum(f.cadastro) * 100), avaliacaoCents: Math.round(toNum(f.avaliacao) * 100), registroCents: Math.round(toNum(f.registro) * 100) },
      iof: { pfDailyPct: toNum(f.iofPf), pjDailyPct: toNum(f.iofPj), additionalPct: toNum(f.iofAdd), capDays: Math.round(toNum(f.iofCap)) }
    };
    const values = [body.cdcPf, body.cdcPj, body.leasingPj, ...Object.values(body.fees), body.iof.pfDailyPct, body.iof.pjDailyPct, body.iof.additionalPct, body.iof.capDays];
    if (values.some((v) => !Number.isFinite(v)) || (body.leasingPf !== null && !Number.isFinite(body.leasingPf))) { toast.error('Confira os números: use apenas dígitos e vírgula.'); return; }
    setBusy(true);
    try { await api.put('/admin/simulator/settings', body); toast.ok('Configurações salvas. O simulador já usa os novos valores.'); settings.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  async function refresh() {
    setRefreshing(true);
    try { await api.post('/admin/simulator/refresh'); toast.ok('Taxas atualizadas pelo Banco Central.'); } catch (e) { toast.error(errorMessage(e)); } finally { settings.reload(); banks.reload(); setRefreshing(false); }
  }

  if (settings.loading && !settings.data) return <PageLoading />;
  if (settings.error || !settings.data) return <ErrorState error={settings.error} onRetry={settings.reload} />;
  const s = settings.data.settings;

  return (
    <>
      <PageHead title="Simulador de financiamento" sub="Taxas, tarifas e IOF usados na simulação pública. Quando a atualização automática está ligada, as taxas seguem a média do Banco Central." actions={<Button icon="refresh" loading={refreshing} onClick={() => void refresh()}>Atualizar pelo Banco Central</Button>} />

      <div className="adm-grid-4">
        <Kpi label="Simulações com PDF" value={num(sims.data?.stats.total ?? 0)} sub="desde o início" />
        <Kpi label="Últimos 30 dias" value={num(sims.data?.stats.last30 ?? 0)} sub="PDFs gerados" />
        <Kpi label="Volume simulado (30 dias)" value={money(sims.data?.stats.volume30Cents ?? 0)} sub="valor financiado" />
        <Kpi label="Taxas de referência" value={monthLabel(s.referenceMonth)} sub={s.source} tone={s.refreshError ? 'warn' : undefined} />
      </div>

      {s.refreshError && <Alert tone="warn" icon="alert-triangle" title="Atualização pelo Banco Central falhou">Motivo: {s.refreshError}. O simulador continua usando as últimas taxas salvas.</Alert>}

      <div className="stack">
        <Card title="Taxas médias de juros (% ao mês)" actions={<Badge tone={s.autoRefresh ? 'ok' : 'neutral'} dot>{s.autoRefresh ? 'Atualização automática' : 'Manual'}</Badge>}>
          <div className="stack">
            <div className="form-grid">
              <Field label="CDC, pessoa física"><Input inputMode="decimal" value={f.cdcPf ?? ''} onChange={set('cdcPf')} /></Field>
              <Field label="CDC, empresa"><Input inputMode="decimal" value={f.cdcPj ?? ''} onChange={set('cdcPj')} /></Field>
              <Field label="Leasing, empresa"><Input inputMode="decimal" value={f.leasingPj ?? ''} onChange={set('leasingPj')} /></Field>
              <Field label="Leasing, pessoa física" hint="Vazio usa a taxa de leasing de empresa, com aviso ao cliente."><Input inputMode="decimal" value={f.leasingPf ?? ''} onChange={set('leasingPf')} /></Field>
            </div>
            <Switch checked={auto} onChange={(e) => setAuto(e.target.checked)} label="Atualizar automaticamente pelo Banco Central (a cada 24 horas)" />
            <p className="muted small">Fonte: séries SGS 25471, 25447, 25450 e 25474 do Banco Central (taxa média, recursos livres). {s.refreshedAt ? `Última atualização automática: ${dateTime(s.refreshedAt)}.` : 'Ainda sem atualização automática.'} Ao salvar uma taxa manualmente, a fonte passa a aparecer como "Informado pela equipe".</p>
          </div>
        </Card>

        <Card title="Tarifas de referência (R$)">
          <div className="stack">
            <div className="form-grid">
              <Field label="Cadastro"><Input inputMode="decimal" value={f.cadastro ?? ''} onChange={set('cadastro')} /></Field>
              <Field label="Avaliação do bem" hint="Só para veículo usado."><Input inputMode="decimal" value={f.avaliacao ?? ''} onChange={set('avaliacao')} /></Field>
              <Field label="Registro do contrato / gravame" hint="Só no CDC."><Input inputMode="decimal" value={f.registro ?? ''} onChange={set('registro')} /></Field>
            </div>
            <p className="muted small">São valores de referência: cada banco e cada estado cobram de um jeito. O cliente pode ajustar na tela do simulador.</p>
          </div>
        </Card>

        <Card title="IOF">
          <div className="stack">
            <div className="form-grid">
              <Field label="Pessoa física (% ao dia)"><Input inputMode="decimal" value={f.iofPf ?? ''} onChange={set('iofPf')} /></Field>
              <Field label="Empresa (% ao dia)"><Input inputMode="decimal" value={f.iofPj ?? ''} onChange={set('iofPj')} /></Field>
              <Field label="Adicional (%)"><Input inputMode="decimal" value={f.iofAdd ?? ''} onChange={set('iofAdd')} /></Field>
              <Field label="Limite de dias"><Input inputMode="numeric" value={f.iofCap ?? ''} onChange={set('iofCap')} /></Field>
            </div>
            <p className="muted small">Padrão da legislação: pessoa física 0,0082% ao dia, empresa 0,0041% ao dia, adicional de 0,38% e limite de 365 dias. Só altere se a regra mudar.</p>
          </div>
        </Card>
      </div>

      <div className="row" style={{ margin: '4px 0 24px' }}>
        <Button variant="primary" loading={busy} onClick={() => void save()}>Salvar configurações</Button>
        <Button variant="ghost" onClick={() => load(s)}>Desfazer alterações</Button>
      </div>

      <Card title="Bancos e taxas por banco" actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setEditBank('new')}>Novo banco</Button>} pad={false}>
        <div className="body" style={{ paddingBottom: 8 }}>
          <p className="muted small" style={{ margin: 0 }}>
            O simulador compara estes bancos. A taxa de cada um é a que você informar aqui (por exemplo, a de uma tabela divulgada pelo banco) ou, se ficar em branco, a <b>taxa média da instituição no Banco Central</b>, achada pelo "nome no Banco Central". Tarifas em branco usam as de referência. Bancos sem nenhuma taxa não aparecem para o cliente.
          </p>
          {banks.data && (
            <p className="muted small" style={{ margin: '8px 0 0' }}>
              Banco Central: {banks.data.bcb.institutions} instituições com taxa registrada{banks.data.bcb.refreshedAt ? `, atualizado em ${dateTime(banks.data.bcb.refreshedAt)}` : ' (ainda sem atualização)'}.
            </p>
          )}
          {banks.data?.bcb.error && <Alert tone="warn" icon="alert-triangle" title="Não foi possível ler as taxas por banco no Banco Central">Motivo: {banks.data.bcb.error}. Os bancos seguem com as últimas taxas guardadas ou com as que você informou.</Alert>}
        </div>
        {banks.loading && !banks.data ? <PageLoading /> : banks.error ? <ErrorState error={banks.error} onRetry={banks.reload} /> : !banks.data?.items.length ? <EmptyState icon="wallet" title="Nenhum banco cadastrado" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Banco</th><th>Nome no Banco Central</th><th className="r">CDC pessoa física</th><th className="r">CDC empresa</th><th className="r">Leasing empresa</th><th>Tarifas próprias</th><th>Status</th><th /></tr></thead><tbody>
            {banks.data.items.map((b) => (
              <tr key={b.id}>
                <td><b>{b.name}</b>{b.notes && <div className="muted small">{b.notes}</div>}</td>
                <td className="mono">{b.bcbMatch || '—'}</td>
                <td className="r"><RateCell r={b.current.cdcPf} /></td>
                <td className="r"><RateCell r={b.current.cdcPj} /></td>
                <td className="r"><RateCell r={b.current.leasingPj} /></td>
                <td>{b.fees.cadastroCents != null || b.fees.avaliacaoCents != null || b.fees.registroCents != null ? 'Sim' : 'Padrão'}</td>
                <td><Badge tone={b.active ? 'ok' : 'neutral'} dot>{b.active ? 'Ativo' : 'Inativo'}</Badge></td>
                <td className="actions"><Button size="sm" variant="ghost" onClick={() => setEditBank(b)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => setDelBank(b)}>Remover</Button></td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      {editBank && <BankModal bank={editBank === 'new' ? null : editBank} onClose={(changed) => { setEditBank(null); if (changed) banks.reload(); }} />}
      {delBank && <ConfirmDialog title="Remover banco" message={<p>Remover <b>{delBank.name}</b> da comparação? Simulações já geradas não mudam.</p>} confirmLabel="Remover" danger onConfirm={async () => { try { await api.del(`/admin/simulator/banks/${delBank.id}`); toast.ok('Banco removido.'); banks.reload(); } catch (e) { toast.error(errorMessage(e)); } }} onClose={() => setDelBank(null)} />}

      <Card title="Simulações recentes" pad={false}>
        {sims.loading && !sims.data ? <PageLoading /> : sims.error ? <ErrorState error={sims.error} onRetry={sims.reload} /> : !sims.data?.items.length ? <EmptyState icon="calculator" title="Nenhum PDF de simulação gerado ainda" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Código</th><th>Cliente</th><th>Veículo</th><th>Modalidade</th><th className="r">Financiado</th><th className="r">Parcela</th><th className="r">Taxa a.m.</th><th>Data</th></tr></thead><tbody>
            {sims.data.items.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}><b className="mono">{r.code}</b></td>
                <td>{r.customer ? <><div>{r.customer.name}</div><div className="muted small">{r.customer.email}</div></> : '—'}</td>
                <td>{KIND[r.vehicleKind] ?? r.vehicleKind} · {money(r.vehicleValueCents)}</td>
                <td>{MODALITY[r.modality] ?? r.modality} · {r.months}x · {r.personType}</td>
                <td className="r num">{money(r.vehicleValueCents - r.downPaymentCents)}</td>
                <td className="r num">{money(r.installmentCents)}</td>
                <td className="r num">{toStr(r.monthlyRatePct)}%</td>
                <td>{dateTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
    </>
  );
}

function RateCell({ r }: { r: BankRate | null }) {
  if (!r) return <span className="muted">sem taxa</span>;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }} title={r.source === 'bcb' ? `Média no Banco Central${r.institution ? `: ${r.institution}` : ''}${r.period ? ` (período iniciado em ${r.period})` : ''}` : 'Informada pela equipe'}>
      <b className="num">{toStr(r.pct)}%</b> <Badge tone={r.source === 'manual' ? 'info' : 'neutral'}>{r.source === 'manual' ? 'informada' : 'Banco Central'}</Badge>
    </span>
  );
}

const centsToStr = (c: number | null) => (c == null ? '' : toStr(c / 100));

function BankModal({ bank, onClose }: { bank: Bank | null; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: bank?.name ?? '', bcbMatch: bank?.bcbMatch ?? '', notes: bank?.notes ?? '',
    cdcPf: toStr(bank?.cdcPfPct), cdcPj: toStr(bank?.cdcPjPct), leasingPj: toStr(bank?.leasingPjPct),
    cadastro: centsToStr(bank?.fees.cadastroCents ?? null), avaliacao: centsToStr(bank?.fees.avaliacaoCents ?? null), registro: centsToStr(bank?.fees.registroCents ?? null)
  });
  const [active, setActive] = useState(bank?.active ?? true);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const rate = (v: string) => (v.trim() ? toNum(v) : null);
  const fee = (v: string) => (v.trim() ? Math.round(toNum(v) * 100) : null);
  async function save() {
    const body = {
      name: f.name.trim(), bcbMatch: f.bcbMatch.trim(), notes: f.notes.trim(), active,
      cdcPfPct: rate(f.cdcPf), cdcPjPct: rate(f.cdcPj), leasingPjPct: rate(f.leasingPj),
      feeCadastroCents: fee(f.cadastro), feeAvaliacaoCents: fee(f.avaliacao), feeRegistroCents: fee(f.registro)
    };
    const nums = [body.cdcPfPct, body.cdcPjPct, body.leasingPjPct, body.feeCadastroCents, body.feeAvaliacaoCents, body.feeRegistroCents].filter((v) => v !== null) as number[];
    if (nums.some((v) => !Number.isFinite(v))) { toast.error('Confira os números: use apenas dígitos e vírgula.'); return; }
    setBusy(true);
    try {
      if (bank) await api.put(`/admin/simulator/banks/${bank.id}`, body); else await api.post('/admin/simulator/banks', body);
      toast.ok('Banco salvo.'); onClose(true);
    } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title={bank ? `Editar ${bank.name}` : 'Novo banco'} onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={f.name.trim().length < 2} onClick={() => void save()}>Salvar</Button></>}>
      <div className="stack">
        <Field label="Nome do banco (aparece para o cliente)"><Input value={f.name} onChange={set('name')} maxLength={60} /></Field>
        <Field label="Nome no Banco Central" hint="Palavras que aparecem no nome da instituição, por exemplo: BRADESCO, ITAU ou DO BRASIL. Serve para buscar a taxa média dele automaticamente."><Input value={f.bcbMatch} onChange={set('bcbMatch')} maxLength={80} /></Field>
        <p className="muted small" style={{ margin: 0 }}>Taxas ao mês, em branco = usar a média do Banco Central.</p>
        <div className="form-grid">
          <Field label="CDC, pessoa física (%)"><Input inputMode="decimal" value={f.cdcPf} onChange={set('cdcPf')} /></Field>
          <Field label="CDC, empresa (%)"><Input inputMode="decimal" value={f.cdcPj} onChange={set('cdcPj')} /></Field>
          <Field label="Leasing, empresa (%)"><Input inputMode="decimal" value={f.leasingPj} onChange={set('leasingPj')} /></Field>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Tarifas do banco em reais, em branco = usar as de referência. Digite 0 se o banco não cobra.</p>
        <div className="form-grid">
          <Field label="Cadastro (R$)"><Input inputMode="decimal" value={f.cadastro} onChange={set('cadastro')} /></Field>
          <Field label="Avaliação do bem (R$)"><Input inputMode="decimal" value={f.avaliacao} onChange={set('avaliacao')} /></Field>
          <Field label="Registro / gravame (R$)"><Input inputMode="decimal" value={f.registro} onChange={set('registro')} /></Field>
        </div>
        <Field label="Observação interna" hint="Ex.: fonte da taxa e data (tabela do banco de 10/2026)."><Input value={f.notes} onChange={set('notes')} maxLength={300} /></Field>
        <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Mostrar no simulador" />
      </div>
    </Modal>
  );
}
