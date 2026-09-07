## Context

`CheckPluggyCredentialInteractor` (`src/interactors/pluggy-credential/check/`) já existe, criado na
change `configuracao-credenciais-pluggy` (tarefa 2.2) como suporte a um fluxo interno (resolução de
`itemId` → credencial). Está marcado deliberadamente sem rota HTTP, com o comentário "não reabra
isso como código morto" — a decisão registrada ali era sobre não inventar consumidor; não era uma
proibição permanente de rota.

`oplab-radar-front` está planejando dois menus novos (Carteira, Cartão), visíveis só para quem tem
credencial Pluggy configurada. Decisão do usuário: o front consulta este serviço no login, em vez
de guardar esse estado localmente — cobre o caso de a credencial ter sido cadastrada em outro
dispositivo/sessão.

## Goals / Non-Goals

**Goals:**
- Expor o estado "pessoa tem credencial configurada e pronta para sincronizar" via HTTP,
  autenticado, sem inventar caso de uso novo.

**Non-Goals:**
- Não expõe qual credencial ou `itemId` está associado — isso seria inventar payload sem
  consumidor, mesma razão pela qual o interactor já devolve `data: {}` em sucesso.
- Não implementa os endpoints de leitura de dado financeiro (`/portfolio`, `/accounts`, ...) — fora
  de escopo, pertence à próxima change (ainda não iniciada), posterior a
  `pluggy-complete-data-capture`.

## Decisions

### D1 — Reaproveitar o interactor existente sem alterar seu contrato
`CheckPluggyCredentialInteractor` já cobre exatamente o cenário necessário. Alternativa descartada:
criar um interactor novo dedicado a "status" — rejeitada por duplicar lógica já implementada e
testada.

### D2 — Os dois erros nomeados viram `hasCredential:false` com 200, não 4xx
`PLUGGY_CREDENTIAL_NOT_FOUND_FOR_PERSON` e `PLUGGY_CREDENTIAL_ITEM_ID_NOT_FOUND_FOR_PERSON` são
estado esperado de "ainda não configurou", não falha. O handler os traduz para uma resposta de
sucesso com o campo booleano, em vez de propagar como erro HTTP — que faria o front tratar uma
situação normal como falha de rede/recusa.

### D3 — Resposta não distingue "sem credencial" de "sem itemId vinculado"
O front só precisa de um booleano para decidir visibilidade de menu, não de qual dos dois cenários
faltou. Alternativa descartada: expor os dois motivos separadamente — rejeitada por inventar
granularidade sem consumidor hoje.

## Risks / Trade-offs

- [Comentário desatualizado do interactor] → corrigido nesta mesma mudança, evitando que uma
  revisão futura reabra a discussão de "código morto" por engano.
