## Why

O `pluggy-connector` tem arquitetura, skills e revisores decididos, mas nenhum arquivo de código. O
`README.md` já registra como pendência que a config mecânica (tsconfig estrito, lint de fronteira entre
pastas, pre-commit, CI) só existiria "quando o scaffold do serviço for criado". Esta change cria esse
scaffold, fechando essa pendência.

## What Changes

- Cria `package.json` com TypeScript, Vitest, Express e `pluggy-sdk` como dependências, seguindo a decisão
  já tomada de usar TypeScript e Vitest.
- Cria a estrutura de pastas exata definida em `arquitetura-camadas`: `src/entities`, `src/interactors`,
  `src/adapters/{gateways,repositories,handlers}`, `src/infra`, `src/shared`, `tests/` espelhando `src/`.
- Cria `tsconfig.json` em modo estrito.
- Cria regra de lint de fronteira entre pastas: falha se `src/interactors` importar de `src/infra` ou de
  `pluggy-sdk` diretamente — a mesma regra que a skill já documenta, agora como verificação automática.
- Cria hook de pre-commit (husky) rodando lint, type-check e teste.
- Cria workflow de CI rodando as mesmas três verificações em cada push/PR.
- Nenhuma entidade, interactor ou rota é escrita nesta change — só o esqueleto e o gate mecânico.

## Capabilities

Nenhuma. Scaffold e tooling, sem comportamento de runtime — `skip_specs: true`.

## Impact

- Arquivos novos na raiz do repositório (`package.json`, `tsconfig.json`, configs de lint/husky/CI) e em
  `src/`, `tests/`.
- Fecha a pendência de config mecânica já registrada em `README.md`.
- Depois desta change, a primeira entidade real (`PluggyItem`, `PluggyPosition` ou `InvestmentIncome`) já
  tem onde morar e já roda sob o gate de lint/type-check/teste — fica pra uma próxima change.
