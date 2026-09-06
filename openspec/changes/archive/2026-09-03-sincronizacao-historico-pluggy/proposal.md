## Why

Hoje este serviço só sabe gravar a **fotografia de agora**: `pluggy_connector_positions` guarda saldo e quantidade
por investimento, sobrescritos a cada sincronização. Nada registra **como se chegou até ali** — nenhuma
compra, venda, juro, amortização, TED ou PIX. Uma aplicação que pretende espelhar fielmente a conta do
titular na corretora não consegue desenhar nem um gráfico de evolução com o que existe.

A Pluggy entrega esse passado por duas rotas que nenhum código deste repositório chama:
`GET /investments/{id}/transactions` (movimentação de cada investimento, com despesas discriminadas e o
número da nota) e `GET /v2/transactions` (extrato de conta, paginado por cursor). São dados de naturezas
diferentes — custódia e caixa — e por isso moram em tabelas separadas.

**Referência documentada do Open Finance:** 365 dias é a janela esperada, mas não é um filtro nosso: este
dump contém registro mais antigo e todo dado devolvido será preservado. A coleta da Pluggy junto à instituição
no trecho de 7 a 365 dias tem
orçamento de **4 requisições por mês** por CPF + instituição + produto (`docs/rate-limits-of`); nossas
leituras só acontecem depois do auto-sync dela e não tentam provocar coleta adicional.

## What Changes

- **Descoberta paginada de contas e investimentos** — `GET /accounts?itemId=X` e o gateway já existente de
  `GET /investments?itemId=X` passam a percorrer `page`/`pageSize`/`totalPages`; a primeira página não é uma
  lista completa. Contas de depósito são o pré-requisito do extrato (`accountId` é obrigatório em
  `/v2/transactions`).
- **Novo gateway `GET /investments/{id}/transactions`** — movimentação de um investimento, paginado por
  `page`/`pageSize` (500 por página), com `expenses` discriminado (corretagem, emolumentos, IRRF, ISS,
  liquidação, custódia) e `brokerageNumber`.
- **Novo gateway `GET /v2/transactions`** — extrato de uma conta, paginado **por cursor** (`next`/`after`,
  não por número de página). Quando a fonte é elegível, a varredura é completa para não presumir ordem ou
  checkpoint que a rota não oferece.
- **Alteração em `pluggy_connector_positions`** — inclusão de `value`, `amount`, `taxes` e `taxes2`; `quantity` e
  `value` usam `DECIMAL(20,8)`, porque o dado real contém oito casas, enquanto montantes usam
  `DECIMAL(20,2)`.
- **Nova tabela `pluggy_connector_position_snapshots`** — apêndice histórico gravado a cada sincronização
  bem-sucedida de posição, junto com a fotografia (design.md D11). É o que torna possível reconstruir
  evolução de patrimônio no futuro: a Pluggy não tem endpoint de valor histórico, então um dia não
  capturado agora nunca é recuperável depois.
- **Nova entidade e tabela de observação de histórico** (`pluggy_connector_history_coverage`) — registra o resultado
  de uma varredura completa por conta/investimento (datas extremas observadas, quantidade e instante), sem
  alegar que uma janela vazia foi coberta.
- **Nova entidade e tabela de movimentação de investimento**, chaveada por (`item_id`, `investment_id`,
  `transaction_id`).
- **Nova entidade e tabela de extrato de conta**, chaveada por (`item_id`, `account_id`, `transaction_id`)
  — separada da anterior, como pedido: caixa e custódia não compartilham forma nem significado.
- **Nova entidade e tabela de conta**, para o extrato ter a quem pertencer e para o backfill saber o que
  varrer.
- **Novo interactor de carga histórica**, disparável por item: na primeira carga varre todos os recursos; nas
  seguintes, usa a marca d'água do item e o `updatedAt` de cada recurso para não varrer fontes sem mudança.
  Quando uma fonte mudou, percorre todas as suas páginas e persiste por upsert em `transaction_id`.
- **Webhook Pluggy neste serviço** — `item/created`/`item/updated` tornam a carga diária reativa ao auto-sync
  da Pluggy. A credencial passa a guardar secret de entrada cifrado e provisiona `POST /webhooks` com URL
  HTTPS pública e header próprio; o handler persiste o evento em inbox, responde 2xx rapidamente e o drena
  de forma idempotente. Não há cron, polling ou integração com `oplab-radar-api`.
- **Wiring no composition root** (`src/index.ts`) e handler HTTP autenticado para o webhook e para o disparo
  manual inicial. Hoje `src/index.ts` monta apenas credencial e pessoa, e nem o
  `SyncPluggyPositionInteractor` já existente é instanciado por alguém.
- **Fora do escopo, deliberadamente:** gerar `fiscal_event` a partir desses dados (ADR 0029 D1 — a Pluggy é
  fonte complementar e de conferência, nunca fonte primária de evento fiscal; `InvestmentTransaction` não
  tem `tipoMercado`, não tem `obs` e não representa ponta lançadora); conciliação automática contra as
  notas importadas (`fronteira-pluggy` regra 11 — divergência vira achado nomeado, e não há tela para
  isso ainda); cartão de crédito (`type=CREDIT` em `/accounts`); provento (`pluggy_connector_investment_income`); e qualquer
  remoção ou integração no `oplab-radar-api`.

## Capabilities

### New Capabilities
- `pluggy-transaction-history`: o que este serviço considera "o passado" de um item, até onde ele vai, como
  a varredura pagina sem estourar o orçamento de requisições, e como cada movimentação é gravada de forma
  idempotente.
- `pluggy-account`: como as contas de um item são descobertas e registradas, e por que o extrato depende
  disso.

### Modified Capabilities
- `pluggy-position-sync`: alterado para capturar os campos financeiros `value`, `amount`, `taxes` e `taxes2` com conversão Decimal, aumentar a precisão de `quantity` e `value` para oito casas (D10), e gravar um snapshot histórico append-only a cada sincronização bem-sucedida (D11).
- `pluggy-credentials`: alterado para armazenar, cifrado, o segredo de entrada do webhook por credencial;
  `clientSecret` continua sendo exclusivamente a credencial de saída para `POST /auth`.

## Impact

- Novos/alterados arquivos em `adapters/gateways/`, `entities/`, `infra/db/{migrations,models}/`,
  `adapters/repositories/`, `interactors/`, `adapters/handlers/`, `infra/http-server.ts` e `src/index.ts`.
- Todas as tabelas novas são próprias deste serviço (`modelagem-de-dados`, regra 1) — nenhuma migration
  toca tabela do `oplab-radar-api`.
- Nenhum arquivo do `oplab-radar-api` ou do `oplab-radar-front`.
- **Expectativa a alinhar com o titular:** a janela documentada é de cerca de 1 ano e a profundidade real
  depende do conector; a persistência não descarta registro mais antigo que a API entregar. Qualquer recorte
  futuro de UI será decisão de leitura, não truncamento de dado.
