## Why

Uma auditoria de segurança externa (Mantis, `audit-security.md`) apontou que o serviço usa o prefixo
físico `pluggy_connector_` nas suas tabelas, enquanto `GEMINI.md`, `README.md`, `PENDENCIAS.md` e a
convenção de nomeação do repositório (`radar-pluggy`) apontam para `radar_pluggy_`. Confirmado por
levantamento direto no banco de dev (`oplab_radar`): **21 tabelas** (e 31 índices nomeados) deste
serviço usam hoje o prefixo `pluggy_connector_`. O usuário decidiu que o nome físico correto é `radar_pluggy_` e autorizou a
migration de rename em produção, além da correção da documentação divergente — que, neste caso, é a
skill `fronteira-pluggy` (regra 13), não os quatro documentos citados acima.

## What Changes

- Migration nova (aditiva, nunca edita migration já aplicada) que renomeia as 21 tabelas físicas de
  `pluggy_connector_*` para `radar_pluggy_*`, e os 31 índices nomeados que carregam o prefixo antigo no
  próprio nome — mesmo padrão do precedente `20260903090000-renomear-tabelas-pluggy-connector.cjs`
  (`renameTable` + `ALTER TABLE ... RENAME INDEX`).
- `tableName` de cada model Sequelize atualizado para o novo nome físico (o nome da classe/entity em
  TypeScript não muda — só o nome físico no banco, como já era o caso pré-mudança).
- Todo teste com o nome físico antigo hardcoded (`describeTable`, `showAllTables().includes(...)`,
  caminho de `require` de migration para self-heal) atualizado para o novo nome.
- Regra 13 da skill `fronteira-pluggy` corrigida: onde hoje documenta `pluggy_connector_` como o prefixo
  físico corrente, passa a documentar `radar_pluggy_`.
- **Fora de escopo, não mexe**: `people` (não é dono deste serviço, só leitura, regra 13 já proíbe) e
  `pluggy_webhooks` (tabela órfã achada durante o levantamento — sem `model` TypeScript, sem o prefixo
  `pluggy_connector_`, superada por `pluggy_connector_webhook_events`; provável resíduo de refatoração
  anterior, dívida pré-existente e não relacionada a este rename).

**BREAKING** (interno, não de contrato de API): nome físico de tabela muda. Nenhum endpoint ou DTO muda
de formato — o impacto é só em quem acessa o banco diretamente (scripts, dashboards de BI, se houver).

## Capabilities

Rename de nome físico de tabela não é comportamento observável de nenhuma capability documentada em
`openspec/specs/` (conferido: nenhuma menciona nome físico). `skip_specs: true` já declarado em
`.openspec.yaml` — não há requirement novo ou modificado.

## Impact

- **Migrations**: 1 migration nova (rename), mais a atualização de `tableName` em até 21 arquivos de
  model.
- **Models Sequelize**: 14 já existem em `staging`; 7 (as tabelas de log bruto de
  `pluggy-complete-data-capture`) só existem hoje no PR #6 (`feat/pluggy-complete-data-capture`), ainda
  não mergeado — ver design.md, seção de sequenciamento.
- **Testes**: arquivos que hardcodam o nome físico da tabela (ver design.md para a lista).
- **Skill `fronteira-pluggy`**: regra 13.
- **Nenhum impacto em `oplab-radar-api`**: nenhuma tabela deste serviço é referenciada por FK de fora; a
  única FK real do banco (`pluggy_connector_credential_items_ibfk_1`) é interna a este serviço e o MySQL
  atualiza a referência automaticamente quando a tabela-pai é renomeada.
