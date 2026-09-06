## 1. Repositórios no formato da bag

- [x] 1.1 `PluggyItemRep`: `constructor(params: AppContainer)`, model de `params.db.models.pluggyItem`,
      transação de `getTransaction(DB_NAMES.MAIN)` em `findOrCreate`, `update` e `findOne`. Verificar
      com `tests/adapters/repositories/pluggy-item.rep.test.ts` ajustado ao construtor novo, verde.
- [x] 1.2 `PluggyCredentialRep`: mesma conversão, transação em `create`, `update`, `findAll`,
      `findByPk` e `findByPersonId`. Verificar com `pluggy-credential.rep.test.ts` verde.
- [x] 1.3 `PluggyCredentialItemRep`: mesma conversão, transação em `create`, `findOne` e `findAll`.
      Verificar com `pluggy-credential-item.rep.test.ts` verde.
- [x] 1.4 `PersonRep`: mesma conversão, model de `params.db.models.person`, transação no `findOne`,
      mantendo o comentário de read-only (`fronteira-pluggy` regra 13). Verificar com
      `person.rep.test.ts` verde.
- [x] 1.5 Trocar os três `asFunction` de repositório por `asClass(...).scoped()` em `register.ts` e
      registrar `personRep`. Verificar que `tests/infra/bootstrap/register.test.ts` continua verde.
- [x] 1.6 Apagar o comentário de `register.ts` que fala em "repositórios ainda no formato antigo" —
      não sobra nenhum. Verificar por `grep` que nenhum repositório recebe model posicional.

## 2. Caso de uso `register-pluggy-credential`

- [x] 2.1 Reescrever `register-pluggy-credential.types.ts`: `RegisterPluggyCredentialInput`,
      `RegisterPluggyCredentialResult` (`{ credentialId: number }`), `RegisterPluggyCredentialOutput`
      (`{data?, error?}`) e `RegisterPluggyCredentialGateway extends DefaultGateway` com
      `saveCredential` e `linkItemToCredential`. Remover `CreatesPluggyCredential`,
      `LinksPluggyCredentialItem` e `CreatedPluggyCredential`. Verificar que o arquivo não importa
      nada de `adapters/` nem de `infra/`.
- [x] 2.2 Criar `adapters/gateways/pluggy-credential/register-pluggy-credential.impl.ts` — herda
      `DefaultInteractorGatewayImpl`, compõe `pluggyCredentialRep` e `pluggyCredentialItemRep`, e é
      onde `requireId()` é chamado. Verificar com teste de integração novo do impl provando que a
      credencial é criada e o item vinculado a ela.
- [x] 2.3 Reescrever o interactor: `constructor(params: AppContainer)` com só
      `params.registerPluggyCredentialImpl`, `addContext`, retorno `{data, error}`, `catch` que
      traduz `ApplicationError` em `{error}` e o resto em `PLUGGY_CREDENTIAL_REGISTRATION_FAILED`.
      Verificar com `register-pluggy-credential.interactor.test.ts` reescrito sobre um fake do
      gateway, cobrindo itemId ausente, sucesso e erro do gateway.
- [x] 2.4 Registrar `registerPluggyCredentialImpl` e `registerPluggyCredentialInteractor` em
      `register.ts` e adicionar a resolução ao `register.test.ts`. Verificar que o teste passa.

## 3. Caso de uso `check-pluggy-credential`

- [x] 3.1 Reescrever `check-pluggy-credential.types.ts`: `CheckPluggyCredentialInput`
      (`{ personId }`), `CheckPluggyCredentialResult` (`Record<string, never>` — nasceu
      `{ itemIds: string[] }` e foi trocado na revisão, ver design.md decisão 2),
      `CheckPluggyCredentialOutput` e `CheckPluggyCredentialGateway extends DefaultGateway` com
      `readCredentialIds` e `readLinkedItemIds`. Verificar que os `Lookup` antigos sumiram do
      repositório inteiro por `grep`.
- [x] 3.2 Criar `adapters/gateways/pluggy-credential/check-pluggy-credential.impl.ts` compondo os dois
      repositórios de credencial, com o `requireId()` e seu comentário aqui. Verificar com teste de
      integração novo do impl.
- [x] 3.3 Reescrever o interactor no formato da regra 2, preservando as duas recusas nomeadas
      distintas. Verificar com `check-pluggy-credential.interactor.test.ts` reescrito sobre um fake
      do gateway, cobrindo pessoa sem credencial, credencial sem item e caminho feliz.
- [x] 3.4 Registrar `checkPluggyCredentialImpl` e `checkPluggyCredentialInteractor` em `register.ts` e
      adicionar a resolução ao `register.test.ts`. Verificar que o teste passa.

## 4. Fronteira HTTP

- [x] 4.1 `register-pluggy-credential.handler.ts` vira `registerPluggyCredentialHandler(req, res)`
      resolvendo `registerPluggyCredentialInteractor` de `req.container` e lendo `{data, error}`.
      Verificar com `register-pluggy-credential.handler.test.ts` ajustado, mantendo os mesmos status
      e `errorType` de hoje (201 `{id}`, 400 `{errorType, extras}`, 500 nos dois casos existentes).
- [x] 4.2 `authenticate.middleware.ts`: `createAuthenticateMiddleware(secret)` resolve `personRep` de
      `req.container`, com 500 nomeado se o escopo faltar; remover `FindsPersonIdByUsername`.
      Verificar com `authenticate.middleware.test.ts` ajustado, cobrindo também o escopo ausente.
- [x] 4.3 `http-server.ts`: `HttpServerDependencies` fica `{ jwtSecret, container }`; a rota
      `/credentials` usa o handler novo. Verificar com `http-server.test.ts` ajustado, com os quatro
      casos de ponta a ponta continuando iguais.
- [x] 4.4 `src/index.ts`: remover a conexão, os três `define*Model` e os três `new *Rep`. Verificar
      por leitura que só sobram `setupContainer()`, `createHttpServer({ jwtSecret, container })` e o
      dreno de boot.

## 5. Colaborador de adapters no lugar certo

- [x] 5.1 Renomear `pluggy-item-credential.gateway.ts` para `pluggy-item-credential.resolver.ts`,
      classe `PluggyItemCredentialResolver`, chave `pluggyItemCredentialResolver`; atualizar os dois
      impls que a compõem e o teste. Verificar por `grep` que nenhum `*.gateway.ts` toca repositório.
- [x] 5.2 Adicionar `<objeto>.resolver.ts` à lista da seção 1 de `arquitetura-camadas`, descrito como
      o colaborador compartilhado que a 2.3.1 manda extrair, e referenciá-lo na 2.3.1. Verificar que
      a seção 1 volta a ser exaustiva de verdade.
- [x] 5.3 Dar ao resolver `findCredentialFor(itemId)` que devolve `undefined`, com `credentialFor`
      virando o invólucro que lança. Verificar com teste cobrindo as duas variantes.
- [x] 5.4 `AcceptPluggyWebhookImpl` passa a compor o resolver em vez de repetir os dois lookups.
      Verificar que `accept-pluggy-webhook.impl.test.ts` continua verde, inclusive a recusa de item
      sem vínculo e a de credencial sem webhook.

## 6. Nomes e domínio do caso de uso de histórico

- [x] 6.1 Renomear `registerBankAccounts` → `readCashSources` e `listInvestments` →
      `readCustodySources` no `.types.ts`, no impl, no interactor e nos testes. Verificar lendo o
      `execute` em voz alta (teste da 2.2.1).
- [x] 6.2 Criar `ObservedHistoryScan` em `entities/pluggy-history-coverage.ts` com `empty()` e
      `observe(page)`, conferindo o invariante a cada página. Verificar com teste de entidade
      cobrindo página vazia, acumulação de várias páginas e página inconsistente recusada.
- [x] 6.3 `LoadPluggyHistoryInteractor.scanUntilTheEnd` usa `ObservedHistoryScan`; apagar `earliest` e
      `latest`. Verificar que `load-pluggy-history.interactor.test.ts` continua verde sem mudar
      asserção de resultado.
- [x] 6.4 `PluggyInvestmentDto` ganha `updatedAt?: Date` lido como data opcional, e
      `readCustodySources` o propaga para `HistorySource.updatedAt`. Verificar com teste do gateway de
      borda (presente, ausente, tipo errado) e teste do impl provando que a fonte de custódia carrega
      o timestamp.
- [x] 6.5 Teste novo no interactor de histórico: investimento cujo `updatedAt` não avançou desde a
      última observação não gera chamada de transação. É o requisito da spec
      `pluggy-transaction-history` que hoje nenhum teste morde para custódia.

## 7. Fechamento

- [x] 7.1 Apagar a seção 2.11 (dívida conhecida) de `.claude/skills/arquitetura-camadas/SKILL.md`,
      preservando o registro de que `pluggy-credential/find` foi removido por ser caso de uso falso.
      Verificar que nenhuma outra parte da skill referencia a dívida.
- [x] 7.2 Remover os diretórios de teste vazios `tests/interactors/pluggy-credential/ensure-syncable/`
      e `.../resolve-for-item/`, restos dos interactors já apagados. Verificar com `ls`.
- [x] 7.3 Rodar `npm run lint`, `npm run type-check`, `npm test` e
      `npx sequelize-cli db:migrate:status`. Verificar 312+ testes verdes e nenhuma migration
      pendente.
- [x] 7.4 Acionar `arquiteto-pluggy-connector` e `engenheiro-pluggy-connector` com o diff e registrar
      cada achado e sua resolução.
