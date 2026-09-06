## Context

Ver `proposal.md` — Why. O que o desenho precisa levar em conta do estado atual:

- O fluxo de referência já existe e foi revisado: `interactors/pluggy-position/sync/` +
  `adapters/gateways/pluggy-position/sync-pluggy-position.impl.ts`. A regra 2 de
  `arquitetura-camadas` (2.1 a 2.10) é normativa e descreve esse fluxo literalmente.
- `RegisterPluggyCredentialInteractor` orquestra dois passos (criar credencial, vincular item)
  **deliberadamente sem transação entre eles** — cadastro único do titular, não reentrega da Pluggy.
- `CheckPluggyCredentialInteractor` tem `execute(personId): Promise<void>` e **nenhum consumidor de
  produção**: só o próprio teste o instancia.
- Os quatro repositórios a converter não abrem nem leem transação hoje. Nenhuma chamada a eles
  acontece dentro de um `startProcess()` (verificado: o único `startProcess` do código é
  `SyncPluggyPositionImpl.savePositionsWithSnapshots`, que usa só posição e snapshot).
- `people` já está em `ModelMap` (`infra/db/models.ts`), então nada de schema muda para o `PersonRep`
  entrar no container.
- `createRequestScopeMiddleware` roda em `app.use` antes de qualquer rota, então `req.container`
  existe para o middleware de autenticação e para os handlers.

## Goals / Non-Goals

**Goals:**

- Fechar a dívida da seção 2.11 de `arquitetura-camadas` e apagar essa seção da skill.
- Deixar `src/index.ts` sem nenhuma construção manual de conexão, model ou repositório.
- Manter os 312 testes existentes verdes, ajustados só onde a assinatura mudou.

**Non-Goals:**

- Nenhuma mudança de comportamento observável: mesmos endpoints, mesmos status HTTP, mesmos
  `errorType`, mesmos corpos de resposta.
- Não introduzir transação onde hoje não existe (em particular, o cadastro de credencial continua
  em dois passos sem transação).
- Não mexer nos impls já convertidos (posição, histórico, webhook).

## Decisions

### 1. Cada interactor de credencial ganha um gateway próprio, com dois métodos

`RegisterPluggyCredentialGateway`:

```ts
saveCredential(input: { personId: number; clientId: string; clientSecret: string }): Promise<number>
linkItemToCredential(credentialId: number, itemId: string): Promise<void>
```

`CheckPluggyCredentialGateway`:

```ts
readCredentialIds(personId: number): Promise<number[]>
readLinkedItemIds(credentialIds: number[]): Promise<string[]>
```

**Por que dois métodos e não um por caso de uso.** Em `check`, as duas recusas são nomeadas e
diferentes — `PLUGGY_CREDENTIAL_NOT_FOUND_FOR_PERSON` (pessoa sem credencial) e
`PLUGGY_CREDENTIAL_ITEM_ID_NOT_FOUND_FOR_PERSON` (credencial sem item vinculado). Colapsar em um
`readReadinessOf(personId)` obrigaria o impl a escolher qual recusa emitir, e regra de negócio
migraria do interactor para o adapter. Em `register`, os dois passos são a própria orquestração que o
caso de uso existe para fazer.

**Alternativa descartada:** gateway com um método `registerCredentialWithItem` que faz tudo. Some com
o caso de uso — sobraria um interactor que só repassa a chamada, e a decisão "sem transação entre os
dois passos" iria parar dentro do adapter, onde ninguém a lê.

**Por que `saveCredential` devolve `number` e não a entidade.** O interactor só precisa do id para o
passo seguinte e para a resposta. Devolver `PluggyCredential` faria o `.types.ts` importar a entidade
inteira e o interactor conhecer `requireId()`, `getClientSecret()` e o webhook provisionado — dado
que ele não usa. O `requireId()` (e o comentário que explica por que ele falha alto em vez de filtrar
em silêncio) passa a viver no impl, que é quem fala com o repositório.

### 2. `CheckPluggyCredentialOutput` não carrega dado no sucesso

`execute` devolvia `void`. Como o retorno agora é `{data, error}`, `data` precisa de um tipo — e
`CheckPluggyCredentialResult` é `Record<string, never>`: sucesso é a ausência de recusa, e não há
dado positivo a devolver.

A primeira versão devolvia `{ itemIds: string[] }`, com o argumento de que era "o que o caso de uso
leu para concluir" e "o que um consumidor futuro vai querer". O engenheiro-pluggy-connector derrubou
isso com o meu próprio critério: descartei `{ ready: true }` por ser campo que nunca vale outra
coisa, e a objeção vale mais forte para `itemIds`, que não tem consumidor **nenhum** — é o antipadrão
do "pode ser útil depois" com roupa de decisão técnica. A forma do payload nasce do primeiro
consumidor real.

Vale lembrar o que **não** está em discussão aqui: converter o caso de uso em vez de apagá-lo foi
decisão explícita do usuário (2.2.2 mandaria apagar código sem consumidor).

### 3. O middleware de autenticação resolve `personRep` do escopo da requisição

`createAuthenticateMiddleware(secret)` perde o parâmetro `people` e a interface
`FindsPersonIdByUsername` some. O middleware lê `req.container` (garantido por
`createRequestScopeMiddleware`, montado antes das rotas) e resolve `personRep`.

**Por que não resolver uma vez no boot** (`deps.container.resolve('personRep')` dentro de
`createHttpServer`): `personRep` é `.scoped()`, e resolvê-lo na raiz o transforma em singleton de
processo com um `getTransaction` que não pertence a nenhuma unidade de trabalho. Resolver por
requisição é o que todo o resto do serviço já faz.

**Consequência para o teste:** `authenticate.middleware.test.ts` passa a montar um container falso
com um `resolve` — mesmo formato que `load-pluggy-history.handler.test.ts` já usa. O middleware
responde `500 PLUGGY_CONNECTOR_AUTHENTICATION_FAILED` se `req.container` estiver ausente, pelo mesmo
motivo que os handlers respondem 500 nesse caso: é falha de wiring, não do requisitante.

### 4. Os quatro repositórios passam a ler a transação do escopo, inclusive `PersonRep`

Regra 2.5 é literal: bag no construtor, model da bag, transação do escopo. Aplico em todas as
operações dos quatro, escrita e leitura.

Hoje isso não muda nada em runtime — nenhuma dessas chamadas acontece dentro de um `startProcess()`,
então `getTransaction` devolve `null` e o Sequelize recebe o mesmo que recebe hoje. O valor é
prevenir exatamente o bug que a regra 2.4 descreve: no dia em que um impl envolver uma dessas
escritas numa unidade atômica, ela entra na transação sem ninguém precisar lembrar de repassá-la.

`PersonRep` entra junto, por decisão do usuário. Continua **read-only** sobre `people` — tabela de
outro repositório (`fronteira-pluggy` regra 13) — e o comentário que declara isso fica no arquivo. A
fronteira que importa ali é "nunca escreve", e ela é preservada; receber a bag não afrouxa nada.

### 5. `register-pluggy-credential.handler.ts` vira função solta

Deixa de exportar `createRegisterPluggyCredentialHandler(interactor)` e passa a exportar
`registerPluggyCredentialHandler(req, res)`, resolvendo do escopo — a forma exata de
`load-pluggy-history.handler.ts`. O tratamento de erro muda de `try/catch` sobre exceção do interactor
para leitura de `{data, error}`, com o `catch` restante cobrindo só falha de wiring
(`PLUGGY_CREDENTIAL_REGISTRATION_FAILED`, 500) — os mesmos status e `errorType` de hoje.

### 6. `src/index.ts` para de abrir a segunda conexão com o banco

Hoje `index.ts` chama `createDatabaseConnection()` e define três models por fora, enquanto o
container abre a sua própria conexão via `getModels()`. Depois da conversão sobra só a do container.
É redução de wiring duplicado, não mudança de comportamento observável.

### 7. `PluggyItemCredentialGateway` vira `PluggyItemCredentialResolver`, e a seção 1 da skill ganha a entrada que falta

A seção 1 de `arquitetura-camadas` declara três coisas dentro de `adapters/gateways/`:
`default-gateway.impl.ts`, `<objeto>/<ação>-<objeto>.impl.ts` e `pluggy-*.gateway.ts` — este último
descrito como "gateway de borda: traduz o SDK/HTTP da Pluggy, **nada de banco**". Só que a 2.3.1
manda extrair, no segundo consumidor, "um colaborador em `adapters/`, ainda não um interactor" — e
não diz onde ele mora. `PluggyItemCredentialGateway` é esse colaborador, e caiu no único padrão de
nome disponível, que é justamente o que proíbe banco.

Correção: arquivo vira `adapters/gateways/pluggy-item-credential.resolver.ts`, classe
`PluggyItemCredentialResolver`, chave `pluggyItemCredentialResolver` (2.3.2), e a seção 1 ganha uma
quarta entrada nomeando `<objeto>.resolver.ts` como o colaborador compartilhado entre impls.

**Alternativa descartada:** criar `adapters/resolvers/`. A seção 1 é contrato fechado e pasta nova
exige decisão do usuário; um quarto tipo de arquivo dentro de uma pasta que já existe é a mudança
menor que resolve o mesmo problema — o caminho volta a denunciar o que o arquivo é.

### 8. `AcceptPluggyWebhookImpl` compõe o resolver, que ganha uma variante que não lança

`credentialFor` lança recusa nomeada; o webhook precisa de `false` sem distinguir "item desconhecido"
de "assinatura inválida" (é decisão de segurança já documentada no próprio impl). O resolver ganha
`findCredentialFor(itemId): Promise<PluggyCredential | undefined>`, e `credentialFor` passa a ser o
invólucro que lança sobre ela. O impl do webhook usa a primeira; posição e histórico seguem na
segunda. A memoização por unidade de trabalho passa a valer para os três.

### 9. A acumulação da cobertura vira comportamento de `PluggyHistoryCoverage`

Hoje `LoadPluggyHistoryInteractor.scanUntilTheEnd` soma a contagem e calcula mais-antiga/mais-nova com
duas funções soltas no arquivo, e só entrega o resultado pronto para `PluggyHistoryCoverage.create`
validar. A entidade valida o invariante (contagem zero ⇒ sem datas; mais-antiga ≤ mais-nova) mas não
sabe chegar nele.

Entra `ObservedHistoryScan` no mesmo arquivo da entidade — `empty()` e `observe(page)` devolvendo nova
instância, com o invariante conferido a cada página em vez de só no fim. Não é conceito novo: é o
acumulador anônimo que já existe, ganhando nome. Fica no arquivo do agregado, sem pasta nem arquivo
novo.

A guarda nova (página com contagem > 0 obrigada a trazer as duas datas) não dispara hoje, porque
`summarize()` no impl deriva contagem e datas da mesma lista.

### 10. `updatedAt` do investimento passa a alimentar `HistorySource`

`PluggyInvestmentDto` ganha `updatedAt?: Date`, lido com o mesmo `optionalDate` que os outros campos
opcionais usam, e `readCustodySources` o propaga. Ausente continua `undefined` ⇒ varredura integral.

O DTO ganhar um campo não afeta o fluxo de posição: `readInvestmentsPage` devolve o DTO por variável
tipada, não por literal, então a propriedade extra é aceita pelo TypeScript e `PluggyPositionRep.save`
monta o rascunho campo a campo.

## Risks / Trade-offs

- **Registro faltando ou com typo no container** → `tests/infra/bootstrap/register.test.ts` resolve a
  árvore inteira; a change adiciona a resolução dos dois interactors novos a esse teste.
- **`req.container` ausente no middleware de autenticação** (ordem de `app.use` invertida por engano
  no futuro) → o middleware recusa com 500 nomeado em vez de deixar `undefined` estourar, e
  `http-server.test.ts` exercita a rota real de ponta a ponta, com Express de verdade.
- **Fakes de teste que hoje simulam o repositório e passam a simular o gateway** → os testes de
  interactor ficam mais simples (um fake, não dois), mas deixam de exercitar a composição
  credencial + vínculo. Essa composição passa a ser coberta pelo teste do impl, que é onde ela
  agora mora.
- **`CheckPluggyCredentialInteractor` continua sem consumidor** → a change não inventa um. Ele fica
  com a forma certa; ligar o caso de uso a um endpoint é decisão de produto, não desta conversão.

## Migration Plan

Sem migration de banco e sem passo de deploy: é uma única mudança de código, coerente em um commit.
Rollback é reverter o commit.
