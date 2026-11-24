import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { isValidPlate, normalizePlate } from '../../shared/format';
import { trackFunnel } from '../funnel';
import { useFreeOffers } from './Catalog';

/**
 * Uma placa, dois caminhos: o botão grande leva à FIPE grátis com os dados essenciais do veículo;
 * o segundo leva à consulta paga. Sem a FIPE grátis no ar, só aparece o caminho da consulta.
 * `paidTo` leva para outra consulta (landing de um produto); `paidLabel` troca o texto do segundo botão.
 */
export default function PlateChoice({ authed, placement, paidProduct, paidLabel = 'Ver débitos, multas e gravame', freeOnly = false, note = true }: {
  authed: boolean; placement: string; paidProduct?: string; paidLabel?: string; freeOnly?: boolean; note?: boolean;
}) {
  const nav = useNavigate();
  const offers = useFreeOffers();
  const errId = `pc-err-${useId().replace(/:/g, '')}`;
  const [plate, setPlate] = useState('');
  const [error, setError] = useState('');
  const showFree = offers.fipe;

  function valid(): string | null {
    const p = normalizePlate(plate);
    if (!isValidPlate(p)) { setError('Informe uma placa válida, por exemplo ABC1D23 ou ABC-1234.'); return null; }
    trackFunnel('PLATE_CAPTURED', { placement, plateFormat: /^[A-Z]{3}[0-9]{4}$/.test(p) ? 'antiga' : 'mercosul', authenticated: authed });
    return p;
  }
  function goFree(e?: FormEvent) {
    e?.preventDefault();
    const p = valid(); if (!p) return;
    trackFunnel('CTA_CLICKED', { placement, target: 'fipe_gratis' });
    nav(`${authed ? '/app/fipe' : '/fipe'}?placa=${p}&go=1`);
  }
  function goPaid() {
    const p = valid(); if (!p) return;
    trackFunnel('CTA_CLICKED', { placement, target: paidProduct ? `consulta_${paidProduct}` : 'consulta' });
    const dest = `/app/consultar?placa=${p}${paidProduct ? `&produto=${encodeURIComponent(paidProduct)}` : ''}`;
    if (authed) nav(dest);
    else nav(paidProduct ? `/criar-conta?next=${encodeURIComponent(dest)}` : `/consultar?placa=${p}`);
  }
  return (
    <form className="pc" onSubmit={(e) => { e.preventDefault(); if (showFree) goFree(); else goPaid(); }} noValidate aria-label="Consultar placa">
      <label className="pc-input">
        <Icon name="car" size={24} /><span className="sr-only">Placa do veículo</span>
        <input value={plate} onChange={(e) => { setPlate(normalizePlate(e.target.value)); setError(''); }} placeholder="Digite a placa (ex: ABC1D23)" inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={8} aria-invalid={Boolean(error)} aria-describedby={errId} />
      </label>
      <p id={errId} className="pc-err" role="alert">{error}</p>
      {showFree ? (
        <>
          <button type="submit" className="btn btn-primary btn-lg pc-big"><Icon name="trending-up" size={22} /><span><b>Ver FIPE grátis + dados do veículo</b><small>Crie sua conta grátis para ver, baixar e imprimir</small></span></button>
          {!freeOnly && <button type="button" className="btn btn-lg pc-alt" onClick={goPaid}><Icon name="shield-check" size={19} /> {paidLabel}</button>}
        </>
      ) : (
        <button type="submit" className="btn btn-primary btn-lg pc-big"><Icon name="search" size={22} /><span><b>Consultar placa</b></span></button>
      )}
      {showFree && note && <ul className="pc-list"><li><Icon name="check" size={15} />Valor FIPE e histórico de preço</li><li><Icon name="check" size={15} />Marca, modelo, ano e combustível</li><li><Icon name="check" size={15} />Chassi parcial e dados de registro</li></ul>}
    </form>
  );
}
