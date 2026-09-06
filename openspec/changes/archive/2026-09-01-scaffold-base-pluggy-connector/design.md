## Context

Ver `proposal.md`. Repositório GitHub separado do `oplab-radar-api`, sem nenhum arquivo hoje. As pastas e a
regra de dependência já estão fechadas em `arquitetura-camadas`; esta change só torna isso executável por
ferramenta, em vez de depender de quem lê a skill.

## Goals / Non-Goals

**Goals:**
- Repositório instalável (`npm install`) e rodável (`npm test`) no primeiro clone.
- Violação da regra de pasta (interactor importando infra/SDK direto) falha o lint, não só a revisão
  humana.

**Non-Goals:**
- Não decide o mecanismo de deploy (Railway, Docker) — fica pra quando o serviço tiver algo pra rodar.
- Não escreve entidade nenhuma — coberto por outras changes.
- Não resolve o `GRANT` de banco levantado como questão aberta na change arquivada
  `definir-skills-arquiteturais-pluggy-connector` — continua em aberto.

## Decisions

**Gerenciador de pacote: npm.**
Mesmo gerenciador do `oplab-radar-api`, sem motivo pra divergir.

**Regra de fronteira de import: ESLint com `no-restricted-imports` por pasta, via `overrides`.**
`src/interactors/**` não pode importar de `src/infra/**` nem do pacote `pluggy-sdk`. Alternativa
descartada: um plugin dedicado de "boundaries" (ex. `eslint-plugin-boundaries`) — descartada por ser mais
configuração do que o problema exige; uma regra nativa do ESLint já resolve com uma lista de padrões.

**CI: GitHub Actions.**
Repositório vive no GitHub; roda lint, type-check e teste em cada push/PR. Alternativa descartada: gate só
no pre-commit local — descartada porque pre-commit é contornável (`--no-verify`) e não pega quem esqueceu
de instalar o hook.

**Pre-commit: husky, rodando os três mesmos comandos do CI.**
Feedback local antes de empurrar — não substitui o CI, é a primeira camada.

**`tsconfig.json` estrito desde o primeiro commit.**
`strict: true`, sem período de transição — não existe código legado aqui pra migrar aos poucos.

## Risks / Trade-offs

- **Regra de ESLint só pega o padrão de import que ela lista** → uma forma nova de contornar (ex.
  `require` dinâmico) não é pega. Mitigação: a skill `arquitetura-camadas` continua sendo a fonte de
  verdade pro revisor humano; o lint é reforço, não substituto.
- **CI genérico não conhece a regra fiscal deste domínio** → lint/type-check/teste pegam erro de sintaxe e
  de tipo, não erro de regra de negócio errada. Isso é papel do Engenheiro na revisão, não do CI.

## Migration Plan

Não aplicável — repositório novo, sem dado nem deploy existente.
