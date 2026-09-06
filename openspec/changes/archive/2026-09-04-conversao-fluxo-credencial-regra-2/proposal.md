## Why

A change `sincronizacao-historico-pluggy` reescreveu posição, histórico e webhook no padrão do
`interactors/car/create` do `oplab-radar-api` e tornou a regra 2 de `arquitetura-camadas` normativa e
literal. O fluxo de credencial ficou de fora e virou dívida declarada na seção 2.11 da própria skill:
dois interactors com colaboradores posicionais que lançam exceção para fora, quatro repositórios que
recebem model por parâmetro, um handler que recebe instância pronta por fábrica e um `http-server.ts`
que monta esse fluxo à mão, fora do container.

Enquanto essa dívida existir, o repositório tem dois padrões vivos ao mesmo tempo — e o formato
antigo continua sendo copiado por quem lê o código em vez da skill. Esta change fecha a 2.11.

## What Changes

- `RegisterPluggyCredentialInteractor` e `CheckPluggyCredentialInteractor` passam a
  `constructor(params: AppContainer)` com **um** gateway resolvido, retorno `{data, error}` e nenhum
  `throw` escapando do `execute`.
- Nascem `RegisterPluggyCredentialGateway` e `CheckPluggyCredentialGateway` nos respectivos
  `.types.ts`, estendendo `DefaultGateway`, e os impls
  `adapters/gateways/pluggy-credential/{register,check}-pluggy-credential.impl.ts` herdando
  `DefaultInteractorGatewayImpl`.
- `PluggyItemRep`, `PluggyCredentialRep`, `PluggyCredentialItemRep` e `PersonRep` passam a
  `constructor(params: AppContainer)`, com model vindo de `params.db.models.*` e transação lida do
  escopo por `getTransaction(DB_NAMES.MAIN)`.
- `register-pluggy-credential.handler.ts` deixa de ser fábrica e passa a resolver o interactor do
  escopo da requisição (`req.container.resolve(...)`), como `load-pluggy-history.handler.ts`.
- `authenticate.middleware.ts` deixa de receber `FindsPersonIdByUsername` por parâmetro e resolve
  `personRep` do escopo da requisição.
- `HttpServerDependencies` encolhe para `{ jwtSecret, container }`; `src/index.ts` para de construir
  conexão, models e repositórios à mão.
- `infra/bootstrap/register.ts` ganha as chaves novas (interactors, impls, `personRep`) e troca os
  três `asFunction` de repositório por `asClass`.
- Nenhuma migration, nenhum endpoint, nenhum corpo de resposta e nenhum `errorType` mudam.

Achados levantados na revisão dos outros quatro casos de uso, corrigidos junto (os quatro passam no
checklist 2.10; os problemas estão em volta deles):

- `PluggyItemCredentialGateway` mora em `adapters/gateways/pluggy-*.gateway.ts`, padrão que a seção 1
  da skill define como "gateway de borda, **nada de banco**" — e ela lê dois repositórios. Vira
  `pluggy-item-credential.resolver.ts` / `PluggyItemCredentialResolver`, e a seção 1 ganha a entrada
  que falta para o colaborador que a 2.3.1 manda extrair.
- `AcceptPluggyWebhookImpl` refaz à mão a resolução item→credencial que esse colaborador já faz.
  Passa a compô-lo.
- `registerBankAccounts` / `listInvestments` viram `readCashSources` / `readCustodySources` (2.2.1:
  par com nomes paralelos, verbo de leitura, registro é mecanismo do impl).
- A acumulação da cobertura (contagem, data mais antiga, mais nova) sai das funções soltas do
  interactor e vira comportamento de `PluggyHistoryCoverage` (regra 3).
- `HistorySource.updatedAt` de custódia é sempre `undefined` (`load-pluggy-history.impl.ts:108`), o
  que mantém o portão incremental permanentemente aberto e faz toda carga varrer a custódia inteira.
  É **bug de conformidade**, não decisão: a spec `pluggy-transaction-history` já exige "MUST chamar
  transações somente para recurso cujo `updatedAt` avançou desde a última observação", e o
  `updatedAt` existe no schema `Investment` da Pluggy (opcional). Passa a ser lido e propagado; a
  ausência continua caindo no fallback de varredura integral, como a spec manda.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

Nenhuma. Change de refatoração pura: o contrato HTTP (`POST /credentials` → 201 `{id}`, 400
`{errorType, extras}`, 401, 500) e as recusas nomeadas continuam idênticos, então nenhum requisito de
spec muda. `.openspec.yaml` declara `skip_specs: true`.

## Impact

**Código**

- `src/interactors/pluggy-credential/register/` e `src/interactors/pluggy-credential/check/`
- `src/adapters/gateways/pluggy-credential/` (pasta nova, dentro do contrato da seção 1 da skill:
  `adapters/gateways/<objeto>/`)
- `src/adapters/repositories/{pluggy-item,pluggy-credential,pluggy-credential-item,person}.rep.ts`
- `src/adapters/handlers/register-pluggy-credential.handler.ts`
- `src/infra/{http-server,authenticate.middleware}.ts`, `src/infra/bootstrap/register.ts`,
  `src/index.ts`
- Testes correspondentes, ajustados só no que a assinatura mudou

**Fora de escopo**

- Schema e migrations — nada a alterar.
- `SyncPluggyPositionImpl`, `LoadPluggyHistoryImpl` e os impls de webhook: já estão no padrão e só
  são tocados se a assinatura de um repositório os obrigar (não obriga — a resolução é por chave do
  container).

**Risco**

Baixo e concentrado no wiring: o que pode quebrar é registro faltando no container, que
`tests/infra/bootstrap/register.test.ts` pega ao resolver a árvore inteira.
