## 1. Pré-condição de branch

- [x] 1.1 Confirmar que o working tree tem os 7 arquivos de model/migration das tabelas raw do PR #6
  (`feat/pluggy-complete-data-capture`) — branch desta change nasce dali, não de `staging` puro (D5 do
  design.md). Verificar com `git log --oneline -1` e a presença de
  `src/infra/db/models/pluggy-account-raw-model.ts`. Branch `feat/renomear-tabelas-radar-pluggy` criada a
  partir de `feat/pluggy-complete-data-capture` (commit `906c046`); os 7 models raw confirmados
  presentes no working tree.

## 2. Migration de rename

- [x] 2.1 Migration nova (`20260907090000-renomear-tabelas-pluggy-connector-para-radar-pluggy.cjs`)
  cobrindo as 21 tabelas com `queryInterface.renameTable` + `ALTER TABLE ... RENAME INDEX` por índice
  nomeado, mesmo padrão de `20260903090000-renomear-tabelas-pluggy-connector.cjs`:

  | de | para |
  |---|---|
  | `pluggy_connector_accounts` | `radar_pluggy_accounts` |
  | `pluggy_connector_account_transactions` | `radar_pluggy_account_transactions` |
  | `pluggy_connector_consents` | `radar_pluggy_consents` |
  | `pluggy_connector_credential_items` | `radar_pluggy_credential_items` |
  | `pluggy_connector_credentials` | `radar_pluggy_credentials` |
  | `pluggy_connector_history_coverage` | `radar_pluggy_history_coverage` |
  | `pluggy_connector_history_sync_states` | `radar_pluggy_history_sync_states` |
  | `pluggy_connector_investment_transactions` | `radar_pluggy_investment_transactions` |
  | `pluggy_connector_items` | `radar_pluggy_items` |
  | `pluggy_connector_loans` | `radar_pluggy_loans` |
  | `pluggy_connector_loan_snapshots` | `radar_pluggy_loan_snapshots` |
  | `pluggy_connector_positions` | `radar_pluggy_positions` |
  | `pluggy_connector_position_snapshots` | `radar_pluggy_position_snapshots` |
  | `pluggy_connector_webhook_events` | `radar_pluggy_webhook_events` |
  | `pluggy_connector_account_raw` | `radar_pluggy_account_raw` |
  | `pluggy_connector_account_transaction_raw` | `radar_pluggy_account_transaction_raw` |
  | `pluggy_connector_consent_raw` | `radar_pluggy_consent_raw` |
  | `pluggy_connector_investment_transaction_raw` | `radar_pluggy_investment_transaction_raw` |
  | `pluggy_connector_item_raw` | `radar_pluggy_item_raw` |
  | `pluggy_connector_loan_raw` | `radar_pluggy_loan_raw` |
  | `pluggy_connector_position_raw` | `radar_pluggy_position_raw` |

  Cada índice renomeado troca só o prefixo `pluggy_connector` por `radar_pluggy` no próprio nome do
  índice (ex.: `uq_pluggy_connector_accounts_item_account` → `uq_radar_pluggy_accounts_item_account`) —
  usar `SHOW INDEX FROM <tabela>` no banco de dev como fonte de verdade dos nomes reais, não o
  código-fonte das migrations antigas.
- [x] 2.2 Rodar `up` e `down` local no banco de dev (`oplab_radar`) e confirmar com `SHOW TABLES LIKE
  'radar_pluggy%'` / `SHOW TABLES LIKE 'pluggy_connector%'` que o rename e a reversão batem exatamente
  com a lista acima (nenhuma tabela extra renomeada, nenhuma esquecida). `up`: 21/21 renomeadas, 0
  remanescente. `down`: 21/21 revertidas, nomes de índice batendo exatamente com o original. Banco de
  dev deixado no estado final (`up` reaplicado após o teste de `down`).
- [x] 2.3 Confirmar que a FK continua íntegra após o rename. Confirmado — e o nome autogerado da
  constraint (`..._ibfk_1`) também é atualizado sozinho pelo MySQL, sem ação explícita (design.md D3
  corrigido para refletir o comportamento real observado, não a suposição original).

## 3. Models

- [x] 3.1 Atualizar `tableName` nos 21 models Sequelize (14 em `src/infra/db/models/*.ts` hoje em
  `staging`, mais os 7 raw trazidos do PR #6) para o nome `radar_pluggy_*` correspondente. Nome da classe
  TypeScript não muda. Também atualizados 3 comentários que citavam o nome físico antigo por extenso
  (`pluggy-loan-model.ts`, `pluggy-loan-snapshot-model.ts`, `pluggy-position-model.ts`).
- [x] 3.2 Rodar `tsc --noEmit` e confirmar limpo. Limpo.

## 4. Testes

- [x] 4.1 Localizar todo teste com o nome físico antigo hardcoded (`grep -rl "pluggy_connector_"
  tests/`) e atualizar para o nome novo — inclui `describeTable(...)`, `showAllTables().includes(...)` e
  caminho de `require` de migration usado em blocos de self-heal. Exceção deliberada: `logger.test.ts`
  usa `pluggy_connector_accounts` só como string de exemplo sintética num teste de redação de segredo em
  log SQL — não testa schema real, não foi alterado. Achado: em 8 arquivos de teste de contrato
  (`*.contract.test.ts`), o `targetName` passado a `createProxyQueryInterface` precisa continuar
  apontando para o nome físico que a migration ORIGINAL (nunca editada) usa internamente
  (`pluggy_connector_*`) — só o nome lido do banco real (`describeTable`, `tables.includes`) muda para
  `radar_pluggy_*`. Corrigido nesses 8 arquivos após a primeira tentativa de `sed` global ter trocado o
  `targetName` também, o que quebrava a interceptação do proxy.
- [x] 4.2 Rodar `npm test` e confirmar verde. Achado, fora do escopo original mas resolvido como efeito
  colateral: o banco `oplab_radar_test` tinha um schema divergente pré-existente em 4 tabelas
  (`credentials`, `credential_items`, `items`, `positions` — índices com nome do rename original de
  2026-09-01, sem o segmento `connector`, nunca atualizados pelo rename de 2026-09-03). Corrigido
  diretamente no banco de teste (ambiente descartável, sem migration versionada) antes de aplicar o
  rename desta change. Resultado: **572/572 testes passaram**, incluindo as 12 que antes desta change
  falhavam por causa dessa mesma divergência.

## 5. Documentação

- [x] 5.1 Corrigir a skill `fronteira-pluggy` (regra 13): onde hoje documenta `pluggy_connector_` como o
  prefixo físico corrente, passa a documentar `radar_pluggy_`. Também removida a menção desatualizada a
  `pluggy_webhooks` como tabela própria com nome de exceção — é a tabela órfã achada durante o
  levantamento (sem model TypeScript, superada por `radar_pluggy_webhook_events`), não fazia sentido
  documentá-la como parte do padrão de nomeação corrente. Corrigida também 1 ocorrência em
  `arquitetura-camadas` (linha 525, exemplo de resolução de tenant no webhook).
- [x] 5.2 Confirmar que `GEMINI.md`, `README.md` e `PENDENCIAS.md` já usam `radar_pluggy_`. Confirmado —
  zero ocorrência de `pluggy_connector_` nos três, nenhuma edição necessária.

## 6. Verificação

- [x] 6.1 Rodar `npm run lint` e confirmar verde, sem novo erro introduzido — 1 erro pré-existente e não
  relacionado em `test-digest.js` (arquivo solto na raiz, não rastreado pelo git, fora do escopo). `tsc
  --noEmit` já confirmado limpo na tarefa 3.2.
- [x] 6.2 Rodar `openspec validate renomear-tabelas-radar-pluggy --strict` e confirmar sem erro
  bloqueante. Limpo: "Change 'renomear-tabelas-radar-pluggy' is valid".
- [x] 6.3 Acionar `arquiteto-radar-pluggy` e `engenheiro-radar-pluggy` (`padroes-de-engenharia`, seção 7 —
  obrigatório, sem exceção de risco pequeno) e corrigir todo achado bloqueante antes de considerar a
  change concluída.
  - `arquiteto-radar-pluggy`: **Aprovado** de primeira — estrutura, pastas, direção de dependência,
    convenção de model/migration todos corretos; verificação própria (572 testes, inspeção direta do
    banco) confirmou o alegado.
  - `engenheiro-radar-pluggy`: **Ajustar** (2 achados bloqueantes, ambos corrigidos):
    1. 5 comentários fora de `tests/`/`migrations/` ainda citavam o nome físico antigo — corrigidos
       (`pluggy-account.rep.ts:47`, `pluggy-credential.rep.ts:26`, `pluggy-position-snapshot.rep.ts:34`,
       `pluggy-loan-snapshot.rep.ts:32`, `pluggy-credential.ts:44`). Confirmado por `grep -rln
       "pluggy_connector_" src/ | grep -v migrations/` — zero restante.
    2. `proposal.md`/`design.md` diziam "22 índices"; a migration real renomeia 31 — corrigido nos dois
       documentos.
    `tsc --noEmit` e `npm run lint` reconfirmados limpos após as correções.
