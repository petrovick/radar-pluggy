## Purpose

Garantir que, para um mesmo Item, no máximo uma ingestão (sincronização de posição + carga de
histórico) execute por vez — qualquer que seja o trigger que a disparou (`WEBHOOK`,
`CREDENTIAL_REGISTRATION_PRELOAD`, `BOOT_RECOVERY`, `MANUAL_HISTORY_LOAD`) — e que, dentro de uma
mesma ingestão, a sincronização de posição e a carga de histórico executem de forma independente:
falha de uma nunca impede a outra de sequer ser tentada.

## ADDED Requirements

### Requirement: No máximo uma ingestão por Item executa por vez, qualquer que seja o trigger
Antes de executar a sincronização de posição e a carga de histórico de um Item, este serviço MUST
adquirir um lease exclusivo daquele Item. Um trigger que não consegue adquirir o lease (outro já
está ingerindo o mesmo Item) MUST desistir desta tentativa sem executar Position nem History, nunca
enfileirando uma segunda execução concorrente.

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

#### Scenario: Lease expirado por worker morto é recuperável
- **WHEN** um processo que detinha o lease de um Item morre antes de liberá-lo, e o tempo de posse
  máximo do lease já passou
- **THEN** um novo trigger para o mesmo Item consegue adquirir o lease, sem esperar indefinidamente

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

#### Scenario: Retentativa após falha parcial não repete trabalho já concluído
- **WHEN** uma ingestão é retentada depois de uma falha parcial (um dos dois teve sucesso, o outro
  não, na tentativa anterior)
- **THEN** o lado que já teve sucesso conclui rapidamente, sem chamada nova à Pluggy, porque sua
  própria marca d'água (`pluggy-sync-progress`) já está em dia; o lado que falhou tenta de novo
  normalmente

### Requirement: Lease é sempre liberado ao final da ingestão, mesmo em falha inesperada
O lease de um Item MUST ser liberado ao final da ingestão, independente de Position e History
terem tido sucesso, falhado, ou de uma exceção inesperada ter interrompido o processamento. Um lease
nunca fica retido além do necessário por uma falha não tratada.

#### Scenario: Exceção inesperada ainda libera o lease
- **WHEN** uma exceção inesperada interrompe o processamento de uma ingestão, antes de Position e
  History concluírem normalmente
- **THEN** o lease do Item é liberado, permitindo uma nova tentativa
