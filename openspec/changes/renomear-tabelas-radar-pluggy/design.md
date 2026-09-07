## Context

Levantamento direto no banco de dev (`oplab_radar`, compartilhado com `oplab-radar-api`) em 2026-09-06
confirma **21 tabelas** com o prefixo `pluggy_connector_`, 31 índices nomeados carregando o mesmo prefixo
no nome, e **uma única FK real** no banco inteiro envolvendo este serviço:
`pluggy_connector_credential_items_ibfk_1` (`credential_id` → `pluggy_connector_credentials.id`).

Das 21 tabelas, **14 já têm migration e model em `staging`**. As outras **7 são as tabelas de log bruto**
de `pluggy-complete-data-capture` (`pluggy_connector_{item,consent,position,account,account_transaction,
investment_transaction,loan}_raw`) — já existem fisicamente no banco de dev (aplicadas manualmente
durante a implementação daquela change) mas o código-fonte (migration + model) só existe hoje no PR #6
(`feat/pluggy-complete-data-capture`), ainda não mergeado em `staging`. Ver proposal.md.

Achado lateral, fora de escopo: `pluggy_webhooks` é uma tabela órfã (sem model TypeScript, sem o prefixo
`pluggy_connector_`, superada por `pluggy_connector_webhook_events`). Não é tocada por este rename —
não carrega o prefixo que está sendo corrigido, e removê-la é decisão de limpeza de schema separada, não
autorizada aqui.

Precedente direto de implementação: `20260903090000-renomear-tabelas-pluggy-connector.cjs` — mesma
operação (`pluggy_*` → `pluggy_connector_*`), mesma técnica (`renameTable` + `ALTER TABLE ... RENAME
INDEX`), mesma regra de `modelagem-de-dados` (nunca editar migration já aplicada — o rename é sempre uma
migration nova).

## Goals / Non-Goals

**Goals:**
- Corrigir o nome físico das 21 tabelas e dos 31 índices de `pluggy_connector_*` para `radar_pluggy_*`,
  sem perda de dado e com `down` simétrico.
- Alinhar a skill `fronteira-pluggy` (regra 13) com o nome físico corrente, em vez de deixá-la divergente
  do banco real.

**Non-Goals:**
- Remover a tabela órfã `pluggy_webhooks` — achado lateral, não autorizado nesta change.
- Mudar nome de entity/model TypeScript (`PluggyItem`, `PluggyPosition`, ...) — só o nome físico no banco
  muda; a convenção "model sem o prefixo, tabela com o prefixo" (`modelagem-de-dados`) continua.
- Qualquer mudança de contrato de API/DTO — nenhum endpoint expõe nome físico de tabela.

## Decisions

**1. Uma migration só, cobrindo as 21 tabelas de uma vez — não uma por tabela.**
Diferente de `pluggy-complete-data-capture` (uma tabela por conceito de negócio), aqui a operação é
idêntica e mecânica nas 21: `renameTable` + `RENAME INDEX`. Uma migration por tabela geraria 21 arquivos
sem nenhum ganho de granularidade de rollback (o rename inteiro é atômico por natureza da operação, e
parcial não faz sentido — banco com metade renomeada é pior que banco não renomeado). Segue o precedente
de `20260903090000`, que já cobriu 4 tabelas numa migration só.

**2. `RENAME TABLE`, nunca `DROP`+`CREATE`.** MySQL `RENAME TABLE` é atômico, preserva dado, preserva
`AUTO_INCREMENT`, e atualiza automaticamente a FK de `pluggy_connector_credential_items` para apontar
para o novo nome da tabela-pai — sem precisar recriar a constraint. Índice precisa de `ALTER TABLE ...
RENAME INDEX` à parte porque `RENAME TABLE` não renomeia o nome interno do índice (só move o dono).

**3. Nome da constraint de FK não precisa de ação explícita.** Verificado por teste real (`up`/`down` no
banco de dev): o MySQL/InnoDB atualiza sozinho o nome autogerado (`..._ibfk_1`) para refletir o nome novo
da tabela-filha quando ela é renomeada — `pluggy_connector_credential_items_ibfk_1` virou
`radar_pluggy_credential_items_ibfk_1` sem nenhum `ALTER TABLE` adicional. Nenhum passo extra necessário.

**4. `people` e `pluggy_webhooks` ficam de fora da lista de rename.** `people` por regra 13 (não é dono).
`pluggy_webhooks` por não carregar o prefixo que está sendo corrigido — está fora do padrão que motivou
esta change, não é o mesmo problema.

**5. Sequenciamento com o PR #6 (`feat/pluggy-complete-data-capture`): a implementação desta change
nasce a partir da branch daquele PR, não de `staging`.** As 7 tabelas raw só têm model/migration no PR
#6. Escrever a migration de rename e atualizar `tableName` das 21 (14 + 7) exige que os arquivos das 7
já existam no working tree. Ordem de deploy em produção: **PR #6 primeiro** (cria as 7 tabelas raw como
`pluggy_connector_*_raw`), **rename depois** (renomeia as 21 de uma vez, incluindo as 7 recém-criadas).
Rodar o rename antes do deploy do PR #6 em produção quebraria o deploy daquele PR lá (as migrations dele
criam tabela com o nome antigo, que já não existiria mais). Ver Migration Plan.

## Risks / Trade-offs

- [Risco] Renomear 21 tabelas numa única migration é uma operação maior que o padrão "uma tabela por
  migration" do resto do repositório → Mitigação: nenhuma tabela fica em estado intermediário observável
  (todas as chamadas de `renameTable`/`RENAME INDEX` ficam dentro do mesmo `up`, sequencial; se uma falhar
  no meio, a migration inteira falha e o `sequelize-cli` não marca como aplicada — rodar de novo repete
  as que já foram, e `RENAME TABLE`/`RENAME INDEX` numa tabela que já tem o nome novo falha alto,
  contendo o problema em vez de mascará-lo).
- [Risco] `down` depende de nome de índice já renomeado existir exatamente como gravado no `up` →
  Mitigação: nomes de índice vêm de `SHOW INDEX` real no banco de dev (não de suposição sobre o que a
  migration original pretendia), então `up`/`down` refletem o estado físico atual, não o código-fonte
  das migrations antigas.
- [Risco] Se o PR #6 for mergeado e implantado em produção sem que o rename já esteja pronto, produção
  fica temporariamente com 14 tabelas `radar_pluggy_*` e 7 `pluggy_connector_*_raw` (dois prefixos ao
  mesmo tempo) → Mitigação: aceito explicitamente como estado transitório entre os dois deploys; nenhum
  código lê nome físico de tabela fora do `tableName` do próprio model, então não há branch de aplicação
  que quebre por isso. O rename desta change resolve a inconsistência assim que for implantado.
- [Risco] Tabela órfã `pluggy_webhooks` continua no banco, sem dono claro no código → Mitigação: nenhuma
  nesta change; achado lateral, fora do escopo autorizado. Sinalizado ao usuário separadamente.

## Migration Plan

1. Merge do PR #6 em `staging` (fora desta change — trabalho já em revisão).
2. Nesta change: branch nasce de `feat/pluggy-complete-data-capture` (ou de `staging` já com o PR #6
   mergeado, o que vier primeiro). Migration nova de rename cobre as 21 tabelas + 31 índices.
   `tableName` de todos os 21 models atualizado no mesmo commit da migration.
3. Deploy em produção: PR #6 primeiro (se ainda não implantado), rename depois — nunca na ordem inversa.
4. `down` simétrico: `RENAME INDEX` de volta ao nome antigo, depois `renameTable` de volta ao nome
   antigo, na ordem inversa da `up` (mesmo padrão do precedente `20260903090000`).
5. Sem backfill — é rename puro, dado não muda.

## Open Questions

Nenhuma. A única decisão que dependia de fato observável (as 7 tabelas raw entram ou não no rename) foi
resolvida por levantamento direto no banco: elas já existem fisicamente, então entram.
