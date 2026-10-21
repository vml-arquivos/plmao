import { pool } from '../db.js';

/**
 * Modelos iniciais de contrato da Placa na Mão. SÃO MINUTAS: entram como RASCUNHO e só podem ser publicados
 * depois de revisão jurídica registrada (referência do parecer). Nenhuma cláusula aqui foi validada por advogado.
 */
export const CONTRACT_VARIABLES = [
  'numero', 'data', 'contratada.nome', 'contratada.documento', 'contratada.endereco',
  'contratante.nome', 'contratante.documento', 'contratante.endereco', 'contratante.email',
  'condicoes_comerciais', 'vigencia', 'pagamento', 'comissao', 'contrato_original'
] as const;

const HEADER = `CONTRATO Nº {{numero}}\n\nDe um lado, {{contratada.nome}}, CNPJ {{contratada.documento}}, com sede em {{contratada.endereco}} ("PLACA NA MÃO"); de outro, {{contratante.nome}}, inscrito(a) sob o documento {{contratante.documento}}, com endereço em {{contratante.endereco}}, e-mail {{contratante.email}} ("{{PAPEL}}"). Data de emissão: {{data}}.\n`;

const DATA_CLAUSE = `PROTEÇÃO DE DADOS. As partes tratam dados pessoais em conformidade com a Lei nº 13.709/2018 (LGPD), somente para as finalidades deste contrato, com medidas de segurança adequadas e comunicação de incidentes relevantes à outra parte. Dados de consulta veicular são usados apenas para a consulta contratada e para obrigações legais.`;
const FORO = `FORO. Fica eleito o foro da comarca do domicílio do(a) contratante para dirimir controvérsias, observadas as regras de competência aplicáveis.`;
const LIMITES = `NATUREZA DO SERVIÇO. A PLACA NA MÃO disponibiliza informações de bases de terceiros e não substitui vistoria, perícia, certidões oficiais nem consulta aos órgãos competentes. As informações refletem a data e a fonte de cada consulta e podem mudar depois dela.`;

export const CONTRACT_MODELS: Array<{ code: string; name: string; kind: 'PF_AVULSO' | 'PJ_B2B' | 'PACOTE_PERSONALIZADO' | 'PARCEIRO' | 'ADITIVO'; title: string; body: string }> = [
  {
    code: 'PF_AVULSO', name: 'Pessoa física — consultas avulsas', kind: 'PF_AVULSO', title: 'Contrato de prestação de serviço de consulta veicular (pessoa física)',
    body: `${HEADER.replace('{{PAPEL}}', 'CLIENTE')}
1. OBJETO. Disponibilização ao CLIENTE de consultas veiculares e relatórios, nas condições abaixo.
2. CONDIÇÕES COMERCIAIS.
{{condicoes_comerciais}}
3. PAGAMENTO. {{pagamento}}
4. VIGÊNCIA. {{vigencia}}
5. ${LIMITES}
6. ${DATA_CLAUSE}
7. ${FORO}`
  },
  {
    code: 'PJ_B2B', name: 'Empresa — consultas com preço acordado', kind: 'PJ_B2B', title: 'Contrato de prestação de serviço de consulta veicular (empresa)',
    body: `${HEADER.replace('{{PAPEL}}', 'CONTRATANTE')}
1. OBJETO. Disponibilização à CONTRATANTE de consultas veiculares e relatórios para uso em sua atividade, com preços acordados.
2. CONDIÇÕES COMERCIAIS E PREÇOS.
{{condicoes_comerciais}}
3. PAGAMENTO. {{pagamento}}
4. VIGÊNCIA E RESCISÃO. {{vigencia}} Qualquer parte pode rescindir com aviso prévio por escrito de 30 dias; consultas já realizadas permanecem devidas.
5. USO DAS INFORMAÇÕES. A CONTRATANTE usa as informações apenas para finalidade legítima e é responsável pelo acesso de seus usuários; é vedada a revenda ou a exposição pública dos relatórios sem autorização.
6. ${LIMITES}
7. ${DATA_CLAUSE}
8. ${FORO}`
  },
  {
    code: 'PACOTE_PERSONALIZADO', name: 'Pacote personalizado', kind: 'PACOTE_PERSONALIZADO', title: 'Contrato de pacote personalizado de consultas',
    body: `${HEADER.replace('{{PAPEL}}', 'CONTRATANTE')}
1. OBJETO. Fornecimento do pacote personalizado descrito nas condições comerciais, combinando itens do catálogo e itens sob medida.
2. COMPOSIÇÃO, PREÇOS E DESCONTOS.
{{condicoes_comerciais}}
3. PAGAMENTO. {{pagamento}} A liberação do pacote depende da confirmação do pagamento; a assinatura deste contrato, por si só, não libera consultas.
4. VIGÊNCIA. {{vigencia}} Saldo não utilizado ao fim da vigência segue a regra definida nas condições comerciais.
5. ${LIMITES}
6. ${DATA_CLAUSE}
7. ${FORO}`
  },
  {
    code: 'PARCEIRO', name: 'Parceiro — comissão por indicação', kind: 'PARCEIRO', title: 'Contrato de parceria comercial com comissão',
    body: `${HEADER.replace('{{PAPEL}}', 'PARCEIRO')}
1. OBJETO. O PARCEIRO indica clientes à PLACA NA MÃO e recebe comissão sobre vendas confirmadas e pagas originadas de sua indicação, sem vínculo empregatício, societário ou de exclusividade.
2. COMISSÃO.
{{comissao}}
3. CONDIÇÕES COMERCIAIS.
{{condicoes_comerciais}}
4. PAGAMENTO DA COMISSÃO. Comissões só passam a ser devidas após a confirmação do pagamento do cliente e do prazo de segurança indicado, e são revertidas em caso de estorno, chargeback ou cancelamento. {{pagamento}}
5. CONDUTA. O PARCEIRO não faz promessas em nome da PLACA NA MÃO, não usa dados de consulta de terceiros e respeita a legislação de publicidade e de proteção de dados.
6. VIGÊNCIA. {{vigencia}}
7. ${DATA_CLAUSE}
8. ${FORO}`
  },
  {
    code: 'ADITIVO', name: 'Aditivo contratual', kind: 'ADITIVO', title: 'Aditivo ao contrato {{contrato_original}}',
    body: `${HEADER.replace('{{PAPEL}}', 'CONTRATANTE')}
ADITIVO ao contrato {{contrato_original}}.
1. ALTERAÇÕES. As condições abaixo substituem as correspondentes do contrato original; as demais permanecem inalteradas.
{{condicoes_comerciais}}
2. VIGÊNCIA DO ADITIVO. {{vigencia}}
3. PAGAMENTO. {{pagamento}}
4. ${FORO}`
  }
];

/** Cria os modelos como rascunho (idempotente). Nunca publica nada. */
export async function ensureContractModels(): Promise<void> {
  for (const m of CONTRACT_MODELS) {
    const t = await pool.query(`INSERT INTO contract_templates(code,name,kind) VALUES($1,$2,$3) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [m.code, m.name, m.kind]);
    await pool.query(`INSERT INTO contract_template_versions(template_id,version,status,title,body) VALUES($1,1,'DRAFT',$2,$3) ON CONFLICT(template_id,version) DO NOTHING`, [t.rows[0].id, m.title, m.body]);
  }
}
