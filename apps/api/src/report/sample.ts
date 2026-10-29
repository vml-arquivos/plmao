/** Dados 100% fictícios, usados só nos modelos de relatório exibidos antes da compra. Nenhum dado real. */
import { buildReportV2, tierForProductCode, viewReport, type ReportV2 } from './normalizeV2.js';
import { renderVehiclePdf, type ReportMeta } from './pdf.js';
import { scopeForProduct } from '../lib/reportScope.js';

export const SAMPLE_RAW: Record<string, unknown> = {
 "CONSULTA": {
  "CODIGORESPOSTA": "100000001",
  "DATAHORA": "01/01/2026 10:00:00",
  "LOGON": "00000",
  "IDCONSULTA": "467"
 },
 "RESPOSTA": {
  "CODIGO": [
   "1",
   "2",
   "2",
   "2",
   "1",
   "1",
   "1",
   "1"
  ],
  "INDICIOSINISTROVEICULAR": {
   "DESCRICAORETORNO": "Sucesso",
   "INDICIODESINISTRO": "0"
  },
  "RECALL": {
   "DESCRICAORETORNO": "SEM RECALL PENDENTE"
  },
  "HISTORICOROUBOFURTO": {
   "DESCRICAORETORNO": "O VEÍCULO NÃO FOI APRESENTADO NO HISTÓRICO DE ROUBO OU FURTO."
  },
  "LEILAOCONJUGADO": {
   "DESCRICAORETORNO": "O VEÍCULO NÃO FOI APRESENTADO NA BASE DE LEILÃO."
  },
  "HISTORICOPROPRIETARIO": {
   "DESCRICAORETORNO": "SUCESSO",
   "REGISTRO_1": {
    "CHAVERETORNO": "010101010101010",
    "OCORRENCIA": "1",
    "UF_DUT": "",
    "CODIGOMUNICIPIO": "NAO INFORMADO",
    "MUNICIPIO": "NAO INFORMADO",
    "ANO_EXERCICIO": "2024",
    "PLACA": "ABC1234",
    "RENAVAM": "00123456789",
    "CHASSI": "9BWZZZ377VT004251",
    "CGC_CPF": "12345678900",
    "NOME_PROPRIETARIO": "JOAO SILVA SANTOS",
    "TIPO_DOCUMENTO": "NAO INFORMADO",
    "CORRECAO_CHASSI_RENAVAM": "NAO INFORMADO",
    "DATA_PROCESSAMENTO": "2024",
    "HORA_PROCESSAMENTO": "00:00",
    "MOTIVO_TIPO_AUTORIZACAO": "NAO INFORMADO"
   },
   "REGISTRO_2": {
    "CHAVERETORNO": "010101010101010",
    "OCORRENCIA": "2",
    "UF_DUT": "",
    "CODIGOMUNICIPIO": "NAO INFORMADO",
    "MUNICIPIO": "NAO INFORMADO",
    "ANO_EXERCICIO": "2015",
    "PLACA": "ABC1234",
    "RENAVAM": "00123456789",
    "CHASSI": "9BWZZZ377VT004251",
    "CGC_CPF": "98765432000110",
    "NOME_PROPRIETARIO": "AUTOMOVEIS BRASIL LTDA",
    "TIPO_DOCUMENTO": "NAO INFORMADO",
    "CORRECAO_CHASSI_RENAVAM": "NAO INFORMADO",
    "DATA_PROCESSAMENTO": "2015",
    "HORA_PROCESSAMENTO": "00:00",
    "MOTIVO_TIPO_AUTORIZACAO": "NAO INFORMADO"
   }
  },
  "VEICULARBNACIONAL": {
   "REGISTRO_1": {
    "DATA_EMPLACAMENTO": "15-MAR-15",
    "CHASSI": "9BWZZZ377VT004251",
    "PLACA": "ABC1234",
    "PLACA_MODELO_NOVO": "ABC1A34",
    "RENAVAM": "00123456789",
    "IDENTIFICACAO_FATURADO": "98765432000110",
    "UF_DO_FATURADO": "SP",
    "TIPO_PROPRIETARIO": "FISICA",
    "UF": "SP",
    "MUNICIPIO": "SAO PAULO",
    "ANO_FABRICACAO": "2015",
    "ANO_MODELO": "2016",
    "MARCA": "VW",
    "MODELO": "VW/GOL 1.0",
    "TIPO_VEICULO": "AUTOMOVEL",
    "ESPECIE_VEICULO": "PASSAGEIRO",
    "CARROCERIA": "NAO APLICAVEL",
    "NUMERO_CARROCERIA": "",
    "COR": "PRATA",
    "COMBUSTIVEL": "FLEX",
    "POTENCIA": "76",
    "CILINDRADA": "1000",
    "NUMERO_LUGAR": "",
    "QUANTIDADE_PASSAGEIRO": "5",
    "CAPACIDADE_CARGA": "0",
    "PESO_BRUTO_TOTAL": "0",
    "CAPACIDADE_MAXIMA_TRACAO": "0",
    "PROCEDENCIA_VEICULO": "",
    "SITUACAO_CHASSI": "N",
    "NUMERO_CAIXA_CAMBIO": "000100200",
    "NUMERO_EIXO": "0",
    "NUMERO_EIXO_TRASEIRO_DIFERENCIAL": "",
    "NUMERO_TERCEIRO_EIXO": "",
    "NUMERO_MOTOR": "BX0001234",
    "TIPO_MONTAGEM": "COMPLETA",
    "TIPO_DOCUMENTO_IMPORTADORA": "OUTROS",
    "IDENTIFICACAO_IMPORTADORA": "",
    "NUMERO_DI": "0",
    "DATA_REGISTRO_DI": "",
    "UNIDADE_LOCAL_SRF": "0",
    "ULTIMA_ATUALIZACAO": "10-JAN-20",
    "RESTRICAO1": "SEM RESTRICAO",
    "RESTRICAO2": "SEM RESTRICAO",
    "RESTRICAO3": "SEM RESTRICAO",
    "RESTRICAO4": "SEM RESTRICAO",
    "DATA_LIMITE_RESTRICAO": "",
    "SITUACAO_VEICULO": "EM CIRCULACAO",
    "NACIONALIDADE": "NACIONAL"
   }
  },
  "PRECIFICADORFIPE": {
   "DESCRICAORETORNO": "SUCESSO",
   "REGISTRO_1": {
    "STATUS": "1",
    "CHASSI": "9BWZZZ377VT004251",
    "CODIGOFIPE": "005843-1",
    "FABRICANTEFIPE": "VW - VOLKSWAGEN",
    "MODELOFIPE": "GOL 1.0 FLEX 4P",
    "ANOMODELOFIPE": "16",
    "COMBUSTIVELFIPE": "F",
    "PRECOFIPE": "32.500,00",
    "PRECOMEDIO": "32.500,00",
    "VIGENCIA": "06/2026"
   }
  },
  "VEICULOSBDRP": {
   "DESCRICAORETORNO": "SUCESSO",
   "RETORNO": {
    "EXISTE_ERRO": "0",
    "MSG_ERRO": "",
    "CHAVERETORNO": "010101020202020",
    "SITUACAOVEICULO": "CIRCULACAO",
    "PLACA": "ABC1234",
    "MUNICIPIO": "SAO PAULO-SP",
    "UF": "SP",
    "RENAVAM": "00123456789",
    "CPF_CNPJ_PROPRIETARIO": "12345678900",
    "TIPODOCUMENTOPROPRIETARIO": "FISICA",
    "PRONOME": "12345678900 JOAO SILVA SANTOS",
    "LICDATA": "20/05/2025",
    "DATAEMISSAOCRV": "15/03/2015",
    "CHASSI": "9BWZZZ377VT004251",
    "TIPODOCUMENTOFATURADO": "JURIDICA",
    "CPFCNPJFATURADO": "98765432000110",
    "UFFATURADO": "SP",
    "TIPODOCUMENTOIMPORTADORA": "",
    "TIPOREMARCACAOCHASSI": "NORMAL",
    "MARCAMODELOCOMPLETO": "VW/GOL 1.0",
    "MARCA": "VOLKSWAGEN",
    "MODELO": "GOL 1.0",
    "VEIANOFABR": "2015",
    "VEIANOMODELO": "2016",
    "TIPO": "AUTOMOVEL",
    "CARROCERIA": "INEXISTENTE",
    "COR": "PRATA",
    "ESPECIE": "PASSAGEIRO",
    "VEICATEGORIA": "PARTICULAR",
    "COMBUSTIVEL": "FLEX",
    "POTENCIA": "76",
    "CILINDRADA": "1000",
    "CAPACIDADECARGA": "0",
    "CODIGOCATEGORIA": "1",
    "CODIGOCOR": "5",
    "CODIGOMARCA": "595959",
    "CODIGOTIPO": "6",
    "VEIPROCEDENCIA": "NACIONAL",
    "CAPACIDADEPASSAG": "5",
    "MOTOR": "BX0001234",
    "NUMERO_CAIXACAMBIO": "000100200",
    "NUMERO_CARROCERIA": "",
    "NUMERO_EIXOTRASEIRODIF": "",
    "NUMERO_TERCEIROEIXO": "",
    "CMT": "0",
    "PBT": "0",
    "EIXOS": "0",
    "TIPOTRANSACAO": "",
    "RESTRICAOFINAN": "ALIENACAO FIDUCIARIA",
    "RESTRICAONOMEAGENTE": "BANCO EXEMPLO S.A.",
    "CGCFINANCEIRA": "00000000000191",
    "RESTRICAOARRENDATARIO": "",
    "RESTRICAODATAINCLUSAO": "10/03/2023",
    "NUMEROCONTRATOFINANCEIRA": "000000000",
    "CODIGOAGENTEFINANCEIRO": "",
    "DATAVIGENCIACONTRATOFINANCEIRA": "",
    "EXISTEDEBITODEIPVA": "NAO EXISTE DEBITO DE IPVA",
    "EXISTEDEBITOMULTA": "NAO EXISTE DEBITO DE MULTA",
    "DEBIPVA": "0,00",
    "EXISTEDEBITODELICENCIAMENTO": "NAO EXISTE DEBITO DE LICENCIAMENTO",
    "EXISTEDEBITODELICENCIAMENTOVL": "0,00",
    "VALORTOTALDEBITOMULTA": "0,00",
    "EXISTEDEBITODEDPVAT": "NAO EXISTE DEBITO DE DPVAT",
    "DPVAT": "0,00",
    "OUTRAS_RESTRICOES_01": "NADA CONSTA",
    "OUTRAS_RESTRICOES_02": "NADA CONSTA",
    "OUTRAS_RESTRICOES_03": "NADA CONSTA",
    "OUTRAS_RESTRICOES_04": "NADA CONSTA",
    "PRONOMEANTERIOR": "AUTOMOVEIS BRASIL LTDA",
    "RESTRICAOCPFCNPJARRENDATAR": "",
    "INTENCAORESTRICAOFINAN": "",
    "INTENCAONOMEAGENTE": "",
    "INTENCAONOMEFINANC": "",
    "INTENCAOCPFCNPJFINANC": "",
    "INTENCAODATAINCLUSAO": "",
    "DEBDERSA": "0,00",
    "DEBDER": "0,00",
    "DEBDETRAN": "0,00",
    "DEBCETESB": "0,00",
    "DEBRENAINF": "0,00",
    "DEBMUNICIPAIS": "0,00",
    "DEBPOLRODFED": "0,00",
    "RESFURTO": "NADA CONSTA",
    "RESGUINCHO": "NADA CONSTA",
    "RESADMINISTRATIVA": "NADA CONSTA",
    "RESJUDICIAL": "NADA CONSTA",
    "RESTRIBUTARIA": "NADA CONSTA",
    "RESRENAJUD": "NADA CONSTA",
    "RESAMBIENTAL": "VEICULO COM INSPECAO VEICULAR OK",
    "LICEXELIC": "2025",
    "CCOMUNICACAOVENDA": "NAO CONSTA COMUNICACAO DE VENDAS",
    "CCOMUNICINCLUSAO": "",
    "TIPODOCCOMPRADOR": "",
    "CPFCNPJCOMPRADOR": "",
    "DATAVENDA": "",
    "NOTAFISCAL": "",
    "PROTOCOLODETRAN": "",
    "INSPECAOANO": "",
    "INSPECAOCENTRO": "",
    "INSPECAODATA": "",
    "INSPECAOSELO": "",
    "INSPECAOSTATUS": "",
    "CODIGOFINANCEIRA": "",
    "DATAINCLUSAOINTENCAOTROCAFINANCEIRA": "",
    "DATALIMITERESTRICAOTRIBUTARIA": "",
    "TEMPOEXECUCAO": "1",
    "REDUNDANCIA": "ORIGINAL",
    "HORA": "1000000000",
    "DATA": "01/01/2026"
   }
  }
 }
};

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function sampleSeries(now = new Date()) {
  const out: Array<{ label: string; time: number; cents: number }> = [];
  for (let i = 23; i >= 0; i--) {
    const t = now.getFullYear() * 12 + now.getMonth() - i;
    out.push({ label: `${MONTHS[t % 12]}/${Math.floor(t / 12)}`, time: t, cents: 3250000 + (i * 15000) });
  }
  return out;
}

/** Cópia do exemplo com o financiamento zerado (consultas gerais mostram "nada consta"; só a de Gravame mostra o contrato fictício). */
function withoutLien(): Record<string, unknown> {
  const raw = structuredClone(SAMPLE_RAW) as { RESPOSTA: { VEICULOSBDRP: { RETORNO: Record<string, string> } } };
  const r = raw.RESPOSTA.VEICULOSBDRP.RETORNO;
  r.RESTRICAOFINAN = 'NADA CONSTA';
  for (const k of ['RESTRICAONOMEAGENTE', 'RESTRICAODATAINCLUSAO', 'CGCFINANCEIRA', 'NUMEROCONTRATOFINANCEIRA']) r[k] = '';
  return raw as unknown as Record<string, unknown>;
}

const cache = new Map<string, ReportV2>();
export function sampleReport(withLien = false): ReportV2 {
  const key = withLien ? 'lien' : 'clean';
  let hit = cache.get(key);
  if (!hit) {
    hit = buildReportV2({ ...(withLien ? SAMPLE_RAW : withoutLien()), enrichment: { fipeHistory: { series: sampleSeries() }, generatedAt: new Date().toISOString() } });
    cache.set(key, hit);
  }
  return hit;
}

/** O relatório de exemplo exatamente como o cliente receberia neste produto (mesmas seções, mesmas regras de privacidade). */
export function sampleViewFor(productId: string): ReportV2 {
  const scope = scopeForProduct(productId, new Date());
  return viewReport(sampleReport(productId === 'LIEN'), { audience: 'client', tier: tierForProductCode(productId), sections: scope.sections, template: scope.template });
}

export function sampleSections(productId: string): Array<{ key: string; label: string; items: string[] }> {
  return sampleViewFor(productId).sections
    .map((s) => ({ key: s.key, label: s.label, items: s.items.filter((i) => i.state !== 'NOT_PROVIDED').map((i) => i.label) }))
    .filter((s) => s.items.length > 0);
}

const pdfCache = new Map<string, { at: number; buf: Buffer }>();
export async function samplePdf(productId: string, productName: string): Promise<Buffer> {
  const hit = pdfCache.get(productId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.buf;
  const meta: ReportMeta = { productName, verificationCode: 'MODELO', verificationUrl: 'https://placanamao.com.br', consultedAt: new Date(), brandName: 'Placa na Mão', sample: true };
  const buf = await renderVehiclePdf(sampleViewFor(productId), meta);
  pdfCache.set(productId, { at: Date.now(), buf });
  return buf;
}
