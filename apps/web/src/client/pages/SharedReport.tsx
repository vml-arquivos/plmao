import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, LinkButton, PageLoading, usePageTitle } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import ReportView from '../../shared/ReportView';
import type { ReportEnvelope } from '../../shared/reportTypes';
import { api } from '../api';

type Shared = ReportEnvelope & { shared: { expiresAt: string } };

/** Página pública do link enviado por quem consultou. Sem CPF nem dados do proprietário; não entra em buscadores. */
export default function SharedReport() {
  const { token = '' } = useParams();
  usePageTitle('Relatório do veículo');
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
  useEffect(() => {
    let alive = true;
    // O servidor conta cada abertura do link, então a leitura acontece uma única vez por visita.
    api.get<Shared>(`/shared-report/${encodeURIComponent(token)}`).then((d) => { if (alive) setData(d); }, (e) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [token]);

  async function pdf() {
    if (!data) return;
    setBusy(true);
    try { await api.download(`/shared-report/${encodeURIComponent(token)}/pdf`, `placa-na-mao-${data.verificationCode}.pdf`); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (error && !data) return (
    <section className="section"><div className="container stack-lg" style={{ maxWidth: 560 }}>
      <Alert tone="warn" title="Link indisponível.">{error}</Alert>
      <div><LinkButton to="/consultar" variant="primary" iconRight="arrow-right">Consultar uma placa</LinkButton></div>
    </div></section>
  );
  if (!data) return <PageLoading />;
  return (
    <section className="section"><div className="container stack">
      <Alert tone="info">Relatório compartilhado com você, válido até {dateTime(data.shared.expiresAt)}. Confira a autenticidade em <Link to={`/validar/${data.verificationCode}`}>validar relatório</Link>.</Alert>
      {error && <Alert tone="warn">{error}</Alert>}
      <ReportView
        report={data.report}
        consultedAt={data.consultedAt}
        productName={data.productName}
        verificationCode={data.verificationCode}
        actions={<Button variant="primary" icon="download" loading={busy} onClick={() => void pdf()}>Baixar PDF</Button>}
      />
      <div className="row no-print"><LinkButton to="/consultar" icon="search">Consultar outra placa</LinkButton></div>
    </div></section>
  );
}
