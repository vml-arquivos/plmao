# Testes e validação

A CARPIVARA possui testes unitários para o normalizador do provedor e um roteiro integrado que valida os fluxos críticos contra PostgreSQL real. A validação integrada usa apenas a massa fictícia do sandbox.

## Execução rápida

```bash
npm test
```

Esse comando compila API e frontend em modo de produção e executa todos os testes em `apps/api/test/`, incluindo segurança, privacidade, providers, pagamentos, migrations e configuração de produção.

O gate completo de release é:
```bash
npm run release:verify
```
Ele exige build, testes, `npm audit --omit=dev --audit-level=high`, verificação de arquivos e `git diff --check` somente quando o diretório `.git` existe. O mesmo verificador pode ser executado em um pacote ZIP sem falhar por ausência de Git.

Para banco isolado, execute `npm run db:migrate` e depois `npm run db:verify`. A validação integrada usa PostgreSQL real e deve ser executada com `npm run test:integration` após a aplicação estar disponível.

## Roteiro integrado

Com PostgreSQL iniciado e a aplicação em execução com as variáveis de sandbox, execute:

```bash
./scripts/integration-smoke.sh
```

| Cenário | Resultado esperado |
| --- | --- |
| `GET /health` | API e banco retornam `ok: true`. |
| Login sandbox | Token JWT é emitido para credenciais válidas. |
| Consulta `TST0A00` | Retorno `SUCCESS`, resultado normalizado e débito de `R$ 12,00` para `COMPLETE`. |
| Idempotência | Reenvio da mesma chave retorna o mesmo relatório sem novo débito. |
| Abertura de histórico | Consulta salva abre sem consumir saldo. |
| Timeout `TIM0E00` | HTTP 502 seguro, mensagem humana e estorno automático. |
| Histórico filtrado | Consulta previamente concluída aparece no filtro de placa. |
| Administração | Administrador sandbox acessa o resumo protegido por permissão. |

## Testes manuais de interface

A validação visual deve abranger desktop, `390px`, `375px` e `320px`. Em cada largura, verifique ausência de rolagem horizontal, controles acessíveis por teclado, foco visível e leitura adequada no modo claro e escuro.

| Fluxo | Verificação |
| --- | --- |
| Tema | Alterar entre claro, escuro e sistema; recarregar a página e confirmar persistência. |
| Consulta | Informar placa, confirmar custo, acompanhar o progresso e abrir o relatório. |
| Relatório | Conferir o diagnóstico, débitos, restrições e exportação autenticada. |
| Histórico | Abrir relatório salvo e usar “Consultar de novo”, entendendo que o segundo fluxo poderá consumir créditos. |
| Carteira | Conferir movimentos de débito, crédito e estorno. |

## Limitações de ambiente

A validação de imagem Docker requer um daemon Docker disponível. A aplicação deve ser construída em ambiente Docker/Coolify antes do primeiro deploy, com `docker build -t carpivara .` e `/health` verificado no container. A indisponibilidade do daemon local não invalida os testes de build, API, banco e fluxos sandbox executados fora do container.
