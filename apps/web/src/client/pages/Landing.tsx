import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../shared/icons';
import { LinkButton, Logo, usePageTitle } from '../../shared/ui';
import { HeroArt, PhoneFrame } from '../art';
import { PublicHeader } from '../layouts';
import { useSession } from '../session';
import { trackFunnel } from '../funnel';
import PlateSearch from '../components/PlateSearch';
import Pricing from '../components/Pricing';
import Faq from '../components/Faq';

const STRIP: Array<{ icon: IconName; t: string; s: string }> = [
  { icon: 'car', t: 'Dados cadastrais', s: 'do veículo, ano, cor e município' },
  { icon: 'dollar', t: 'Débitos e multas', s: 'IPVA, licenciamento, DPVAT e mais' },
  { icon: 'shield-alert', t: 'Restrições e gravames', s: 'roubo, furto e financiamento' },
  { icon: 'file-text', t: 'Relatório em PDF', s: 'para imprimir e compartilhar' }
];
const WHY: Array<{ icon: IconName; t: string; s: string }> = [
  { icon: 'file-text', t: 'Dados completos', s: 'Veículo, débitos, restrições e financiamento reunidos em um relatório.' },
  { icon: 'zap', t: '100% online', s: 'Digite a placa e receba o resultado em segundos, no celular ou no computador.' },
  { icon: 'shield-check', t: 'Fontes contratadas e atualizadas', s: 'Dados consultados na hora, com a data e a fonte registradas no relatório.' },
  { icon: 'printer', t: 'Relatórios detalhados', s: 'Resumo claro, alertas em destaque, PDF para imprimir e código de validação.' }
];

function SamplePhones() {
  return (
    <div className="phones" aria-label="Exemplo ilustrativo do relatório, com dados fictícios">
      <PhoneFrame className="sm">
        <div className="mini-plate"><div><b>ABC1D23</b><small className="muted" style={{ display: 'block' }}>VW / Exemplo 1.0 · 2020/2021</small></div><Icon name="shield-check" size={20} /></div>
        <div className="mini-verdict"><Icon name="shield-check" size={22} /><div><b>Sem alertas relevantes</b><span>Veículo sem pendências</span></div></div>
        {[['car', 'Dados cadastrais', 'Marca, modelo, ano e cor'], ['dollar', 'Débitos', 'Licenciamento, IPVA'], ['shield-alert', 'Restrições', 'Roubo, furto e outras'], ['credit-card', 'Financiamento', 'Gravame e contratos']].map(([i, t, s]) => (
          <div className="mini-row" key={t}><span className="mi"><Icon name={i as IconName} size={15} /></span><div><b>{t}</b><small>{s}</small></div></div>
        ))}
      </PhoneFrame>
      <PhoneFrame>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}><span>Relatório completo</span><Icon name="menu" size={16} /></div>
        <div className="mini-verdict"><Icon name="shield-check" size={22} /><div><b>Situação do veículo</b><span>Sem restrições</span></div></div>
        {[['dollar', 'Débitos pendentes', 'R$ 0,00'], ['receipt', 'Multas', 'R$ 0,00'], ['shield-alert', 'Restrições', 'Nada consta'], ['file-text', 'Gravame', 'Nada consta']].map(([i, t, s]) => (
          <div className="mini-row" key={t}><span className="mi"><Icon name={i as IconName} size={15} /></span><div><b>{t}</b><small>{s}</small></div></div>
        ))}
        <div className="mini-btn">Baixar relatório</div>
      </PhoneFrame>
    </div>
  );
}

export default function Landing() {
  usePageTitle('');
  const { status } = useSession();
  useEffect(() => { trackFunnel('HOME_PAGE_VIEW', { landing: '/' }); }, []);
  return (
    <>
      <PublicHeader overHero />
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-art" aria-hidden="true"><HeroArt /></div>
        <div className="container">
          <div className="hero-copy">
            <span className="kicker">Consulta veicular completa</span>
            <h1 id="hero-title">Tudo o que você precisa saber sobre o veículo, <span className="grad-text">em um só lugar.</span></h1>
            <p className="hero-lead">Dados cadastrais, débitos, multas, restrições e gravame. Consulte com rapidez, segurança e total clareza.</p>
            <PlateSearch authed={status === 'authed'} placement="hero" />
            <p className="hero-note">Sem mensalidade. Pague apenas pela consulta que fizer.</p>
          </div>
        </div>
        <div className="benefit-strip"><div className="container" style={{ display: 'contents' }}>
          {STRIP.map((s) => <div className="item" key={s.t}><span className="ib"><Icon name={s.icon} size={22} /></span><div><b>{s.t}</b><span className="s">{s.s}</span></div></div>)}
        </div></div>
      </section>

      <section className="section" id="consultas">
        <div className="container">
          <div className="section-head"><span className="eyebrow">Por que a Placa na Mão</span><h2>Por que consultar com a Placa na Mão?</h2><p>Mais segurança para você decidir, com a praticidade de uma consulta que cabe na palma da mão.</p></div>
          <div className="why-grid">{WHY.map((w) => <div className="why-card" key={w.t}><span className="wi"><Icon name={w.icon} size={24} /></span><h3>{w.t}</h3><p>{w.s}</p></div>)}</div>
        </div>
      </section>

      <section className="section alt">
        <div className="container showcase">
          <div>
            <span className="eyebrow">Resultado fácil de ler</span>
            <h2 style={{ fontSize: 'clamp(26px,3.6vw,40px)', marginTop: 10 }}>Um relatório que você entende em segundos.</h2>
            <p className="muted" style={{ marginTop: 14, fontSize: 17 }}>Um veredito claro no topo, valores em aberto em destaque e todos os detalhes organizados por seção — no celular ou impresso.</p>
            <ul className="checklist">
              {['Situação do veículo resumida em um só lugar', 'Débitos e multas com valores, sem somar em duplicidade', 'Campos que a fonte não retornou aparecem como “Não informado”', 'PDF com código de validação para compartilhar'].map((t) => <li key={t}><span className="ck"><Icon name="check" size={14} strokeWidth={3} /></span>{t}</li>)}
            </ul>
            <div className="row" style={{ marginTop: 26 }}><LinkButton to="/consultar" variant="primary" size="lg" iconRight="arrow-right">Fazer uma consulta</LinkButton></div>
            <span className="sample-tag">Imagens ilustrativas, com dados fictícios.</span>
          </div>
          <SamplePhones />
        </div>
      </section>

      <section className="section">
        <div className="container"><Pricing /></div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="api-block">
            <div>
              <span className="eyebrow">Para desenvolvedores</span>
              <h3 style={{ marginTop: 8 }}>API Placa na Mão</h3>
              <p style={{ fontWeight: 600, color: 'var(--text)' }}>Integre nossas consultas ao seu sistema.</p>
              <p>Gere uma chave, envie a placa e receba o relatório estruturado em JSON, com a mesma cobrança e os mesmos dados da plataforma.</p>
              <div className="api-checks">{['Documentação completa', 'Chaves com limite de uso', 'Resposta em JSON padronizado', 'Suporte técnico'].map((t) => <span key={t}><Icon name="check-circle" size={18} />{t}</span>)}</div>
              <LinkButton to="/desenvolvedores" variant="primary" iconRight="arrow-right">Saiba mais</LinkButton>
            </div>
            <pre className="code-box" aria-label="Exemplo de chamada da API"><code>{`curl -X POST https://placanamao.com.br/api/v1/vehicles \\
  -H "Authorization: Bearer pnm_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{ "plate": "ABC1D23", "product": "COMPLETE" }'

{
  "id": "9f1c…",
  "status": "SUCCESS",
  "result": { "v2": { "verdict": { "level": "CLEAR" } } }
}`}</code></pre>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <div className="section-head center"><span className="eyebrow">Dúvidas frequentes</span><h2>Transparência antes de cada consulta.</h2></div>
          <Faq />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="final-banner">
            <div className="art" aria-hidden="true"><HeroArt /></div>
            <div className="fb-logo"><Logo forceDark height={56} /></div>
            <div>
              <h2>Seu veículo em boas mãos.</h2>
              <p>Informação é poder. Consulte a placa agora e decida com segurança.</p>
              <div className="fb-cta"><LinkButton to="/consultar" variant="primary" size="lg" iconRight="arrow-right">Consultar agora</LinkButton><Link to="/fipe" className="btn btn-lg btn-outline-light">Ver FIPE grátis</Link></div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
