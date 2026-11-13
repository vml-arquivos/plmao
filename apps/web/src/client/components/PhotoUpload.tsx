import { useRef, useState } from 'react';
import { Icon } from '../../shared/icons';
import { errorMessage } from '../../shared/api';
import { Button, Spinner, useToast } from '../../shared/ui';
import { api } from '../api';

type Kind = 'photo' | 'cover' | 'logo';
const MAX_SIDE: Record<Kind, number> = { photo: 1600, cover: 1800, logo: 600 };
const ACCEPT = 'image/png,image/jpeg,image/webp';

/** Endereço que o navegador pode mostrar: foto enviada pelo sistema ou link https antigo. */
export const photoSrc = (u: string | null | undefined): string | null => (u && (/^https:\/\//i.test(u) || /^\/api\/public\/store-photos\/[0-9a-f-]{36}$/i.test(u)) ? u : null);

/** Reduz a imagem no próprio aparelho antes de enviar (foto de celular tem vários MB). Se não der para ler, envia o original. */
async function prepare(file: File, kind: Kind): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const side = MAX_SIDE[kind];
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const keepPng = kind === 'logo' && file.type === 'image/png';
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024 && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { bmp.close(); return file; }
    const w = Math.max(1, Math.round(bmp.width * scale)); const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); return file; }
    if (!keepPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(bmp, 0, 0, w, h); bmp.close();
    const type = keepPng ? 'image/png' : 'image/jpeg';
    const blob: Blob | null = await new Promise((ok) => canvas.toBlob(ok, type, 0.85));
    if (!blob) return file;
    return new File([blob], keepPng ? 'imagem.png' : 'imagem.jpg', { type });
  } catch { return file; }
}

export async function uploadStorePhoto(file: File, kind: Kind): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && !file.type.startsWith('image/')) throw new Error('Escolha uma imagem (JPG, PNG ou WebP).');
  const ready = await prepare(file, kind);
  if (ready.size > 6 * 1024 * 1024) throw new Error('A imagem passa de 6 MB. Escolha uma menor.');
  const r = await api.upload<{ url: string }>('/dealer/photos', ready, { kind });
  return r.url;
}

/** Várias fotos do veículo: botão de carregar, miniaturas, trocar de ordem (a primeira é a capa) e remover. */
export function PhotoGrid({ value, onChange, max = 8 }: { value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [drag, setDrag] = useState(false);
  const current = useRef(value); current.current = value;

  async function add(files: FileList | File[] | null) {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!list.length) { if (files && (files as FileList).length) toast.error('Escolha imagens (JPG, PNG ou WebP).'); return; }
    const room = max - current.current.length;
    if (room <= 0) { toast.error(`O limite é de ${max} fotos por veículo.`); return; }
    const take = list.slice(0, room);
    if (list.length > room) toast.error(`Só cabem mais ${room} foto${room > 1 ? 's' : ''}. As demais foram ignoradas.`);
    setBusy((n) => n + take.length);
    for (const f of take) {
      try { const url = await uploadStorePhoto(f, 'photo'); onChange([...current.current, url]); current.current = [...current.current, url]; }
      catch (e) { toast.error(`${f.name}: ${errorMessage(e)}`); }
      finally { setBusy((n) => n - 1); }
    }
    if (input.current) input.current.value = '';
  }
  const move = (i: number, d: -1 | 1) => { const a = [...value]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j]!, a[i]!]; onChange(a); };
  const remove = (i: number) => onChange(value.filter((_, k) => k !== i));

  return (
    <div className={`pu${drag ? ' drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void add(e.dataTransfer.files); }}>
      <div className="pu-grid">
        {value.map((u, i) => {
          const src = photoSrc(u);
          return (
            <div className="pu-item" key={`${u}-${i}`}>
              {src ? <img src={src} alt={`Foto ${i + 1}`} loading="lazy" /> : <div className="pu-broken"><Icon name="image" size={22} /></div>}
              {i === 0 && <span className="pu-cover">Capa</span>}
              <div className="pu-actions">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Mover foto ${i + 1} para a esquerda`}><Icon name="arrow-left" size={14} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} aria-label={`Mover foto ${i + 1} para a direita`}><Icon name="arrow-right" size={14} /></button>
                <button type="button" onClick={() => remove(i)} aria-label={`Remover foto ${i + 1}`}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          );
        })}
        {Array.from({ length: busy }).map((_, i) => <div className="pu-item pu-wait" key={`w${i}`}><Spinner size={22} /></div>)}
        {value.length + busy < max && (
          <button type="button" className="pu-add" onClick={() => input.current?.click()}>
            <Icon name="upload" size={22} /><span>Carregar fotos</span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void add(e.target.files)} />
      <p className="muted pu-hint">{value.length} de {max} fotos. Toque em “Carregar fotos” ou arraste as imagens para cá. A primeira é a capa no anúncio.</p>
    </div>
  );
}

/** Uma imagem só (logo ou capa da loja): botão de carregar, prévia e remover. */
export function SingleImage({ value, onChange, kind, label, ratio = '1 / 1' }: { value: string; onChange: (v: string) => void; kind: 'logo' | 'cover'; label: string; ratio?: string }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const src = photoSrc(value);
  async function pick(files: FileList | null) {
    const f = files?.[0]; if (!f) return;
    setBusy(true);
    try { onChange(await uploadStorePhoto(f, kind)); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return (
    <div className="pu-single">
      <div className="pu-prev" style={{ aspectRatio: ratio }}>{busy ? <Spinner size={22} /> : src ? <img src={src} alt={label} /> : <Icon name="image" size={26} />}</div>
      <div className="pu-single-btns">
        <Button size="sm" icon="upload" onClick={() => input.current?.click()} disabled={busy}>{src ? 'Trocar imagem' : 'Carregar imagem'}</Button>
        {value && <Button size="sm" variant="ghost" onClick={() => onChange('')} disabled={busy}>Remover</Button>}
      </div>
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => void pick(e.target.files)} />
    </div>
  );
}
