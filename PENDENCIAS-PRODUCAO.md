# Pendências para produção (1.10.0)

O que o código já faz está no CHANGELOG. Aqui está só o que falta, quem precisa decidir e o que fica desligado até lá. Nada foi ligado, testado contra serviço real nem publicado.

## Antes de qualquer cobrança ou consulta real

| Item | O que falta | Quem |
|---|---|---|
| Credify | Corpo da requisição (`CREDIFY_QUERY_BODY_TEMPLATE`), caminho e método finais, credenciais de homologação, preço por consulta e contrato. O adaptador não consulta nada sem isso. | Você + fornecedor |
| Mercado Pago | `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`; cadastrar a URL do webhook; testar pagamento, estorno e conciliação com credencial `TEST-`. Não implementado: reembolso parcial, parcelamento, exclusão de meios de pagamento. Conciliação não tem tela para pedido sem linha de pagamento. | Você |
| Dados do fornecedor | Contrato/DPA (LGPD) com quem fornece os dados veiculares. | Você + jurídico |
| Fiscal | Definir com o contador regime, alíquotas e se a nota é emitida por provedor ou à mão. Não existe adaptador de NFS-e; a emissão automática não é disparada sozinha. | Contador |

## Contratos e assinatura

- As minutas foram escritas como ponto de partida e **não passaram por advogado**. O sistema impede publicar versão sem a referência da revisão jurídica registrada por outra pessoa.
- A assinatura atual é **aceite eletrônico simples** (nome digitado, hash do texto, IP em HMAC, navegador, data). Se o negócio exigir assinatura avançada ou qualificada (ICP-Brasil), é preciso contratar provedor e integrar; ainda não há documentação nem credenciais.
- Decisão comercial pendente: modelo de pacote personalizado (hoje é registrado como ação manual), descontos máximos e regras de comissão por parceiro.

## E-mail

- Configurar `EMAIL_PROVIDER=smtp` (host, usuário, senha, remetente com SPF/DKIM/DMARC) e `EMAIL_WEBHOOK_SECRET`.
- Mapear o formato de evento de entrega/devolução do provedor escolhido para o webhook genérico (`POST /api/webhooks/email`, assinatura HMAC-SHA256).

## Chat de suporte

- O assistente é determinístico: responde só com perguntas frequentes publicadas. Sem FAQs, encaminha tudo à equipe. Cadastre as perguntas no painel.
- Anexos ficam no banco (até 2 MB). Para volume maior, mover para armazenamento de objetos e passar antivírus.
- Definir quem atende, horário e prazo de resposta (não há SLA automático) e o e-mail de suporte em Configurações.

## Depoimentos

- Texto de consentimento (versão `2026-10`) precisa de revisão jurídica. Mudar o texto muda a versão e exige novo envio.
- Nenhum depoimento é criado sozinho. O cadastro manual exige comprovante de autorização e uma segunda pessoa para aprovar.

## Segurança e operação

- MFA da equipe segue opcional por decisão; o checklist avisa quem está sem. Recomendado ativar para financeiro, clientes e contratos.
- Simulador: as taxas ficam defasadas se a atualização automática (Banco Central) falhar; o site avisa depois de 3 meses e o checklist também.
- Rodar `npm audit --omit=dev --audit-level=high` e avaliar a atualização do `react-router`.
- Política de retenção do `STORE_RAW` (dado bruto do fornecedor) ainda precisa de decisão.
- Opcional: dupla aprovação para estornos de alto valor.
- Usar `GET /ready` como verificação de prontidão no Coolify (além de `/health`).
- Antes do deploy: backup do banco; migrações 027–034 rodam sozinhas na subida; `npm run db:rollback -- 8` reverte.
