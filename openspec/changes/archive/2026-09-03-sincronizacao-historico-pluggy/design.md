## Context

Esta change consome `FindPluggyCredentialInteractor`, `PluggyAuthGateway` (`POST /auth`),
`PluggyItemsGateway` (`GET /items/{id}`) e `PluggyItem`/`PluggyItemRep` (marca d'água). O
`SyncPluggyPositionInteractor` continua responsável pela fotografia; esta change corrige a sua paginação e
amplia os campos da fotografia, mas não confunde posição com movimentação.

O dump real de 2026-09-03 é a evidência de desenho: 3 contas (1 `CREDIT`, 2 `BANK`), 1.017 transações de
conta distribuídas pelas 3 contas, 59 investimentos e 264 movimentações distribuídas pelos 59 investimentos.
Ele foi produzido percorrendo as páginas, não é uma resposta de página única. Há 608 lançamentos no cartão,
mas cartão permanece fora desta entrega; as duas contas `BANK` têm 341 e 68 lançamentos. A profundidade
observada varia por recurso (inclusive recursos sem lançamento), portanto não há uma única data inicial de
histórico para o item.

| Rota | Paginação confirmada | Forma relevante observada |
|---|---|---|
| `GET /accounts?itemId=X` e `GET /investments?itemId=X` | `page`, `pageSize`, `totalPages` | listas de descoberta; ambas precisam percorrer todas as páginas |
| `GET /investments/{id}/transactions` | `page`, `pageSize`, `totalPages` | 264 registros; `value` e `quantity` chegam com até 8 casas |
| `GET /v2/transactions?accountId=X` | cursor `next` | 1.017 registros; `date`, `createdAt` e `updatedAt` contêm hora e milissegundos |

O Open Finance documenta 365 dias como referência, mas a API pode devolver registros mais antigos — o dump
tem movimentação de 2025-08-29 numa coleta de 2026-09-03. A profundidade efetiva depende da instituição e
todo registro devolvido é persistido, sem filtro de corte. A coleta na instituição, não a nossa leitura da API
Pluggy, é limitada: o trecho de 7–365 dias tem 4 coletas/mês por
CPF + instituição + produto. A Pluggy executa o auto-sync; este serviço somente reage ao resultado dele.

## Goals / Non-Goals

**Goals:**

- Registrar o histórico de custódia e caixa disponível, com paginação completa e gravação idempotente.
- Fazer a primeira carga completa e as cargas seguintes reativas a `item/created` e `item/updated` neste
  serviço, sem cron, polling, `PATCH /items` ou passagem pelo `oplab-radar-api`.
- Preservar precisão, instante e metadados que o dump demonstrou necessários para auditoria e análise.
- Declarar apenas o que foi observado numa varredura concluída, nunca inventar cobertura temporal.

**Non-Goals:**

- Gerar `fiscal_event`, conciliar automaticamente notas, reconstruir posição histórica, cartão de crédito,
  provento e qualquer arquivo ou integração no `oplab-radar-api`.

## Decisions

### D1 — Caixa e custódia são relações distintas
`pluggy_connector_investment_transactions` e `pluggy_connector_account_transactions` são tabelas diferentes, cada qual com sua
própria chave única. Uma liquidação pode legitimamente existir nas duas e nunca será deduplicada entre elas.

### D2 — A linha persistida preserva os atributos analíticos observados
Além dos identificadores, valores e datas, o extrato preserva `category_id`, categoria, tipo/operação,
`description_raw`, `order`, `merchant` e `payment_data`; estes dois últimos ficam como JSON opcional. A
movimentação de investimento preserva `value`, `amount`, `netAmount`, `quantity`, `priceFactor`,
`indexerPercentage`, `agreedRate`, `movementType`, `tradeDate`, descrição, nota e as 13 despesas:
`service_tax`, `brokerage_fee`, `income_tax`, `trading_assets_notice_fee`, `maintenance_fee`,
`settlement_fee`, `clearing_fee`, `stock_exchange_fee`, `custody_fee`, `operating_fee`, `other`, `iof` e
`iof_provision`. Campos não fornecidos ficam `NULL`; não há `0` inferido, nem JSON usado no lugar de campo
monetário.

### D3 — Idempotência fica no banco e ausência não apaga
As constraints únicas são (`item_id`, `investment_id`, `transaction_id`) e (`item_id`, `account_id`,
`transaction_id`), com upsert. Uma nova resposta atualiza a mesma linha — inclusive `PENDING` → `POSTED` —
e uma ausência na resposta nunca remove linha já armazenada.

### D4 — Datas guardam o instante que a fonte entregou
`date`, `trade_date`, `createdAt`, `updatedAt` e os timestamps locais usam fisicamente `DATETIME(3)`
(`Sequelize.DATE(3)`), não `DATEONLY`: o dump tem horários e milissegundos em lançamentos de conta. A
ordenação temporal e a auditoria não podem perder esse dado. A aplicação normaliza o instante
para UTC ao serializar, sem deslocar o valor de origem para uma data civil inventada.

### D5 — Cobertura significa observação de uma varredura, não garantia de intervalo
`pluggy_connector_history_coverage` tem chave (`item_id`, `reference_type`, `reference_id`) e guarda
`oldest_observed_transaction_at`, `newest_observed_transaction_at`, `observed_transaction_count`,
`last_completed_scan_at` e `source_updated_at`. Uma varredura completa sem transações grava contagem zero e
datas nulas: prova que a resposta foi vazia naquele instante, mas NÃO afirma que um período foi coberto.
Falha no meio não altera o registro de conclusão anterior. Esta tabela é separada para não alterar a
semântica de `pluggy_connector_positions`.

`pluggy_connector_history_sync_states` é o estado por consumidor: uma linha por item com
`last_completed_item_updated_at`. Ele é separado de `pluggy_connector_items.last_updated_at`, que pertence à posição.
Assim posição e histórico podem processar o mesmo item em qualquer ordem, e falha de uma não fecha o portão
da outra. Essa marca só avança depois que todas as fontes elegíveis da execução terminam.

### D6 — Cada fonte é completamente paginada quando é elegível
Na primeira carga, contas e investimentos são descobertos em todas as páginas e cada recurso elegível é
varrido até não haver `next` (extrato) ou até `page === totalPages` (investimento). Nas cargas posteriores,
o item precisa ter marca d'água nova em `pluggy_connector_history_sync_states`; então somente recursos cujo `updatedAt`
avançou desde `source_updated_at` são varridos. Recurso sem `updatedAt`, ou sem `source_updated_at`, é
varrido integralmente como fallback seguro. Uma fonte elegível é sempre lida por inteiro, pois não há cursor de
movimentação de investimento confiável para salvar como checkpoint. O dump mostra que uma única página não
é suficiente e que um investimento pode ter zero movimentações.

O gateway devolve uma página por vez; o interactor itera e persiste página a página. Ele valida que a página
devolvida é a requisitada, que `totalPages` é inteiro finito e não muda durante a varredura, e que cada `next` de cursor é um caminho relativo para
`/v2/transactions` no domínio Pluggy, sem repetir cursor. Assim uma resposta malformada não produz loop nem
SSRF. Não há retry próprio: falha do worker devolve o evento à inbox `PENDING` para recuperação no próximo
boot ou disparo manual; ela não depende de uma reentrega depois que o handler já respondeu 2xx.

### D7 — Webhook local faz a carga diária, com autenticidade e idempotência
Não há agendador. No cadastro da credencial, o serviço gera/recebe um `webhook_secret` próprio, o cifra e
cria `POST /webhooks` da Pluggy para `event: all`, com URL HTTPS pública e header autenticado, persistindo
`webhook_id`, URL e evento por credencial para atualizá-lo por `PATCH /webhooks/{id}`/rotacioná-lo sem criar
duplicata. `client_secret` nunca é
reutilizado como segredo de entrada. O vínculo item-credencial precisa estar persistido antes de aceitar
`item/created`; evento de item ainda não vinculado é recusado sem atribuí-lo a uma pessoa por inferência.
Credenciais existentes são provisionadas por operação autenticada e explícita de reconciliação, nunca por
cron; assim o deploy não deixa contas já cadastradas sem gatilho diário.

O handler valida o header em tempo constante, persiste na inbox e retorna 2xx em menos de 5 segundos. A
inbox possui `PENDING`, `PROCESSING`, `SUCCEEDED` e lease; `event_id` é único, claim é atômico, e eventos de
um mesmo `item_id` são serializados. O processamento inicia após a resposta e também drena `PENDING` no boot
e pela rota manual de recuperação; evento que falha volta a `PENDING` e registra erro resumido. Assim 2xx não
perde trabalho se o processo cair. Só então o worker relê `GET /items/{id}` — o payload é gatilho, não dado —
e processa `item/created`/`item/updated`.

### D8 — Estados da Pluggy são explícitos
`SUCCESS` permite a carga. O gateway de item entrega avisos por produto. `PARTIAL_SUCCESS` exige examinar o aviso: se o produto da fonte foi
limitado pelo rate limit, a fonte é recusada nomeando item e produto e nenhuma marca de conclusão avança.
Lista vazia, produto limitado e fonte sem movimentação são três estados diferentes.

### D9 — Precisão acompanha o dump, não uma suposição de moeda
Todo número da Pluggy converte uma vez na fronteira com `new Decimal(String(n))`. Em `pluggy_connector_positions`,
`quantity` e `value` são `DECIMAL(20,8)`; `balance`, `amount_original`, `amount`, `taxes` e `taxes2` são
`DECIMAL(20,2)`. Em movimentações, `quantity`, `value`, `price_factor`, `indexer_percentage` e
`agreed_rate` são `DECIMAL(20,8)`; montantes e despesas são `DECIMAL(20,2)`. A evidência é direta:
`value` de investimento e transação chegou com até 8 casas, enquanto `amount` e `netAmount` chegaram com 2.

### D10 — Ownership, índices e FKs
Todas as tabelas são deste serviço e têm PK `BIGINT.UNSIGNED` própria. Não há FK física para itens, pessoas,
contas ou investimentos, pois os identificadores da Pluggy são externos e o serviço não pode impor
integridade sobre tabelas de outro repositório. Há índices para leitura cronológica por recurso e as
constraints únicas necessárias à idempotência. O down desfaz índices antes das tabelas/colunas na ordem
inversa.

### D11 — Fotografia de posição também vira apêndice histórico, nunca só sobrescrita
O motivo original desta change (`proposal.md`, Why) é permitir reconstruir a evolução do patrimônio do
titular. Movimentação (`pluggy_connector_investment_transactions`) não basta pra isso: ela registra
compra/venda/juro/amortização, nunca a variação de preço de mercado entre esses eventos — uma ação sem
nenhuma transação num período segue variando de valor todo dia, e esse dado não aparece em nenhuma
movimentação. A Pluggy não expõe endpoint de valor histórico de investimento (`GET /investments`/`GET
/investments/{id}` só devolvem o estado atual) — não há como recuperar depois um dia que não foi
capturado quando ele aconteceu.

Por isso, toda sincronização bem-sucedida de `SyncPluggyPositionInteractor` grava, na mesma transação de
banco que atualiza a fotografia, uma linha em `pluggy_connector_position_snapshots` — apêndice histórico,
nunca sobrescrito. Identidade (`item_id`, `investment_id`, `quota_date`) com upsert: mesma `quota_date`
atualiza a mesma linha (reentrega de webhook não duplica), `quota_date` diferente cria linha nova. `quota_date`
é a data da cotação que a Pluggy reportou, não o instante em que este serviço processou. Guarda os mesmos
campos financeiros da fotografia (`balance`, `quantity`, `value`, `amount`, `amount_original`, `taxes`,
`taxes2`) mais `currency_code`, e um `synced_at` (auditoria de quando este serviço gravou, fora da chave
de idempotência). Campos descritivos (nome, tipo, código, ISIN) não são duplicados aqui — ficam só na
fotografia viva; o snapshot é histórico de valor, não um espelho completo do investimento. Índice
(`item_id`, `quota_date`) cobre a leitura de "todas as posições do item numa data", útil para somar
patrimônio total por dia. Se a gravação do snapshot falhar, a fotografia da mesma sincronização não
avança — as duas nunca ficam dessincronizadas.

Este change entrega o dado bruto; construir a série/gráfico de evolução em si é leitura, fora deste
serviço.

## Risks / Trade-offs

- Snapshot diário sem retenção definida cresce indefinidamente (uma linha por investimento por dia com
  cotação nova). Não há requisito de retenção/agregação nesta change — decisão explícita a tomar depois,
  se o volume justificar.
- O item pode atualizar todos os investimentos numa coleta; nesse caso todos tornam-se elegíveis e a leitura
  completa é deliberada, não uma varredura cega. No dump, os 59 investimentos tinham `updatedAt` recente.
- O banco guarda informação financeira e de transação sensível; logs, mensagens de erro e testes não podem
  reproduzir payload ou identificadores reais.
- Transação removida pela instituição permanece armazenada (D3). É a opção segura até existir fluxo humano
  para confirmar remoção.
