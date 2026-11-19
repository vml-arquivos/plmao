import { useState } from 'react';
import { api } from '../api';
import { Alert, Button, ErrorState, Field, Input, PageLoading, Switch, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { Card, PageHead } from '../parts';
import { Icon } from '../../shared/icons';
import { EMPTY_HOME_CONFIG, HOME_DEFAULTS, type HomeConfig, type HomeImage, type HomePayload, type HomeSlot } from '../../shared/homeDefaults';

const SLOTS: Array<{ slot: HomeSlot; title: string; size: string; hint: string }> = [
  { slot: 'hero', title: 'Imagem do topo', size: '1200 × 900 px', hint: 'Aparece à direita do campo da placa, no computador. Sem imagem, o site mostra o exemplo de relatório.' },
  { slot: 'showcase', title: 'Imagem do relatório', size: '1200 × 900 px', hint: 'Aparece ao lado dos 3 passos. Sem imagem, o site mostra os celulares de exemplo.' },
  { slot: 'final', title: 'Fundo da busca final', size: '1600 × 700 px', hint: 'Fundo do bloco azul no fim da página. Prefira imagem escura, para o texto branco continuar legível.' }
];

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

function ImageSlot({ item, image, onChange }: { item: (typeof SLOTS)[number]; image?: HomeImage; onChange: (img: HomeImage | null) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const send = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { toast.error('Use uma imagem PNG, JPG ou WebP.'); return; }
    if (file.size > 3 * 1024 * 1024) { toast.error('A imagem passa de 3 MB. Reduza o arquivo e tente de novo.'); return; }
    setBusy(true);
    try { const r = await api.upload<{ image: HomeImage | null }>('/admin/content/home/image', file, { slot: item.slot }); onChange(r.image); toast.ok('Imagem salva. Já está no site.'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await api.del('/admin/content/home/image', { query: { slot: item.slot } }); onChange(null); toast.ok('Imagem removida. O site volta ao padrão.'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div><b>{item.title}</b> <span className="muted" style={{ fontSize: 13 }}>· ideal {item.size}</span></div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{item.hint}</p>
      {image
        ? <img src={image.url} alt="" style={{ width: '100%', maxHeight: 190, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--border)' }} />
        : <div className="muted" style={{ display: 'grid', placeItems: 'center', height: 120, borderRadius: 12, border: '1px dashed var(--border-strong)', fontSize: 13 }}>Usando o padrão do site</div>}
      {image && <span className="muted" style={{ fontSize: 12.5 }}>{image.width && image.height ? `${image.width} × ${image.height} px · ` : ''}{Math.round(image.sizeBytes / 1024)} KB</span>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className={`btn btn-sm ${busy ? 'disabled' : ''}`} style={{ cursor: busy ? 'wait' : 'pointer' }}>
          <Icon name="upload" size={15} /> {image ? 'Trocar imagem' : 'Enviar imagem'}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={(e) => { void send(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {image && <Button size="sm" variant="ghost" loading={busy} onClick={remove}>Remover</Button>}
      </div>
    </div>
  );
}

function Editor({ data, onSaved }: { data: HomePayload; onSaved: (v: HomePayload) => void }) {
  const toast = useToast();
  const c0 = { ...EMPTY_HOME_CONFIG, ...data.config };
  const [f, setF] = useState({
    heroTag: c0.heroTag ?? '', heroLead: c0.heroLead ?? '', consultasTitle: c0.consultasTitle ?? '', consultasSub: c0.consultasSub ?? '',
    showcaseTitle: c0.showcaseTitle ?? '', showcaseBullets: c0.showcaseBullets.join('\n'), packsTitle: c0.packsTitle ?? '', packsSub: c0.packsSub ?? '', finalTitle: c0.finalTitle ?? '', finalSub: c0.finalSub ?? '',
    aOn: c0.announce.enabled, aText: c0.announce.text ?? '', aLabel: c0.announce.linkLabel ?? '', aLink: c0.announce.linkTo ?? '',
    steps: c0.show.steps, tools: c0.show.tools, testimonials: c0.show.testimonials, lojista: c0.show.lojista
  });
  const [images, setImages] = useState(data.images);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const text = (k: 'heroTag' | 'heroLead' | 'consultasTitle' | 'consultasSub' | 'packsTitle' | 'packsSub' | 'finalTitle' | 'finalSub' | 'showcaseTitle', label: string, max: number, long = false) => (
    <Field label={label} hint={`${f[k].length}/${max} · vazio usa o texto padrão`}>
      {long
        ? <Textarea rows={2} maxLength={max} value={f[k]} placeholder={HOME_DEFAULTS[k]} onChange={(e) => set(k, e.target.value)} />
        : <Input maxLength={max} value={f[k]} placeholder={HOME_DEFAULTS[k]} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  );
  const body = (): HomeConfig => ({
    heroTag: orNull(f.heroTag), heroLead: orNull(f.heroLead), consultasTitle: orNull(f.consultasTitle), consultasSub: orNull(f.consultasSub),
    showcaseTitle: orNull(f.showcaseTitle), showcaseBullets: f.showcaseBullets.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5),
    packsTitle: orNull(f.packsTitle), packsSub: orNull(f.packsSub), finalTitle: orNull(f.finalTitle), finalSub: orNull(f.finalSub),
    announce: { enabled: f.aOn, text: orNull(f.aText), linkLabel: orNull(f.aLabel), linkTo: orNull(f.aLink) },
    show: { steps: f.steps, tools: f.tools, testimonials: f.testimonials, lojista: f.lojista }
  });
  const save = async () => {
    setBusy(true);
    try { const r = await api.put<HomePayload>('/admin/content/home', body()); onSaved(r); toast.ok('Página inicial salva. Já está no site.'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const restore = () => { setF((s) => ({ ...s, heroTag: '', heroLead: '', consultasTitle: '', consultasSub: '', showcaseTitle: '', showcaseBullets: '', packsTitle: '', packsSub: '', finalTitle: '', finalSub: '', aOn: false, aText: '', aLabel: '', aLink: '', steps: true, tools: true, testimonials: true, lojista: true })); toast.ok('Campos limpos. Clique em Salvar para voltar ao padrão do site.'); };
  return (
    <div className="stack">
      <Alert tone="info">O que você deixar vazio usa o texto padrão. O título principal (H1) da página inicial continua em <b>SEO e Google</b>. Os preços e as consultas vêm da <b>Vitrine de produtos</b>.</Alert>

      <Card title="Aviso de campanha">
        <div className="stack">
          <Switch checked={f.aOn} onChange={(e) => set('aOn', e.target.checked)} label="Mostrar aviso no topo da página inicial" />
          <div className="form-grid">
            <Field label="Texto do aviso" hint={`${f.aText.length}/140`}><Input maxLength={140} value={f.aText} placeholder="Ex.: Consulta completa com preço de lançamento" onChange={(e) => set('aText', e.target.value)} /></Field>
            <Field label="Texto do botão (opcional)" hint={`${f.aLabel.length}/30`}><Input maxLength={30} value={f.aLabel} placeholder="Ex.: Ver agora" onChange={(e) => set('aLabel', e.target.value)} /></Field>
            <Field label="Link do botão (opcional)" hint="Use /planos, /consultar... ou um endereço https://"><Input maxLength={200} value={f.aLink} placeholder="/planos" onChange={(e) => set('aLink', e.target.value)} /></Field>
          </div>
        </div>
      </Card>

      <Card title="Textos">
        <div className="stack">
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
            {text('heroTag', 'Frase do topo (abaixo do título)', 90)}
            {text('heroLead', 'Texto do topo', 220, true)}
            {text('consultasTitle', 'Título das consultas', 70)}
            {text('consultasSub', 'Subtítulo das consultas', 120)}
            {text('showcaseTitle', 'Título da seção do relatório', 90)}
            {text('packsTitle', 'Título dos pacotes', 70)}
            {text('packsSub', 'Subtítulo dos pacotes', 120)}
            {text('finalTitle', 'Título da busca final', 80)}
            {text('finalSub', 'Texto da busca final', 120)}
          </div>
          <Field label="Pontos da seção do relatório" hint="Um por linha, até 5. Vazio usa os 3 padrões.">
            <Textarea rows={4} value={f.showcaseBullets} placeholder={HOME_DEFAULTS.showcaseBullets.join('\n')} onChange={(e) => set('showcaseBullets', e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="Imagens">
        <div className="adm-grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {SLOTS.map((s) => <ImageSlot key={s.slot} item={s} image={images[s.slot]} onChange={(img) => setImages((cur) => { const n = { ...cur }; if (img) n[s.slot] = img; else delete n[s.slot]; return n; })} />)}
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>PNG, JPG ou WebP, até 3 MB. As imagens são salvas na hora, sem precisar clicar em Salvar. Use só imagens suas ou com licença.</p>
      </Card>

      <Card title="Seções">
        <div className="stack" style={{ gap: 10 }}>
          <Switch checked={f.steps} onChange={(e) => set('steps', e.target.checked)} label="Mostrar os 3 passos (Digite a placa, Escolha, Receba)" />
          <Switch checked={f.lojista} onChange={(e) => set('lojista', e.target.checked)} label="Mostrar o bloco “Lojista ou empresa?”" />
          <Switch checked={f.testimonials} onChange={(e) => set('testimonials', e.target.checked)} label="Mostrar depoimentos (só aparecem se houver depoimentos publicados)" />
          <Switch checked={f.tools} onChange={(e) => set('tools', e.target.checked)} label="Mostrar “Ferramentas grátis”" />
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Consultas, pacotes, perguntas frequentes e textos de SEO sempre aparecem.</p>
        </div>
      </Card>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Button variant="primary" loading={busy} onClick={save}>Salvar página inicial</Button>
        <Button variant="ghost" onClick={restore}>Voltar ao padrão</Button>
      </div>
    </div>
  );
}

export default function HomePage() {
  usePageTitle('Página inicial');
  const res = useAsync(() => api.get<HomePayload>('/admin/content/home'));
  return (
    <div className="adm-page stack">
      <PageHead title="Página inicial" sub="Troque textos, imagens e o aviso de campanha da página inicial, sem mexer em código." />
      {res.loading && !res.data ? <PageLoading /> : res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : res.data ? <Editor key={res.data.updatedAt ?? 'novo'} data={res.data} onSaved={res.setData} /> : null}
    </div>
  );
}
