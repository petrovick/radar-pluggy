## Why

O `pluggy-connector` ainda não tem código. A change arquivada `definir-skills-arquiteturais-pluggy-connector`
já resolveu as skills de domínio (`fronteira-pluggy`, `modelagem-de-dados`) mas deixou em aberto,
deliberadamente, `arquitetura-camadas` e `padroes-de-engenharia` — precisavam de uma decisão de estrutura
que ainda não existia. Esta change toma essa decisão.

O risco que motiva o nível de detalhe aqui: uma LLM sem esse contexto, ao implementar a primeira feature
deste serviço, pode inventar uma topologia razoável na aparência (webhook embutido no `oplab-radar-api`,
credencial Pluggy fixa por processo, entidade anêmica copiando o padrão do `Car`) que colide com decisão já
tomada nesta conversa — e o modo de falha não é erro de compilação, é infraestrutura errada em produção ou
comportamento que viola o uso pessoal do plano gratuito da Pluggy.

## What Changes

- Define a topologia de execução do serviço: processo único, standalone, compartilhado pelas três contas
  Pluggy pessoais (mantenedor, cônjuge, irmão), com resolução de tenant por `itemId` no handler de webhook
  — não processo por pessoa, não embutido no `oplab-radar-api`.
- Define a estrutura de pastas como contrato fechado (lista exaustiva, pasta nova exige parar e perguntar) e
  a regra de dependência entre camadas (interactor nunca importa infra/SDK direto).
- Define o conceito de "entidade forte" (construtor privado + factory validando invariante, comportamento
  próprio) como obrigatório para toda entidade do domínio, e a ordem de projeto (entidade e invariante antes
  do caso de uso que a orquestra).
- Define os princípios de engenharia do repositório: simplicidade sem overengineering, responsabilidade
  única por caso de uso, ausência de retry customizado em chamada à Pluggy (a reentrega de webhook já é o
  mecanismo de retry do fornecedor), verificação exaustiva de cada campo/método/branch antes de aprovar.
- Decide que lint, type-check e teste são gate de pipeline (CI/pre-commit), não conteúdo de skill — e que
  nenhum achado, por menor que seja, vira dívida documentada e tolerada.
- Cria os arquivos `.claude/skills/arquitetura-camadas/SKILL.md` e `.claude/skills/padroes-de-engenharia/SKILL.md`
  deste repositório (Non-Goal da change arquivada, agora resolvido).
- Cria dois subagents de revisão obrigatória deste repositório — Arquiteto (fronteira/pasta/dependência) e
  Engenheiro (SOLID/entidade forte/simplicidade/teste que morde a regra) — cada um com veredito de três
  estados: Aprovado / Ajustar (bloqueante) / Excluir e refazer.
- Decide que a criação da tabela/coluna de credencial Pluggy (`clientId`, `clientSecret` criptografado,
  `itemId`, vínculo a `person_id`) é escrita e propriedade do `oplab-radar-api` (tela de Settings no
  `oplab-radar-front`); este repositório só lê essa tabela, read-only, mesma regra de `people`/`custody_accounts`.
- Decide que a execução de migration deste serviço nunca roda no boot do processo (evita corrida entre
  reinícios) — vira passo explícito de deploy.
- Não altera nenhum comportamento observável de runtime — nenhuma dessas decisões tem código ainda.

## Capabilities

Nenhuma. Mudança de arquitetura, processo e tooling (skills, subagents, decisão de topologia) — sem
comportamento de runtime implementado nesta change. `skip_specs: true`.

## Impact

- Arquivos novos em `.claude/skills/arquitetura-camadas/` e `.claude/skills/padroes-de-engenharia/` deste
  repositório.
- Arquivos novos de definição de subagent (Arquiteto, Engenheiro) para este repositório.
- Reabre, para o `oplab-radar-api`, a necessidade de uma tabela de settings/credencial Pluggy por pessoa
  (fora do escopo de código desta change — fica registrado como dependência a coordenar com aquele
  repositório antes da implementação real do `pluggy-connector`).
- Nenhum código de aplicação deste serviço é escrito nesta change — isso é implementação subsequente
  (scaffold, migrations, interactors, entidades), guiada pelo que fica decidido aqui.
