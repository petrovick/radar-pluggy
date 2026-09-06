## Why

`pluggy-connector` não tem hoje de onde ler a credencial (`clientId`/`clientSecret`) nem o(s) `itemId`(s) que
autenticam contra a API da Pluggy — sem isso, nenhuma chamada real acontece. Uma investigação (registrada em
`design.md`) fechou como o titular obtém essa credencial na prática (vínculo manual, feito fora do produto,
entre a conta gratuita Meu Pluggy e uma Application no Dashboard da Pluggy). **Decisão revista durante o
`apply` deste change:** a credencial passa a ser propriedade e responsabilidade deste serviço — não do
`oplab-radar-api`, como o spec de `pluggy-item` decidia antes. `pluggy-item` continua sem armazenar credencial
(isso não muda); o que muda é que uma entidade nova, própria deste serviço, passa a existir para isso.

## What Changes

- Nova tela de configurações no `oplab-radar-front` (repositório separado) onde o titular cadastra uma ou mais
  credenciais Pluggy (`clientId`/`clientSecret`) e o(s) `itemId`(s) associados. Uma pessoa pode ter mais de uma
  credencial; uma credencial nunca é compartilhada entre pessoas.
- Nova tabela **neste repositório** (`pluggy_credentials` ou nome equivalente com prefixo `pluggy_`), migration
  e model próprios, seguindo a mesma convenção de `pluggy_items` (`modelagem-de-dados`, regra 1 — tabela nova é
  propriedade deste serviço).
- `pluggy-connector` passa a expor a leitura/escrita dessa credencial e a autenticar contra `POST /auth` usando
  o par correspondente ao `itemId` em questão.
- **Fora do escopo, deliberadamente:** criação programática de item, Connect Token, Connect Widget, ou qualquer
  automação do vínculo OAuth com o conector "MeuPluggy". Esse vínculo continua manual, fora do produto.
- Credencial ausente, ou `itemId` ausente para a pessoa em questão, é recusa nomeada — nunca segue com valor
  default nem empresta a credencial de outra pessoa.

## Capabilities

### New Capabilities
- `pluggy-credentials`: como este serviço obtém, valida e usa a credencial (`clientId`/`clientSecret`) e o(s)
  `itemId`(s) de uma pessoa para autenticar contra a API da Pluggy, e o que acontece quando faltam.

### Modified Capabilities
- `pluggy-item`: o requisito "Credencial da Pluggy nunca é persistida por este registro" atribuía a propriedade
  da credencial ao `oplab-radar-api`. Isso muda: a propriedade passa a ser deste serviço, numa entidade própria
  — `PluggyItem` continua sem armazenar credencial, mas a razão passa a ser separação de responsabilidade
  interna, não fronteira entre repositórios.

## Impact

- **Neste repositório:** nova tabela e entidade de credencial (migration, model, repositório, testes), leitura
  da credencial correta por `itemId` para autenticar contra `POST /auth` → `apiKey` → `X-API-KEY`, e uma forma
  de a credencial chegar até essa tabela (endpoint HTTP de escrita — desenho pendente, ver "Open Questions" em
  `design.md`).
- **`oplab-radar-front`:** tela de configurações, que agora precisa saber falar com `pluggy-connector` (e não
  mais só com `oplab-radar-api`) para escrever a credencial — desenho de conectividade pendente.
- **`oplab-radar-api`:** deixa de ter qualquer papel nesta funcionalidade.
