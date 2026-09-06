## Why

O scaffold do `pluggy-connector` está fechado (arquitetura, lint de fronteira, CI), mas nenhuma entidade
real existe. `PluggyItem` é a peça de código que representa o estado sincronizado de uma conexão Pluggy
(status de execução, marca d'água de sincronização) — pré-requisito para qualquer interactor de
sincronização ou handler de webhook futuro, que precisam de algo para ler e persistir esse estado.

## What Changes

- Criar a entidade `PluggyItem` (construtor privado + factory, invariante de transição de
  `executionStatus` validada na própria entidade).
- Criar a migration própria da tabela `pluggy_items` (este serviço é dono dela, conforme
  `modelagem-de-dados`), com FK de leitura para `person_id` (`people` é somente leitura, sem
  `references`/`onDelete` de saída impondo constraint sobre ela).
- Criar o model factory Sequelize espelhando a migration, com tradução `snake_case` → `camelCase` na
  fronteira model→entity.
- Teste que morde a invariante de transição de `executionStatus` e teste de contrato comparando o model
  factory contra a migration real.
- Não inclui: interactor de sincronização, rota HTTP, chamada ao `pluggy-sdk`, tabela de credencial
  (`clientId`/`clientSecret` continuam no `oplab-radar-api`, fora do escopo deste serviço).

## Capabilities

### New Capabilities
- `pluggy-item`: estado sincronizado de um item Pluggy (execução, marca d'água) como entidade forte e
  tabela própria deste serviço.

### Modified Capabilities
(nenhuma — não há spec existente para alterar)

## Impact

- Código novo: `src/entities/pluggy-item.ts` (ou equivalente), migration em `src/infra/db/migrations/`,
  model factory em `src/infra/db/models/` e classe de acesso a dado (`.rep.ts`) em
  `src/adapters/repositories/` (ver `arquitetura-camadas` para localização exata).
- Banco físico `oplab_radar`: nova tabela `pluggy_items`, sem alterar `people`/`custody_accounts`.
- Nenhum impacto em `oplab-radar-api`/`oplab-radar-front` nesta change — só a entidade e a migration
  deste lado.
