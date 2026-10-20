# Integração com provedor veicular

## Estado atual

A aplicação opera com `DATA_PROVIDER=mock`. O provider mock consulta exclusivamente a tabela `sandbox_vehicles`, contendo dados fictícios, e mantém o sistema totalmente utilizável sem serviço externo.

Quando `DATA_PROVIDER=real`, a seleção de provider falha de forma explícita até que exista contrato oficial. Essa decisão impede que endpoint, autenticação ou campos sejam inventados antes da documentação do fornecedor.

## Fronteira de arquitetura

```text
Interface web → API interna → serviço de consulta → adapter do provider → normalizador → PostgreSQL → relatório
```

A interface nunca consome os nomes técnicos do fornecedor. Ela recebe somente o relatório normalizado, formado por identificação, características, registro, débitos, restrições e recall.

## Requisitos para implementar o provider real

Antes de alterar o adapter, registre a documentação oficial e valide os itens abaixo.

| Informação necessária | Finalidade |
| --- | --- |
| URL base e versão da API | Configurar `VEHICLE_API_BASE_URL`. |
| Método de autenticação | Definir uso seguro de login, senha, token ou assinatura. |
| Contrato de consulta | Determinar placa, parâmetros opcionais e idempotência do fornecedor. |
| Esquema de resposta e códigos de erro | Mapear campos sem expor o payload técnico ao frontend. |
| Limites e timeout | Dimensionar `VEHICLE_API_TIMEOUT_MS` e retentativas seguras. |
| Política comercial | Determinar cobrança, cobertura e regras de reprocessamento. |
| LGPD e retenção | Definir minimização, armazenamento do original e acesso a dados pessoais. |

## Procedimento de implementação

A implementação deve criar uma classe que satisfaça `VehicleDataProvider` em `apps/api/src/types.ts`. O adapter deve receber a placa normalizada, chamar apenas o contrato oficial, mapear erros em códigos internos e devolver `providerQueryId` e `raw`. Em seguida, o normalizador deverá ser estendido para converter o payload oficial no modelo interno.

Nunca passe credenciais para o frontend, registre tokens em log ou exponha `raw_response` em rotas comuns. O adapter deve respeitar timeout, permitir o estorno já existente na rota de consulta e manter a idempotência do pedido interno.

## Variáveis de runtime

As credenciais são lidas somente no servidor e devem ser configuradas pelo ambiente de deploy.

```dotenv
DATA_PROVIDER=real
VEHICLE_API_BASE_URL=
VEHICLE_API_LOGIN=
VEHICLE_API_PASSWORD=
VEHICLE_API_TOKEN=
VEHICLE_API_TIMEOUT_MS=15000
```

> Não adicione essas variáveis ao Git, ao Dockerfile, a argumentos de build ou ao bundle do frontend.
