## Context

O `pluggy-connector` é um serviço TypeScript novo, ainda sem nenhum código, que vai:
- escrever direto no banco `oplab_radar`, hoje de propriedade exclusiva do `oplab-radar-api`;
- possuir migration própria só para `pluggy_items`, `investment_income` e `pluggy_positions` — `people` e
  `custody_accounts` são somente leitura para ele;
- reimplementar, usando o SDK oficial `pluggy-sdk`, a integração cujas regras de domínio já foram decididas
  nos ADRs [0029](../../../oplab-radar-api/docs/ADR/0029-integracao-pluggy-open-finance.md) (papel da
  Pluggy — D1 a D22) e [0030](../../../oplab-radar-api/docs/ADR/0030-webhook-pluggy-autenticado.md)
  (webhook — W1 a W6) do `oplab-radar-api`;
- manter o webhook público no `oplab-radar-api` até este serviço estar pronto em produção — a migração do
  webhook é corte futuro, não deste change.

Essas decisões vivem hoje só na conversa entre o mantenedor e o assistente que o ajudou a chegar nelas.
Um LLM sem esse histórico, ao abrir este repositório, não tem como derivá-las sozinho — e o modo de falha
não é um erro de compilação, é dado fiscal ou monetário errado em produção, ou uma migration que colide
com o histórico do `oplab-radar-api` no mesmo banco físico.

## Goals / Non-Goals

**Goals:**
- Definir o conjunto de skills do Claude Code para este repositório e o que cada uma cobre.
- Decidir quais skills genéricas de Pluggy já instaladas no marketplace do `oplab-radar-api`
  (`.agents/skills/pluggy-*`) são reaproveitadas aqui, e quais ficam de fora.
- Registrar a origem de cada regra da skill de fronteira (D1–D22, W1–W6) para que fique rastreável quando
  os ADRs de origem mudarem.

**Non-Goals:**
- Não escreve os arquivos `SKILL.md` em si — isso é tarefa de implementação, listada em `tasks.md`.
- Não define a estrutura de pastas final do serviço (`src/`, camadas) — isso é conteúdo da futura
  `pluggy-connector:arquitetura-camadas`, que só pode ser escrita com precisão depois que o scaffold
  inicial existir.
- Não resolve o mecanismo de `GRANT` no MySQL para impor por permissão de banco a fronteira de tabelas
  (levantado na exploração como camada complementar à skill) — fica como questão em aberto.

## Decisions

**D-A. Modelo de três camadas de skill.**

```
Camada 1 — genérico Pluggy (reaproveitado do marketplace)
Camada 2 — invariantes do domínio (fronteira-pluggy: D1–D22, W1–W6)
Camada 3 — organização deste repositório (arquitetura, dados, padrões TS)
```

Alternativa descartada: uma única skill grande cobrindo tudo. Descartada porque mistura conhecimento
genérico (que o marketplace já mantém atualizado) com decisão de produto (que só este time pode manter) —
a skill genérica desatualiza sozinha se o Pluggy mudar a API; a de domínio só desatualiza se o produto
mudar de ideia. Separar os ciclos de vida evita que uma atualização de uma pise na outra.

**D-B. Reaproveitamento do marketplace (`oplab-radar-api/.agents/skills/`) — por cópia, não symlink.**

`oplab-radar-api` e `pluggy-connector` são repositórios Git separados, em GitHub separados. O symlink que
o `oplab-radar-api` usa internamente (`.claude/skills/pluggy-*` → `.agents/skills/pluggy-*`) funciona
porque as duas pontas estão no mesmo checkout. Entre os dois repositórios não há checkout compartilhado
garantido — a esposa e o irmão do mantenedor rodam suas próprias instâncias, cada uma com seu próprio
clone de `pluggy-connector`, sem necessariamente ter `oplab-radar-api` ao lado. Um symlink cruzando repo
aponta para um caminho que só existe na máquina de quem criou o link; em qualquer outro clone, é um link
quebrado. A skill precisa existir **dentro** do repositório `pluggy-connector`, como arquivo próprio.

| Skill | Decisão | Por quê |
|---|---|---|
| `pluggy-integration` | Copiar o conteúdo para este repositório | Conhecimento genérico de Items/Connect/webhooks, sem viés de produto |
| `pluggy-open-finance` | Copiar o conteúdo para este repositório | Conhecimento genérico de contas/investimentos/sync |
| `pluggy-payments` | Não trazer | Fora do domínio do produto por decisão do PRD (`docs/PRD-PLUGGY-OPEN-FINANCE.md`, seção "Fica fora") |
| `pluggy-doctor` | Não trazer agora | Skill de revisão pós-hoc — só faz sentido quando já houver código de integração pra revisar |

Trade-off aceito: cópia não recebe atualização automática se o marketplace revisar
`pluggy-integration`/`pluggy-open-finance` — a skill copiada pode desatualizar em silêncio. Sem mecanismo
de sync entre repos Git separados, não há alternativa sem depender de checkout local; o risco fica
registrado em Risks / Trade-offs.

**D-C. Conteúdo da `pluggy-connector:fronteira-pluggy`.**

Cada linha da skill é uma decisão já tomada (D1–D22 do ADR 0029, W1–W6 do ADR 0030), traduzida em regra de
código com o porquê e um exemplo do que a LLM NUNCA deve escrever. As regras mapeadas nesta exploração:

- Fronteira decimal (D4): toda conversão de valor da Pluggy passa por `new Decimal(String(n))`, uma vez,
  na borda — nunca aritmética sobre o `number` do SDK.
- Pluggy nunca é fonte fiscal primária (D1): nenhuma tabela alimentada por `InvestmentTransaction`/
  `Investment` chega em `fiscal_event` ou em base de cálculo de IR.
- Vazio não é zero (D3): consentimento revogado/expirado grava estado explícito de reconexão.
- Produtos explícitos na criação do item (D13): sempre `['INVESTMENTS','INVESTMENTS_TRANSACTIONS']`,
  nunca omitido.
- `IDENTITY` desligado por padrão (D14).
- Sincronização por marca d'água (D21): só lê transação de investimento cujo `updatedAt` mudou; só
  dispara quando `GET /items/{id}` vier `executionStatus: SUCCESS`.
- Proibido cron/batch de `PATCH /items` (D9).
- Payload do webhook é gatilho, não dado (W3): primeira ação após receber evento é `GET /items/{id}`.
- Segredo do webhook comparado em tempo constante (W1).
- Idempotência por `eventId` com unicidade no banco (W2).
- Divergência vira achado nomeado, nunca correção automática (D12).
- MCP/CLI da Pluggy nunca é caminho de dado em produção (D22).
- Migration deste repositório só cria/altera tabelas de sua propriedade (`pluggy_items`,
  `investment_income`, `pluggy_positions`); `people`/`custody_accounts` são somente leitura, sem FK de
  saída — decisão tomada nesta própria conversa, sem ADR de origem no `oplab-radar-api` (é específica da
  divisão em dois repositórios).

**D-D. `pluggy-connector:modelagem-de-dados` declara a fronteira de propriedade de tabela** como sua
primeira regra, antes de qualquer convenção de nomenclatura — é o item da tabela de riscos com maior
potencial de dano estrutural (colisão de migration entre os dois repositórios no mesmo banco físico).

## Risks / Trade-offs

- **Skill só protege quem lê a skill.** Uma LLM que ignore ou não carregue a skill pode ainda escrever a
  migration errada. Mitigação real seria uma camada que não dependa de comportamento — ex.: o usuário
  MySQL do `pluggy-connector` ter `GRANT` restrito às suas tabelas (`SELECT` em `people`/`custody_accounts`,
  `ALL` só nas próprias). Não decidido neste change — ver Open Questions.
- **Cópia sem mecanismo de sync pode desatualizar** se o marketplace revisar `pluggy-integration` ou
  `pluggy-open-finance` depois que este repositório já as tiver copiado. Mitigação: nenhuma automática —
  aceito como custo de repositórios Git separados; revisão manual periódica fica a critério do mantenedor,
  não deste change.
- **Os ADRs 0029/0030 têm pendências abertas** (P0.5, P0.6, P2–P7 no 0029) que podem mudar D13, D21 e
  outras regras espelhadas aqui. Mitigação: a skill referencia o número da decisão (D-número/W-número),
  não só a regra, para que uma mudança no ADR de origem seja rastreável até aqui.

## Open Questions

- Vale perseguir a camada de `GRANT` de banco como reforço estrutural à fronteira de tabelas, além da
  skill? Levantado na exploração, não decidido — pode virar change própria depois que o serviço tiver um
  usuário de banco configurado.
