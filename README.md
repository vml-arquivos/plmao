# CARPIVARA

A **CARPIVARA** é uma plataforma de consulta veicular com relatório claro, carteira baseada em créditos, histórico persistido e arquitetura preparada para integrar um provedor real sem reconstruir a aplicação. A versão atual opera integralmente em **sandbox**, exclusivamente com dados fictícios.

> **Princípio do produto:** puxe a história do veículo antes de tomar uma decisão. Os dados apresentados refletem exclusivamente o retorno do provedor configurado no momento da consulta.

## O que está funcional

| Área | Implementação atual |
| --- | --- |
| Acesso | Cadastro, login, logout, expiração JWT, troca de senha, auditoria e bloqueio temporário após falhas consecutivas. |
| Autorização | RBAC extensível por permissões, com os papéis `CLIENTE`, `OPERADOR`, `ADMIN` e `SUPER_ADMIN`. |
| Consulta | Validação de placa brasileira, idempotência, reserva/debito transacional, provider mock, timeout controlado, normalização e estorno automático em falha. |
| Carteira | Saldo protegido por `FOR UPDATE`, ledger de movimentações e compra sandbox explicitamente controlada por variável. |
| Histórico | Persistência da consulta, abertura sem nova cobrança, filtro por placa e exportação JSON autenticada. |
| Interface | Landing comercial, fluxo de autenticação, dashboard responsivo, relatório premium, modos claro/escuro/sistema persistidos e área administrativa condicional. |
| Operação | Migrations versionadas, healthcheck com banco, logs estruturados sem dados sensíveis e imagem Docker multi-stage. |

## Início rápido em desenvolvimento

Copie o arquivo de exemplo e **nunca** use o segredo de exemplo em produção.

```bash
cp .env.example .env
npm ci
docker compose up -d
npm run dev
```

A interface de desenvolvimento fica em `http://localhost:5173`; a API fica em `http://localhost:4000`. Em produção, a própria API serve o build do frontend no mesmo domínio.

Para a demonstração local, mantenha `DATA_PROVIDER=mock`, `SANDBOX_SEED_ENABLED=true` e `SANDBOX_CREDIT_PURCHASE_ENABLED=true`. O bootstrap cria somente dados fictícios.

| Conta sandbox | Senha | Saldo inicial |
| --- | --- | --- |
| `cliente@demo.local` | `Demo@123456` | 100 créditos |
| `admin@demo.local` | `Admin@123456` | 250 créditos |

As credenciais acima são exclusivamente de sandbox. Desative o seed para qualquer ambiente exposto ao público.

## Placas sandbox

| Placa | Cenário fictício |
| --- | --- |
| `TST0A00` | Veículo sem alertas relevantes. |
| `DEV1B11` | Multas, licenciamento e restrição judicial/RENAJUD. |
| `IPV2A22` | Débito de IPVA. |
| `REN3J33` | Restrição judicial e gravame. |
| `REC4L44` | Recall pendente. |
| `FUR5T55` | Ocorrência fictícia de furto/roubo. |
| `MUL6T66` | Multas. |
| `INC7P77` | Resposta com campos incompletos. |
| `TIM0E00` | Timeout simulado; a consulta é estornada automaticamente. |

## Comandos de qualidade

```bash
npm run build
npm test
npm run db:migrate
npm run db:verify
npm run release:verify
```

`npm test` compila os dois workspaces e executa a suíte automatizada. `db:migrate` e `db:verify` exigem um PostgreSQL acessível e são separados do processo de release. Para uma validação funcional completa, consulte [TESTING.md](TESTING.md). Para deploy no Coolify, consulte [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md).

## Limite intencional da versão

O `MockVehicleProvider` está pronto para demonstração e testes. A integração em `DATA_PROVIDER=real` **não deve ser ativada** antes de haver documentação e credenciais oficiais do fornecedor. Consulte [API-INTEGRATION.md](API-INTEGRATION.md).

## Documentos técnicos

| Documento | Conteúdo |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Fluxo, fronteiras e decisões de arquitetura. |
| [DATABASE.md](DATABASE.md) | Modelo de dados, migrations e integridade. |
| [SECURITY.md](SECURITY.md) | Controles de segurança e privacidade. |
| [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md) | Deploy, variáveis e healthcheck. |
| [TESTING.md](TESTING.md) | Bateria de testes e roteiro integrado. |
| [API-INTEGRATION.md](API-INTEGRATION.md) | Contrato para futuro provider real. |
| [CHANGELOG.md](CHANGELOG.md) | Alterações desta entrega. |
