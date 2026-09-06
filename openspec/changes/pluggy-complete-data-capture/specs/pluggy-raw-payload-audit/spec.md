## Purpose

Manter um log íntegro do payload bruto que a Pluggy devolveu para cada recurso sincronizado, capturado
antes de qualquer validação, para permitir auditoria futura do que foi efetivamente recebido.

## ADDED Requirements

### Requirement: Uma tabela de log por tipo de recurso
Cada tipo de recurso sincronizado (item, consentimento, posição, conta, transação de conta, transação de
investimento, empréstimo) MUST ter sua própria tabela de log de payload bruto. O log nunca mistura o
payload bruto de tipos de recurso diferentes numa tabela só.

#### Scenario: Payload de conta e de investimento não se misturam
- **WHEN** uma conta e um investimento são sincronizados na mesma carga
- **THEN** o payload bruto de cada um é gravado na tabela de log do seu próprio tipo de recurso

### Requirement: Captura preserva o payload exatamente como recebido
O payload bruto de cada item de uma resposta da Pluggy MUST ser capturado como recebido, sem transformação
e sem remoção de campo — inclusive campo que nenhuma entity ou coluna deste serviço lê hoje.

#### Scenario: Payload bruto preserva campo não mapeado
- **WHEN** a Pluggy devolve um campo que nenhuma entity ou coluna deste serviço lê hoje
- **THEN** o log de payload bruto ainda contém esse campo, inalterado

### Requirement: Gravação do log acontece junto com o registro principal
O log de payload bruto MUST ser inserido na mesma transação atômica em que a linha correspondente é
gravada na tabela principal daquele recurso. Quando um item falha validação antes de chegar à tabela
principal, nenhum dos dois registros é gravado — o log de payload bruto não é ponto de captura
independente da validação.

#### Scenario: Falha de validação não grava nem o log bruto
- **WHEN** um item de uma página falha validação de campo obrigatório
- **THEN** nem a tabela principal nem o log de payload bruto recebem linha para esse item

#### Scenario: Sucesso grava os dois juntos
- **WHEN** um item passa na validação e é persistido na tabela principal
- **THEN** o payload bruto correspondente é gravado na tabela de log na mesma transação

### Requirement: Log é append-only, sem chave de unicidade
Cada sincronização MUST gravar uma linha nova no log de payload bruto, mesmo quando o conteúdo é idêntico
ao da sincronização anterior para o mesmo recurso. O log não impõe restrição de unicidade sobre o
identificador do recurso — decidir se duas capturas são a "mesma ocorrência" ou uma duplicata de negócio é
questão em aberto, resolvida fora desta capacidade.

#### Scenario: Duas sincronizações sem mudança geram duas linhas
- **WHEN** o mesmo investimento é sincronizado duas vezes sem nenhum campo diferente
- **THEN** existem duas linhas no log de payload bruto para esse investimento, uma por sincronização
