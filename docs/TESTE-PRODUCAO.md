# Roteiro de teste de produção (30 minutos)

Faça com a conta de administrador e uma conta de cliente de teste. Anote o horário de cada passo.

## 1. Antes de publicar
- [ ] "Backup agora" no banco (Coolify) e anotar o horário (`docs/BACKUP.md`).
- [ ] Variáveis conferidas: `DATA_PROVIDER=real`, `CREDIFY_CLIENT_ID`, `CREDIFY_CLIENT_SECRET`, `PAYMENT_PROVIDER=mercadopago`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`.

## 2. Depois de publicar (0–5 min)
- [ ] `https://placanamao.com.br/health` responde `{"ok":true}`.
- [ ] `https://placanamao.com.br/ready` responde `ok: true` (se vier 503, a lista `migrationsMissing` mostra o que falta; não libere tráfego).
- [ ] Logs de inicialização sem erro e sem senha/chave impressa.
- [ ] `/robots.txt` e `/sitemap.xml` abrem (texto/XML, não página de erro).

## 3. Credify (5–10 min)
- [ ] Painel → Integrações → "Testar login na Credify": OK e IP do servidor autorizado.
- [ ] Uma única consulta real de teste (gasta 1 consulta) com o pacote Completa, em uma placa que você conhece. Anote o tempo mostrado.

## 4. Fluxo do cliente (10–25 min)
- [ ] Entrar como cliente, abrir "Nova consulta" (o login da Credify é preparado em segundo plano).
- [ ] Consulta com cupom 100% (sem pagamento): abre o relatório, mostra "Processando" se passar de 20 s e termina sozinho.
- [ ] Nos logs, achar a linha `query_completed` e anotar `providerMs`, `enrichMs`, `normalizeMs`, `saveMs`. Se a consulta falhar, achar `query_failed_refunded` e o motivo.
- [ ] Placa que não existe: aparece "não encontramos dados", e o valor volta ao saldo.
- [ ] Compra real mínima no Mercado Pago (Pix): pedido fica pago, direito de consulta aparece, consulta usa o direito.
- [ ] Duplo clique em "Pagar": só um pagamento é criado.

## 5. Segurança rápida
- [ ] Cliente A não consegue abrir o PDF da FIPE de um código do cliente B (deve dar "não encontrado").
- [ ] Painel pede senha, e 2FA se `TEAM_TOTP_REQUIRED=true`.

## Decisão
**Segue** se `/ready` ok, consulta do cliente concluída e compra Pix creditada. **Volta a imagem anterior** se `/ready` falhar, houver erro 5xx público ou a consulta paga ficar sem retorno/estorno.
