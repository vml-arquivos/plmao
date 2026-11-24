/** Textos padrão da página inicial. O painel só guarda o que for trocado; campo vazio usa estes. */
export const HOME_DEFAULTS = {
  heroTag: 'Saiba tudo sobre o carro antes de fechar negócio.',
  heroLead: 'Veja o valor FIPE e os dados do veículo de graça. Débitos, multas, restrições e gravame em um só relatório, sem mensalidade.',
  consultasTitle: 'Escolha a consulta.',
  consultasSub: 'O valor aparece antes de pagar.',
  showcaseTitle: 'Relatório claro, do jeito que você precisa.',
  showcaseBullets: ['Situação do veículo resumida no topo', 'Débitos e multas com valores, sem duplicidade', 'PDF com código de validação para compartilhar'],
  packsTitle: 'Consulte mais, pague menos por consulta.',
  packsSub: 'Recarregue o saldo e use em qualquer consulta. Sem mensalidade.',
  finalTitle: 'Consulte a placa antes de fechar negócio.',
  finalSub: 'Leva menos de um minuto.'
} as const;

export type HomeSlot = 'hero' | 'showcase' | 'final';
export interface HomeImage { url: string; width: number | null; height: number | null; sizeBytes: number; mime: string }
export interface HomeConfig {
  heroTag: string | null; heroLead: string | null; consultasTitle: string | null; consultasSub: string | null;
  showcaseTitle: string | null; showcaseBullets: string[]; packsTitle: string | null; packsSub: string | null;
  finalTitle: string | null; finalSub: string | null;
  announce: { enabled: boolean; text: string | null; linkLabel: string | null; linkTo: string | null };
  show: { steps: boolean; tools: boolean; testimonials: boolean; lojista: boolean };
}
export interface HomePayload { config: HomeConfig; images: Partial<Record<HomeSlot, HomeImage>>; updatedAt?: string | null }

export const EMPTY_HOME_CONFIG: HomeConfig = {
  heroTag: null, heroLead: null, consultasTitle: null, consultasSub: null, showcaseTitle: null, showcaseBullets: [], packsTitle: null, packsSub: null, finalTitle: null, finalSub: null,
  announce: { enabled: false, text: null, linkLabel: null, linkTo: null },
  show: { steps: true, tools: true, testimonials: true, lojista: true }
};
