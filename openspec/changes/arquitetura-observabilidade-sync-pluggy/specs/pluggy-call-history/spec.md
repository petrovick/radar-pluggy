## Purpose

Manter um histórico append-only de toda chamada que este serviço faz à Pluggy — autenticação,
leitura de snapshot, configuração de plataforma — com classificação, origem e resultado, para
auditoria, análise de frequência e detecção de anomalia. Nunca funciona como estado de quota,
lock ou lease.

## ADDED Requirements

### Requirement: Toda chamada concluída gera uma tentativa de persistência de exatamente um registro
Depois que uma chamada ao SDK da Pluggy termina — com sucesso ou com falha — este serviço tenta
gravar exatamente um registro, contendo o instante de início, o instante de término, a duração e o
resultado. Esta é uma garantia de tentativa, não de entrega: como a persistência é best-effort (ver
"Falha ao registrar uma chamada nunca impede a chamada de negócio"), a perda do registro é possível
quando o processo termina antes do `INSERT` ou o banco está indisponível no momento da gravação —
esses casos devem ser observáveis por log ou métrica, nunca silenciosos. `radar_pluggy_calls` nunca
é fonte de verdade sobre "quantas chamadas realmente aconteceram", só sobre as que conseguiram ser
registradas.

#### Scenario: Chamada bem-sucedida grava o resultado
- **WHEN** uma chamada ao SDK da Pluggy termina com sucesso
- **THEN** uma tentativa de gravação ocorre, e se bem-sucedida o registro tem o resultado de sucesso
  e a duração da chamada

#### Scenario: Chamada que falha grava o resultado com falha nomeada
- **WHEN** uma chamada ao SDK da Pluggy termina em erro
- **THEN** uma tentativa de gravação ocorre, e se bem-sucedida o registro tem um resultado de falha
  nomeado, nunca omitido

#### Scenario: Processo termina antes de persistir o registro
- **WHEN** o processo é encerrado depois que uma chamada ao SDK termina, mas antes de a tentativa de
  gravação concluir
- **THEN** aquela chamada real fica sem registro correspondente em `radar_pluggy_calls` — perda
  aceita como limite conhecido deste mecanismo, não corrigida por lock, lease ou outbox

### Requirement: Registro nunca é atualizado depois de criado
Um registro de chamada é gravado uma única vez, já com todos os seus campos preenchidos. Nenhuma
operação posterior modifica um registro existente.

#### Scenario: Nenhuma atualização é aplicada a um registro já gravado
- **WHEN** o histórico de chamadas já contém um registro de uma chamada concluída
- **THEN** nenhuma operação subsequente altera esse registro — uma nova chamada sempre gera um
  registro novo, nunca uma atualização do anterior

### Requirement: Autenticação é observada no ponto real onde acontece
O registro de uma chamada de autenticação só é gravado quando a autenticação de fato ocorre contra a
Pluggy — nunca é inferido a partir de outra chamada que a Pluggy realiza internamente.

#### Scenario: Client novo gera um registro de autenticação
- **WHEN** uma chamada é feita com um client que ainda não tem token de acesso em cache
- **THEN** um registro de autenticação é gravado, correspondente à autenticação real que ocorreu

#### Scenario: Client com token em cache não gera novo registro de autenticação
- **WHEN** uma chamada é feita com um client cujo token de acesso em cache ainda é válido
- **THEN** nenhum registro de autenticação é gravado para essa chamada

### Requirement: Classificação por escopo de chamada é obrigatória e fechada
Todo registro tem um escopo de chamada entre: `AUTH`, `SNAPSHOT_READ`, `PLATFORM_CONFIG`,
`ITEM_SYNC_TRIGGER`, `DIRECT_INSTITUTION`, `UNKNOWN`. Nenhum registro fica sem escopo.

#### Scenario: Leitura de snapshot é classificada corretamente
- **WHEN** uma chamada lê dados já coletados pela Pluggy (item, investimentos, contas, empréstimos,
  consentimentos)
- **THEN** o registro é classificado como `SNAPSHOT_READ`

#### Scenario: Operação sem classificação conhecida cai em UNKNOWN
- **WHEN** uma chamada não corresponde a nenhuma classificação conhecida
- **THEN** o registro é gravado com escopo `UNKNOWN`, nunca fica sem escopo

### Requirement: Falha ao registrar uma chamada nunca impede a chamada de negócio
Uma falha ao gravar o histórico de chamadas nunca impede, atrasa de forma bloqueante, nem reverte a
chamada de negócio que a originou. A falha em si é sempre observável — nunca engolida em silêncio.

#### Scenario: Histórico indisponível não interrompe a sincronização
- **WHEN** a gravação de um registro de chamada falha
- **THEN** a chamada de negócio que a originou continua seu fluxo normalmente, e a falha de
  gravação é registrada como aviso de log ou métrica, nomeando o erro

### Requirement: Registro nunca funciona como mecanismo de concorrência
O histórico de chamadas nunca é lido nem escrito como parte de uma decisão de exclusividade,
lock, lease ou controle de quota restante.

#### Scenario: Duas chamadas simultâneas não são coordenadas por este histórico
- **WHEN** duas chamadas à Pluggy acontecem ao mesmo tempo
- **THEN** o histórico de chamadas registra as duas, sem impedir, atrasar ou serializar nenhuma
  delas
