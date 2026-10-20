export const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  { q: 'O que eu recebo ao consultar uma placa?', a: 'Um relatório organizado em seções (identificação, características, registro, débitos, restrições e financiamento), com um resumo de situação, valores em aberto quando informados e opção de baixar em PDF ou imprimir.' },
  { q: 'Os dados são sempre completos?', a: 'Cada campo depende do que a fonte contratada retorna para aquela placa. Quando um dado não vem, o relatório mostra “Não informado pela fonte”, sem confundir com “nada consta”.' },
  { q: 'Como funciona o pagamento?', a: 'Você paga por consulta avulsa (Pix ou cartão, conforme o checkout) ou recarrega saldo em pacotes. O preço final aparece antes de você confirmar. Se a consulta falhar por problema técnico, o valor é estornado automaticamente.' },
  { q: 'Meus relatórios ficam salvos?', a: 'Sim. Todas as consultas concluídas ficam no seu histórico, com PDF e código de verificação, para você abrir de novo quando precisar.' },
  { q: 'Dados pessoais do proprietário aparecem?', a: 'Não de forma aberta. Nome e documentos são protegidos conforme a LGPD, e dados sensíveis aparecem mascarados no relatório.' },
  { q: 'O relatório substitui a vistoria?', a: 'Não. Ele apoia a decisão com os dados disponíveis, mas não substitui vistoria, certidões ou consulta aos órgãos competentes antes de fechar negócio.' }
];

export default function Faq() {
  return <div className="faq">{FAQ_ITEMS.map((i) => <details key={i.q}><summary>{i.q}</summary><p>{i.a}</p></details>)}</div>;
}
