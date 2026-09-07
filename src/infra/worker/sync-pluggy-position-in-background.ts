import type { AppContainerInstance } from '../bootstrap/register.js'
import { createScope } from '../bootstrap/scope.js'

// Dispara `SyncPluggyPositionInteractor` numa unidade de trabalho própria, sem bloquear quem
// chamou — mesmo papel de `drainInBackground` (webhook-drainer.ts) para o evento de webhook, aqui
// para o disparo manual que `scope.ts` já documenta como o terceiro gatilho previsto ("request
// HTTP, evento de webhook, disparo manual").
//
// `createScope(rootContainer)` de novo a cada chamada, nunca o escopo de uma requisição HTTP já
// respondida: essa requisição terminou, e os registros `.scoped()` do container (reps, resolver de
// credencial, logger) memoizam por unidade de trabalho (arquitetura-camadas, 2.2.1) — reaproveitar
// o escopo dela para uma continuação que sobrevive à resposta estenderia essa memoização além do
// que ela deveria cobrir.
export function syncPluggyPositionInBackground(
  rootContainer: AppContainerInstance,
  itemId: string,
  onError: (error: unknown) => void,
): void {
  try {
    const scope = createScope(rootContainer)
    void scope
      .resolve('syncPluggyPositionInteractor')
      .execute({ itemId })
      .then((result) => {
        if (result.error) {
          onError(result.error)
        }
      })
      .catch(onError)
  } catch (err) {
    onError(err)
  }
}
