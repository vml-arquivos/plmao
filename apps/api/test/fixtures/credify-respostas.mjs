// Respostas de exemplo da Credify (formato publicado na documentação) para as auditorias sem custo.
import fs from 'node:fs';

const base = JSON.parse(fs.readFileSync(new URL('./exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
export const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const consulta = (id) => ({ CODIGORESPOSTA: '1', DATAHORA: '01/01/2026 10:00:00', LOGON: '1', IDCONSULTA: id });
const ok = (id, resposta) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '1', ...resposta } });
const absent = (id, text) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '2', DESCRICAORETORNO: text } });

/** Veículo fictício legível (a amostra da documentação vem com X nos campos de identificação). */
export const IDENT = { CHASSI: '9BWZZZ377VT004251', RENAVAM: '00123456789', MARCA: 'VW', MODELO: 'GOL 1.0', MARCAMODELOCOMPLETO: 'VW/GOL 1.0 FLEX', COR: 'PRATA', COMBUSTIVEL: 'ALCOOL/GASOLINA', MOTOR: 'CFZ123456', MUNICIPIO: 'SAO PAULO', CILINDRADA: '1000', POTENCIA: '76', VEIANOFABR: '2020', VEIANOMODELO: '2021', PLACA: 'AAA0000', CPF_CNPJ_PROPRIETARIO: '12345678900', CPFCNPJFATURADO: '12345678900' };
const withRet = (flags) => { const c = structuredClone(base); Object.assign(c.RESPOSTA.VEICULOSBDRP.RETORNO, IDENT, flags); return c; };

const ALIENADO = { RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA', RESTRICAONOMEAGENTE: 'BANCO EXEMPLO S.A.', CGCFINANCEIRA: '00000000000191', NUMEROCONTRATOFINANCEIRA: '0045-9981234-7', RESTRICAODATAINCLUSAO: '20240220', DATAVIGENCIACONTRATOFINANCEIRA: '20290220' };
const CARREGADA_FLAGS = { ...ALIENADO, RECALL: 'POSSUI RECALL', RESFURTO: 'CONSTA OCORRENCIA', RESJUDICIAL: 'CONSTA RESTRICAO JUDICIAL', RESRENAJUD: 'CONSTA RESTRICAO RENAJUD' };

const NACIONAL = ok('369', { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { DATA_EMPLACAMENTO: '15-MAR-15', CHASSI: IDENT.CHASSI, PLACA: 'AAA0000', PLACA_MODELO_NOVO: 'AAA0A00', RENAVAM: IDENT.RENAVAM, UF: 'SP', MUNICIPIO: 'SAO PAULO', ANO_FABRICACAO: '2020', ANO_MODELO: '2021', MARCA: 'VW', MODELO: 'VW/GOL 1.0', COR: 'PRATA', COMBUSTIVEL: 'FLEX', SITUACAO_CHASSI: 'N', NUMERO_MOTOR: 'CFZ123456', TIPO_MONTAGEM: 'COMPLETA', ULTIMA_ATUALIZACAO: '10-JAN-20', RESTRICAO1: 'SEM RESTRICAO', RESTRICAO2: 'SEM RESTRICAO', RESTRICAO3: 'SEM RESTRICAO', RESTRICAO4: 'SEM RESTRICAO', SITUACAO_VEICULO: 'EM CIRCULACAO', NACIONALIDADE: 'NACIONAL' } });
const LEILAO_DADOS = ok('448', { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { IDLEILAO: '48211', LOTE: '0137', LEILOEIRO: 'LEILOEIRO EXEMPLO', DATALEILAO: '2025-03-14', COMITENTE: 'SEGURADORA EXEMPLO', CONDICAOGERALDOVEICULO: 'RECUPERAVEL' } });
const LEILAO_NADA = absent('448', 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.');
const GRAVAME = ok('533', { GRAVAME: { PLACA: 'AAA0000', CHASSI: IDENT.CHASSI, GRAVAMES: { REGISTRO_1: { NUMERO_RESTRICAO: '123456', DATA_RESTRICAO: '2024-02-20', ESTADO_RESTRICAO: 'SP', STATUS: 'ATIVO', NOME_AGENTE: 'BANCO EXEMPLO S.A.', DOCUMENTO_AGENTE: '00000000000191', NUMERO_CONTRATO: '0045-9981234-7' } } } });
const GRAVAME_NADA = ok('533', { GRAVAME: { PLACA: 'AAA0000', GRAVAMES: {} } });
const RECALL = ok('452', { RECALL: { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { DATAINICIOCAMPANHA: '04/03/2024', MONTADORA: 'VW DO BRASIL', IDGRAVIDADE: '3', INDICATIVO: 'GRANDE IMPORTANCIA', MARCAMODELO: 'VW/GOL' } } });
const ROUBO = ok('456', { DESCRICAORETORNO: 'SUCESSO', OCORRENCIA: 'FURTO', UF_DUT: 'DF' });
const RENAJUD = ok('483', { RENAJUD: { REGISTRO_1: { NUMERODOPROCESSO: '0001234-56.2024.8.26.0100', TRIBUNAL: 'TJSP', DATAINCLUSAO: '2024-06-01', TIPORESTRICAO: 'TRANSFERENCIA' } } });
const RENAINF = ok('536', { RENAINF: { PLACA: 'AAA0000', RESTRICOES: { INDICADOR_RENAINF: 'TRUE' }, DEBITOS: [{ TOTAL: '195.23', MULTA: '195.23', DATA_VENCIMENTO: '10/12/2026', DESCRICAO: 'EXCESSO DE VELOCIDADE', STATUS_PAGAMENTO: 'opened', TIPO: '3', DADOS_EXTRAS: [{ GRUPO: 'Detalhamento Multa', CHAVE: 'Local', EXTRA1: 'AV BRASIL, 1000' }] }] } });
const OWNERS = ok('458', { DESCRICAORETORNO: 'SUCESSO', QUANTIDADE: '2', REGISTRO_1: { ANO_EXERCICIO: '2024', NOME_PROPRIETARIO: 'JOAO SILVA SANTOS', UF_DUT: 'SP' }, REGISTRO_2: { ANO_EXERCICIO: '2022', NOME_PROPRIETARIO: 'MARIA SOUZA', UF_DUT: 'RJ' } });
const OWNER_PLATE = ok('514', { DESCRICAORETORNO: 'SUCESSO', NOME_PROPRIETARIO: 'JOAO SILVA SANTOS' });
const FIPE = ok('454', { PRECIFICADORFIPE: { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { STATUS: '1', CHASSI: IDENT.CHASSI, CODIGOFIPE: '005004-1', FABRICANTEFIPE: 'VW - VOLKSWAGEN', MODELOFIPE: 'GOL 1.0 FLEX 4P', ANOMODELOFIPE: '2021', COMBUSTIVELFIPE: 'F', PRECOFIPE: '45.000,00', PRECOMEDIO: '44.000,00', VIGENCIA: '11/2026' } } });
const SINISTRO = (v) => ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: v });

/** FIPE pública (histórico de preços): resposta de mentira, 24 meses, sem acesso à internet. */
export const fipePublic = async (url) => {
  const u = String(url);
  if (u.endsWith('/years')) return new Response(JSON.stringify([{ code: '2021-1', name: '2021 Gasolina' }]), { status: 200 });
  if (u.endsWith('/history')) { const out = []; for (let i = 23; i >= 0; i--) { const d = new Date(Date.UTC(2026, 10 - i, 1)); out.push({ month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, price: `R$ ${(45000 - i * 150).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` }); } return new Response(JSON.stringify({ priceHistory: out }), { status: 200 }); }
  return new Response('{}', { status: 404 });
};

export const SCENARIOS = {
  'placa limpa': { [`/debitosrestricoesproprietarios`]: withRet({}), '/indiciosinistro': SINISTRO('0'), '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_NADA, '/gravame': GRAVAME_NADA, '/historicoproprietario': OWNERS, '/veiculoproprietarioplaca': OWNER_PLATE, '/precificadorfipe': FIPE, '/renainf': ok('536', { RENAINF: { PLACA: 'AAA0000', DEBITOS: [] } }), '/renajud': ok('483', { RENAJUD: {} }) },
  'alienação sem detalhe no cadastro': { '/debitosrestricoesproprietarios': withRet({ RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA', RESTRICAONOMEAGENTE: [], NUMEROCONTRATOFINANCEIRA: [], RESTRICAODATAINCLUSAO: [], CGCFINANCEIRA: [] }), '/indiciosinistro': SINISTRO('0'), '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_NADA, '/gravame': GRAVAME, '/historicoproprietario': OWNERS, '/veiculoproprietarioplaca': OWNER_PLATE, '/precificadorfipe': FIPE, '/renainf': ok('536', { RENAINF: { PLACA: 'AAA0000', DEBITOS: [] } }), '/renajud': ok('483', { RENAJUD: {} }) },
  'placa com ocorrências': { '/debitosrestricoesproprietarios': withRet(CARREGADA_FLAGS), '/indiciosinistro': SINISTRO('1'), '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_DADOS, '/gravame': GRAVAME, '/historicoproprietario': OWNERS, '/veiculoproprietarioplaca': OWNER_PLATE, '/precificadorfipe': FIPE, '/renainf': RENAINF, '/renajud': RENAJUD, '/recall': RECALL, '/historicoroubofurto': ROUBO }
};

