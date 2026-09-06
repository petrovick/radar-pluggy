# pluggy-transaction-history Specification

## Purpose

Definir como este serviço lê, observa e atualiza o histórico de caixa e custódia de um item Pluggy sem
inventar cobertura temporal, perder páginas ou executar sincronização periódica própria.

## Requirements

### Requirement: Caixa e custódia são registros distintos
Movimentação de investimento e extrato de conta MUST ser gravados em registros separados, com identidades e
chaves próprias. O sistema nunca mistura as duas naturezas, mesmo quando uma liquidação aparece nas duas
fontes.

#### Scenario: Liquidação aparece em ambas as fontes
- **WHEN** uma venda de investimento e o crédito correspondente aparecem no extrato da conta do mesmo item
- **THEN** dois registros distintos são gravados, um em cada tabela

### Requirement: Repetir carga atualiza sem duplicar nem apagar
Movimentação MUST ser identificada por (`itemId`, recurso, `transactionId`) e persistida por upsert. Uma
resposta posterior atualiza a linha existente; ausência de uma linha numa resposta nunca a remove.

#### Scenario: Pending vira posted
- **WHEN** uma transação de conta gravada como `PENDING` é recebida novamente como `POSTED`
- **THEN** a mesma linha passa a conter `POSTED`, sem duplicata

#### Scenario: Recarga traz menos registros
- **WHEN** uma recarga devolve menos movimentações que a anterior
- **THEN** as movimentações já gravadas permanecem armazenadas

### Requirement: Fonte elegível é paginada até o fim
A primeira carga MUST descobrir todas as páginas de contas e investimentos e percorrer cada fonte elegível
até seu término: cursor ausente para extrato e última página indicada para investimento. Páginas já obtidas
podem ser persistidas, mas falha, cursor repetido ou metadado incoerente MUST impedir a conclusão da
observação daquela fonte.

#### Scenario: Extrato tem múltiplas páginas por cursor
- **WHEN** uma página de extrato devolve um cursor `next` válido
- **THEN** o sistema busca a próxima página e termina somente quando não houver cursor

#### Scenario: Falha na página intermediária
- **WHEN** a busca de uma página intermediária falha
- **THEN** os registros já persistidos permanecem, mas a observação concluída da fonte não avança

### Requirement: Cursor nunca redireciona a leitura para fora da Pluggy
O cursor `next` MUST ser validado como caminho relativo de `GET /v2/transactions`; URL absoluta, caminho de
outro endpoint ou cursor repetido MUST ser recusado. O sistema nunca segue um cursor como URL arbitrária.

#### Scenario: Cursor absoluto é recusado
- **WHEN** a resposta do extrato contém `next` apontando para uma URL absoluta
- **THEN** a carga é recusada sem fazer requisição para essa URL

### Requirement: Campos obrigatórios e opcionais preservam o contrato da fonte
Para movimentação de investimento, `id`, `type` e `date` MUST existir. Para extrato, `id`, `description`,
`currencyCode`, `amount`, `date`, `accountId`, `type`, `status`, `createdAt` e `updatedAt` MUST existir.
Campo opcional ausente ou `null` é aceito; campo presente com tipo inválido MUST ser recusado nomeando o
campo. O `accountId` de uma transação MUST ser igual à conta consultada.

#### Scenario: Extrato sem balance é aceito
- **WHEN** a Pluggy devolve transação de extrato sem `balance`
- **THEN** a transação é gravada com balance nulo

#### Scenario: Amount vem como texto
- **WHEN** `amount` vem como texto em vez de número
- **THEN** a movimentação é recusada nomeando o campo, sem conversão implícita

### Requirement: Números, despesas nomeadas e instantes são preservados na fronteira
Todo número monetário, taxa, fator e quantidade MUST converter para `Decimal` na fronteira. As 13 despesas
de investimento MUST ser armazenadas em colunas opcionais próprias: `service_tax`, `brokerage_fee`,
`income_tax`, `trading_assets_notice_fee`, `maintenance_fee`, `settlement_fee`, `clearing_fee`,
`stock_exchange_fee`, `custody_fee`, `operating_fee`, `other`, `iof` e `iof_provision`. Instantes fornecidos
pela Pluggy MUST preservar hora e milissegundo. `parseFloat`, aritmética sobre `number` e redução de
timestamp para data civil são proibidos.

#### Scenario: Value com oito casas é preservado
- **WHEN** uma movimentação de investimento contém `value` com oito casas decimais
- **THEN** ela é gravada como Decimal de oito casas, sem arredondamento para centavos

#### Scenario: Despesa nomeada é preservada sem inventar zero
- **WHEN** a Pluggy devolve somente `expenses.serviceTax` e `expenses.iof`
- **THEN** `service_tax` e `iof` são gravados como Decimal, e as outras 11 colunas de despesa permanecem nulas

### Requirement: Observação do histórico não presume cobertura
Após varredura completa, o sistema MUST registrar por conta ou investimento o menor e maior instante
observado, quantidade recebida e instante da conclusão. Varredura vazia MUST registrar contagem zero e
datas nulas, sem afirmar que qualquer período foi coberto ou fabricar movimentação.

#### Scenario: Fonte sem movimentação
- **WHEN** uma varredura completa de investimento termina sem registros
- **THEN** a observação registra contagem zero e datas nulas, sem declarar período coberto

### Requirement: Atualização diária é reativa à Pluggy
O sistema MUST reagir a `item/created` e `item/updated` recebidos pelo webhook local, reler o item e exigir
marca d'água nova exclusiva do histórico. Em carga posterior, MUST chamar transações somente para recurso
cujo `updatedAt` avançou desde a última observação; se qualquer dos dois timestamps faltar, MUST varrer a
fonte inteira como fallback seguro. A marca de posição não pode bloquear o histórico. Não há cron, polling
ou `PATCH /items`.

#### Scenario: Dia sem mudança não busca transações
- **WHEN** o item relido não tem marca d'água mais nova que a última sincronização
- **THEN** nenhuma chamada de transação é feita

### Requirement: Webhook é provisionado, autenticado e durável neste serviço
O serviço MUST configurar um webhook `event: all` da Pluggy para URL HTTPS pública com segredo de entrada
único por credencial, armazenado cifrado e distinto de `clientSecret`; id, URL e evento remotos MUST ficar
persistidos para que rotação use atualização, não um segundo cadastro. Credenciais existentes MUST poder ser
reconciliadas por operação autenticada explícita. O handler MUST resolver somente vínculo
item-credencial pré-existente, validar o segredo em tempo constante, persistir o evento numa inbox e retornar
2xx em menos de 5 segundos. A inbox MUST ter transições atômicas `PENDING` → `PROCESSING` → `SUCCEEDED`,
lease e unicidade de `eventId`; falha ou lease vencido retorna a `PENDING`. Eventos do mesmo item são
serializados. O payload é somente gatilho; o worker relê o item e os dados da Pluggy.

#### Scenario: Reentrega do mesmo evento
- **WHEN** a Pluggy reenvia o mesmo `eventId`
- **THEN** o serviço não executa a carga uma segunda vez

#### Scenario: Processo cai após reconhecer o evento
- **WHEN** o evento já recebeu 2xx, mas o processo cai antes de concluir a carga
- **THEN** o evento permanece ou volta a `PENDING` e é recuperável no próximo boot ou disparo manual

### Requirement: Produto limitado não é interpretado como vazio
Quando o item vier em `PARTIAL_SUCCESS` com aviso de rate limit para o produto da fonte, o sistema MUST
recusar aquela fonte nomeando item e produto. Nenhuma observação de conclusão avança e dados existentes não
são sobrescritos como vazios.

#### Scenario: Rate limit de investimento
- **WHEN** o item indica limite mensal atingido para investimento
- **THEN** a carga de investimento é recusada e os registros existentes permanecem intactos

#### Scenario: Partial success sem limite no produto da fonte
- **WHEN** o item está em `PARTIAL_SUCCESS`, mas o aviso não limita o produto da fonte
- **THEN** a carga daquela fonte segue normalmente
