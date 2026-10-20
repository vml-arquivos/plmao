# Ativação de acesso social

A aplicação já possui rotas de OAuth/OIDC, **PKCE**, estado de curta duração, validação de `nonce`, validação criptográfica do ID Token, sessões revogáveis e persistência de identidades. Os botões de Google, Microsoft e Apple são habilitados automaticamente quando as credenciais correspondentes existirem no ambiente de runtime.

> **Apple Pay não é uma modalidade de autenticação.** Para acesso de conta, o provedor correto é **Sign in with Apple**. Apple Pay deverá ser configurado mais tarde somente na camada de pagamentos, caso seja escolhido como meio de cobrança.

## Redirect URIs que devem ser registrados

| Provedor | URI de retorno exata |
|---|---|
| Google | `https://carpivara.casadf.com.br/api/auth/oauth/google/callback` |
| Microsoft | `https://carpivara.casadf.com.br/api/auth/oauth/microsoft/callback` |
| Apple | `https://carpivara.casadf.com.br/api/auth/oauth/apple/callback` |

Os provedores validam a URI de retorno. No caso do Google, a URI precisa ser previamente autorizada e corresponder exatamente à URI usada pela aplicação; ela não deve conter segredo algum.[1] Para Microsoft Entra ID, registre uma plataforma Web e informe a URI de retorno; os endpoints OIDC são descobertos no documento OpenID Connect do tenant.[2] O fluxo implementado segue OpenID Connect, que autentica a pessoa usuária por meio de um ID Token emitido pelo provedor.[3]

## Variáveis de runtime

Defina os valores abaixo no painel de ambiente do Coolify. Eles devem permanecer **somente em runtime**, com proteção de segredos do build habilitada, e nunca devem ser enviados ao GitHub.

```dotenv
APP_URL=https://carpivara.casadf.com.br
WEB_ORIGIN=https://carpivara.casadf.com.br

OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=

OAUTH_MICROSOFT_CLIENT_ID=
OAUTH_MICROSOFT_CLIENT_SECRET=
OAUTH_MICROSOFT_TENANT=common

OAUTH_APPLE_CLIENT_ID=
OAUTH_APPLE_TEAM_ID=
OAUTH_APPLE_KEY_ID=
OAUTH_APPLE_PRIVATE_KEY=
```

A chave privada da Apple deve ser guardada como segredo de runtime, mantendo as quebras de linha como `\n`. A aplicação cria o client secret assinado da Apple em memória e não persiste tokens de provedor.

## Estrutura persistida no banco

A migration `003_identity_and_social_auth` adiciona as tabelas e os índices necessários para o ciclo completo de conta, preservando o cadastro por e-mail e senha.

| Tabela | Responsabilidade |
|---|---|
| `user_identities` | Vínculo único entre a conta CARPIVARA e o identificador imutável de Google, Microsoft ou Apple. |
| `user_sessions` | Sessões JWT revogáveis, com expiração e metadados mínimos de auditoria. |
| `user_consents` | Registro versionado de aceite de Termos, Privacidade e comunicação de marketing. |
| `oauth_authorization_states` | Estado, nonce e PKCE de uso único para proteção da transação OIDC. |
| `oauth_login_tickets` | Ticket curto e de uso único para concluir o retorno ao frontend sem expor o JWT na URL. |

## Sequência de ativação

1. Crie o client Web no Google Cloud Console e registre a primeira URI de retorno.
2. Crie o App Registration no Microsoft Entra ID, habilite os ID Tokens conforme o fluxo Web e registre a segunda URI.
3. Crie a Service ID no Apple Developer, associe o domínio e registre a terceira URI.
4. Insira os segredos no Coolify como variáveis exclusivas de runtime.
5. Dispare o redeploy e abra a tela de acesso. Cada botão habilita somente quando o seu conjunto mínimo de credenciais estiver disponível.
6. Realize um login controlado por provedor e confirme o novo registro em `user_identities` e `user_sessions`.

## Referências

[1]: https://developers.google.com/identity/protocols/oauth2/web-server "Google — Using OAuth 2.0 for Web Server Applications"
[2]: https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc "Microsoft — OpenID Connect on the Microsoft identity platform"
[3]: https://openid.net/specs/openid-connect-core-1_0.html "OpenID Connect Core 1.0"
