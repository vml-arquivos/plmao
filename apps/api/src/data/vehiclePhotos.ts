/**
 * Fotos com licença livre (Wikimedia Commons). Autor, licença e página de origem conferidos pela API do Commons em 21/10/2026.
 * A foto só entra se a licença permitir uso comercial com atribuição; o crédito aparece no card e na ficha.
 * Troque por foto própria (ou de fabricante com autorização) pelo painel: campos "URL da imagem" e crédito.
 */
export interface VehiclePhoto { slug: string; file: string; credit: string; license: string }

const commons = (file: string) => file.replace(/ /g, '_');
export const photoUrl = (file: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(commons(file)).replace(/%28/g, '(').replace(/%29/g, ')')}?width=800`;
export const photoPage = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(commons(file)).replace(/%28/g, '(').replace(/%29/g, ')')}`;

export const VEHICLE_PHOTOS: VehiclePhoto[] = [
  { slug: 'fiat-strada', file: 'Fiat Strada Mk6 Volcano in Uruguay - front.jpg', credit: 'NaBUru38 / Wikimedia Commons', license: 'CC BY-SA 4.0' },
  { slug: 'chevrolet-onix', file: 'Chevrolet Onix (second generation, front view).jpg', credit: 'Chevrolet México / Wikimedia Commons', license: 'CC BY 3.0' },
  { slug: 'hyundai-hb20', file: 'Hyundai HB20 Unique 2019.jpg', credit: 'Leandroazc / Wikimedia Commons', license: 'CC BY-SA 4.0' },
  { slug: 'toyota-corolla', file: '2023 Toyota Corolla 2.0 XEi (Brazil).jpg', credit: 'Just a Man / Wikimedia Commons', license: 'CC BY 4.0' },
  { slug: 'volkswagen-polo', file: '2018 Volkswagen Polo 1.6 MSi Trendline (Brazil, front).jpg', credit: 'Just a Man / Wikimedia Commons', license: 'CC BY 4.0' },
  { slug: 'toyota-hilux', file: 'Toyota Hilux SRV 2.8 TD 2023 (54286671377) (cropped).jpg', credit: 'RL GNZLZ / Wikimedia Commons', license: 'CC BY-SA 2.0' }
];
