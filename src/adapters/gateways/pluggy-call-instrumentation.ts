import { randomUUID } from 'node:crypto'
import type { PluggyCallOperation, PluggyCallScope } from '../../entities/pluggy-call.js'
import type { PluggyCallRecorder } from './pluggy-call-recorder.js'
import { classifyPluggyCallFailure } from './pluggy-client.gateway.js'
import { currentCallContext, nextPageOrdinal } from '../../infra/tools/call-context.js'

interface ExtractedCallInfo {
  resourceId: string | undefined
  pageOrdinal: number | undefined
  pageSize: number | undefined
}

interface OperationSpec {
  operation: PluggyCallOperation
  callScope: PluggyCallScope
  httpMethod: string
  routeTemplate: string
  resourceType: string | undefined
  // Cada método do SDK tem uma forma de argumento diferente (design.md D3: o primeiro argumento não
  // é uniformemente `itemId`) — uma função por operação é mais simples e mais correta que decifrar
  // índice/campo genericamente.
  extract: (args: unknown[]) => ExtractedCallInfo
}

function numberAt(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function stringAt(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function fieldOf(value: unknown, field: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[field] : undefined
}

// Tabela estática operação → metadado (design.md D3/D24), cobrindo os 8 gateways de borda e
// `fetchWebhook`/`createWebhook`/`updateWebhook` (D22). `resourceId`/`pageOrdinal`/`pageSize` são
// derivados dos argumentos reais de cada chamada — nunca do corpo de resposta.
const OPERATIONS: Record<string, OperationSpec> = {
  fetchItem: {
    operation: 'FETCH_ITEM',
    callScope: 'SNAPSHOT_READ',
    httpMethod: 'GET',
    routeTemplate: '/items/{id}',
    resourceType: 'ITEM',
    extract: (args) => ({ resourceId: stringAt(args[0]), pageOrdinal: undefined, pageSize: undefined }),
  },
  fetchInvestments: {
    operation: 'FETCH_INVESTMENTS',
    callScope: 'SNAPSHOT_READ',
    httpMethod: 'GET',
    routeTemplate: '/investments',
    resourceType: 'ITEM',
    extract: (args) => ({
      resourceId: stringAt(args[0]),
      pageOrdinal: numberAt(fieldOf(args[2], 'page')),
      pageSize: numberAt(fieldOf(args[2], 'pageSize')),
    }),
  },
  fetchLoans: {
    operation: 'FETCH_LOANS',
    callScope: 'SNAPSHOT_READ',
    httpMethod: 'GET',
    routeTemplate: '/loans',
    resourceType: 'ITEM',
    extract: (args) => ({
      resourceId: stringAt(args[0]),
      pageOrdinal: numberAt(fieldOf(args[1], 'page')),
      pageSize: numberAt(fieldOf(args[1], 'pageSize')),
    }),
  },
  fetchConsents: {
    operation: 'FETCH_CONSENTS',
    callScope: 'SNAPSHOT_READ',
    httpMethod: 'GET',
    routeTemplate: '/consents',
    resourceType: 'ITEM',
    extract: (args) => ({
      resourceId: stringAt(args[0]),
      pageOrdinal: numberAt(fieldOf(args[1], 'page')),
      pageSize: numberAt(fieldOf(args[1], 'pageSize')),
    }),
  },
  // Método próprio de `PluggyConnectorClient` (não do SDK cru) — estende `fetchAccounts` pra expor
  // paginação numérica de verdade.
  fetchAccountsPage: {
    operation: 'FETCH_ACCOUNTS',
    callScope: 'SNAPSHOT_READ',
    httpMethod: 'GET',
    routeTemplate: '/accounts',
    resourceType: 'ITEM',
    extract: (args) => ({ resourceId: stringAt(args[0]), pageOrdinal: numberAt(args[1]), pageSize: numberAt(args[2]) }),
  },
  // Cursor-based (design.md D24): nunca o cursor opaco da Pluggy — o ordinal é um contador local do
  // `CallContext`, particionado por operação + `accountId`.
  fetchTransactionsCursor: {
    operation: 'FETCH_ACCOUNT_TRANSACTIONS',
    callScope: 'SNAPSHOT_READ',
    httpMethod: 'GET',
    routeTemplate: '/transactions',
    resourceType: 'ACCOUNT',
    extract: (args) => {
      const resourceId = stringAt(args[0])
      return {
        resourceId,
        pageOrdinal: resourceId !== undefined ? nextPageOrdinal('FETCH_ACCOUNT_TRANSACTIONS', resourceId) : undefined,
        pageSize: numberAt(fieldOf(args[1], 'pageSize')),
      }
    },
  },
  fetchInvestmentTransactions: {
    operation: 'FETCH_INVESTMENT_TRANSACTIONS',
    callScope: 'SNAPSHOT_READ',
    httpMethod: 'GET',
    routeTemplate: '/investments/{id}/transactions',
    resourceType: 'INVESTMENT',
    extract: (args) => ({
      resourceId: stringAt(args[0]),
      pageOrdinal: numberAt(fieldOf(args[1], 'page')),
      pageSize: numberAt(fieldOf(args[1], 'pageSize')),
    }),
  },
  fetchWebhook: {
    operation: 'FETCH_WEBHOOKS',
    callScope: 'PLATFORM_CONFIG',
    httpMethod: 'GET',
    routeTemplate: '/webhooks/{id}',
    resourceType: 'WEBHOOK',
    extract: (args) => ({ resourceId: stringAt(args[0]), pageOrdinal: undefined, pageSize: undefined }),
  },
  createWebhook: {
    operation: 'CREATE_WEBHOOK',
    callScope: 'PLATFORM_CONFIG',
    httpMethod: 'POST',
    routeTemplate: '/webhooks',
    // Sem recurso natural: o webhook ainda não existe antes desta chamada criar.
    resourceType: undefined,
    extract: () => ({ resourceId: undefined, pageOrdinal: undefined, pageSize: undefined }),
  },
  updateWebhook: {
    operation: 'UPDATE_WEBHOOK',
    callScope: 'PLATFORM_CONFIG',
    httpMethod: 'PATCH',
    routeTemplate: '/webhooks/{id}',
    resourceType: 'WEBHOOK',
    extract: (args) => ({ resourceId: stringAt(args[0]), pageOrdinal: undefined, pageSize: undefined }),
  },
}

export interface InstrumentationTarget {
  itemId: string | undefined
  connectorId: number | undefined
}

// Embrulha `client` (cacheado ou `freshClient`) num Proxy de método (design.md D3): cada chamada
// instrumentada mede início/fim reais, classifica sucesso/falha (reaproveitando
// `classifyPluggyCallFailure`, D24) e grava via `recorder` — nunca aguardado (D25), nunca grava
// corpo de requisição/resposta, segredo ou cursor opaco. Método sem entrada na tabela passa direto,
// sem instrumentação (nunca quebra uma chamada por falta de metadado).
export function instrumentPluggyClient<T extends object>(client: T, target: InstrumentationTarget, recorder: PluggyCallRecorder): T {
  return new Proxy(client, {
    get(obj, prop, receiver) {
      const original = Reflect.get(obj, prop, receiver)
      if (typeof original !== 'function' || typeof prop !== 'string') {
        return original
      }
      const spec = OPERATIONS[prop]
      if (!spec) {
        return original
      }

      return function instrumented(this: unknown, ...args: unknown[]) {
        const startedAt = new Date()
        const info = spec.extract(args)
        const ctx = currentCallContext()

        const record = (
          outcome: 'SUCCEEDED' | 'FAILED',
          failure?: { failureKind: string | undefined; httpStatus: number | undefined; errorCode: string | undefined },
        ) => {
          recorder.record({
            itemId: target.itemId,
            connectorId: target.connectorId,
            operation: spec.operation,
            httpMethod: spec.httpMethod,
            routeTemplate: spec.routeTemplate,
            callScope: spec.callScope,
            trigger: ctx?.trigger ?? 'SYSTEM_INTERNAL',
            resourceType: spec.resourceType,
            resourceId: info.resourceId,
            requestCorrelationId: ctx?.requestCorrelationId ?? randomUUID(),
            webhookEventId: ctx?.webhookEventId,
            pageOrdinal: info.pageOrdinal,
            pageSize: info.pageSize,
            startedAt,
            completedAt: new Date(),
            httpStatus: failure?.httpStatus,
            outcome,
            failureKind: failure?.failureKind,
            errorCode: failure?.errorCode,
          })
        }

        let result: unknown
        try {
          result = (original as (...a: unknown[]) => unknown).apply(obj, args)
        } catch (error) {
          record('FAILED', classifyPluggyCallFailure(error))
          throw error
        }

        if (result instanceof Promise) {
          return result.then(
            (value: unknown) => {
              record('SUCCEEDED')
              return value
            },
            (error: unknown) => {
              record('FAILED', classifyPluggyCallFailure(error))
              throw error
            },
          )
        }

        record('SUCCEEDED')
        return result
      }
    },
  })
}
