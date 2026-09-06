## 1. Skill de arquitetura (arquitetura-camadas)

- [x] 1.1 Criar `.claude/skills/arquitetura-camadas/SKILL.md` com a lista de pastas de primeiro nível como
      contrato fechado e exaustivo (D-F) — cada pasta com um papel único, e a regra explícita de que pasta
      fora da lista exige parar e perguntar antes de criar. Verificar: a lista de pastas é a primeira seção
      do arquivo, no mesmo formato que `modelagem-de-dados` usa pra tabela.
- [x] 1.2 Documentar a regra de dependência (D-G): interactor nunca importa `infra/` nem `pluggy-sdk`
      diretamente — define a própria interface de gateway, adapter implementa e traduz. Incluir o exemplo do
      defeito #3 do `Car` (`oplab-radar-api`) como o que este repositório evita por desenho, sem citar ADR
      de origem (D-M). Verificar: a regra cita o exemplo do que a LLM nunca deve escrever (import direto de
      `infra/`/SDK dentro de `interactors/`).
- [x] 1.3 Documentar a ordem de projeto (D-I): entidade e invariante primeiro, caso de uso depois, mesmo
      quando o gatilho é um evento de webhook — com a fronteira explícita de que invariante só vem do que
      `fronteira-pluggy` já documenta, nunca de caso hipotético. Verificar: a seção existe e referencia
      `fronteira-pluggy` como única fonte de invariante, sem mencionar ADR.
- [x] 1.4 Documentar a topologia de execução (D-A/D-B) como contexto do repositório: serviço único,
      standalone, atendendo as 3 contas Pluggy pessoais, com resolução de tenant por `itemId` no handler de
      webhook antes da validação de assinatura. Verificar: a seção descreve o fluxo de resolução de tenant
      e cita que a validação de segredo do webhook (W1) usa o segredo da pessoa dona do item.

## 2. Skill de padrões de engenharia (padroes-de-engenharia)

- [x] 2.1 Criar `.claude/skills/padroes-de-engenharia/SKILL.md` com o conceito de "entidade forte" (D-H)
      como regra obrigatória — construtor privado + factory validando invariante, comportamento próprio,
      nunca campo público mutável — incluindo o par de exemplo anêmica-vs-forte e o teste de aceitação ("se
      virar interface sem perder nada, não é entidade"). Verificar: a regra aparece com os dois exemplos de
      código (anêmica e forte) lado a lado.
- [x] 2.2 Documentar simplicidade sem overengineering e a ausência de retry customizado em I/O à Pluggy
      (D-J): método pequeno, uma responsabilidade por interactor, e o motivo específico deste domínio (a
      reentrega de webhook já é o retry do fornecedor, idempotência por `eventId`) — com o exemplo do que
      NUNCA escrever (`retry-with-backoff` em volta de chamada à Pluggy). Verificar: o exemplo negativo cita
      reentrega de webhook como a razão, não princípio genérico de Clean Code.
- [x] 2.3 Documentar a fronteira de erro do handler HTTP (D-J): toda rota termina em try/catch convertendo
      exceção em resposta controlada, independente da ausência de retry em I/O interno. Verificar: a
      distinção entre "sem retry em I/O interno" e "sem exceção não tratada na borda HTTP" está explícita,
      sem contradição aparente.
- [x] 2.4 Documentar o contrato dos dois revisores obrigatórios (D-L): Arquiteto e Engenheiro, sempre
      chamados ao fim de toda tarefa, cada um com veredito de três estados (Aprovado / Ajustar — bloqueante
      / Excluir e refazer — quando corrigir equivaleria a reescrever), e a regra de verificação exaustiva do
      Engenheiro (todo campo/método/branch precisa de justificativa afirmativa específica). Verificar: os
      três estados do veredito estão nomeados e o critério de "excluir e refazer" está definido sem depender
      de contagem literal de linhas.
- [x] 2.5 Documentar que lint/type-check/teste são gate de pipeline (D-K), não conteúdo desta skill —
      referenciar onde a config mecânica vai morar (tarefa 4) sem descrever comando de execução aqui.
      Verificar: a skill não instrui "rode `npm run lint`" nem similar.
- [x] 2.6 Registrar explicitamente a regra de zero tolerância a achado pequeno (D-L): nenhum "Ajustar" vira
      dívida documentada e aceita — contrasta com o padrão observado em `oplab-radar-api:padroes-de-engenharia`
      (Car aceito com 8 defeitos conhecidos), sem citar esse repositório como modelo. Verificar: a regra
      aparece como proibição explícita de "documentar e aceitar por agora".

## 3. Subagents de revisão obrigatória

- [x] 3.1 Criar o subagent Arquiteto (`.claude/agents/arquiteto-pluggy-connector.md` ou nome equivalente)
      com foco em D-F/D-G — julga só caminho de arquivo e direção de dependência, devolve veredito de três
      estados. Verificar: o prompt do agente lista os três estados e não avalia SOLID/entidade (isso é do
      Engenheiro).
- [x] 3.2 Criar o subagent Engenheiro (`.claude/agents/engenheiro-pluggy-connector.md` ou nome equivalente)
      com foco em D-H/D-I/D-J/D-L — julga entidade forte, simplicidade, ausência de retry indevido e se o
      teste realmente morde a regra de negócio, com a obrigação de verificação exaustiva. Verificar: o
      prompt exige justificativa afirmativa por campo/método antes de aprovar, não checklist de ausência de
      red flag.
- [x] 3.3 Registrar em ambos os agentes que são obrigatórios ao fim de toda tarefa deste repositório, sem
      exceção de "risco pequeno não justifica chamar" — ao contrário do padrão condicional usado pelos
      revisores do `oplab-radar-api`. Verificar: nenhum dos dois arquivos condiciona a chamada a critério de
      risco.

## 4. Registro de decisões e pendências não implementadas nesta change

- [x] 4.1 Atualizar `README.md` deste repositório registrando, como pendência explícita: a config mecânica
      de lint de fronteira/tsconfig estrito/pre-commit/CI (D-K) ainda não existe — só a decisão de que ela
      deve existir como gate de pipeline; fica pra quando o scaffold real do serviço (`package.json`,
      `src/`) for criado. Verificar: a pendência está registrada nominalmente, apontando pra D-K deste
      design.
- [x] 4.2 Registrar em `README.md` a dependência cross-repo não resolvida (D-C): a tabela de credencial
      Pluggy (`clientId`, `clientSecret` criptografado, `itemId`, vínculo a `person_id`) precisa existir no
      `oplab-radar-api`, escrita pela tela de Settings do `oplab-radar-front`, antes deste serviço funcionar
      de ponta a ponta. Verificar: a pendência está registrada como bloqueio de funcionamento, não como nota
      lateral.
