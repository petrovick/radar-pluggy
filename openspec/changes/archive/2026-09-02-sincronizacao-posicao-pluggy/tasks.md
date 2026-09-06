## 1. Modelo de dados (`pluggy_positions`)

- [x] 1.1 Criar migration `pluggy_positions`: `id` (PK própria), `item_id`, `investment_id` (o `id` da
      Pluggy), `type`, `subtype` (nullable), `name`, `code` (nullable), `isin` (nullable), `currency_code`,
      `balance` (`DECIMAL(14,2)`), `quantity`/`amount_original` (`DECIMAL(14,8)`/`(14,2)`, nullable), `status`
      (nullable), `institution_name`/`institution_number` (nullable), `quota_date`, `created_at`,
      `updated_at`. Índice único em (`item_id`, `investment_id`). Verificado: migrate e undo limpos.
- [x] 1.2 Criar entity `PluggyPosition` (factory `create`, `reconstitute`) — `investmentId`/`itemId`/`type`/
      `balance`/`name`/`currencyCode`/`quotaDate` obrigatórios (spec `pluggy-position-sync`);
      `subtype`/`code`/`isin`/`quantity`/`amountOriginal`/`status`/instituição opcionais. `balance` e os
      campos numéricos presentes já chegam como `Decimal` — a entidade não faz a conversão, só aceita o tipo.
      (`src/entities/pluggy-position.ts`, 10 testes cobrindo obrigatório ausente e opcional ausente)
- [x] 1.3 Criar model Sequelize + repositório `PluggyPositionRep`, com `save` fazendo upsert por
      (`item_id`, `investment_id`) — nunca duas linhas pro mesmo investimento (D2). Teste de contrato mirando
      a migration, e teste de repositório cobrindo upsert e precisão decimal no round-trip.
      (`src/infra/db/models/pluggy-position-model.ts`, `src/adapters/repositories/pluggy-position.rep.ts`)

## 2. Gateway `GET /items/{id}`

- [x] 2.1 Criar `PluggyItemsGateway.fetchItem(itemId, apiKey)`: chama `GET /items/{id}`, devolve
      `executionStatus`/`lastUpdatedAt` frescos. Timeout e tratamento de erro no mesmo padrão de
      `PluggyAuthGateway` (sem retry — regra 3 de `padroes-de-engenharia`). Teste cobrindo sucesso, item não
      encontrado (404) e timeout. (`src/adapters/gateways/pluggy-items.gateway.ts`)

## 3. Gateway `GET /investments`

- [x] 3.1 Criar `PluggyInvestmentsGateway.fetchInvestments(itemId, apiKey)`: chama `GET /investments?itemId=X`,
      devolve a lista de investimentos com `balance` e os campos numéricos presentes já convertidos para
      `Decimal` na fronteira (D5) — nunca `parseFloat`. Investimento com campo obrigatório ausente/tipo
      errado recusa a chamada inteira, nomeando item + índice + campo. Teste cobrindo sucesso (com e sem
      campo opcional), lista vazia, campo obrigatório ausente, e timeout.
      (`src/adapters/gateways/pluggy-investments.gateway.ts`)

## 4. Interactor de sincronização (`pluggy-position/sync`)

- [x] 4.1 Criar `SyncPluggyPositionInteractor` (`interactors/pluggy-position/sync/sync-pluggy-position.interactor.ts`
      + `.types.ts`, convenção de `arquitetura-camadas`): dado um `itemId`, resolve a credencial
      (`FindPluggyCredentialInteractor`), autentica (`PluggyAuthGateway`), busca o item fresco
      (`PluggyItemsGateway`), aplica o portão (D1) — recusa/encerra sem chamar investimentos se o portão não
      abrir —, busca investimentos (`PluggyInvestmentsGateway`), recusa nomeando o item se a lista vier vazia
      com portão aberto (D4), grava cada fotografia (`PluggyPositionRep`), e só então avança a marca d'água em
      `PluggyItem` (`PluggyItemRep.save`). Adicionado `PluggyItemRep.findByItemId` (não previsto originalmente
      nesta tarefa, necessário pra ler a marca d'água guardada antes do portão). 6 cenários testados: primeira
      sincronização, portão fechado por status, portão fechado por item sem mudança, portão aberto, lista
      vazia (recusa), propagação de erro de credencial.

## 5. Verificação

- [x] 5.1 Rodar lint, verificação de tipos e teste na íntegra, e registrar o resultado. (90/90 testes, lint e
      type-check limpos, após as correções da 5.2 e da 5.3)
- [x] 5.2 Acionar `arquiteto-pluggy-connector` e `engenheiro-pluggy-connector`, fornecendo diff, arquivos e
      resultado das verificações. `arquiteto-pluggy-connector`: **Aprovado** de primeira. `engenheiro-pluggy-connector`:
      **Ajustar** (bloqueante) — três achados corrigidos: (1) `optionalString`/`optionalDecimal` no gateway de
      investimentos e `lastUpdatedAt` no gateway de items confundiam "ausente/null" (legítimo) com "presente
      com tipo errado" (recusa nomeada agora, não sumia mais em silêncio); (2) `gateOpen` do interactor
      confundia "executionStatus diferente de SUCCESS" (portão fechado, normal) com "SUCCESS sem
      `lastUpdatedAt`" (agora recusa nomeada, `PLUGGY_ITEM_SUCCESS_WITHOUT_LAST_UPDATED_AT`); (3) `design.md`
      D5 prometia `value`/`amount`/`taxes`/`taxes2` que nunca foram implementados — corrigido o texto pra
      refletir o escopo real (D3/D5), já que nenhum consumidor precisa desses campos hoje. Segunda rodada do
      `engenheiro-pluggy-connector`: **Aprovado**, confirmando os três achados fechados com teste dedicado.
- [x] 5.3 Achado adicional do `engenheiro-pluggy-connector` (fora dos 3 bloqueantes, mas o projeto tem zero
      tolerância a achado pequeno): `getInstitutionField` aceitava array como `institution` (`typeof [] ===
      'object'`) sem recusar. Corrigido com `Array.isArray`, teste dedicado. 90/90 testes.
