/**
 * Catálogo dos 109 campos do retorno VEICULOSBDRP do provedor.
 * Cada campo declara seção, rótulo, tipo, sensibilidade (LGPD) e o menor nível de produto que o exibe.
 * Nada aqui é "inventado": só campos presentes no contrato/amostra do provedor.
 */

export type FieldKind = 'text' | 'money' | 'date' | 'status' | 'flag' | 'code' | 'number';
export type Sensitivity = 'PUBLIC' | 'PARTIAL' | 'OWNER' | 'INTERNAL';
export type Tier = 1 | 2 | 3;

export interface FieldDef {
  key: string;
  label: string;
  section: SectionKey;
  kind: FieldKind;
  sensitivity: Sensitivity;
  tier: Tier;
  /** para `flag`: regex (sobre o texto sem acento/maiúsculo) que indica situação regular. Padrão: NADA CONSTA etc. */
  clear?: RegExp;
  /** campo cuja presença com valor indica restrição grave (veredito de alto risco). */
  high?: boolean;
  doc?: 'CPF_CNPJ' | 'NAME' | 'VEHICLE_ID';
}

export type SectionKey = 'IDENTIFICACAO' | 'CARACTERISTICAS' | 'REGISTRO' | 'DEBITOS' | 'RESTRICOES' | 'GRAVAME' | 'INSPECAO_RECALL' | 'PROPRIETARIO' | 'INTERNO';

export const SECTIONS: Array<{ key: SectionKey; label: string; description: string; order: number }> = [
  { key: 'IDENTIFICACAO', label: 'Identificação do veículo', description: 'Marca, modelo e identificadores', order: 10 },
  { key: 'CARACTERISTICAS', label: 'Características', description: 'Ano, cor, combustível, categoria e capacidades', order: 20 },
  { key: 'REGISTRO', label: 'Registro e licenciamento', description: 'Emplacamento, situação, CRV e comunicação de venda', order: 30 },
  { key: 'DEBITOS', label: 'Débitos', description: 'IPVA, licenciamento, multas, DPVAT e demais débitos', order: 40 },
  { key: 'RESTRICOES', label: 'Restrições', description: 'Furto/roubo, judicial, administrativa, tributária, ambiental e outras', order: 50 },
  { key: 'GRAVAME', label: 'Financiamento e gravame', description: 'Restrição financeira, intenção de gravame e contratos', order: 60 },
  { key: 'INSPECAO_RECALL', label: 'Inspeção e recall', description: 'Inspeção veicular e campanhas de recall', order: 70 },
  { key: 'PROPRIETARIO', label: 'Proprietário (dados protegidos)', description: 'Tipo de documento; dados pessoais protegidos pela LGPD', order: 80 },
  { key: 'INTERNO', label: 'Controle interno', description: 'Metadados técnicos do provedor', order: 99 }
];

const f = (key: string, label: string, section: SectionKey, kind: FieldKind, tier: Tier, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, section, kind, sensitivity: 'PUBLIC', tier, ...extra });
const internal = (key: string, label: string, kind: FieldKind = 'code'): FieldDef => f(key, label, 'INTERNO', kind, 3, { sensitivity: 'INTERNAL' });
const owner = (key: string, label: string, doc: 'CPF_CNPJ' | 'NAME', section: SectionKey = 'PROPRIETARIO'): FieldDef => f(key, label, section, 'text', 3, { sensitivity: 'OWNER', doc });

export const FIELD_CATALOG: FieldDef[] = [
  // Identificação
  f('PLACA', 'Placa', 'IDENTIFICACAO', 'text', 1),
  f('MARCA', 'Marca', 'IDENTIFICACAO', 'text', 1),
  f('MODELO', 'Modelo', 'IDENTIFICACAO', 'text', 1),
  f('MARCAMODELOCOMPLETO', 'Marca/modelo completo', 'IDENTIFICACAO', 'text', 1),
  f('CHASSI', 'Chassi', 'IDENTIFICACAO', 'text', 1, { sensitivity: 'PARTIAL', doc: 'VEHICLE_ID' }),
  f('RENAVAM', 'RENAVAM', 'IDENTIFICACAO', 'text', 2, { sensitivity: 'PARTIAL', doc: 'VEHICLE_ID' }),
  f('MOTOR', 'Número do motor', 'IDENTIFICACAO', 'text', 2, { sensitivity: 'PARTIAL', doc: 'VEHICLE_ID' }),
  f('NUMERO_CAIXACAMBIO', 'Número da caixa de câmbio', 'IDENTIFICACAO', 'text', 3, { sensitivity: 'PARTIAL', doc: 'VEHICLE_ID' }),
  f('NUMERO_CARROCERIA', 'Número da carroceria', 'IDENTIFICACAO', 'text', 3, { sensitivity: 'PARTIAL', doc: 'VEHICLE_ID' }),
  f('NUMERO_EIXOTRASEIRODIF', 'Eixo traseiro/diferencial', 'IDENTIFICACAO', 'text', 3, { sensitivity: 'PARTIAL', doc: 'VEHICLE_ID' }),
  f('NUMERO_TERCEIROEIXO', 'Terceiro eixo', 'IDENTIFICACAO', 'text', 3, { sensitivity: 'PARTIAL', doc: 'VEHICLE_ID' }),
  f('TIPOREMARCACAOCHASSI', 'Remarcação de chassi', 'IDENTIFICACAO', 'flag', 2, { clear: /^NORMAL$|^NAO REMARCADO|^SEM REMARCACAO/, high: true }),
  internal('CODIGOMARCA', 'Código da marca'),
  // Características
  f('VEIANOFABR', 'Ano de fabricação', 'CARACTERISTICAS', 'text', 1),
  f('VEIANOMODELO', 'Ano do modelo', 'CARACTERISTICAS', 'text', 1),
  f('COR', 'Cor', 'CARACTERISTICAS', 'text', 1),
  f('COMBUSTIVEL', 'Combustível', 'CARACTERISTICAS', 'text', 1),
  f('POTENCIA', 'Potência', 'CARACTERISTICAS', 'text', 1),
  f('CILINDRADA', 'Cilindrada', 'CARACTERISTICAS', 'text', 1),
  f('TIPO', 'Tipo', 'CARACTERISTICAS', 'text', 1),
  f('ESPECIE', 'Espécie', 'CARACTERISTICAS', 'text', 1),
  f('VEICATEGORIA', 'Categoria', 'CARACTERISTICAS', 'text', 1),
  f('CARROCERIA', 'Carroceria', 'CARACTERISTICAS', 'text', 2),
  f('VEIPROCEDENCIA', 'Procedência', 'CARACTERISTICAS', 'text', 1),
  f('EIXOS', 'Eixos', 'CARACTERISTICAS', 'number', 2),
  f('CAPACIDADEPASSAG', 'Capacidade de passageiros', 'CARACTERISTICAS', 'text', 2),
  f('CAPACIDADECARGA', 'Capacidade de carga', 'CARACTERISTICAS', 'text', 2),
  f('CMT', 'CMT (capacidade máxima de tração)', 'CARACTERISTICAS', 'text', 3),
  f('PBT', 'PBT (peso bruto total)', 'CARACTERISTICAS', 'text', 3),
  internal('CODIGOCOR', 'Código da cor'),
  internal('CODIGOTIPO', 'Código do tipo'),
  internal('CODIGOCATEGORIA', 'Código da categoria'),
  // Registro
  f('UF', 'UF de emplacamento', 'REGISTRO', 'text', 1),
  f('MUNICIPIO', 'Município', 'REGISTRO', 'text', 1),
  f('SITUACAOVEICULO', 'Situação do veículo', 'REGISTRO', 'status', 1),
  f('LICEXELIC', 'Exercício do licenciamento', 'REGISTRO', 'text', 2),
  f('LICDATA', 'Data do licenciamento', 'REGISTRO', 'date', 2),
  f('DATAEMISSAOCRV', 'Emissão do CRV', 'REGISTRO', 'date', 2),
  f('CCOMUNICACAOVENDA', 'Comunicação de venda', 'REGISTRO', 'flag', 3, { clear: /^NAO CONSTA|^SEM COMUNICACAO/ }),
  f('CCOMUNICINCLUSAO', 'Inclusão da comunicação de venda', 'REGISTRO', 'date', 3),
  f('DATAVENDA', 'Data da venda comunicada', 'REGISTRO', 'date', 3),
  f('TIPOTRANSACAO', 'Tipo de transação', 'REGISTRO', 'text', 3),
  f('PROTOCOLODETRAN', 'Protocolo do DETRAN', 'REGISTRO', 'text', 3),
  f('NOTAFISCAL', 'Nota fiscal', 'REGISTRO', 'text', 3),
  f('UFFATURADO', 'UF do faturamento', 'REGISTRO', 'text', 3),
  // Débitos
  f('EXISTEDEBITODEIPVA', 'IPVA', 'DEBITOS', 'flag', 2, { clear: /^NAO EXISTE/ }),
  f('DEBIPVA', 'Valor de IPVA em aberto', 'DEBITOS', 'money', 2),
  f('EXISTEDEBITODELICENCIAMENTO', 'Licenciamento', 'DEBITOS', 'flag', 2, { clear: /^NAO EXISTE/ }),
  f('EXISTEDEBITODELICENCIAMENTOVL', 'Valor de licenciamento em aberto', 'DEBITOS', 'money', 2),
  f('EXISTEDEBITODEDPVAT', 'DPVAT', 'DEBITOS', 'flag', 2, { clear: /^NAO EXISTE/ }),
  f('DPVAT', 'Valor de DPVAT em aberto', 'DEBITOS', 'money', 2),
  f('EXISTEDEBITOMULTA', 'Multas', 'DEBITOS', 'flag', 2, { clear: /^NAO EXISTE/ }),
  f('VALORTOTALDEBITOMULTA', 'Total de multas em aberto', 'DEBITOS', 'money', 2),
  f('DEBDETRAN', 'Multas — DETRAN', 'DEBITOS', 'money', 3),
  f('DEBDER', 'Multas — DER', 'DEBITOS', 'money', 3),
  f('DEBDERSA', 'Multas — DERSA', 'DEBITOS', 'money', 3),
  f('DEBPOLRODFED', 'Multas — Polícia Rodoviária Federal', 'DEBITOS', 'money', 3),
  f('DEBRENAINF', 'Multas — RENAINF', 'DEBITOS', 'money', 3),
  f('DEBMUNICIPAIS', 'Débitos municipais', 'DEBITOS', 'money', 2),
  f('DEBCETESB', 'Débitos CETESB', 'DEBITOS', 'money', 3),
  // Restrições
  f('RESFURTO', 'Furto/roubo', 'RESTRICOES', 'flag', 2, { high: true }),
  f('RESJUDICIAL', 'Restrição judicial', 'RESTRICOES', 'flag', 2, { high: true }),
  f('RESRENAJUD', 'RENAJUD', 'RESTRICOES', 'flag', 2, { high: true }),
  f('RESADMINISTRATIVA', 'Restrição administrativa', 'RESTRICOES', 'flag', 2, { high: true }),
  f('RESTRIBUTARIA', 'Restrição tributária', 'RESTRICOES', 'flag', 2, { high: true }),
  f('DATALIMITERESTRICAOTRIBUTARIA', 'Limite da restrição tributária', 'RESTRICOES', 'date', 3),
  f('RESGUINCHO', 'Guincho/depósito', 'RESTRICOES', 'flag', 2),
  f('RESAMBIENTAL', 'Restrição ambiental', 'RESTRICOES', 'flag', 2, { clear: /NADA CONSTA|INSPECAO VEICULAR OK|^NAO POSSUI/ }),
  f('RESTRICAORFB', 'Receita Federal', 'RESTRICOES', 'flag', 2, { high: true }),
  f('OUTRAS_RESTRICOES_01', 'Outras restrições (1)', 'RESTRICOES', 'flag', 3),
  f('OUTRAS_RESTRICOES_02', 'Outras restrições (2)', 'RESTRICOES', 'flag', 3),
  f('OUTRAS_RESTRICOES_03', 'Outras restrições (3)', 'RESTRICOES', 'flag', 3),
  f('OUTRAS_RESTRICOES_04', 'Outras restrições (4)', 'RESTRICOES', 'flag', 3),
  // Gravame
  f('RESTRICAOFINAN', 'Restrição financeira', 'GRAVAME', 'flag', 2, { high: true }),
  f('RESTRICAONOMEAGENTE', 'Agente financeiro (restrição)', 'GRAVAME', 'text', 2),
  f('RESTRICAODATAINCLUSAO', 'Data de inclusão da restrição', 'GRAVAME', 'date', 2),
  f('RESTRICAOARRENDATARIO', 'Arrendatário', 'GRAVAME', 'text', 3),
  owner('RESTRICAOCPFCNPJARRENDATAR', 'Documento do arrendatário', 'CPF_CNPJ', 'GRAVAME'),
  f('INTENCAORESTRICAOFINAN', 'Intenção de gravame', 'GRAVAME', 'flag', 3, { high: true }),
  f('INTENCAONOMEFINANC', 'Financeira (intenção)', 'GRAVAME', 'text', 3),
  f('INTENCAONOMEAGENTE', 'Agente (intenção)', 'GRAVAME', 'text', 3),
  owner('INTENCAOCPFCNPJFINANC', 'Documento da financeira (intenção)', 'CPF_CNPJ', 'GRAVAME'),
  f('INTENCAODATAINCLUSAO', 'Data da intenção de gravame', 'GRAVAME', 'date', 3),
  owner('CGCFINANCEIRA', 'CNPJ da financeira', 'CPF_CNPJ', 'GRAVAME'),
  internal('CODIGOFINANCEIRA', 'Código da financeira'),
  internal('CODIGOAGENTEFINANCEIRO', 'Código do agente financeiro'),
  f('NUMEROCONTRATOFINANCEIRA', 'Número do contrato', 'GRAVAME', 'text', 3, { sensitivity: 'OWNER', doc: 'VEHICLE_ID' }),
  f('DATAVIGENCIACONTRATOFINANCEIRA', 'Vigência do contrato', 'GRAVAME', 'date', 3),
  f('DATAINCLUSAOINTENCAOTROCAFINANCEIRA', 'Inclusão da intenção de troca de financeira', 'GRAVAME', 'date', 3),
  // Inspeção e recall
  f('RECALL', 'Recall', 'INSPECAO_RECALL', 'flag', 2),
  f('INSPECAOSTATUS', 'Status da inspeção', 'INSPECAO_RECALL', 'text', 3),
  f('INSPECAOANO', 'Ano da inspeção', 'INSPECAO_RECALL', 'text', 3),
  f('INSPECAODATA', 'Data da inspeção', 'INSPECAO_RECALL', 'date', 3),
  f('INSPECAOSELO', 'Selo da inspeção', 'INSPECAO_RECALL', 'text', 3),
  f('INSPECAOCENTRO', 'Centro de inspeção', 'INSPECAO_RECALL', 'text', 3),
  // Proprietário (dados protegidos)
  f('TIPODOCUMENTOPROPRIETARIO', 'Tipo de proprietário', 'PROPRIETARIO', 'text', 2),
  owner('PRONOME', 'Nome do proprietário', 'NAME'),
  owner('PRONOMEANTERIOR', 'Nome do proprietário anterior', 'NAME'),
  owner('CPF_CNPJ_PROPRIETARIO', 'CPF/CNPJ do proprietário', 'CPF_CNPJ'),
  owner('CPFCNPJFATURADO', 'CPF/CNPJ do faturado', 'CPF_CNPJ'),
  f('TIPODOCUMENTOFATURADO', 'Tipo do faturado', 'PROPRIETARIO', 'text', 3),
  f('TIPODOCUMENTOIMPORTADORA', 'Tipo do importador', 'PROPRIETARIO', 'text', 3),
  owner('CPFCNPJCOMPRADOR', 'CPF/CNPJ do comprador', 'CPF_CNPJ'),
  f('TIPODOCCOMPRADOR', 'Tipo do comprador', 'PROPRIETARIO', 'text', 3),
  // Interno
  internal('CHAVERETORNO', 'Chave de retorno', 'text'),
  internal('TEMPOEXECUCAO', 'Tempo de execução', 'number'),
  internal('EXISTE_ERRO', 'Existe erro', 'flag'),
  internal('MSG_ERRO', 'Mensagem de erro', 'text'),
  internal('REDUNDANCIA', 'Redundância', 'text')
];

export const CATALOG_BY_KEY: ReadonlyMap<string, FieldDef> = new Map(FIELD_CATALOG.map((def) => [def.key, def]));
