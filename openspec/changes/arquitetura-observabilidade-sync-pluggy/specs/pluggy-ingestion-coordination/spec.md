## Purpose

Garantir que, para um mesmo Item, no máximo uma ingestão (sincronização de posição + carga de
histórico) execute por vez — qualquer que seja o trigger que a disparou (`WEBHOOK`,
`CREDENTIAL_REGISTRATION_PRELOAD`, `BOOT_RECOVERY`, `MANUAL_HISTORY_LOAD`) — e que, dentro de uma
mesma ingestão, a sincronização de posição e a carga de histórico executem de forma independente:
falha de uma nunca impede a outra de sequer ser tentada. O lease é uma otimização de trabalho —
evita ingestões concorrentes redundantes — e não é a única linha de defesa: a integridade dos dados
de marca d'água e observação é garantida por escrita atômica (`pluggy-sync-progress`,
`pluggy-connection-observability`), independente do lease.

## ADDED Requirements

### Requirement: No máximo uma ingestão por Item executa por vez, qualquer que seja o trigger
Antes de executar a sincronização de posição e a carga de histórico de um Item, este serviço MUST
adquirir um lease exclusivo daquele Item, identificado por um token que nunca depende da resolução
de milissegundo de um timestamp para distinguir posse (um contador monotônico por item — nenhuma
aquisição concorrente pode receber o mesmo token). Um trigger que não consegue adquirir o lease
(outro já está ingerindo o mesmo Item) MUST desistir desta tentativa sem executar Position nem
History, nunca enfileirando uma segunda execução concorrente.

#### Scenario: Webhook e pré-carga não processam o mesmo item ao mesmo tempo
- **WHEN** um evento de webhook e uma pré-carga de cadastro chegam para o mesmo `itemId`
  aproximadamente ao mesmo tempo
- **THEN** apenas um dos dois adquire o lease e executa Position/History; o outro desiste desta
  tentativa sem executar nada

#### Scenario: Rota manual recusa quando o item já está sendo ingerido
- **WHEN** um titular aciona a carga manual de histórico para um item que já tem uma ingestão em
  andamento (lease ocupado por outro trigger)
- **THEN** a rota responde recusando nomeadamente, sem executar Position nem History para esse item

#### Scenario: Lease liberado permite a próxima tentativa
- **WHEN** uma ingestão termina (com sucesso ou com falha) e libera o lease do Item
- **THEN** um novo trigger para o mesmo Item consegue adquirir o lease e executar normalmente

#### Scenario: Duas aquisições nunca recebem o mesmo token de posse
- **WHEN** duas tentativas de adquirir o lease do mesmo Item ocorrem em sequência (a segunda depois
  que a primeira já liberou ou expirou)
- **THEN** cada uma recebe um token de posse distinto, mesmo que as duas aquisições aconteçam no
  mesmo milissegundo

### Requirement: Quem detém o lease renova periodicamente durante trabalho longo
Enquanto a ingestão estiver em andamento, quem detém o lease MUST renová-lo periodicamente, antes de
seu prazo expirar — uma carga de histórico com muitas páginas pode legitimamente durar mais que o
prazo original do lease. Uma renovação só é aceita quando quem a pede ainda detém o token de posse
atual; a renovação nunca muda esse token. Quando o processo termina a ingestão (sucesso, falha, ou
exceção), a renovação para e o lease é liberado.

#### Scenario: Carga longa renova o lease antes de expirar
- **WHEN** uma carga de histórico com muitas páginas ultrapassa o prazo original do lease
- **THEN** o lease é renovado periodicamente enquanto o processamento continua, sem expirar e sem
  permitir que outro trigger adquira o mesmo item nesse meio tempo

#### Scenario: Processo morto para de renovar, e o lease se torna reivindicável
- **WHEN** o processo que detém o lease morre e para de renová-lo
- **THEN** o lease expira no prazo normal (sem renovação) e um novo trigger consegue adquiri-lo, com
  um novo token de posse

### Requirement: Position e History executam de forma independente dentro de uma ingestão
Dentro de uma ingestão, a sincronização de posição e a carga de histórico MUST ser executadas de
forma independente: o resultado de cada uma é capturado separadamente, e a falha de uma nunca impede
a outra de ser executada. A unidade de trabalho só é considerada bem-sucedida quando as duas
tiverem sucesso; falha de qualquer uma marca a unidade como falha (para efeito de retentativa do
trigger que a originou), mas o que teve sucesso permanece persistido.

#### Scenario: Falha de posição não impede a carga de histórico
- **WHEN** a sincronização de posição de um Item falha (por exemplo, erro ao ler investimentos)
- **THEN** a carga de histórico do mesmo Item ainda é executada, e seu resultado (sucesso ou falha)
  é capturado independente do resultado da posição

#### Scenario: Falha de histórico não impede a sincronização de posição
- **WHEN** a carga de histórico de um Item falha
- **THEN** a sincronização de posição do mesmo Item ainda é executada, e seu resultado é capturado
  independente do resultado do histórico

#### Scenario: Sucesso parcial não é tratado como falha total nem descarta o que já foi persistido
- **WHEN** a sincronização de posição de um Item tem sucesso e a carga de histórico do mesmo Item
  falha, dentro da mesma ingestão
- **THEN** a fotografia de posição atualizada pela sincronização bem-sucedida permanece persistida;
  a unidade de trabalho é marcada como falha só para efeito de retentativa do trigger

#### Scenario: Retentativa após falha parcial não repete chamada às fontes já concluídas
- **WHEN** uma ingestão é retentada depois de uma falha parcial (um dos dois teve sucesso, o outro
  não, na tentativa anterior)
- **THEN** o lado que já teve sucesso não chama de novo os endpoints da fonte já concluída
  (`investments`, `loans`, `accounts`/`transactions`, conforme o caso) — sua própria marca d'água
  (`pluggy-sync-progress`) já está em dia; a releitura do Item em si (`fetchItem`, necessária para
  decidir o portão) ainda acontece normalmente, memoizada uma vez por unidade de trabalho; o lado que
  falhou tenta de novo normalmente

### Requirement: Lease é sempre liberado ao final da ingestão, mesmo em falha inesperada
O lease de um Item MUST ser liberado ao final da ingestão, independente de Position e History
terem tido sucesso, falhado, ou de uma exceção inesperada ter interrompido o processamento. A
renovação periódica MUST parar no mesmo momento em que o lease é liberado. Um lease nunca fica
retido além do necessário por uma falha não tratada.

#### Scenario: Exceção inesperada ainda libera o lease
- **WHEN** uma exceção inesperada interrompe o processamento de uma ingestão, antes de Position e
  History concluírem normalmente
- **THEN** o lease do Item é liberado, e a renovação periódica é interrompida, permitindo uma nova
  tentativa
