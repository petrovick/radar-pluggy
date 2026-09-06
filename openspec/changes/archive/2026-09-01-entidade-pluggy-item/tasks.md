## 1. Dependência e configuração de banco

- [x] 1.1 Adicionar `sequelize` e `sequelize-cli` ao `package.json` e verificar `npm install` sem erro.
- [x] 1.2 Criar `.sequelizerc` apontando `migrations-path` para `src/infra/db/migrations/` (corrigido de
      `migrations/` na raiz após revisão do usuário — ver design.md D2) e `config` para
      `sequelize.config.cjs` (CommonJS puro, fora do `include` do `tsconfig.json` — mesma convenção do
      `sequelize.config.cjs` de `oplab-radar-api`); ler `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_DATABASE`/
      `MYSQL_USER`/`MYSQL_PASSWORD`, dialect `mysql`. Verificar com `npx sequelize-cli db:migrate:status`
      rodando sem erro de configuração.
- [x] 1.3 Criar `src/infra/db/database.ts` (corrigido de `src/infra/database.ts` — ver design.md D2/D3)
      com a instância Sequelize de runtime, usada pelo repositório (não pela migration). Verificar que
      `npm run type-check` continua limpo.

## 2. Migration `pluggy_items`

- [x] 2.1 Criar migration `src/infra/db/migrations/<timestamp>-criar-pluggy-items.cjs` com colunas `id`
      (`BIGINT.UNSIGNED` autoIncrement PK), `item_id` (`STRING(36)`, `UNIQUE`, `allowNull: false`),
      `person_id` (`BIGINT.UNSIGNED`, `allowNull: false`, coluna simples com índice comum — nunca
      `references`/`onDelete` para `people`, ver design D6), `status` (`STRING(20)`, `allowNull: false`),
      `execution_status` (`STRING(50)`, `allowNull: true`), `last_updated_at` (`DATE(3)`,
      `allowNull: true`), `created_at`, `updated_at`. `down` faz `dropTable('pluggy_items')`.
- [x] 2.2 Aplicar a migration no banco de desenvolvimento (`npx sequelize-cli db:migrate`) e verificar a
      tabela criada com as colunas exatas via `DESCRIBE pluggy_items` (MySQL).
- [x] 2.3 Verificar rollback: `npx sequelize-cli db:migrate:undo` remove a tabela sem erro, depois
      reaplicar para deixar o ambiente no estado esperado pelos próximos passos.

## 3. Entidade `PluggyItem`

- [x] 3.1 Criar `src/entities/pluggy-item.ts`: construtor privado, factory `PluggyItem.create({ itemId,
      personId, status })` validando `personId` obrigatório e `status` pertencente ao conjunto
      `UPDATING | LOGIN_ERROR | OUTDATED | WAITING_USER_INPUT | UPDATED`. Recusa nomeando o campo/valor
      inválido, nunca default.
- [x] 3.2 Adicionar `updateStatus(newStatus)` e `advanceWatermark(lastUpdatedAt)` na entidade —
      `advanceWatermark` recusa quando `lastUpdatedAt` recebido é anterior ao já registrado na instância.
- [x] 3.3 Teste unitário (`tests/entities/pluggy-item.test.ts`) cobrindo os 4 requirements do spec:
      criação sem `personId` recusada, `status` desconhecido recusado, watermark retrocedendo recusado,
      e ausência de qualquer campo de credencial na forma pública da entidade. Verificar com
      `npm test -- pluggy-item`.

## 4. Persistência

- [x] 4.1 Criar `src/infra/db/models/pluggy-item-model.ts` com `definePluggyItemModel(sequelize)`
      espelhando exatamente as colunas da migration (só forma, sem lógica). Corrigido de local original
      (`adapters/repositories/`) após revisão do usuário — ver design.md D3.
- [x] 4.2 Criar `src/adapters/repositories/pluggy-item.rep.ts` (`PluggyItemRep`, sufixo curto por
      preferência do usuário — antes `pluggy-item-repository.ts`/`PluggyItemRepository`): métodos de
      escrita chamam a fábrica/métodos da entidade antes de qualquer `findOrCreate`/`update` (unicidade
      de `item_id` via `findOrCreate`, nunca busca-depois-cria em dois passos); tradução `snake_case` →
      `camelCase` na fronteira model → entity.
- [x] 4.3 Teste de contrato (`tests/infra/db/models/pluggy-item-model.contract.test.ts`, espelhando o
      novo local do model): introspecciona a tabela criada pela migration num banco de teste e compara
      contra as colunas
      declaradas em `definePluggyItemModel`. Verificar que o teste falha de propósito se uma coluna for
      removida do model (sanity check manual, revertido antes de commitar).
      Nota: exigiu adicionar serviço MySQL ao CI (`.github/workflows/ci.yml`) — decisão validada com o
      usuário — e corrigir o default de `MYSQL_HOST` (`mysql` → `127.0.0.1`), já que este repositório
      não roda dentro do docker-compose do `oplab-radar-api`.

## 5. Verificação e revisão

- [x] 5.1 Rodar `npm run lint`, `npm run type-check` e `npm test` na íntegra e registrar o resultado
      (sem esperar CI). Resultado: lint limpo (após adicionar globals Node para `**/*.cjs` ao
      `eslint.config.js`), type-check limpo, 8/8 testes passando.
- [x] 5.2 Acionar `arquiteto-pluggy-connector` (estrutura de pasta, direção de dependência) e
      `engenheiro-pluggy-connector` (entidade forte, SOLID, teste mordendo a regra) — obrigatório, sem
      exceção de risco pequeno. Aplicar qualquer veredito "Ajustar" antes de considerar a tarefa concluída.
      Resultado: arquiteto — Aprovado na primeira rodada. Engenheiro — Ajustar (bloqueante) na primeira
      rodada (`PluggyItemRepository.save` nunca lia a linha existente antes de atualizar, tornando
      `advanceWatermark` inatingível pelo caminho real; guarda de credencial só em tempo de compilação;
      `executionStatus` fora de `create`; sem teste de duplicidade de `itemId`). Corrigido e reaprovado
      na segunda rodada — ver `design.md` D3/D3.1 para o registro da correção.

      Pós-aprovação, o usuário apontou que a aprovação do arquiteto não pegou dois desvios de pasta:
      model deveria estar em `infra/db/models/`, não em `adapters/repositories/` (D2/D3), e a nomenclatura
      de arquivo/classe do repositório deveria ser `.rep.ts`/`Rep`, não `-repository.ts`/`Repository` por
      extenso (pasta `adapters/repositories/` continua correta, só o sufixo mudou). Skill e código
      corrigidos; terceira rodada de validação estrutural pendente.
