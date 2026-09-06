## Purpose

Definir como o histórico de consentimento Open Finance de um item Pluggy é descoberto e registrado, para
que o estado de acesso (ativo, expirado, revogado) e o escopo autorizado sejam auditáveis.

## ADDED Requirements

### Requirement: Consentimento pertence ao item que o originou
Todo consentimento registrado MUST carregar o `itemId` que o originou.

#### Scenario: Consentimento sem item é recusado
- **WHEN** um consentimento é apresentado para gravação sem `itemId`
- **THEN** a gravação é recusada nomeando o campo ausente

### Requirement: Consentimento é o estado atual do item, uma linha por item
Um item tem uma única linha de consentimento, identificada por `itemId`. Cada sincronização MUST
substituir essa linha pelo consentimento mais recente devolvido pela Pluggy — não é histórico de
renovações, é o estado atual. O histórico completo que a Pluggy devolve (todos os consentimentos do
item, inclusive revogados) permanece disponível na tabela de log de payload bruto (capacidade
`pluggy-raw-payload-audit`), não nesta tabela.

#### Scenario: Renovação substitui a linha existente
- **WHEN** um item já tem um consentimento revogado registrado e a Pluggy devolve um consentimento novo,
  concedido depois
- **THEN** a linha existente é atualizada para refletir o consentimento novo, sem criar uma segunda linha

### Requirement: Escopo autorizado é capturado, não só o prazo
Além de `expiresAt` e `revokedAt`, todo consentimento MUST persistir `products` e
`openFinancePermissionsGranted` exatamente como a Pluggy devolveu — são o que diz quais dados o titular
autorizou, não só até quando.

#### Scenario: Consentimento com permissões de investimento e conta
- **WHEN** a Pluggy devolve `openFinancePermissionsGranted` com permissões de investimento e de conta
- **THEN** a lista inteira é persistida junto ao consentimento
