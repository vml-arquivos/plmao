import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, Input } from '../shared/ui';
import { api } from './api';
import { fabYears, fleetLong, logInterest, snapshotLabel, type CatalogHit, type CatalogSearch } from './guide';

/**
 * Escolha do veículo no simulador: digita marca/modelo e escolhe na lista da frota brasileira (Senatran).
 * O campo continua livre: quem não achar pode digitar o nome do jeito que quiser.
 * Ao escolher, registramos só qual veículo foi (sem dados pessoais) para saber o que as pessoas procuram.
 */
export function VehiclePicker({ value, onChange }: { value: string; onChange: (label: string) => void }) {
  const listId = useId();
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [picked, setPicked] = useState<CatalogHit | null>(null);
  const [typed, setTyped] = useState(false);
  const [searched, setSearched] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (!typed || q.length < 2) { setHits([]); setSearched(''); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.get<CatalogSearch>('/vehicles/catalog/search', { query: { q, limit: 8 } }).then((r) => {
        if (!alive) return;
        setHits(r.items); setSearched(q); setActive(-1); if (r.snapshot) setSnapshot(r.snapshot.id);
      }, () => { if (alive) { setHits([]); setSearched(q); } });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [value, typed]);

  // Busca sem resultado, parada por um tempo: anotamos o termo (sem placa, e-mail ou número longo) para ampliar o catálogo.
  useEffect(() => {
    const q = value.trim();
    if (!typed || q.length < 3 || searched !== q || hits.length) return;
    const t = setTimeout(() => logInterest({ type: 'SEARCH_NO_RESULT', term: q }), 1500);
    return () => clearTimeout(t);
  }, [value, typed, searched, hits.length]);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const choose = (h: CatalogHit) => {
    onChange(h.name.slice(0, 80)); setPicked(h); setTyped(false); setOpen(false); setHits([]);
    logInterest({ type: 'SIMULATOR_PICK', catalogId: h.id });
  };
  const showList = open && typed && value.trim().length >= 2;

  return (
    <Field label="Qual veículo você quer financiar?" hint="Opcional. Digite a marca ou o modelo e escolha na lista, ou escreva do seu jeito. O nome aparece no PDF.">
      <div className="vpicker" ref={box}>
        <Input
          icon="search" value={value} maxLength={80} placeholder="Ex.: Onix, Gol, Civic, CG 160…" autoComplete="off"
          role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onFocus={() => setOpen(true)}
          onChange={(e) => { onChange(e.target.value); setTyped(true); setPicked(null); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % hits.length); }
            else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); setActive((i) => (i <= 0 ? hits.length - 1 : i - 1)); }
            else if (e.key === 'Enter' && showList && active >= 0 && hits[active]) { e.preventDefault(); choose(hits[active]!); }
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {showList && (
          <ul id={listId} className="vpicker-list" role="listbox" aria-label="Veículos encontrados">
            {hits.map((h, i) => (
              <li key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); choose(h); }} onMouseEnter={() => setActive(i)}>
                <b>{h.name}</b>
                <small>{fleetLong(h.fleet)} na frota · fabricados {fabYears(h.yearMin, h.yearMax)}{h.guide ? ' · tem ficha no guia' : ''}</small>
              </li>
            ))}
            {!hits.length && searched === value.trim() && <li className="empty" role="presentation">Não achamos esse nome na frota. Pode usar o texto que digitou.</li>}
            {snapshot && hits.length > 0 && <li className="foot" role="presentation">Frota do Senatran, {snapshotLabel(snapshot)}. Nomes como o órgão cadastra.</li>}
          </ul>
        )}
      </div>
      {picked && (
        <p className="vpicker-picked">
          <b>{fleetLong(picked.fleet)}</b> {picked.fleet === 1 ? 'veículo' : 'veículos'} com esse nome na frota, fabricados {fabYears(picked.yearMin, picked.yearMax)}.{' '}
          <Link to={picked.guide ? `/veiculos/${picked.guide.slug}` : `/veiculos/frota/${picked.id}`}>{picked.guide ? 'Ver a ficha no guia' : 'Ver detalhes'}</Link>
        </p>
      )}
    </Field>
  );
}
