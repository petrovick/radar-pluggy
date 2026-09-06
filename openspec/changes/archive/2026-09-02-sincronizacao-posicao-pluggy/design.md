## Context

Peças já existentes que este change consome, sem alterar: `FindPluggyCredentialInteractor` (resolve a credencial de um `itemId`), `PluggyAuthGateway` (`POST /auth` → `apiKey`), `PluggyItem`/`PluggyItemRep` (estado de sincronização, com `advanceWatermark` já implementado).

Especificação real da Pluggy (`GET /investments`, consultada via MCP `pluggy-docs`): cada `Investment` tem `id`, `itemId`, `type`, `balance`, `name`, `currencyCode`, `date` como campos obrigatórios; `subtype`, `code`, `isin`, `quantity`, `value`, `amount`, `amountOriginal`, `institution`, `status` são opcionais (podem ser `null` mesmo com a chamada bem-sucedida — não é o "vazio" da regra 3 de `fronteira-pluggy`, é o investimento não ter aquele atributo, ex.: renda fixa sem `quantity` de cota). `updatedAt` por investimento existe no schema, mas não é obrigatório e — decisão desta entrega — não é usado aqui: serve pra decidir se busca `GET /investments/{id}/transactions` (fronteira-pluggy regra 6), e essa chamada só tem consumidor no change futuro de provento.

Limites do plano gratuito (`docs/rate-limits-of`): `GET /investments` (lista) — 30 requisições/mês, e criação/a cada 7 dias fora isso. Compatível com sincronização ~1x/dia.

## Goals / Non-Goals

**Goals:**
- Sincronizar a fotografia de posição de um item, respeitando o portão de marca d'água (fronteira-pluggy regra 6): sem mudança no item, zero chamadas a `GET /investments`.
- Persistir a fotografia mais recente de cada investimento de um item.

**Non-Goals:**
- Provento (`investment_income`, D18 do ADR 0029) — precisa de mapa de classificação próprio (D19), fora desta entrega.
- `GET /investments/{id}/transactions` e o portão por investimento (regra 6, segunda metade) — único consumidor é o provento; sem ele, chamar essa rota agora não teria por que existir.
- Handler de webhook que dispara este interactor a partir de `item/updated` — este interactor é chamável diretamente (mesmo padrão de `PluggyAuthGateway`), o webhook é change futuro.
- Histórico completo de posição (uma linha por sincronização) — esta entrega guarda só a fotografia mais recente por item + investimento (ver D2).

## Decisions

### D1 — Portão de sincronização é só o nível do item, não por investimento
A fonte de posição é o próprio `GET /investments` (dado que a marca d'água do item já libera). Diferente da busca de transação (que É por investimento, regra 6, segunda metade — mas fora do escopo aqui), aqui basta o portão de item: `GET /items/{id}` traz `executionStatus`/`lastUpdatedAt` frescos; se `executionStatus !== 'SUCCESS'` ou `lastUpdatedAt` fresco não for mais novo que o guardado em `PluggyItem`, a sincronização para sem chamar `GET /investments`. Isso já é o teste que define a fatia (fronteira-pluggy regra 6): "dia sem movimento ⇒ zero chamadas".

### D2 — Fotografia mais recente, sem histórico
`pluggy_positions` guarda uma linha por (`item_id`, `investment_id`), sobrescrita a cada sincronização (upsert). Alternativa descartada: uma linha por sincronização (histórico completo) — rejeitada por enquanto porque nenhum consumidor (conferência, F4.2 do `PLANO-PLUGGY.md`) foi construído ainda; guardar histórico sem uso é dado em repouso sem contrapartida. Se a conferência por competência vier a precisar de histórico, essa é uma migration nova, aditiva.

### D3 — Campo obrigatório do schema Pluggy é obrigatório aqui; campo opcional capturado é opcional aqui; campo opcional não capturado nem existe
`id`, `itemId`, `type`, `balance`, `name`, `currencyCode`, `date` são obrigatórios na entidade (recusa nomeada se ausentes — refletem o que a própria Pluggy documenta como obrigatório). `subtype`, `code`, `isin`, `quantity`, `amountOriginal`, `institution`, `status` são opcionais — `null`/ausente aqui não é o "vazio" da regra 3, é o investimento genuinamente não ter aquele atributo (ex.: papel de renda fixa sem `quantity` de cota). Presente com tipo diferente do esperado (nem `null`, nem o tipo certo) recusa igual a um obrigatório — nomeando o campo — porque isso é resposta mal formada, não ausência legítima.

`value`, `amount`, `taxes`, `taxes2` existem no schema da Pluggy mas **não são capturados por esta entrega** — nenhuma tabela/consumidor precisa deles hoje (o campo espelha `ADR 0029 F4.1`: "quantity, balance, amountOriginal, institution"). Corrigido depois da primeira versão deste documento, que listava esses quatro campos em D5 sem eles terem sido implementados — capturar dado que nada consome seria dado em repouso sem contrapartida (mesmo raciocínio de D2 para histórico). Se um consumidor futuro precisar de algum desses campos, entra como migration aditiva naquele momento, não agora.

### D4 — Lista vazia com portão aberto é recusa nomeada, nunca "posição zerada"
Se o portão (D1) libera a sincronização mas `GET /investments` devolve lista vazia, isso é o "vazio" da regra 3 (consentimento revogado/expirado) — recusa nomeada (`PLUGGY_INVESTMENTS_EMPTY_WITH_SUCCESS_STATUS`), nunca apaga ou substitui as posições já persistidas por "portfólio ficou vazio".

### D5 — Conversão pra Decimal só nos campos numéricos capturados e presentes
`new Decimal(String(n))` em `balance` sempre, e em `quantity`/`amountOriginal` quando não forem `null` — nunca `parseFloat`, nunca aritmética sobre o `number` do JSON (fronteira-pluggy regra 1). `value`/`amount`/`taxes`/`taxes2` não fazem parte do schema de posição desta entrega (D3) — a conversão deles não se aplica porque o dado não é capturado, não porque a regra 1 abre exceção.

## Risks / Trade-offs

- [Sem histórico de posição] → conferência por competência (F4.2, futuro) pode precisar de outra fonte de dado histórico; aceito porque não existe consumidor disso hoje.
- [Item-level gate sem novo estado de webhook] → o "lastUpdatedAt fresco" vem de uma chamada real a `GET /items/{id}` feita por este próprio interactor, não de um webhook — mais uma chamada a cada sincronização manual, mas necessária: sem o webhook, não há outra forma confiável de saber que o item mudou.
