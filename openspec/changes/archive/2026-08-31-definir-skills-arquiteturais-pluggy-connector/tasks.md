## 1. Skill de domínio (fronteira-pluggy)

- [x] 1.1 Criar `.claude/skills/fronteira-pluggy/SKILL.md` (caminho plano, mesmo padrão do
      `oplab-radar-api`: `.claude/skills/<nome>/SKILL.md`, sem pasta de repositório no meio) com as 13
      regras mapeadas em
      `design.md` (D1, D3, D4, D9, D12, D13, D14, D21, D22 do ADR 0029; W1, W2, W3 do ADR 0030; e a regra
      de fronteira de tabela decidida nesta conversa), cada uma citando a decisão de origem e um exemplo do
      que a LLM nunca deve escrever. Verificar: as 13 regras do design.md aparecem no arquivo, cada uma com
      a referência D-número/W-número correspondente.

## 2. Skill de modelagem de dados

- [x] 2.1 Criar `.claude/skills/modelagem-de-dados/SKILL.md` (caminho plano, mesmo padrão acima) com a fronteira de
      propriedade de tabela como primeira regra do arquivo, antes de qualquer convenção de nomenclatura:
      este repositório migra só `pluggy_items`, `investment_income` e `pluggy_positions`; `people` e
      `custody_accounts` são somente leitura, sem FK de saída. Verificar: a regra de fronteira é a primeira
      seção do arquivo.

## 3. Skills genéricas (marketplace)

- [x] 3.1 Copiar o conteúdo de `pluggy-integration` e `pluggy-open-finance` de
      `oplab-radar-api/.agents/skills/` para arquivos próprios deste repositório
      (`.claude/skills/pluggy-integration/SKILL.md`, `.claude/skills/pluggy-open-finance/SKILL.md`) — nunca
      symlink, os dois repositórios são Git/GitHub separados e um link cruzando repo quebra em qualquer
      clone que não seja o checkout local de quem o criou. Verificar: os arquivos existem como cópia real
      (não link) dentro de `pluggy-connector/.claude/skills/`.
- [x] 3.2 Registrar explicitamente, em `design.md` ou num comentário do próprio diretório, que
      `pluggy-payments` e `pluggy-doctor` foram avaliadas e propositalmente não trazidas nesta rodada (D-B).
      Verificar: nenhum link ou arquivo para essas duas skills existe em `.claude/skills/` deste
      repositório.

## 4. Registro do que fica pendente

- [x] 4.1 Deixar registrado (README ou arquivo equivalente do repositório) que
      `pluggy-connector:arquitetura-camadas` e `pluggy-connector:padroes-de-engenharia` são skills
      necessárias mas só podem ser escritas com precisão depois que o scaffold inicial do serviço existir
      (Non-Goal do design.md). Verificar: existe um registro explícito apontando essa dependência, para
      que não seja esquecido.
