import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { isValidPlate, normalizePlate } from '../../shared/format';
import { trackFunnel } from '../funnel';

/** Campo "Digite a placa" do hero. Envia para /consultar (visitante) ou /app/consultar (logado). */
export default function PlateSearch({ authed, placement }: { authed: boolean; placement: string }) {
  const nav = useNavigate();
  const [plate, setPlate] = useState('');
  const [error, setError] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const p = normalizePlate(plate);
    if (!isValidPlate(p)) { setError('Informe uma placa válida, por exemplo ABC1D23 ou ABC-1234.'); return; }
    trackFunnel('PLATE_CAPTURED', { placement, plateFormat: /^[A-Z]{3}[0-9]{4}$/.test(p) ? 'antiga' : 'mercosul', authenticated: authed });
    nav(`${authed ? '/app/consultar' : '/consultar'}?placa=${p}`);
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Consultar placa">
      <div className="plate-search">
        <label><Icon name="car" size={22} /><span className="sr-only">Placa do veículo</span>
          <input value={plate} onChange={(e) => { setPlate(normalizePlate(e.target.value)); setError(''); }} placeholder="Digite a placa (ex: ABC1D23)" inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={8} aria-invalid={Boolean(error)} aria-describedby="plate-err" />
        </label>
        <button type="submit" className="btn btn-primary btn-lg"><Icon name="search" size={19} /> Consultar</button>
      </div>
      <p id="plate-err" className="plate-search-err" role="alert">{error}</p>
    </form>
  );
}
