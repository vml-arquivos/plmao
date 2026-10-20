import Brand, { BRAND } from './Brand';

type LegalKind = 'terms' | 'privacy';

const sections: Record<LegalKind, Array<{ title: string; text: string }>> = {
  terms: [
    { title: '1. Objeto', text: 'A BUSCARR organiza consultas veiculares e relatórios conforme o produto escolhido e as informações efetivamente disponibilizadas pelas fontes contratadas. O cadastro e a Consulta Zero não obrigam a compra de uma consulta paga.' },
    { title: '2. Limites da consulta', text: 'Cada produto informa sua cobertura antes da confirmação. Informação não consultada, indisponível ou parcial não equivale a “nada consta”. O relatório apoia a decisão, mas não substitui vistoria, certidões ou verificações oficiais exigidas no negócio.' },
    { title: '3. Preços e pagamentos', text: 'Cada consulta paga informa seu preço em reais antes do checkout. O saldo pré-pago em reais e os entitlements de consulta são disponibilizados somente após confirmação do parceiro de pagamento. Em falha técnica da consulta, o sistema registra o estorno aplicável. Cancelamentos, reembolsos e chargebacks podem gerar reversões conforme o caso.' },
    { title: '4. Uso responsável', text: 'O usuário deve utilizar as informações para finalidade legítima, respeitar a legislação e não tentar acessar, compartilhar ou explorar dados fora das permissões concedidas.' },
    { title: '5. Disponibilidade', text: 'Fontes externas podem apresentar indisponibilidade ou alteração de cobertura. Produtos sem fonte real homologada permanecem indisponíveis e não devem ser vendidos como consulta concluída.' },
    { title: '6. Contato', text: `Dúvidas sobre a plataforma podem ser enviadas para ${BRAND.supportEmail}.` }
  ],
  privacy: [
    { title: '1. Dados tratados', text: 'Tratamos dados de conta, autenticação, contato, consentimento, pagamentos, carteira, consultas realizadas, registros de segurança e informações técnicas necessárias ao funcionamento da plataforma.' },
    { title: '2. Finalidades', text: 'Os dados são usados para autenticar usuários, executar consultas, gerar relatórios, processar pagamentos, prevenir fraude, prestar suporte, cumprir obrigações e melhorar a experiência mediante métricas operacionais.' },
    { title: '3. Dados veiculares e pessoais', text: 'Dados pessoais eventualmente retornados por fontes veiculares não são exibidos sem finalidade, base legal e permissão específicas. A cobertura do produto e o nível de acesso determinam quais campos podem ser apresentados.' },
    { title: '4. Compartilhamento', text: 'Compartilhamos somente o necessário com provedores de consulta, pagamento, infraestrutura, autenticação e comunicação contratados para operar o serviço, observadas as regras aplicáveis.' },
    { title: '5. Segurança e retenção', text: 'Aplicamos controles de acesso, sessões revogáveis, auditoria e proteção de credenciais. Os prazos de retenção devem atender finalidade, contrato, prevenção a fraude e obrigações legais.' },
    { title: '6. Direitos do titular', text: `O titular pode solicitar confirmação, acesso, correção, informações, oposição ou exclusão quando aplicável pelo contato ${BRAND.supportEmail}.` }
  ]
};

export default function LegalPage({ kind }: { kind: LegalKind }) {
  const title = kind === 'terms' ? 'Termos de Uso' : 'Política de Privacidade';
  return <div className="legalPage"><header><a href="/?site=1" aria-label="Voltar à página inicial"><Brand compact /></a><a href="/?site=1">Voltar ao início</a></header><main><p className="kicker">Transparência BUSCARR</p><h1>{title}</h1><p className="legalUpdated">Versão operacional · 21 de agosto de 2026</p><div className="legalNotice">Este texto estabelece as regras operacionais mínimas da plataforma. A publicação definitiva deve receber validação jurídica e refletir os contratos reais com fornecedores.</div>{sections[kind].map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.text}</p></section>)}</main><footer><a href="/termos">Termos de Uso</a><a href="/privacidade">Política de Privacidade</a><a href={`mailto:${BRAND.supportEmail}`}>Contato</a></footer></div>;
}
