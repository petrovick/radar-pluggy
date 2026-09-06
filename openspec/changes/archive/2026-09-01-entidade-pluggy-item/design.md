## Context

Primeira change deste serviço a tocar banco de verdade. `package.json` ainda não tem `sequelize` nem
`sequelize-cli` — só `decimal.js`, `express`, `pluggy-sdk`. `arquitetura-camadas` já fecha onde cada
pedaço mora (`src/entities`, `src/adapters/repositories`, `src/infra`); `modelagem-de-dados` já fecha
convenção de coluna e a fronteira de que tabela este serviço pode escrever (`pluggy_items` é dele). Ver
`proposal.md` para motivação.

## Goals / Non-Goals

**Goals:**
- Decidir onde a dependência `sequelize`/`sequelize-cli` entra e onde a migration física mora, já que
  isso não foi decidido em nenhuma change anterior.
- Decidir o desenho de coluna de `pluggy_items` e qual campo carrega a invariante da entidade.
- Decidir o formato do teste de contrato local (model factory vs. migration), comparando só contra o
  schema deste próprio repositório.

**Non-Goals:**
- Não desenha nenhuma publicação ou integração com `oplab-radar-api`/`oplab-radar-front` — fora do
  escopo desta change.
- Não desenha o handler de webhook nem o interactor de sincronização — só a entidade e a persistência.
- Não valida todos os ~30 valores de `executionStatus` — ver Decisão D4.

## Decisions

**D1. `sequelize` e `sequelize-cli` entram como dependência nesta change.**
Nenhuma change anterior instalou ORM. Como este é o primeiro código que escreve em `pluggy_items`, a
dependência nasce aqui, junto com o schema que ela serve — evita uma change "só infra" sem tabela real
para validar a configuração.

**D2. Migration mora em `src/infra/db/migrations/`, como `.cjs` puro — nunca `.ts`.**
`oplab-radar-api` (mesmo banco físico `oplab_radar`) agrupa tudo que é banco sob `infra/db/`
(`models/` + `migrations/` + conexão); esta decisão corrige uma primeira versão desta change que colocava
a migration em `migrations/` na raiz do repositório — inconsistente com o próprio precedente citado como
justificativa (achado do usuário, revisando a saída do `arquiteto-pluggy-connector`). `.cjs`
(`module.exports`) continua sendo a extensão certa, não `.ts`: `tsconfig.json` deste repositório usa
`include: ["src", "tests"]`, um padrão sem `*`/extensão que só resolve `.ts`/`.tsx`/`.d.ts` — confirmado
rodando `tsc --noEmit` com a migration `.cjs` já dentro de `src/infra/db/migrations/`, sem nenhum erro de
type-check. `.sequelizerc` aponta `migrations-path` para `src/infra/db/migrations/` e `config` para
`sequelize.config.cjs` (também `.cjs`, mesmo motivo).

**D3. Model factory mora em `src/infra/db/models/`, repositório em `src/adapters/repositories/`; nenhum
dos dois persiste um objeto que não passou pela fábrica da entidade.**
Correção da mesma revisão do usuário: a primeira versão desta change colocava `definePluggyItemModel` em
`adapters/repositories/`, misturando "forma da tabela" (pertence a `infra/db/models/`, ao lado da
migration que a origina) com "classe que usa o model para orquestrar leitura/escrita"
(`adapters/repositories/`) na mesma pasta — o `arquiteto-pluggy-connector` aprovou a primeira versão sem
notar a mistura; a `arquitetura-camadas` foi corrigida para deixar isso explícito antes desta correção.
`definePluggyItemModel(sequelize)` declara só a forma da tabela (sem lógica). Classe e arquivo usam o
sufixo curto `Rep`/`.rep.ts` (não `Repository`/`-repository.ts` por extenso, preferência do usuário).
`PluggyItemRep.save`
usa `findOrCreate` para a criação (unicidade de `item_id` sem a corrida de "buscar, e se não achar,
criar" em dois passos). Quando a linha já existe, `findOrCreate` a devolve intocada — a atualização de
`status`/`executionStatus`/watermark roda à parte, contra o estado **real persistido** (recarregado via
`PluggyItem.reconstitute`), nunca contra o rascunho recém-validado: só assim `advanceWatermark` compara
com uma marca d'água que existe de verdade, em vez de comparar contra `undefined` sempre. A validação
nunca é feita só no banco — está toda antes de qualquer `INSERT`/`UPDATE`.
Correção registrada na revisão do `engenheiro-pluggy-connector`: a primeira versão desta change criava
sempre uma entidade nova antes de checar a existência da linha, o que tornava `advanceWatermark`
inatingível pelo caminho real de persistência.

**D3.1. `PluggyItem.create` também recusa em runtime um campo fora do conjunto esperado, nomeando-o.**
A checagem de tipo (`CreatePluggyItemProps`) já barra um objeto-literal com `clientSecret`, mas não pega
uma variável/objeto espalhado vindo de fora (`{...payload, personId}`) — que é exatamente a forma como um
payload de webhook chegaria numa change futura. Como o Requirement 4 do spec descreve comportamento em
runtime ("a operação é recusada, nomeando o campo"), a fábrica também roda um guard em runtime
(`assertNoUnexpectedFields`) sobre o conjunto de chaves permitido, além da checagem de tipo.

**D4. `status` carrega a invariante fechada; `executionStatus` é armazenado como texto livre, não
validado.**
A Pluggy documenta `status` como um conjunto fechado e estável de 5 valores (`UPDATING`, `LOGIN_ERROR`,
`OUTDATED`, `WAITING_USER_INPUT`, `UPDATED` — confirmado em `docs.pluggy.ai/docs/item-lifecycle`), que é o
campo que efetivamente decide o que o resto do sistema faz com o item. `executionStatus` tem dezenas de
valores intermediários e de erro (`LOGIN_IN_PROGRESS`, `MERGE_ERROR`, `ACCOUNT_LOCKED`, etc.), evolui
conforme a Pluggy adiciona conectores, e serve só para diagnóstico humano — validar um closed-set desse
tamanho criaria acoplamento frágil a mudança de fornecedor sem ganho de invariante real no domínio.
Alternativa descartada: validar `executionStatus` com o mesmo rigor de `status` — rejeitada pelo motivo
acima; se um caso de uso futuro precisar decidir com base num valor específico de `executionStatus`, essa
necessidade vira invariante própria naquele momento, não aqui.

**D5. `item_id` é `STRING(36)` único (UUID da Pluggy), não a chave primária física.**
PK segue a convenção de `modelagem-de-dados` (`BIGINT.UNSIGNED autoIncrement`), igual `people.id`.
`item_id` carrega a unicidade de negócio via `UNIQUE` próprio, sem virar PK — mantém a tabela consistente
com o resto do schema físico compartilhado.

**D6. `person_id` é coluna simples com índice, nunca uma `FOREIGN KEY` física para `people`.**
`fronteira-pluggy` regra 13 e `modelagem-de-dados` regra 1 proíbem "`FOREIGN KEY` de saída impondo
constraint sobre elas" — uma `references: { model: 'people', key: 'id' }` na migration de `pluggy_items`
seria exatamente isso: o MySQL passaria a exigir que qualquer alteração em `people.id` (feita pelo
histórico de migration do `oplab-radar-api`, repositório e migration history diferentes) respeite uma
constraint definida por este lado. `person_id` é `BIGINT.UNSIGNED NOT NULL` com índice comum
(`addIndex`, não `references`) — suficiente para performance de consulta, sem acoplamento físico entre os
dois históricos de migration. A garantia de que `person_id` aponta para uma pessoa real é
responsabilidade da aplicação (repositório/entidade), não do schema.
Alternativa descartada: `references`/`onDelete` como em migrations do próprio `oplab-radar-api` (ex.:
`custody_accounts` → `people`) — válido lá porque as duas tabelas pertencem ao mesmo repositório e
histórico de migration; aqui pertencem a repositórios diferentes, então a mesma técnica vira exatamente o
acoplamento que a regra 13 nomeia e proíbe.

**D7. Teste de contrato compara o model factory local contra a migration local, escopo desta change.**
O teste de contrato aqui é local, sem qualquer publicação: cria a tabela pela migration num banco de
teste, introspecciona as colunas reais, e compara contra as colunas declaradas em
`definePluggyItemModel` — nasce na mesma tarefa que cria migration e model, nunca como item separado que
pode ficar pra depois.

## Risks / Trade-offs

- **Nenhuma migration roda no boot** (decisão já registrada na arquitetura geral) → aplicar via
  `sequelize-cli db:migrate` manual/passo de deploy explícito, nunca automático.
- **`executionStatus` sem validação** pode um dia guardar um valor que a Pluggy nunca documentou →
  aceito, é campo de diagnóstico; não decide comportamento de domínio.
- **Primeira vez que este serviço grava no banco físico compartilhado** com `oplab-radar-api` → migration
  só cria tabela nova (`pluggy_items`), nunca altera tabela existente; risco de colisão de schema é o
  mesmo que `modelagem-de-dados` já mitiga.

## Migration Plan

1. `npm install sequelize sequelize-cli` (+ tipos, se necessário).
2. `.sequelizerc` + `sequelize.config.cjs` apontando para o banco `oplab_radar` via as mesmas env vars
   locais do `oplab-radar-api` (`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`,
   `MYSQL_PASSWORD`) — mesmo banco físico, mesma rede Docker de dev, sem inventar nomenclatura nova.
3. Migration `src/infra/db/migrations/YYYYMMDDHHMMSS-criar-pluggy-items.cjs` criando a tabela; `down` faz
   `dropTable`.
4. Aplicar manualmente (`sequelize-cli db:migrate`) contra o ambiente de desenvolvimento antes do PR.
5. Rollback: `sequelize-cli db:migrate:undo` — seguro porque a tabela é nova e não tem consumidor ainda.
