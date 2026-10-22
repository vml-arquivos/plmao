/**
 * Consumo oficial por versão, guardado como OBSERVAÇÃO com fonte, ciclo e data (nunca como "a verdade única").
 *
 * Regras desta carga:
 *  - só entra linha que aparece na tabela oficial do Inmetro (PBE Veicular 2024) com o rótulo literal da versão;
 *  - quando duas fontes independentes concordam (ficha de referência do guia e tabela do Inmetro) ou quando a
 *    pesquisa anexada pelo Marcio (Corolla e Civic híbridos) traz a mesma linha, o registro nasce "CONFERIDO";
 *  - valores de fabricante ficam em linha própria, sem substituir o do Inmetro;
 *  - ausência de dado é ausência: nada é estimado, arredondado ou preenchido por média.
 */
export const INMETRO_PBEV_2024_URL = 'https://www.gov.br/inmetro/pt-br/assuntos/regulamentacao/avaliacao-da-conformidade/programa-brasileiro-de-etiquetagem/tabelas-de-eficiencia-energetica/veiculos-automotivos-pbe-veicular/pbe-veicular-2024-1.pdf/@@download/file';
export const INMETRO_NAME = 'Inmetro, Tabela PBE Veicular 2024';
export const COLLECTED_AT = '2026-10-21';

export interface ConsumptionSeed {
  /** slug do modelo no guia e nome da versão cadastrada (para ligar a observação à ficha) */
  modelSlug: string; versionName: string | null;
  brand: string; model: string; versionLabel: string; segment: string; propulsion: string;
  fuel: 'Gasolina' | 'Etanol';
  cityKml: number; roadKml: number;
  sourceKind: 'INMETRO' | 'FABRICANTE';
  sourceName?: string; sourceUrl?: string;
  note: string;
}

type Row = [modelSlug: string, versionName: string | null, brand: string, model: string, label: string, segment: string, propulsion: string, gasCity: number, gasRoad: number, ethCity: number | null, ethRoad: number | null, note: string];

const ROWS: Row[] = [
  ['chevrolet-onix', '1.0', 'CHEVROLET', 'ONIX', '10MT HB (1.0 - 12 V, M-6)', 'Médio', 'Combustão', 13.3, 16.5, 9.3, 11.4, 'Mesmo valor da ficha de referência do guia.'],
  ['chevrolet-onix', '1.0 Turbo AT', 'CHEVROLET', 'ONIX', '10TAT HB (1.0T - 12 V, A-6)', 'Médio', 'Combustão', 11.6, 14.9, 8.3, 10.4, 'Mesmo valor da ficha de referência do guia. A tabela traz o mesmo número para as versões LT1, LTZ e PR2.'],
  ['chevrolet-onix-sedan', 'LT 1.0 Turbo', 'CHEVROLET', 'ONIX PLUS', '10TMT LT1 (1.0T - 12 V, M-6)', 'Médio', 'Combustão', 13.4, 16.9, 9.3, 11.8, 'Na tabela de 2024 o sedã aparece como "ONIX PLUS". Mesmo valor da ficha de referência do guia.'],
  ['fiat-mobi', 'Like 1.0', 'FIAT', 'MOBI', 'LIKE (1.0-8V, M-5)', 'Sub Compacto', 'Combustão', 13.5, 15.0, 9.6, 10.4, 'Mesmo valor da ficha de referência do guia.'],
  ['fiat-argo', 'Drive 1.0', 'FIAT', 'ARGO', 'DRIVE 1.0 (1.0-6V, M-5)', 'Compacto', 'Combustão', 13.3, 14.7, 9.4, 10.2, 'A tabela traz também a linha "DRIVE 1.0 / 1.0" com valores um pouco melhores (13,6 e 15,1 km/l na gasolina); aqui vale a linha de rótulo "DRIVE 1.0", igual à ficha do guia.'],
  ['fiat-cronos', 'Drive 1.3', 'FIAT', 'CRONOS', 'DRIVE 1.3 (1.3-8V, M-5)', 'Médio', 'Combustão', 12.8, 15.5, 9.0, 10.9, 'Mesmo valor da ficha de referência do guia.'],
  ['hyundai-hb20', 'Sense Plus 1.0', 'Hyundai', 'HB20', 'Sense (1.0-12V, M-5), linha sem "25MY"', 'Compacto', 'Combustão', 13.5, 14.6, 9.6, 10.4, 'A tabela traz também a linha "Sense (25MY)" com 13,6 / 14,8 km/l na gasolina e 10,0 / 10,4 km/l no etanol. Confirme na concessionária qual linha vale para o ano-modelo do carro que você procura.'],
  ['volkswagen-polo', 'Track 1.0', 'VW', 'POLO', 'TRACK MPI (MY24) (1.0-12V, M-5)', 'Médio', 'Combustão', 13.7, 15.2, 9.4, 10.8, 'Linha do ano-modelo 2024. Mesmo valor da ficha de referência do guia.'],
  ['volkswagen-virtus', 'Highline 1.0 TSI', 'VW', 'VIRTUS', 'HIGHLINE 200TSI AUTOMÁTICO (1.0-12V, A-6)', 'Médio', 'Combustão', 12.1, 14.4, 8.3, 10.2, 'A tabela traz também "TSI AUTOMÁTICO (MY24)" com 12,1 / 14,8 km/l na gasolina. Mesmo valor da ficha de referência do guia para a linha citada.'],
  ['honda-hr-v', 'EXL 1.5', 'HONDA', 'HR-V', 'EXL HONDA SENSING (1.5-16V, CVT)', 'Médio', 'Combustão', 12.7, 13.9, 8.8, 9.8, 'Mesmo valor da ficha de referência do guia.'],
  ['toyota-corolla', 'XEi 2.0', 'TOYOTA', 'COROLLA', 'XEI 20 (2.0 - 16V, CVT)', 'Grande', 'Combustão', 12.3, 14.9, 8.6, 10.7, 'A ficha de referência anterior trazia 11,9 / 14,5 km/l (gasolina) e 8,0 / 10,0 km/l (etanol); a ficha do guia foi corrigida para o valor do Inmetro. A mesma linha vale para GLI 20, ALTIS 20 e GRS (MY 2024).'],
  // Pesquisa anexada (híbridos): só gasolina, que é o combustível comparado na pesquisa.
  ['toyota-corolla', 'Altis Hybrid 1.8', 'TOYOTA', 'COROLLA', 'ALTIS HV (MY 2024) 1.8 - 16V, CVT', 'Grande', 'Híbrido', 18.5, 15.7, null, null, 'A tabela traz também a linha "APREMIUMH 1.8 - 16V" com os mesmos valores; não foi feita fusão de versões sem confirmar a correspondência comercial.'],
  ['honda-civic', 'Touring Hybrid 2.0', 'HONDA', 'CIVIC HYBRID', 'TOURING 2.0 - 16V', 'Grande', 'Híbrido', 18.3, 15.9, null, null, 'A linha da tabela não informa o ano-modelo. A Honda chama a versão de "Civic Advanced Hybrid" no catálogo comercial.']
];

export const CONSUMPTION_SEED: ConsumptionSeed[] = ROWS.flatMap(([modelSlug, versionName, brand, model, versionLabel, segment, propulsion, gc, gr, ec, er, note]) => {
  const base = { modelSlug, versionName, brand, model, versionLabel, segment, propulsion, sourceKind: 'INMETRO' as const, note };
  const out: ConsumptionSeed[] = [{ ...base, fuel: 'Gasolina', cityKml: gc, roadKml: gr }];
  if (ec !== null && er !== null) out.push({ ...base, fuel: 'Etanol', cityKml: ec, roadKml: er });
  return out;
});

/** O catálogo da Honda traz um valor urbano 0,1 km/l acima do Inmetro. Fica registrado à parte, sem substituir o oficial. */
export const HONDA_CIVIC_OBS: ConsumptionSeed = {
  modelSlug: 'honda-civic', versionName: 'Touring Hybrid 2.0', brand: 'HONDA', model: 'CIVIC HYBRID', versionLabel: 'Civic Advanced Hybrid (catálogo Honda)', segment: 'Grande', propulsion: 'Híbrido',
  fuel: 'Gasolina', cityKml: 18.4, roadKml: 15.9, sourceKind: 'FABRICANTE', sourceName: 'Honda, catálogo oficial do Civic Advanced Hybrid',
  sourceUrl: 'https://www.honda.com.br/automoveis/sites/hab/files/catalogos/civic_hibrido/index.html',
  note: 'O valor urbano é 0,1 km/l maior que o da tabela do Inmetro (18,3). Os dois ficam registrados; o do Inmetro é a base de comparação.'
};

/** Versões e modelo novos, só com o que as fontes informam. */
export const COROLLA_HYBRID_VERSION = {
  name: 'Altis Hybrid 1.8', yearModel: 2024, fuel: 'Híbrido (flex)',
  specs: { engine: '1.8 16V híbrido', transmission: 'CVT', cons_city_gas_kml: 18.5, cons_road_gas_kml: 15.7 } as Record<string, string | number | boolean>
};
export const CIVIC_MODEL = {
  slug: 'honda-civic', brand: 'Honda', name: 'Civic', vehicleType: 'CAR', bodyType: 'Sedã',
  specSource: 'Inmetro (Tabela PBE Veicular 2024) e catálogo oficial da Honda, consultados em 21/10/2026. Por enquanto a ficha traz só o consumo oficial; o restante entra conforme a conferência das fontes.',
  version: {
    name: 'Touring Hybrid 2.0', yearModel: null as number | null, fuel: 'Gasolina (híbrido)',
    specs: { engine: '2.0 16V híbrido', transmission: 'CVT', cons_city_gas_kml: 18.3, cons_road_gas_kml: 15.9 } as Record<string, string | number | boolean>
  }
};

/** Descrição curta do Civic: só o que o Inmetro (PBEV 2024) e o catálogo da Honda informam. */
export const CIVIC_SUMMARY = 'Sedã grande com versão híbrida. Consumo oficial na tabela PBEV 2024 do Inmetro: 18,3 km/l na cidade e 15,9 km/l na estrada, a gasolina. Suspensão dianteira independente MacPherson e traseira multilink, segundo o catálogo da Honda.';
