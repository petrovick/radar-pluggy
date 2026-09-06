## Why

O `pluggy-connector` é um serviço novo que vai escrever direto no banco `oplab_radar`, hoje de propriedade
exclusiva do `oplab-radar-api`, e vai reimplementar uma integração (Pluggy/Open Finance) cujas regras de
domínio já foram decididas nos ADRs 0029 e 0030 daquele repositório — mas essas decisões vivem só na
cabeça de quem participou da conversa. Qualquer LLM (ou pessoa) que abrir este repositório sem esse
contexto pode: (a) tratar a Pluggy como fonte de verdade fiscal, (b) converter valor monetário sem passar
pela fronteira decimal, (c) violar a proibição de cron/batch da própria Pluggy, ou (d) criar uma migration
que colide com o histórico de migration do `oplab-radar-api` no mesmo banco físico. Nenhuma dessas falhas
aparece em teste unitário óbvio — aparecem em produção, com dinheiro ou dado fiscal errado.

Este change formaliza quais skills o `pluggy-connector` precisa, para que a arquitetura sobreviva à
ausência do autor original em qualquer sessão futura.

## What Changes

- Define o conjunto de skills do Claude Code para este repositório, em três camadas: genérico Pluggy
  (reaproveitado do marketplace já instalado em `oplab-radar-api/.agents/skills`), invariantes do domínio
  (tradução dos ADRs 0029/0030 em regra de código) e organização interna do repositório (camadas,
  modelagem de dados, padrões de engenharia em TypeScript/Vitest).
- Decide **não** trazer as skills `pluggy-payments` (fora do domínio do produto, por decisão do PRD) nem
  `pluggy-doctor` (skill de revisão pós-hoc; entra depois que houver código pra revisar).
- Não altera nenhum comportamento do serviço `pluggy-connector` em si — é puramente tooling/processo.

## Capabilities

Nenhuma. Mudança de tooling (skills do Claude Code), sem comportamento observável do serviço — `skip_specs: true`.

## Impact

- Arquivos novos em `.claude/skills/` deste repositório (ou symlinks para `.agents/skills/` equivalentes ao
  padrão já usado em `oplab-radar-api`).
- Nenhum código de aplicação é afetado.
