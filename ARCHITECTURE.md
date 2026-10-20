# CARPIVARA — arquitetura

## Princípios aplicados

A aplicação é composta por dois workspaces TypeScript: uma API Express e uma interface React/Vite. O build do frontend é servido pela própria API, permitindo um único domínio para interface, `/api/*` e `/health`.

A regra central é que a interface usa somente o **modelo normalizado**. Um adapter recebe a resposta do provider, o normalizador converte os campos técnicos em um relatório estável e o frontend não conhece o contrato externo. A resposta original pode permanecer armazenada para auditoria, mas não é enviada por rotas comuns.

| Domínio | Responsabilidade |
| --- | --- |
| Identidade | Cadastro, autenticação JWT, senha com bcrypt, bloqueio temporário e eventos de acesso. |
| Autorização | Papéis e permissões extensíveis, aplicados por middleware de ação. |
| Carteira | Saldo, ledger imutável, operações transacionais e estornos. |
| Consulta | Validação, idempotência, reserva de crédito, provider, timeout, normalização e persistência. |
| Relatórios | Resultado salvo, abertura sem cobrança, exportação JSON autenticada e histórico filtrável. |
| Operação | Migrations, healthcheck, auditoria, logs estruturados e métricas administrativas básicas. |

## Fluxo crítico de consulta

```text
Usuário autenticado
  → validação e normalização da placa
  → verificação do produto e saldo em transação com lock
  → criação da consulta PROCESSING + débito no ledger
  → adapter do provider configurado
  → normalizador do relatório interno
  → resultado salvo + consulta SUCCESS
  → relatório e histórico
```

Se o provider expirar, falhar ou retornar um formato inválido, o processo localiza a consulta em `PROCESSING`, bloqueia a carteira, registra a transação `REFUND`, marca a consulta como `REFUNDED` e devolve uma mensagem humana. A chave `Idempotency-Key` é única por usuário, evitando consulta e cobrança duplicadas em reenvios.

## Banco e migrations

O bootstrap cria apenas a base compatível para instalações novas. Depois, `schema_migrations` controla migrations versionadas e transacionais. A migration de hardening adiciona bloqueio de login, metadados operacionais, índices, idempotência e a estrutura persistente de papéis/permissões.

> Alterações futuras no banco devem entrar como uma nova migration, nunca como uma modificação destrutiva implícita no bootstrap.

## Provider e pagamento

`MockVehicleProvider` é o adapter ativo em sandbox e trabalha somente com registros fictícios. O adapter real continua uma fronteira intencionalmente inativa até existir documentação oficial. O fluxo de pagamento real também permanece fora da implementação: créditos só poderão ser liberados após webhook assinado, validado e idempotente.

## Produção

```text
Navegador → TLS / reverse proxy → CARPIVARA (frontend + API) → PostgreSQL
                                  ├─ provider veicular configurado
                                  ├─ gateway de pagamento configurado
                                  └─ futuro storage de exportações/PDF
```

Os segredos existem apenas no runtime. Não devem aparecer no Dockerfile, argumentos de build, repositório, logs, bundle do frontend ou respostas de erro.
