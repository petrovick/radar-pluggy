## Why

`oplab-radar-front` (repositório separado) vai ganhar dois menus novos (Carteira/Investimentos e
Cartão/Extrato) que só devem aparecer para quem já tem credencial Pluggy configurada. O front
decidiu consultar este serviço para saber isso, em vez de inferir localmente (localStorage) — para
refletir corretamente uma credencial cadastrada em outro dispositivo/sessão. Hoje não existe
nenhuma rota de leitura desse estado: `CheckPluggyCredentialInteractor` já implementa exatamente a
checagem necessária (credencial + itemId vinculado, por pessoa), mas está marcado "SEM ROTA, DE
PROPÓSITO".

## What Changes

- Rota nova, autenticada: `GET /credentials/status`, expondo `CheckPluggyCredentialInteractor` já
  existente, sem alterar seu contrato interno.
- Resposta simplificada para o consumidor: `{ hasCredential: boolean }`. Os dois erros nomeados do
  interactor (`PLUGGY_CREDENTIAL_NOT_FOUND_FOR_PERSON`, `PLUGGY_CREDENTIAL_ITEM_ID_NOT_FOUND_FOR_PERSON`)
  são estado normal de "ainda não configurou", não falha — viram `hasCredential:false` com 200, não
  um erro HTTP.
- Atualiza o comentário do interactor que dizia "SEM ROTA, DE PROPÓSITO" — deixa de ser verdade; a
  razão de não inventar payload em caso de sucesso (`data: {}`) continua válida e não muda.

## Capabilities

### Modified Capabilities
- `pluggy-credentials`: ganha um requisito de leitura do estado de configuração via HTTP — antes só
  existia contrato de escrita (`POST /credentials`).

## Impact

- Neste repositório: handler novo, rota nova, sem migration nem mudança de schema.
- `oplab-radar-front`: consumirá esta rota para o gate de visibilidade dos dois menus novos (change
  separada, naquele repositório).
