import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, ErrorState, LinkButton, PageLoading, PlateBadge, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { ApiError, errorMessage } from '../../shared/api';
import { dateTime, money } from '../../shared/format';
import ReportView from '../../shared/ReportView';
import type { ReportEnvelope } from '../../shared/reportTypes';
import { api } from '../api';
import { STATUS, type QuerySummary } from '../components/QueryRow';

interface FipeQuote { documentCode: string; consultedAt: string; referenceMonth: string; brand: { name: string }; model: { name: string }; year: { name: string }; fuel?: string; fipeCode: string; valueLabel: string; blocks: Array<{ key: string; label: string; message: string }> }
type Detail = QuerySummary & { result?: QuerySummary['result'] & { fipe?: FipeQuote } };

export default function QueryDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [pdfBusy, setPdfBusy] = useState(false);
  usePageTitle('Relatório');
  const { data, error, loading, reload } = useAsync(async () => {
    const summary = await api.get<Detail>(`/queries/${id}`);
    if (summary.status !== 'SUCCESS' || summary.productId === 'FIPE_FREE') return { summary, envelope: null as ReportEnvelope | null };
    try { return { summary, envelope: await api.get<ReportEnvelope>(`/queries/${id}/report`) }; }
    catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 409)) return { summary, envelope: null }; throw e; }
  }, [id]);

  if (loading && !data) return <PageLoading />;
  if (error != null) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const { summary, envelope } = data;

  async function pdf(path: string, name: string) {
    setPdfBusy(true);
    try { await api.download(path, name); } catch (e) { toast.error(errorMessage(e)); } finally { setPdfBusy(false); }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); toast.ok('Link copiado!'); } catch { toast.error('Não foi possível copiar.'); } }

  const back = <Link to="/app/historico" className="muted no-print" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 14 }}><Icon name="arrow-left" size={16} /> Histórico</Link>;

  if (envelope) {
    const { report } = envelope;
    return (
      <div>
        {back}
        <ReportView
          report={report}
          consultedAt={envelope.consultedAt}
          productName={envelope.productName}
          verificationCode={envelope.verificationCode}
          actions={<>
            <Button variant="primary" icon="download" loading={pdfBusy} onClick={() => pdf(`/queries/${id}/report/pdf`, `placa-na-mao-${envelope.verificationCode}.pdf`)}>Baixar PDF</Button>
            <Button icon="printer" onClick={() => window.print()}>Imprimir</Button>
            <Button icon="link" onClick={() => copy(envelope.verificationUrl)}>Link de validação</Button>
          </>}
          upsell={<div className="row-between"><span><b>Há pontos de atenção fora do seu plano.</b> A consulta completa mostra todos os detalhes.</span><LinkButton to={`/app/consultar?placa=${summary.plate}&produto=COMPLETE`} variant="primary" size="sm" iconRight="arrow-right">Consulta completa</LinkButton></div>}
        />
        <div className="row no-print" style={{ marginTop: 22 }}>
          <LinkButton to={`/app/consultar?placa=${summary.plate}`} icon="refresh">Consultar de novo</LinkButton>
          <LinkButton to="/app/consultar" variant="ghost" icon="search">Outra placa</LinkButton>
        </div>
      </div>
    );
  }

  const fipe = summary.result?.fipe;
  if (summary.status === 'SUCCESS' && fipe) {
    return (
      <div className="stack-lg">
        {back}
        <section className="card card-pad fipe-result">
          <div className="row"><PlateBadge plate={summary.plate} size="lg" /><div><h2>{fipe.brand.name} {fipe.model.name}</h2><p className="muted">{fipe.year.name}{fipe.fuel ? ` · ${fipe.fuel}` : ''} · Código FIPE {fipe.fipeCode}</p></div></div>
          <div><span className="muted">Valor médio · {fipe.referenceMonth}</span><div className="fipe-value num">{fipe.valueLabel}</div></div>
          <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{fipe.blocks.map((b) => <li key={b.key} className="alert"><Icon name="info" /><div><b>{b.label}.</b> {b.message}</div></li>)}</ul>
          <div className="row"><Button variant="primary" icon="download" loading={pdfBusy} onClick={() => pdf(`/fipe/reports/${fipe.documentCode}/pdf`, `placa-na-mao-fipe-${fipe.documentCode}.pdf`)}>Baixar PDF</Button><LinkButton to={`/app/consultar?placa=${summary.plate}&produto=COMPLETE`} iconRight="arrow-right">Fazer consulta completa</LinkButton></div>
        </section>
      </div>
    );
  }

  const st = STATUS[summary.status] ?? { tone: 'info' as const, label: summary.status };
  return (
    <div className="stack-lg">
      {back}
      <section className="card card-pad stack">
        <div className="row"><PlateBadge plate={summary.plate} size="lg" /><div><h2>{summary.productName}</h2><p className="muted">{dateTime(summary.createdAt)} · {summary.priceCents > 0 ? money(summary.priceCents) : 'Grátis'}</p></div><Badge tone={st.tone} dot>{st.label}</Badge></div>
        {summary.status === 'PROCESSING' && <Alert tone="info" title="Consulta em processamento.">Isso costuma levar poucos segundos. <button className="btn btn-sm" onClick={reload}>Atualizar</button></Alert>}
        {summary.status === 'FAILED' && <Alert tone="danger" title="Não foi possível concluir esta consulta.">Se houve cobrança, o valor foi estornado automaticamente. Você pode tentar novamente.</Alert>}
        {summary.status === 'REFUNDED' && <Alert tone="warn" title="Consulta estornada.">O valor voltou para o seu saldo. Você pode tentar novamente quando quiser.</Alert>}
        {summary.status === 'SUCCESS' && <Alert tone="warn" title="Relatório indisponível.">Este relatório não pôde ser exibido. Fale com o suporte informando o código {summary.verificationCode}.</Alert>}
        <div className="row"><Button variant="primary" onClick={() => nav(`/app/consultar?placa=${summary.plate}`)} icon="refresh">Tentar novamente</Button></div>
      </section>
    </div>
  );
}
