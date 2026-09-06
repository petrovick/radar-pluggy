import { asValue } from 'awilix'
import { randomUUID } from 'node:crypto'
import type { Transaction } from 'sequelize'
import type { AppContainerInstance } from './register.js'
import type { Logger } from '../tools/log/logger.js'

// Escopo por unidade de trabalho (request HTTP, evento de webhook, disparo manual) — mesma função
// `createScope` do `oplab-radar-api` (`infra/bootstrap/scope.ts`).
//
// É aqui que vive o detentor de transação: `setTransaction(name, tx)` registra a transação vigente
// NESTE escopo, e `getTransaction(name)` a devolve. Repositório e gateway do mesmo escopo enxergam a
// mesma transação sem que ninguém a passe por parâmetro — em particular, sem o interactor conhecê-la.
// Escopos diferentes (dois eventos simultâneos) têm detentores independentes.
export function createScope(container: AppContainerInstance, requestId?: string): AppContainerInstance {
  const scope = container.createScope()
  const logger: Logger = scope.resolve('logger')
  const uuid = requestId ?? randomUUID()
  logger.addContext({ uuid })

  scope.register({
    requestId: asValue(uuid),
    getTransaction: asValue((name: string): Transaction | null => {
      try {
        return scope.resolve(`${name}Transaction`)
      } catch {
        return null
      }
    }),
    setTransaction: asValue((name: string, transaction: Transaction | null): void => {
      scope.register({ [`${name}Transaction`]: asValue(transaction) })
    }),
  })

  return scope
}
