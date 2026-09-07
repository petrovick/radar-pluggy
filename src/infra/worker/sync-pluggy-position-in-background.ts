import type { AppContainerInstance } from '../bootstrap/register.js'
import { createScope } from '../bootstrap/scope.js'
import type { LeaseGuard } from '../../shared/lease-guard.js'

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
// `onSettled` (tasks.md 7.6/D30): a rota manual precisa liberar o lease de ingestão compartilhado
// só DEPOIS que Position concluir (sucesso ou falha) — nunca antes, senão reabriria a janela de
// corrida que o lease existe pra fechar. Opcional porque o disparo do webhook (`http-server.ts`) não
// tem lease próprio nesse ponto: quem adquire e libera, ali, é o `pluggy-item-ingestion.ts`.
// `leaseGuard`, mesmo motivo: só a rota manual (D30) já detém um lease com heartbeat rodando quando
// dispara este background — repassa `lease.guard` pra Position recusar página/chamada/commit
// destrutivo novo se a posse for perdida enquanto ainda está em voo.
export function syncPluggyPositionInBackground(
  rootContainer: AppContainerInstance,
  itemId: string,
  onError: (error: unknown) => void,
  onSettled?: () => void,
  leaseGuard?: LeaseGuard,
): void {
  try {
    const scope = createScope(rootContainer)
    void scope
      .resolve('syncPluggyPositionInteractor')
      .execute({ itemId, ...(leaseGuard !== undefined ? { leaseGuard } : {}) })
      .then((result) => {
        if (result.error) {
          onError(result.error)
        }
      })
      .catch(onError)
      .finally(() => onSettled?.())
  } catch (err) {
    onError(err)
    onSettled?.()
  }
}
