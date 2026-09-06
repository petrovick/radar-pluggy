## Context

`pluggy-connector` é um serviço separado do `oplab-radar-api`, que reimplementa a integração Pluggy num
repositório próprio (`fronteira-pluggy`, regra de contexto). A investigação que originou este change apurou
como a credencial nasce na prática, no plano gratuito/pessoal da Pluggy:

- o titular conecta bancos (BTG, Itaú, etc.) diretamente no **Meu Pluggy** (`meu.pluggy.ai`), um app de
  consumidor da própria Pluggy, gratuito e sem prazo de expiração;
- separadamente, cria uma **Application** no **Dashboard** de desenvolvedor (`dashboard.pluggy.ai`) e recebe um
  par `clientId`/`clientSecret`;
- autoriza essa Application a ler cada banco já conectado no Meu Pluggy através de um conector especial,
  chamado "MeuPluggy" (referido como "conector 200" no ADR 0029 do `oplab-radar-api`) — uma autorização OAuth
  **por banco conectado**, feita manualmente, fora de qualquer produto nosso;
- essa autorização funciona como um proxy: cria um `Item` normal, dono da Application, sincronizado 1x/dia.

Fontes: [`pluggyai/meu-pluggy`](https://github.com/pluggyai/meu-pluggy),
[`meu.pluggy.ai/api-guide`](https://meu.pluggy.ai/api-guide), [`pluggy.ai/precos`](https://www.pluggy.ai/precos).

O spec já existente `pluggy-item` (`openspec/specs/pluggy-item/spec.md`) decidia que a credencial pertencia ao
`oplab-radar-api`. **Revisto durante o `apply` deste change:** a propriedade passa a ser deste serviço — uma
entidade nova (`PluggyCredential`), tabela própria com prefixo `pluggy_`, seguindo a mesma convenção de
`pluggy_items` (`modelagem-de-dados`, regra 1). `PluggyItem` continua sem armazenar credencial — isso não muda,
só muda a razão: agora é separação de responsabilidade interna a este serviço, não fronteira entre
repositórios.

Cada `person` é identificada de forma única pelo CPF — é o dono/titular real, não um "cliente" comercial de um
produto multiusuário. O plano gratuito da Pluggy proíbe uso comercial e CPF de terceiro (ADR 0029, pendência
P5); nada neste change assume ou habilita multiencilocação comercial. O que existe é o padrão de ownership já
usado em toda tabela do domínio (`person_id` como dono, FK `people`) — a mesma convenção, aplicada aqui.

## Goals / Non-Goals

**Goals:**
- Definir o contrato de leitura: como `pluggy-connector` obtém a credencial e o(s) `itemId`(s) de uma pessoa
  antes de chamar a API da Pluggy.
- Definir o comportamento de recusa quando a credencial ou o `itemId` não existem para a pessoa em questão.

**Non-Goals:**
- Desenhar a tela de configurações no `oplab-radar-front` em detalhe (UI, validação de formulário) — só o
  contrato de como ela alcança este serviço.
- Automatizar o vínculo OAuth com o conector "MeuPluggy" — permanece manual, fora do produto.
- Desenhar o cliente HTTP de chamadas de dado (`GET /investments`, etc.) além da autenticação — fica para um
  change futuro que consumir a credencial para sincronizar dado.

## Decisions

### D1 — Credencial é persistida neste serviço, em tabela própria
Tabela nova (`pluggy_credentials`), migration e model neste repositório, mesma convenção de `pluggy_items`.
Alternativa descartada (decisão original deste change, revertida durante o `apply`): ler a credencial de uma
tabela do `oplab-radar-api`, cross-repo, read-only — rejeitada porque a tabela nunca chegou a existir lá, e o
usuário decidiu que a responsabilidade é deste serviço, não daquele.

### D2 — Uma credencial pertence a exatamente uma pessoa; uma pessoa pode ter mais de uma credencial
Confirmado com o usuário. Alternativa descartada (erro cometido nesta própria investigação): tratar
`clientId`/`clientSecret` como configuração de ambiente única, compartilhada por todo o serviço — não se aplica
aqui porque cada pessoa tem sua própria conta pessoal Meu Pluggy e sua própria Application no Dashboard.

### D3 — Vínculo OAuth com "MeuPluggy" fica fora do produto
O titular faz esse vínculo manualmente, fora do produto — decisão explícita do usuário nesta conversa.
`pluggy-connector` não gera Connect Token nem abre Connect Widget para esse fluxo.

### D4 — Ausência de credencial ou itemId é recusa nomeada
Sem credencial ou `itemId` para a pessoa em questão, a chamada é recusada citando o campo e a pessoa ausentes —
nunca segue sem autenticação, nunca usa a credencial de outra pessoa. Consistente com a regra 6 do `CLAUDE.md`
raiz (dado obrigatório ausente é erro, nunca default), estendida aqui de cálculo fiscal para configuração de
acesso.

### D5 — Cada itemId pertence a exatamente uma credencial; a busca nunca é ambígua por pessoa
Confirmado ao vivo no Dashboard (`dashboard.pluggy.ai/applications`): uma Application tem exatamente um par
`clientId`/`clientSecret`, e um `Item` só existe porque foi criado através de uma Application específica — é
inerente ao modelo da Pluggy, não uma escolha nossa. Quando uma pessoa tem mais de uma credencial (D2), a tabela
de credencial (`pluggy_credentials`, D1) guarda, junto de cada `itemId`, a qual credencial ele pertence. A busca
é sempre `itemId` → credencial → `clientId`/`clientSecret`, nunca "a credencial desta pessoa" de forma ambígua.

### D6 — `client_secret` é criptografado na aplicação antes de gravar
Cifra (AES-256-GCM) acontece na fronteira de escrita, nunca em texto plano no banco. A chave de cifragem vem de
uma variável de ambiente própria deste serviço (ex. `PLUGGY_CREDENTIAL_ENCRYPTION_KEY`), nunca versionada nem
compartilhada com o `oplab-radar-api`. Alternativa descartada: texto plano por enquanto — rejeitada pelo
usuário porque o segredo dá acesso a dado bancário de terceiro; adiar cifragem teria custo de migração de dado
depois.

### D7 — `oplab-radar-front` ganha uma rota nova, direta para este serviço
O proxy do `oplab-radar-front` (hoje só `/api` → `oplab-radar-api`) ganha uma rota nova (ex. `/api/pluggy`) que
encaminha diretamente para `pluggy-connector`, em paralelo à rota existente — sem passar pelo
`oplab-radar-api`. Mudança de configuração naquele repositório (Vite proxy), fora do código deste repositório.
Alternativa descartada: `oplab-radar-api` repassar a escrita — rejeitada pelo usuário, que preferiu o
`oplab-radar-front` falar direto com este serviço.

### D8 — `POST /credentials` exige o mesmo JWT do `oplab-radar-api`; `personId` nunca vem do corpo
Achado durante a integração real com o front (D7): o endpoint não tinha autenticação nenhuma — confiava no
`personId` que viesse no corpo da requisição. Qualquer requisição que alcançasse a porta conseguia cadastrar
credencial pra qualquer `personId`, inclusive de outra pessoa do mesmo agregado familiar.

Corrigido com um middleware (`src/infra/authenticate.middleware.ts`) que reimplementa a verificação do JWT
hand-rolled do `oplab-radar-api` (`JwtHandler.verify` — HS256 sem lib externa, HMAC-SHA256 em tempo constante,
sem `jsonwebtoken` como dependência nova) e resolve `personId` a partir do `sub` (username) do token, lendo
`people` — tabela de outro dono, só leitura (`fronteira-pluggy` regra 13). O segredo (`JWT_SECRET`) é o mesmo
valor configurado em `config.http.jwtSecret` no `oplab-radar-api`, combinado por variável de ambiente entre os
dois serviços — nenhum dos dois gera o segredo do outro. `personId` deixa de existir no corpo da requisição;
`RegisterPluggyCredentialInteractor` só recebe o que o middleware resolveu.

Toda recusa de autenticação (token ausente, assinatura inválida, expirado, username sem pessoa
correspondente) responde `401 {errorType: 'UNAUTHORIZED'}` — genérico, sem indicar qual motivo, pra não ajudar
quem está tentando adivinhar.

Alternativa descartada: seguir sem autenticar por enquanto, documentando como dívida — rejeitada pelo usuário
dado o histórico deste projeto de não aceitar achado grande como dívida "por agora".

## Risks / Trade-offs

- [Vínculo manual por banco conectado no Meu Pluggy] → cada nova conta bancária exige uma ida manual ao
  Dashboard; aceito porque automatizar está fora do escopo do plano gratuito sem revisão comercial (ADR 0029,
  pendência P5).
- [Chave de cifragem em variável de ambiente] → perda da chave torna toda credencial cifrada irrecuperável;
  aceito por ora, sem rotação de chave nem KMS — revisar se o volume de credenciais crescer.
- [Rota nova no proxy do front] → depende de uma mudança de configuração em outro repositório (Vite), fora do
  escopo de código deste change; a tarefa 5 de `tasks.md` só anda depois dela.
- [Segredo do JWT combinado por variável de ambiente entre dois serviços] → se um dos dois trocar o segredo
  sem avisar o outro, todo token vira inválido nesse serviço até sincronizar de novo; aceito porque é o mesmo
  padrão de acoplamento fraco que já existe pra outras variáveis compartilhadas (ex. credencial de banco), e
  formalizar rotação automatizada é desproporcional ao tamanho do sistema hoje.
