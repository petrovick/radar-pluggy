import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**'],
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      // CommonJS puro (migration do sequelize-cli, sequelize.config.cjs): `require()` é a única
      // forma de import que existe aqui, não dívida a evitar.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // Scripts de tooling (tasks/dev.mjs, tasks/setup.mjs): ESM rodando direto no Node, fora do
    // `src/` compilado — precisam dos globals do Node (process, console, timers), que o preset
    // padrão não declara.
    files: ['tasks/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/interactors/**/*.ts'],
    rules: {
      // Regra 2 de `arquitetura-camadas` mecanizada. A ÚNICA importação de `infra/` que um caso de
      // uso pode fazer é o tipo `AppContainer` de `infra/bootstrap/register` — é por ele que o
      // construtor recebe a bag e resolve o próprio gateway (mesma forma do `create-car.interactor`
      // no `oplab-radar-api`). Todo o resto de `infra/` e o `pluggy-sdk` seguem proibidos: quem fala
      // com banco, HTTP ou SDK é o impl do gateway, em `adapters/gateways/`.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/infra/db/**',
                '**/infra/db',
                '**/infra/tools/**',
                '**/infra/http/**',
                '**/infra/worker/**',
                '**/infra/bootstrap/scope*',
                '**/infra/config/**',
                'pluggy-sdk',
              ],
              message:
                'interactor não importa infra/ nem pluggy-sdk direto — a única exceção é o tipo AppContainer de infra/bootstrap/register; o resto entra pelo gateway do caso de uso.',
            },
          ],
        },
      ],
    },
  },
)
