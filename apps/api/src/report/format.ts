/** Formatação de textos do provedor (MAIÚSCULAS sem acento) para leitura humana em pt-BR. */
const FIX: Record<string, string> = {
  NAO: 'não', POSSUI: 'possui', CONSTA: 'consta', EXISTE: 'existe', DEBITO: 'débito', DEBITOS: 'débitos', INSPECAO: 'inspeção', VEICULO: 'veículo', VEICULAR: 'veicular',
  COMUNICACAO: 'comunicação', VENDAS: 'vendas', RESTRICAO: 'restrição', RESTRICOES: 'restrições', CIRCULACAO: 'circulação', LICENCIAMENTO: 'licenciamento', INEXISTENTE: 'inexistente',
  ORIGINAL: 'original', NORMAL: 'normal', FISICA: 'física', JURIDICA: 'jurídica', NADA: 'nada', MULTA: 'multa', MULTAS: 'multas', IPVA: 'IPVA', DPVAT: 'DPVAT', RFB: 'RFB',
  RECALL: 'recall', COM: 'com', DE: 'de', DA: 'da', DO: 'do', OK: 'OK', FURTO: 'furto', ROUBO: 'roubo', JUDICIAL: 'judicial', REGISTRO: 'registro', APLICAVEL: 'aplicável',
  AUTOMOVEL: 'automóvel', GASOLINA: 'gasolina', ALCOOL: 'álcool', PASSAGEIRO: 'passageiro', PARTICULAR: 'particular', NACIONAL: 'nacional', IMPORTADO: 'importado',
  CAMINHAO: 'caminhão', REBOQUE: 'reboque', MOTOCICLETA: 'motocicleta', MOTONETA: 'motoneta', ONIBUS: 'ônibus', UTILITARIO: 'utilitário', CAMIONETA: 'camioneta', BAIXADO: 'baixado',
  SINISTRO: 'sinistro', LEILAO: 'leilão', ATIVO: 'ativo', REMARCADO: 'remarcado', PENDENTE: 'pendente'
};

export function sentenceCase(text: string): string {
  const folded = text.trim();
  if (!folded) return folded;
  if (folded !== folded.toUpperCase()) return folded; // já tem caixa mista: respeita
  const words = folded.split(/\s+/).map((w) => FIX[w.replace(/[^A-Z]/g, '')] ?? w.toLowerCase());
  const out = words.join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function brlFromCents(cents: number): string {
  const negative = cents < 0; const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}
