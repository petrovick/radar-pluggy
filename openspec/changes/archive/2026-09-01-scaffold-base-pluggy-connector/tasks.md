## 1. package.json e dependências

- [x] 1.1 Criar `package.json` com TypeScript, Vitest, Express, `pluggy-sdk`, ESLint e husky como
      dependências, e `npm install` rodando sem erro.
- [x] 1.2 Adicionar scripts `lint`, `type-check`, `test` no `package.json`. Verificado: `lint` passa limpo;
      `type-check` e `test` falham só por ausência de arquivo-fonte/teste (esperado em árvore vazia), sem
      erro de configuração.

## 2. Estrutura de pastas

- [x] 2.1 Criar `src/entities`, `src/interactors`, `src/adapters/gateways`, `src/adapters/repositories`,
      `src/adapters/handlers`, `src/infra`, `src/shared` e `tests/` — cada uma com um `.gitkeep` ou arquivo
      mínimo, e verificar que a árvore bate exatamente com a lista de `arquitetura-camadas`.

## 3. TypeScript e lint de fronteira

- [x] 3.1 Criar `tsconfig.json` com `strict: true`. Verificado: `npm run type-check` falha só com
      `TS18003` (nenhum arquivo-fonte encontrado) — erro esperado de árvore sem `.ts` ainda, não erro de
      configuração. Volta a passar assim que o primeiro arquivo real for criado.
- [x] 3.2 Configurar ESLint com `no-restricted-imports` proibindo `src/interactors/**` de importar
      `src/infra/**` ou `pluggy-sdk`, e verificar com um arquivo de teste temporário que a regra dispara
      erro de lint — remover o arquivo de teste depois de confirmar.

## 4. Gate mecânico (pre-commit e CI)

- [x] 4.1 Configurar husky rodando `lint`, `type-check` e `test` no pre-commit. Verificado: uma tentativa
      de commit foi bloqueada de fato (script de `type-check` falhou e o hook impediu o commit) — árvore
      ainda sem código real, então não há commit efetivo nesta change; acontece com a primeira entidade.
- [x] 4.2 Criar workflow de GitHub Actions rodando os três mesmos comandos em push/PR. Verificado: YAML
      válido, mesmos três comandos do pre-commit. Execução real num PR fica pendente até o repositório ter
      remoto no GitHub — não existe ainda.

## 5. Fechamento da pendência registrada

- [x] 5.1 Atualizar `README.md`, removendo a pendência de config mecânica (já fechada por esta change) e
      registrando que a próxima peça de código real é a primeira entidade (`PluggyItem`, `PluggyPosition`
      ou `InvestmentIncome`), a decidir em change própria.
