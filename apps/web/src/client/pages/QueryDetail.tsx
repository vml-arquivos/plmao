import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, ErrorState, Field, Input, LinkButton, Modal, PageLoading, PlateBadge, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { ApiError, errorMessage } from '../../shared/api';
import { dateTime, money } from '../../shared/format';
import ReportView from '../../shared/ReportView';
import type { ReportEnvelope } from '../../shared/reportTypes';
import { api } from '../api';
import { STATUS, type QuerySummary } from '../components/QueryRow';

interface FipeQuote { documentCode: string; consultedAt: string; referenceMonth: string; brand: { name: string }; model: { name: string }; year: { name: string }; fuel?: string; fipeCode: string; valueLabel: string; blocks: Array<{ key: string; label: string; message: string }> }
type Detail = QuerySummary & { result?: QuerySummary['result'] & { fipe?: FipeQuote } };

function DisputeModal({ queryId, onClose }: { queryId: string; onClose: () => void }) {
  const toast = useToast();
  const [field, setField] = useState(''); const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function send() {
    setBusy(true); setError('');
    try { await api.post(`/queries/${queryId}/report/dispute`, { field, message }); toast.ok('Recebemos. A equipe vai conferir e responder por e-mail.'); onClose(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Informar dado incorreto" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void send()}>Enviar</Button></>}>
      <div className="stack">
        <Field label="Qual campo (opcional)"><Input value={field} onChange={(e) => setField(e.target.value)} maxLength={80} placeholder="Ex.: Cor, ano, débitos" /></Field>
        <Field label="O que parece errado"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={800} rows={4} placeholder="Descreva o dado e o que você encontrou." /></Field>
        {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
      </div>
    </Modal>
  );
}

export default function QueryDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [dispute, setDispute] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  usePageTitle('Relatório');
  const runningRef = useRef(false);
  const { data, error, loading, reload } = useAsync(async () => {
    // Resumo e relatório juntos (uma ida ao servidor só); se a consulta ainda não concluiu, o relatório responde 404/409 e é ignorado.
    const wasRunning = runningRef.current;
    const [summary, report] = await Promise.allSettled([api.get<Detail>(`/queries/${id}`), wasRunning ? Promise.reject(new ApiError(409, 'QUERY_IN_PROGRESS', 'Consulta em andamento.', {})) : api.get<ReportEnvelope>(`/queries/${id}/report`)]);
    runningRef.current = summary.status === 'fulfilled' && summary.value.status === 'PROCESSING';
    // Se estava em andamento e concluiu, busca o relatório agora.
    if (wasRunning && summary.status === 'fulfilled' && summary.value.status === 'SUCCESS' && summary.value.productId !== 'FIPE_FREE') {
      try { return { summary: summary.value, envelope: await api.get<ReportEnvelope>(`/queries/${id}/report`) }; }
      catch (e) { if (e instanceof ApiError && (e.status === 404 || e.status === 409)) return { summary: summary.value, envelope: null }; throw e; }
    }
    if (summary.status === 'rejected') throw summary.reason;
    if (summary.value.status !== 'SUCCESS' || summary.value.productId === 'FIPE_FREE') return { summary: summary.value, envelope: null as ReportEnvelope | null };
    if (report.status === 'fulfilled') return { summary: summary.value, envelope: report.value };
    const e = report.reason;
    if (e instanceof ApiError && (e.status === 404 || e.status === 409)) return { summary: summary.value, envelope: null };
    throw e;
  }, [id]);

  async function cancelQuery() {
    setCancelBusy(true);
    try { await api.post(`/queries/${id}/cancel`, {}); toast.ok('Consulta cancelada.'); reload(); }
    catch (e) { toast.error(errorMessage(e)); reload(); } finally { setCancelBusy(false); }
  }

  // Consulta em andamento (a fonte pode levar um ou dois minutos): a tela se atualiza sozinha até concluir.
  const processing = data?.summary.status === 'PROCESSING';
  const reloadRef = useRef(reload); reloadRef.current = reload;
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => reloadRef.current(), 2000);
    return () => clearInterval(t);
  }, [processing]);

  if (loading && !data) return <PageLoading />;
  if (error != null) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const { summary, envelope } = data;

  async function pdf(path: string, name: string) {
    setPdfBusy(true);
    try { await api.download(path, name); } catch (e) { toast.error(errorMessage(e)); } finally { setPdfBusy(false); }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); toast.ok('Link copiado!'); } catch { toast.error('Não foi possível copiar.'); } }

  const back = <Link to="/app/historico" className="muted no-print" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 14 }}><Icon name="arrow-left" size={16} /> Consultas</Link>;

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
          <Button variant="ghost" icon="car" onClick={() => void api.post('/garage/vehicles', { plate: summary.plate, modelLabel: [report.headline.brand, report.headline.model].filter(Boolean).join(' ').slice(0, 80), modelYear: Number(report.headline.modelYear) || null }).then(() => { toast.ok('Guardado na sua garagem.'); nav('/app/garagem'); }, (e) => { if (e instanceof ApiError && e.status === 409) { toast.ok('Já está na sua garagem.'); nav('/app/garagem'); } else toast.error(errorMessage(e)); })}>Guardar na garagem</Button>
          <Button variant="ghost" icon="alert-triangle" onClick={() => setDispute(true)}>Informar dado incorreto</Button>
        </div>
        {dispute && <DisputeModal queryId={id} onClose={() => setDispute(false)} />}
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
        {summary.status === 'PROCESSING' && <Alert tone="info" title="Consulta em processamento.">Estamos buscando nas bases. Pode levar até um ou dois minutos e esta tela atualiza sozinha. Se preferir, cancele: o valor volta na hora.<span className="row" style={{ marginTop: 8, gap: 8 }}><button className="btn btn-sm" onClick={reload}>Atualizar</button><Button size="sm" variant="ghost" loading={cancelBusy} onClick={() => void cancelQuery()}>Cancelar consulta</Button></span></Alert>}
        {summary.status === 'FAILED' && <Alert tone="danger" title="Não foi possível concluir esta consulta.">{summary.failureMessage ?? 'Se houve cobrança, o valor foi estornado automaticamente. Você pode tentar novamente.'}</Alert>}
        {summary.status === 'REFUNDED' && <Alert tone="warn" title="Consulta estornada.">{summary.failureMessage ?? 'Se você pagou com o saldo, o valor voltou para ele. Se pagou direto (Pix ou cartão), sua consulta paga continua disponível no topo de Nova consulta. Você pode tentar de novo quando quiser.'}</Alert>}
        {summary.status === 'SUCCESS' && <Alert tone="warn" title="Relatório indisponível.">Este relatório não pôde ser exibido. Fale com o suporte informando o código {summary.verificationCode}.</Alert>}
        <div className="row"><Button variant="primary" onClick={() => nav(`/app/consultar?placa=${summary.plate}`)} icon="refresh">Tentar novamente</Button></div>
      </section>
    </div>
  );
}
