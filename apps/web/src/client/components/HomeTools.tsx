import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../../shared/icons';
import { LinkButton, Skeleton } from '../../shared/ui';
import { api } from '../api';
import { ModelCard, type GuideCard } from '../guide';
import { SimulatorWidget } from '../pages/Simulator';

const SIM_POINTS: Array<{ icon: IconName; t: string }> = [
  { icon: 'percent', t: 'Taxa média de mercado do Banco Central, ou a taxa da sua proposta' },
  { icon: 'receipt', t: 'IOF e tarifas incluídos, com o CET calculado' },
  { icon: 'bar-chart', t: 'CDC e leasing lado a lado, para carro, moto, caminhão e utilitário' },
  { icon: 'file-text', t: 'PDF completo com todas as parcelas para levar ao banco' }
];

/** Simulador de financiamento resumido na página inicial. */
export function HomeSimulator() {
  return (
    <section className="section home-sim" id="simulador">
      <div className="container home-split">
        <div className="home-split-copy">
          <span className="eyebrow">Simulador de financiamento</span>
          <h2>Quanto custa financiar o seu veículo? Veja antes de ir ao banco.</h2>
          <p className="muted">Simule CDC ou leasing com a taxa média de mercado, IOF e tarifas, e descubra a parcela, o CET e o custo total. Funciona para carro, moto, caminhão e qualquer outro veículo.</p>
          <ul className="checklist">{SIM_POINTS.map((p) => <li key={p.t}><Icon name="check-circle" size={20} />{p.t}</li>)}</ul>
          <div className="row" style={{ marginTop: 22 }}>
            <LinkButton to="/simulador" variant="primary" iconRight="arrow-right">Abrir o simulador completo</LinkButton>
            <LinkButton to="/simulador/caminhao" icon="truck">Financiar caminhão</LinkButton>
          </div>
        </div>
        <SimulatorWidget />
      </div>
    </section>
  );
}

const GUIDE_POINTS: Array<{ icon: IconName; t: string; s: string }> = [
  { icon: 'list', t: 'Ficha técnica completa', s: 'Motor, consumo, dimensões, segurança e equipamentos por versão.' },
  { icon: 'star', t: 'Notas de quem tem o carro', s: 'Conforto, consumo, confiabilidade e custo de manutenção, com opiniões de donos.' },
  { icon: 'bar-chart', t: 'Compare dois ou três veículos', s: 'Lado a lado, com o melhor de cada quesito destacado.' },
  { icon: 'wrench', t: 'Dicas e cuidados', s: 'O que olhar antes de comprar e como evitar gastos desnecessários.' }
];

/** Vitrine do guia de veículos: busca por modelo, pontos fortes e modelos em destaque. */
export function HomeGuide() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<GuideCard[] | null>(null);
  useEffect(() => { api.get<{ items: GuideCard[] }>('/vehicles', { query: { sort: 'rating', limit: 3 } }).then((r) => setItems(r.items), () => setItems([])); }, []);
  const submit = (e: FormEvent) => { e.preventDefault(); nav(q.trim() ? `/veiculos?q=${encodeURIComponent(q.trim())}` : '/veiculos'); };
  return (
    <section className="section alt home-guide" id="guia">
      <div className="container stack-lg">
        <div className="home-split">
          <div className="home-split-copy">
            <span className="eyebrow">Guia de veículos</span>
            <h2>Pesquise o carro, veja a ficha técnica e compare antes de comprar.</h2>
            <p className="muted">Busque pelo modelo (ou pela placa), veja as informações técnicas, a nota de quem tem e compare com outro veículo, de acordo com dados reais. Crie sua conta grátis para ver tudo.</p>
            <form className="home-guide-search" onSubmit={submit} role="search" aria-label="Buscar veículo no guia">
              <Icon name="search" size={20} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: Onix, Hilux, CG 160…" aria-label="Modelo do veículo" maxLength={60} />
              <button type="submit" className="btn btn-primary">Pesquisar</button>
            </form>
            <div className="row" style={{ marginTop: 16 }}>
              <LinkButton to="/comparar" icon="bar-chart">Comparar veículos</LinkButton>
              <Link to="/veiculos" className="link-btn">Ver todo o guia →</Link>
            </div>
          </div>
          <div className="home-guide-points">
            {GUIDE_POINTS.map((p) => <div className="why-card" key={p.t}><span className="wi"><Icon name={p.icon} size={22} /></span><h3>{p.t}</h3><p>{p.s}</p></div>)}
          </div>
        </div>
        {items === null && <div className="guide-grid"><Skeleton h={300} r={20} /><Skeleton h={300} r={20} /><Skeleton h={300} r={20} /></div>}
        {items && items.length > 0 && (
          <div className="stack">
            <div className="between"><h3>Modelos em destaque</h3><Link to="/veiculos" className="link-btn">Ver todos →</Link></div>
            <div className="guide-grid">{items.map((m) => <ModelCard key={m.slug} m={m} />)}</div>
          </div>
        )}
      </div>
    </section>
  );
}
