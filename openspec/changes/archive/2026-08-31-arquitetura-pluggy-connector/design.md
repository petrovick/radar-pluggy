## Context

Ver `proposal.md` para motivação. Estado atual: repositório sem nenhum código; `fronteira-pluggy` e
`modelagem-de-dados` já existem e não são tocados por esta change. `oplab-radar-api` roda separado, banco
físico `oplab_radar` compartilhado, cada pessoa (mantenedor, cônjuge, irmão) com sua própria conta Pluggy
pessoal (plano gratuito, 1 CPF por conta — confirmado em pluggy.ai/meu-pluggy: o fluxo pessoal não admite
múltiplos CPFs numa mesma conta). `oplab-radar-api` é multi-tenant de verdade: 1 deployment, 1 banco,
servindo os 3 `person_id`.

## Goals / Non-Goals

**Goals:**
- Fechar estrutura de pastas e regra de dependência do `pluggy-connector`.
- Fechar disciplina de entidade (entidade forte, ordem de projeto entidade-antes-de-caso-de-uso).
- Fechar princípios de engenharia (simplicidade, ausência de retry customizado em I/O à Pluggy).
- Fechar contrato dos dois subagents de revisão obrigatória e seu veredito de três estados.
- Fechar topologia de execução (serviço único, resolução de tenant por `itemId`) e o que isso implica para
  armazenamento de credencial e execução de migration.

**Non-Goals:**
- Não escreve código de aplicação (entidades, interactors, migrations reais) — implementação subsequente.
- Não desenha a tela de Settings do `oplab-radar-front` nem o schema exato da tabela de credencial no
  `oplab-radar-api` — só define a fronteira de leitura deste lado. Detalhe de schema e criptografia é
  decisão daquele repositório.
- Não escreve o conteúdo dos arquivos de lint/tsconfig/CI — só decide que eles existem como gate de
  pipeline, não como texto de skill. Conteúdo fica em `tasks.md`.
- Não revisita `fronteira-pluggy` nem `modelagem-de-dados`.
- Não resolve nome de domínio/DNS por pessoa — a decisão de serviço único torna isso desnecessário.

## Decisions

**D-A. Topologia de execução: serviço único, standalone, compartilhado pelas 3 contas Pluggy.**

Alternativas descartadas:
- *Lib embutida no `oplab-radar-api`*: rejeitada — Node é single-thread, trabalho síncrono pesado do
  conector (parsing de payload, loop de reconciliação) bloquearia o event loop que também serve cálculo
  fiscal de outro usuário. Reverte também o motivo original de repositório separado (instância própria sem
  depender do `oplab-radar-api` ao lado).
- *3 deploys separados, um por pessoa*: parecia necessário por "cada Pluggy precisa de domínio próprio" —
  falso. Confirmado via doc oficial (`POST /webhooks`, autenticado por `X-API-KEY`): o registro de webhook é
  escopado por conta/API key, não há restrição de unicidade de URL entre contas diferentes. 3x o custo
  operacional sem ganho de isolamento que justifique.

**D-B. Resolução de tenant por `itemId` no handler de webhook, não credencial fixa de processo.**

Como 1 serviço atende as 3 contas, não existe mais "quem sou eu" fixo por env var. Ao receber um evento, o
handler extrai `itemId` do payload, busca no próprio banco quem é o dono (`person_id` + credencial) **antes**
de validar a assinatura do webhook (W1 de `fronteira-pluggy` passa a comparar contra o segredo daquela
pessoa especificamente). Pré-requisito: o item precisa estar registrado (itemId ↔ person_id) antes do
primeiro evento chegar — acontece quando a pessoa cadastra o item na tela de Settings do
`oplab-radar-front`, depois de conectar via app Meu Pluggy (fluxo de criação do item continua fora deste
serviço, conforme já decidido).

**D-C. Credencial Pluggy é escrita e propriedade do `oplab-radar-api`; este serviço só lê.**

`clientId`, `clientSecret` (criptografado em repouso — responsabilidade de quem escreve), `itemId` e o
segredo do webhook vivem numa tabela do `oplab-radar-api`, vinculada a `person_id`, preenchida pela tela de
Settings do front. `pluggy-connector` lê read-only, mesma regra que já vale para `people`/`custody_accounts`
em `modelagem-de-dados` — mais uma tabela na mesma lista, sem migration própria sobre ela.

Risco aceito: isso cria uma dependência cross-repo que não é resolvida nesta change — o
`pluggy-connector` não funciona de verdade até essa tabela existir no `oplab-radar-api`. Registrado, não
bloqueia o fechamento da arquitetura deste lado.

**D-D. Migration deste serviço nunca roda no boot do processo.**

Vira passo explícito de deploy (comando de pre-deploy do Railway, ou passo de CI/manual). Motivo: banco
físico compartilhado; auto-migrate no boot arriscaria corrida se o processo reiniciar enquanto uma migration
ainda não aplicada existe. `SequelizeMeta` garante idempotência entre execuções sequenciais, não protege
contra execução simultânea.

**D-F. Pasta como contrato fechado.**

Lista de pastas de primeiro nível é exaustiva; cada uma com um papel único, sem sobreposição. Pasta fora da
lista não se cria por conveniência — para e pergunta, mesmo padrão que `modelagem-de-dados` já aplica a
tabela. Caminho do arquivo sozinho denuncia violação de camada num diff, sem precisar ler o conteúdo —
verificação estrutural, independe de julgamento semântico do revisor.

**D-G. Regra de dependência: interactor nunca importa `infra/` nem `pluggy-sdk` diretamente.**

O interactor define a própria interface de gateway; o adapter implementa e traduz o shape do SDK na borda.
Isso permite testar o interactor 100% com fake, zero rede/banco. Corrige de raiz, por desenho, o defeito #3
documentado no `Car` do `oplab-radar-api` (interactor importando `AppContainer` de `infra/`) — sem criar
exceção equivalente; injeção só por construtor.

**D-H. Entidade forte é obrigatória.**

Construtor privado + factory que valida invariante, comportamento próprio (ex.:
`PluggyPosition.reconcileAgainst`) — nunca campo público mutável. Teste de aceitação: se a classe puder virar
`interface`/objeto plano sem perder nada, não é entidade. Previne por desenho o defeito #2 do `Car`
(`CarEntity` anêmica), em vez de documentá-lo como dívida aceita.

**D-I. Ordem de projeto: entidade e invariante primeiro, caso de uso depois.**

Mesmo quando o gatilho chega em forma de caso de uso (processar um webhook), o desenho começa por qual
entidade e qual invariante aquilo toca. Fronteira: invariante vem só do que `fronteira-pluggy` já documenta
(regras 1-13) — nunca se modela entidade para regra hipotética futura ainda não decidida.

**D-J. Simplicidade sem overengineering; I/O à Pluggy sem retry customizado.**

Método pequeno, um interactor por responsabilidade, sem abstração para caso hipotético. Chamada à Pluggy que
falha, falha — a reentrega de webhook (até 9x, idempotência por `eventId`, regra 10 de `fronteira-pluggy`) já
é o mecanismo de retry do fornecedor; reimplementar retry-with-backoff é reinventar isso com risco de bug
novo. Isso não contradiz a fronteira do handler HTTP em si, que continua convertendo exceção em resposta
controlada (try/catch na borda do processo) — fronteira de processo compartilhado é uma preocupação
diferente de retry de I/O interno.

**D-K. Lint, type-check e teste são gate de pipeline, não conteúdo de skill.**

A skill ensina o princípio (simplicidade, dependência, entidade forte); a imposição mecânica (tsconfig
estrito, lint de fronteira de import entre pastas, husky pre-commit, CI) é config de repositório — tarefa de
implementação, listada em `tasks.md`, nunca texto que a LLM precisa "decidir seguir".

**D-L. Revisão obrigatória por dois subagents, sempre, com veredito de três estados.**

Arquiteto (pasta/dependência — nunca a peça vale mais que o caminho onde vive) e Engenheiro (SOLID/entidade
forte/simplicidade/teste que morde a regra), cada um obrigatório ao fim de toda tarefa, sem "risco justifica
chamar". Veredito: **Aprovado** / **Ajustar** (bloqueante — corrige antes de seguir, nunca vira dívida
documentada) / **Excluir e refazer** (quando corrigir equivaleria a reescrever a peça, não emendar linha). O
Engenheiro verifica de forma exaustiva: todo campo/método/branch precisa de justificativa afirmativa
específica — não impressão geral de "parece ok".

Alternativa descartada: revisor único combinado (justificável por ser 1 domínio só) — descartada
explicitamente para manter separação de papel (onde mora vs. como foi desenhado), mesmo em escala pequena.

**D-M. Nenhuma citação de ADR do `oplab-radar-api` nas duas skills novas.**

ADR é convenção daquele repositório. `arquitetura-camadas` e `padroes-de-engenharia` não citam número de
decisão de lá — a fronteira de invariante vem só do que `fronteira-pluggy` já documenta, neste próprio
repositório.

## Risks / Trade-offs

- **1 serviço único atendendo as 3 contas** → um bug/crash afeta as 3 pessoas ao mesmo tempo (não isola uma
  da outra), embora nunca toque o processo do `oplab-radar-api`. Aceito enquanto o uso for só o círculo
  familiar; mitigação se crescer seria voltar a deploys separados (D-A permite reverter sem mudar o resto do
  desenho — pasta, dependência e entidade não dependem da topologia de deploy).
- **Dependência cross-repo não resolvida** (D-C) → o serviço não funciona de ponta a ponta até a tabela de
  credencial existir no `oplab-radar-api`. Mitigação: registrado aqui como pré-requisito explícito, não
  como suposição implícita.
- **Cópia de `pluggy-integration`/`pluggy-open-finance` sem mecanismo de sync** (decisão já registrada na
  change arquivada) → risco não repetido aqui, só lembrado: pode desatualizar em silêncio.
- **"Uso pessoal" da Pluggy verificado via página pública de marketing/FAQ** (pluggy.ai/meu-pluggy,
  pluggy.ai/precos), não o texto formal completo dos Termos de Uso → suficiente para a decisão de hoje (3
  contas pessoais separadas, sem revenda, sem uso comercial), mas vale reler se o projeto crescer além do
  círculo familiar.

## Migration Plan

Não aplicável — sem deploy nem dado em produção ainda. A ordem de implementação (scaffold de pastas →
skills → subagents de revisão → coordenação da tabela de credencial com `oplab-radar-api`) fica detalhada
em `tasks.md`.

## Open Questions

- Schema exato e mecanismo de criptografia da tabela de credencial Pluggy no `oplab-radar-api` — decisão
  daquele repositório, não deste; só a fronteira de leitura (D-C) está fechada aqui.
