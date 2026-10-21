import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../shared/icons';
import { LinkButton, Logo, usePageTitle } from '../../shared/ui';
import { HeroArt, PhoneFrame } from '../art';
import { PublicHeader } from '../layouts';
import { useSession } from '../session';
import { trackFunnel } from '../funnel';
import PlateSearch from '../components/PlateSearch';
import { PackageCards, ProductCards, SmartPicker } from '../components/Catalog';
import Faq from '../components/Faq';
import Testimonials from '../components/Testimonials';
import { LatestPosts } from './Content';
import { HomeGuide, HomeSimulator } from '../components/HomeTools';

const STRIP: Array<{ icon: IconName; t: string; s: string }> = [
  { icon: 'car', t: 'Dados do veículo', s: 'marca, modelo, ano, cor e município' },
  { icon: 'dollar', t: 'Débitos e multas', s: 'IPVA, licenciamento e mais' },
  { icon: 'shield-alert', t: 'Restrições e gravame', s: 'roubo, furto e financiamento' },
  { icon: 'file-text', t: 'Relatório em PDF', s: 'para guardar e compartilhar' }
];
const STEPS = [
  { t: 'Digite a placa', s: 'Aceita placa antiga e Mercosul. Sem cadastro de documentos.' },
  { t: 'Escolha a consulta', s: 'Do essencial à checagem completa. O preço aparece antes de pagar.' },
  { t: 'Receba o relatório', s: 'Resumo claro no topo, detalhes por seção e PDF com código de validação.' }
];
const WHY: Array<{ icon: IconName; t: string; s: string }> = [
  { icon: 'file-text', t: 'Dados reunidos', s: 'Veículo, débitos, restrições e financiamento em um só relatório.' },
  { icon: 'zap', t: '100% online', s: 'Resultado em segundos, no celular ou no computador.' },
  { icon: 'shield-check', t: 'Transparência', s: 'Data e fonte registradas. O que a fonte não retornar aparece como “Não informado”.' },
  { icon: 'lock', t: 'Privacidade', s: 'Dados pessoais protegidos conforme a LGPD, sempre mascarados.' }
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
            <h1 id="hero-title">Conheça a história do carro <span className="grad-text">antes de decidir.</span></h1>
            <p className="hero-lead">Dados do veículo, débitos, multas, restrições e gravame em um relatório fácil de ler. Sem mensalidade: você paga só pela consulta que fizer.</p>
            <PlateSearch authed={status === 'authed'} placement="hero" />
            <div className="trust-row"><span><Icon name="shield-check" size={16} />Pagamento seguro</span><span><Icon name="zap" size={16} />Resultado em segundos</span><span><Icon name="printer" size={16} />PDF para imprimir</span></div>
          </div>
        </div>
        <div className="benefit-strip"><div className="container" style={{ display: 'contents' }}>
          {STRIP.map((s) => <div className="item" key={s.t}><span className="ib"><Icon name={s.icon} size={22} /></span><div><b>{s.t}</b><span className="s">{s.s}</span></div></div>)}
        </div></div>
      </section>

      <HomeGuide />
      <HomeSimulator />

      <section className="section" id="como-funciona">
        <div className="container">
          <div className="section-head"><span className="eyebrow">Como funciona</span><h2>Três passos, menos de um minuto.</h2></div>
          <div className="steps">{STEPS.map((s) => <div className="step" key={s.t}><h3>{s.t}</h3><p>{s.s}</p></div>)}</div>
        </div>
      </section>

      <section className="section alt" id="consultas">
        <div className="container stack-lg">
          <div className="section-head" style={{ marginBottom: 0 }}><span className="eyebrow">Consultas</span><h2>Escolha o nível de segurança que você precisa.</h2><p>Cada consulta mostra exatamente o que entrega. O valor final aparece antes do pagamento.</p></div>
          <ProductCards homeOnly />
          <SmartPicker />
          <div className="row"><LinkButton to="/planos" iconRight="arrow-right">Comparar todas as consultas</LinkButton></div>
        </div>
      </section>

      <section className="section">
        <div className="container showcase">
          <div>
            <span className="eyebrow">Resultado fácil de ler</span>
            <h2 style={{ fontSize: 'clamp(26px,3.6vw,40px)', marginTop: 10 }}>Um relatório que você entende em segundos.</h2>
            <p className="muted" style={{ marginTop: 14, fontSize: 17 }}>Veredito claro no topo, valores em aberto em destaque e todos os detalhes organizados por seção, no celular ou impresso.</p>
            <ul className="checklist">
              {['Situação do veículo resumida em um só lugar', 'Débitos e multas com valores, sem somar em duplicidade', 'Campos que a fonte não retornou aparecem como “Não informado”', 'PDF com código de validação para compartilhar'].map((t) => <li key={t}><span className="ck"><Icon name="check" size={14} /></span>{t}</li>)}
            </ul>
            <div className="row" style={{ marginTop: 26 }}><LinkButton to="/consultar" variant="primary" size="lg" iconRight="arrow-right">Fazer uma consulta</LinkButton></div>
            <span className="sample-tag">Imagens ilustrativas, com dados fictícios.</span>
          </div>
          <SamplePhones />
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <div className="section-head center"><span className="eyebrow">Por que a Placa na Mão</span><h2>Clareza para decidir com tranquilidade.</h2></div>
          <div className="why-grid">{WHY.map((w) => <div className="why-card" key={w.t}><span className="wi"><Icon name={w.icon} size={24} /></span><h3>{w.t}</h3><p>{w.s}</p></div>)}</div>
        </div>
      </section>

      <section className="section" id="pacotes">
        <div className="container stack-lg">
          <div className="section-head" style={{ marginBottom: 0 }}><span className="eyebrow">Pacotes de saldo</span><h2>Consulte mais e pague menos por consulta.</h2><p>Recarregue o saldo uma vez e use em qualquer consulta. Sem mensalidade e sem validade curta.</p></div>
          <PackageCards />
        </div>
      </section>

      <section className="section alt" id="blog">
        <div className="container stack-lg">
          <div className="row-between"><div className="section-head" style={{ marginBottom: 0 }}><span className="eyebrow">Blog</span><h2>Guias para comprar e vender com segurança.</h2></div><LinkButton to="/blog" iconRight="arrow-right">Ver todos</LinkButton></div>
          <LatestPosts n={3} />
        </div>
      </section>

      <Testimonials />

      <section className="section" id="duvidas">
        <div className="container">
          <div className="section-head center"><span className="eyebrow">Dúvidas frequentes</span><h2>Transparência antes de cada consulta.</h2></div>
          <Faq limit={6} />
          <div className="row" style={{ justifyContent: 'center', marginTop: 22 }}><Link to="/perguntas-frequentes" className="btn">Ver todas as perguntas</Link></div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="final-banner">
            <div className="art" aria-hidden="true"><HeroArt /></div>
            <div className="fb-logo"><Logo forceDark height={56} /></div>
            <div>
              <h2>Seu próximo carro merece uma checagem.</h2>
              <p>Consulte a placa agora e decida com segurança.</p>
              <div className="fb-cta"><LinkButton to="/consultar" variant="primary" size="lg" iconRight="arrow-right">Consultar agora</LinkButton><Link to="/fipe" className="btn btn-lg btn-outline-light">Ver FIPE grátis</Link></div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
