/**
 * Rótulos legíveis e campos que não entram nos detalhes de leilão, roubo/furto e recall.
 * A Credify devolve nomes colados em maiúsculas (TIPOOCORRENCIA, SUJEITOACONFIRMACAOPELAMONTADORA): sem este mapa o relatório mostraria "Tipoocorrencia".
 * Campos de identificação do veículo (placa, ano, cor, motor…) já aparecem no cabeçalho e na comparação entre bases, então não se repetem aqui.
 */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  TIPOOCORRENCIA: 'Tipo de ocorrência',
  BOLETIM: 'Boletim de ocorrência',
  DATAOCORRENCIA: 'Data da ocorrência',
  UFOCORRENCIA: 'UF da ocorrência',
  DATAINICIOCAMPANHA: 'Início da campanha',
  MONTADORA: 'Montadora',
  SUJEITOACONFIRMACAOPELAMONTADORA: 'Sujeito à confirmação da montadora',
  FONECONFIRMACAO: 'Telefone para confirmar',
  MARCAMODELO: 'Campanha',
  SITUACAODOCHASSI: 'Situação do chassi',
  CONDICAOGERALDOVEICULO: 'Condição geral',
  CATEGORIADOVEICULO: 'Categoria',
  LEILOEIRO: 'Leiloeiro',
  COMITENTE: 'Comitente',
  PATIO: 'Pátio'
};

/** Campos técnicos ou repetidos que não ajudam quem lê o relatório. */
export const HIDDEN_FIELDS = /^(PLACA|PLACA_?MODELO_?NOVO|ANOBOLETIM|CODIGOORGAOSEGURANCA|IDGRAVIDADE|INDICATIVO|NSUVEICULO|ANOMODELO|ANOFABRICACAO|COMBUSTIVEL|COR|NRMOTOR|NRCAMBIO|NRCARROCERIA|NREIXOTRASEIRO|QUANTIDADEDEEIXOS|CATEGORIADOVEICULO|OCORRENCIA|CHAVERETORNO)$/;

export const labelFor = (key: string): string | undefined => FIELD_LABELS[key.toUpperCase()];

/** Data ISO (2023-06-18) vira 18/06/2023; o resto fica como veio. */
export function prettyValue(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}
