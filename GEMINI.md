# Diretrizes do Projeto — radar-pluggy

## 1. Fluxo de Trabalho e Planejamento

- **Plano Primeiro**: Antes de escrever qualquer código ou executar qualquer comando modificador (como `npx sequelize-cli db:migrate` ou alterações no banco), elabore ou atualize o plano de implementação em `implementation_plan.md` com `request_feedback: true` e **aguarde a aprovação explícita do usuário**.
- **Nunca antecipar execução**: Não rode comandos de migração ou mutação durante a fase de planejamento.
- **Estilo de Resposta**: Direto ao ponto. Sem textão, sem enrolação. Descreva decisões diretamente em português claro, sem inventar siglas opacas. Links para arquivos devem ser clicáveis no padrão `file:///caminho/absoluto`.

## 2. Regras Não Negociáveis de Arquitetura e Modelagem

- **Isolamento de Banco**: Toda tabela nova pertence exclusivamente a este serviço (`modelagem-de-dados`, regra 1). Nunca crie migration nem faça `ALTER` em `people`, `custody_accounts` ou qualquer tabela pré-existente de outro serviço.
- **Nomenclatura Física vs. Código**:
  - Nome físico de tabela e índice no MySQL leva obrigatoriamente o prefixo `radar_pluggy_` (ex.: `radar_pluggy_accounts`, `uq_radar_pluggy_accounts_item_account`).
  - Entidades TypeScript, models Sequelize e repositórios **não** levam o prefixo no nome da classe ou do arquivo (ex.: `PluggyAccount`, `definePluggyAccountModel`, `PluggyAccountRep`). Apenas a propriedade `tableName:` do model e as migrations usam o prefixo físico.
- **Fronteira Decimal**:
  - Todo valor monetário e quantidade converte uma única vez na borda dos gateways usando `new Decimal(String(n))` (`fronteira-pluggy`, regra 1). Proibido usar `parseFloat` ou aritmética sobre tipo primitivo `number`.
  - `quantity`, `value`, `price_factor`, `indexer_percentage` e `agreed_rate` usam `DECIMAL(20, 8)`.
  - `balance`, `amount`, `net_amount`, `amount_original`, `taxes`, `taxes2` e despesas usam `DECIMAL(20, 2)`.
- **Entidades Fortes e Invariantes**:
  - Construtor privado, métodos factory estáticos `create` (com guarda contra propriedades inesperadas em runtime) e `reconstitute`, estado privado imutável com getters.
  - Campo obrigatório ausente deve lançar `ApplicationError` nomeado com detalhes; nunca use valores default como `?? 0` ou `?? ''`.
- **Snapshot Histórico de Posição (D11 & Task 1.4)**:
  - `SyncPluggyPositionInteractor` salva a fotografia (`radar_pluggy_positions`) e o snapshot histórico (`radar_pluggy_position_snapshots`) **na mesma transação de banco** (`SequelizeTransactionRunner`).
  - O campo de idempotência do snapshot é `quota_date` (data de cotação entregue pela Pluggy, nunca o instante da sincronização).
  - Se a gravação do snapshot falhar, o rollback desfaz a fotografia e a marca d'água não avança.
- **Segredos Cifrados**:
  - O campo `webhook_secret` em `radar_pluggy_credentials` usa `STRING(512)` (mesmo tipo e tamanho de `client_secret` cifrado; não use `TEXT`).
- **Migrations Reversíveis e Imutáveis**:
  - Toda migration nova descreve e testa explicitamente o método `down`, garantindo reversibilidade sem perda de índices não relacionados.
  - Nunca edite migrations já aplicadas; sempre crie uma nova migration.
- **Limites de Escopo**:
  - Não gere `fiscal_event` nem concilie automaticamente com notas de corretagem (fora de escopo).
  - Nunca execute `git add` ou `git commit`.
  - Não execute a task 8.2 (acionamento de agentes externos).
