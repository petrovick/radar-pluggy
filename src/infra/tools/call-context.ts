import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

// Carrega só dado contextual de observabilidade — NUNCA DB, repositório ou o próprio
// `PluggyCallRecorder` (design.md D2/D31): isso seria service locator implícito, contra o registro
// explícito por DI que o resto do código segue. Único jeito de threadar `trigger`/correlação através
// de `PluggyConnectorClient`, que é singleton cacheado fora de qualquer escopo Awilix e sobrevive a
// muitas unidades de trabalho diferentes.
export interface CallContext {
  trigger: string
  webhookEventId: string | undefined
  requestCorrelationId: string
}

interface StoredCallContext extends CallContext {
  // Contador de página para paginação cursor-based (D24) — particionado por `operation + resourceId`,
  // reiniciado a cada novo `runWithCallContext` (nunca o cursor opaco da Pluggy em si).
  pageCounters: Map<string, number>
}

const storage = new AsyncLocalStorage<StoredCallContext>()

export interface CallContextInput {
  trigger: string
  webhookEventId?: string
  // Gerado automaticamente quando ausente — a maioria dos chamadores não tem um id de requisição
  // HTTP para propagar (worker, boot, webhook).
  requestCorrelationId?: string
}

export function runWithCallContext<T>(ctx: CallContextInput, fn: () => Promise<T>): Promise<T> {
  const stored: StoredCallContext = {
    trigger: ctx.trigger,
    webhookEventId: ctx.webhookEventId,
    requestCorrelationId: ctx.requestCorrelationId ?? randomUUID(),
    pageCounters: new Map(),
  }
  return storage.run(stored, fn)
}

export function currentCallContext(): CallContext | undefined {
  const ctx = storage.getStore()
  if (!ctx) {
    return undefined
  }
  return { trigger: ctx.trigger, webhookEventId: ctx.webhookEventId, requestCorrelationId: ctx.requestCorrelationId }
}

// `undefined` fora de qualquer `runWithCallContext` — quem chama decide o que fazer (D24: paginação
// numérica não usa isto, só a cursor-based).
export function nextPageOrdinal(operation: string, resourceId: string): number | undefined {
  const ctx = storage.getStore()
  if (!ctx) {
    return undefined
  }
  const key = `${operation}:${resourceId}`
  const next = (ctx.pageCounters.get(key) ?? 0) + 1
  ctx.pageCounters.set(key, next)
  return next
}
