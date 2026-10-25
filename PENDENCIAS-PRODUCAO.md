# Pendências para produção (1.12.1)

## Roteiro de configuração (teste e produção)

Fazer nesta ordem. Teste e produção usam as mesmas variáveis; só mudam os valores.

1. **Brevo**: criar a conta, adicionar o domínio em Remetentes e domínios e publicar no DNS os registros que o Brevo mostrar (SPF, DKIM e DMARC). Esperar ficar "autenticado". Criar o remetente (ex.: `no-reply@seudominio`).
2. **SMTP no Coolify**: `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER`, `SMTP_PASSWORD` (chave SMTP), `EMAIL_FROM`, `EMAIL_WEBHOOK_SECRET`. Reiniciar. Testar em Integrações > e-mail e criando um membro da equipe (o convite sai por e-mail).
3. **Acesso da equipe**: no Coolify, `TEAM_TOTP_REQUIRED=false` (ou remover a variável). Opcional: `TEAM_TRUSTED_DEVICE_DAYS`.
4. **Pagamento (teste)**: `PAYMENT_PROVIDER=mercadopago` com `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` de teste (veja "Mercado Pago: configuração exata"), webhook em `https://SEU-DOMINIO/api/payments/mercadopago/webhook`. Pagar, estornar e conferir a conciliação. Ou `asaas` com a chave de homologação.
5. **Pagamento (produção)**: trocar para as credenciais reais só depois do passo 4 completo.
6. **Ambientes**: ideal um app de teste no Coolify (outro subdomínio, outro banco, credenciais de teste) e outro de produção. Em produção: `NODE_ENV=production`, `SANDBOX_SEED_ENABLED=false`, `PAYMENT_PROVIDER` real ou `disabled`.
7. **Antes do deploy**: backup do banco; `/ready` como verificação de saúde.


O que o código já faz está no CHANGELOG. Aqui está só o que falta, quem precisa decidir e o que fica desligado até lá. Nada foi ligado, testado contra serviço real nem publicado.

## Antes de qualquer cobrança ou consulta real

| Item | O que falta | Quem |
|---|---|---|
| Credify | Corpo da requisição (`CREDIFY_QUERY_BODY_TEMPLATE`), caminho e método finais, credenciais de homologação, preço por consulta e contrato. O adaptador não consulta nada sem isso. | Você + fornecedor |
| Mercado Pago | Variáveis `PAYMENT_PROVIDER=mercadopago`, `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET`; cadastrar no painel do Mercado Pago a URL `https://SEU-DOMINIO/api/payments/mercadopago/webhook` (evento Pagamentos). Comece com a credencial de teste e use Integrações > Testar conexão; teste pagamento, estorno e conciliação antes de trocar para a de produção. Não implementado: reembolso parcial, parcelamento, exclusão de meios de pagamento. Conciliação não tem tela para pedido sem linha de pagamento. | Você |
| Dados do fornecedor | Contrato/DPA (LGPD) com quem fornece os dados veiculares. | Você + jurídico |
| Fiscal | Definir com o contador regime, alíquotas e se a nota é emitida por provedor ou à mão. Não existe adaptador de NFS-e; a emissão automática não é disparada sozinha. | Contador |

## Mercado Pago: configuração exata

O sistema já cria o checkout, recebe o aviso (webhook), libera o saldo ou a consulta, estorna e concilia. Falta só a conta e as credenciais.

**1. Conta e aplicação (no site do Mercado Pago)**
1. Conta do Mercado Pago com identidade validada e a conta bancária ou chave Pix que vai receber.
2. Em "Suas integrações", criar uma aplicação para **pagamentos online** com **Checkout Pro**.
3. Na aplicação, criar duas **contas de teste**: uma de vendedor e uma de comprador. O vendedor de teste já vem criado com a aplicação.
4. Anotar o **Access Token de teste** (credenciais de teste) e depois o de **produção**. O de teste também começa com `APP_USR`; não dá para distinguir pelo prefixo. O botão "Testar conexão" do painel mostra qual é.

**2. Variáveis no Coolify (teste)**

| Variável | Valor |
|---|---|
| `PAYMENT_PROVIDER` | `mercadopago` |
| `MP_ACCESS_TOKEN` | Access Token de teste |
| `MP_WEBHOOK_SECRET` | Assinatura secreta do webhook (passo 3) |
| `MP_STATEMENT_DESCRIPTOR` | `PLACANAMAO` (aparece na fatura do cartão, até 22 letras) |
| `MP_BINARY_MODE` | `false` (Pix e cartão em análise continuam valendo) |
| `MP_EXPIRES_MINUTES` | `0` (usa o prazo padrão do Mercado Pago) |
| `PAYMENT_SYNC_WORKER` | `true` (já é o padrão; confere pedidos abertos a cada 3 minutos) |

Em produção `PAYMENT_PROVIDER=sandbox` é proibido. `APP_URL` precisa ser `https://placanamao.com.br`: o Mercado Pago só aceita endereço HTTPS público.

**3. Webhook (Suas integrações > aplicação > Webhooks > Configurar notificações)**
1. Aba **Modo produtivo**, URL: `https://placanamao.com.br/api/payments/mercadopago/webhook`
2. Marcar o evento **Pagamentos**.
3. **Salvar configuração**. Isso gera a **chave secreta**. Copiar para `MP_WEBHOOK_SECRET` e fazer o redeploy.
4. Pagamentos feitos com credencial de teste **não mandam aviso**. Por isso o sistema também confere sozinho: ao voltar do checkout (tela da Carteira) e a cada 3 minutos para pedidos abertos. Para testar o aviso em si, use "Simular" na mesma tela do Mercado Pago (o Data ID de teste não existe de verdade e o sistema não acha o pagamento e responde erro; isso é esperado, o que vale é a assinatura ter sido aceita).

**4. Teste de ponta a ponta**
1. Painel > Integrações > Mercado Pago > **Testar conexão**: mostra "Credencial de teste" e "Segredo do webhook definido".
2. Entrar como cliente, Carteira > Comprar um pacote. Pagar com a conta de comprador de teste.
3. Ao voltar, o saldo entra em segundos. Conferir em Painel > Pagamentos.
4. Testar também: pagamento recusado, Pix pendente e estorno (Painel > pagamento > Estornar). Pagamento que ficar pendente: botão **Conciliar** na linha dele em Painel > Pagamentos.

**5. Produção**
1. Trocar `MP_ACCESS_TOKEN` pelo Access Token de **produção** (a conta precisa estar habilitada para cobrar).
2. Se o segredo do webhook for diferente no modo produtivo, atualizar `MP_WEBHOOK_SECRET`.
3. Redeploy, **Testar conexão** (deve dizer "Credencial de produção") e fazer uma compra real do menor valor. Estornar depois, se quiser.

**Não implementado:** estorno parcial, parcelamento personalizado, exclusão de meios de pagamento, Pix com QR code dentro do site (hoje o Pix e o cartão acontecem na página do Mercado Pago).

## Contratos e assinatura

- Para subir a sua minuta: Contratos > Modelos > "Enviar minuta (.txt ou .md)" cria uma nova versão em rascunho; use as variáveis do painel (valores, descontos, vigência e comissão são calculados pelo sistema). Para .docx, cole o texto no editor.
- As minutas foram escritas como ponto de partida e **não passaram por advogado**. O sistema impede publicar versão sem a referência da revisão jurídica registrada por outra pessoa.
- A assinatura atual é **aceite eletrônico simples** (nome digitado, hash do texto, IP em HMAC, navegador, data). Se o negócio exigir assinatura avançada ou qualificada (ICP-Brasil), é preciso contratar provedor e integrar; ainda não há documentação nem credenciais.
- Decisão comercial pendente: modelo de pacote personalizado (hoje é registrado como ação manual), descontos máximos e regras de comissão por parceiro.

## E-mail (Brevo): configuração exata

**Já conferido nas telas (22/10/2026):** DNS no Cloudflare (DKIM `brevo1`/`brevo2`, `brevo-code`, DMARC, `em`/`img.em`/`r.em`, todos "Somente DNS") e remetente `no-reply@placanamao.com.br` verificado, com DKIM e DMARC ok.

**1. Coolify (variáveis, copiar como está; só os três em maiúsculas entre aspas são seus)**

```
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<login SMTP: Brevo > SMTP e API > aba SMTP (parece xxxx@smtp-brevo.com, não é o e-mail da conta)>
SMTP_PASSWORD=<chave SMTP gerada na mesma tela (começa com xsmtpsib-), não a chave de API>
EMAIL_FROM=no-reply@placanamao.com.br
EMAIL_REPLY_TO=placanamao@gmail.com
EMAIL_WEBHOOK_SECRET=<texto aleatório longo, 40+ caracteres, sem espaço>
EMAIL_OUTBOX_WORKER=true
APP_NAME=Placa na Mão
```

`EMAIL_FROM` tem que ser exatamente o remetente verificado no Brevo. O e-mail sai como "Placa na Mão <no-reply@placanamao.com.br>" e, se a pessoa responder, a resposta vai para `EMAIL_REPLY_TO` (o Gmail). O Gmail não entra em nenhuma outra variável: ele só recebe. Já os avisos de novas mensagens do formulário de contato vão para o "e-mail de suporte" em Configurações do painel; coloque o mesmo Gmail lá. Depois de salvar, reiniciar o app.

**1b. Se o teste de conexão demorar uns 15 segundos e falhar (erro 502), o servidor está bloqueando a saída de SMTP.** A DigitalOcean bloqueia as portas 25, 465 e 587 em contas novas. Duas saídas:

- *Porta alternativa:* no terminal do app no Coolify, `nc -vz -w 8 smtp-relay.brevo.com 587` e `nc -vz -w 8 smtp-relay.brevo.com 2525`. Se só o 2525 abrir, use `SMTP_PORT=2525` (com `SMTP_SECURE=false`).
- *API do Brevo (recomendado, usa a porta 443, que nunca é bloqueada):* troque no Coolify para
  ```
  EMAIL_PROVIDER=brevo_api
  BREVO_API_KEY=<Brevo > SMTP e API > aba Chaves de API > Gerar uma nova chave de API>
  ```
  e pode remover `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` e `SMTP_PASSWORD`. `EMAIL_FROM`, `EMAIL_REPLY_TO` e `EMAIL_WEBHOOK_SECRET` continuam iguais. Com a restrição de IP ligada no Brevo, o IP do servidor (`159.223.105.157`) também precisa estar liberado para a chave de API.

**2. Remetente do Gmail no Brevo**: não use `placanamao@gmail.com` como remetente. Gmail não permite assinatura própria (DKIM "Padrão") e o aviso vermelho da tela de remetentes vem dele. Pode apagar esse remetente; o oficial é o do domínio.

**3. Webhook de retorno de entrega (Brevo > Plug-ins e integrações > Webhooks)**: clicar em "Adicionar webhook", escolher **Webhook de saída** (o da esquerda, "Envie eventos do Brevo para uma ferramenta externa") e preencher:

- Tipo: **Transacional**
- URL: `https://placanamao.com.br/api/webhooks/email/brevo`
- Eventos: Entregue, Hard bounce, Soft bounce, Bloqueado, Spam (reclamação) e E-mail inválido
- Autenticação: se aparecer, **Bearer token** com o mesmo valor de `EMAIL_WEBHOOK_SECRET`. Se aparecer cabeçalho personalizado: nome `x-webhook-token`, valor igual ao `EMAIL_WEBHOOK_SECRET`. O servidor aceita Bearer, cabeçalho `x-webhook-token` ou Basic (a senha é o segredo). Sem autenticação ele recusa (401).

**4. Teste (nesta ordem)**

1. Painel > Integrações > "Testar conexão e enviar e-mail de teste". Deve dizer conexão ok e chegar um e-mail para o seu endereço em até 1 minuto. Se der "credenciais recusadas", a `SMTP_USER` ou a `SMTP_PASSWORD` está errada (confira que é a chave SMTP).
   Se der **credenciais recusadas**: (a) `SMTP_USER` é o login SMTP (`xxxx@smtp-brevo.com`), não o e-mail da conta; (b) `SMTP_PASSWORD` é a chave SMTP (`xsmtpsib-...`), não a chave de API; (c) sem espaços, aspas ou asteriscos no valor (cole o valor inteiro, sem máscara); (d) reiniciar/redeployar o app depois de salvar as variáveis; (e) no Brevo, em Segurança > Endereços IP autorizados, se a restrição estiver ligada, inclua o IP do servidor (`159.223.105.157`) ou desligue a restrição. Se der **não foi possível conectar**: confira `SMTP_HOST=smtp-relay.brevo.com` e `SMTP_PORT=587` com `SMTP_SECURE=false`.
2. Equipe e acessos > novo membro com um e-mail seu de teste: o convite com o link deve chegar.
3. No Brevo > Transacional > Logs, o e-mail aparece como "Entregue". O estado interno (ENVIADO, ENTREGUE, BOUNCED) fica na fila de e-mail, hoje só pela API do painel (`GET /api/admin/email-outbox`); ainda não há tela para ela.
4. Teste direto do webhook, pelo terminal (troque SEGREDO). Com o token certo deve responder `{"ok":true,"received":1,"applied":0}`; sem o token, 401:

```
curl -i -X POST https://placanamao.com.br/api/webhooks/email/brevo -H "Authorization: Bearer SEGREDO" -H "Content-Type: application/json" -d '{"event":"delivered","message-id":"<teste>"}'
```

**5. Se o webhook não chegar**: o site está atrás do proxy do Cloudflare (nuvem laranja). Em Segurança > WAF, crie uma regra "Skip" para o caminho `/api/webhooks/email/brevo`, ou desligue o "Bot Fight Mode".

**6. DNS, observações**: o SPF `v=spf1 -all` pode ficar; o Brevo assina por DKIM e o DMARC passa por ele. O MX `.` (sem recebimento) faz o domínio não receber e-mail, o que é certo para `no-reply`. Se quiser receber em `contato@placanamao.com.br`, use Email Routing do Cloudflare (ele substitui esse MX). O DMARC `p=none` serve para começar; depois de uma semana sem problemas nos relatórios, pode subir para `p=quarantine`.

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
- Antes do deploy: backup do banco; migrações 027–037 rodam sozinhas na subida; `npm run db:rollback -- 9` reverte.
