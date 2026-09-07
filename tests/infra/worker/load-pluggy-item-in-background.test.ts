import { describe, expect, it } from 'vitest'
import { loadPluggyItemInBackground } from '../../../src/infra/worker/load-pluggy-item-in-background.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

// Mesma disciplina de teste de `sync-pluggy-position-in-background.test.ts`: o container fake só
// precisa suportar `createScope()` e `resolve('logger'|'syncPluggyPositionInteractor'|'loadPluggyHistoryInteractor')`.
function buildContainer(
  syncPosition: () => Promise<{ error?: ApplicationError }>,
  loadHistory: () => Promise<{ error?: ApplicationError }>,
) {
  const calls: string[] = []
  const scope = {
    register: () => {},
    resolve: (key: string) => {
      if (key === 'logger') {
        return { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} }
      }
      if (key === 'syncPluggyPositionInteractor') {
        return {
          execute: async (input: unknown) => {
            calls.push('sync')
            expect(input).toEqual({ itemId: 'item-1' })
            return syncPosition()
          },
        }
      }
      if (key === 'loadPluggyHistoryInteractor') {
        return {
          execute: async (input: unknown) => {
            calls.push('history')
            expect(input).toEqual({ origin: 'USER', personId: 7, itemId: 'item-1' })
            return loadHistory()
          },
        }
      }
      throw new Error(`chave inesperada: ${key}`)
    },
  }
  const container = { createScope: () => scope } as unknown as AppContainerInstance
  return { container, calls }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('loadPluggyItemInBackground', () => {
  it('nunca lança de forma síncrona — devolve antes de as promises internas resolverem', () => {
    const { container } = buildContainer(
      async () => ({}),
      async () => ({}),
    )

    expect(() => loadPluggyItemInBackground(container, 7, 'item-1', () => {})).not.toThrow()
  })

  it('sucesso sincroniza posição e só então carrega histórico, sem chamar onError', async () => {
    const { container, calls } = buildContainer(
      async () => ({}),
      async () => ({}),
    )
    const errors: unknown[] = []

    loadPluggyItemInBackground(container, 7, 'item-1', (err) => errors.push(err))
    await flushMicrotasks()

    expect(calls).toEqual(['sync', 'history'])
    expect(errors).toEqual([])
  })

  it('posição com erro chama onError e nunca chega a carregar histórico', async () => {
    const error = new ApplicationError('PLUGGY_CONSENT_REVOKED', { itemId: 'item-1' })
    const { container, calls } = buildContainer(
      async () => ({ error }),
      async () => ({}),
    )
    const errors: unknown[] = []

    loadPluggyItemInBackground(container, 7, 'item-1', (err) => errors.push(err))
    await flushMicrotasks()

    expect(calls).toEqual(['sync'])
    expect(errors).toEqual([error])
  })

  it('histórico com erro chama onError, depois de a posição ter sido sincronizada', async () => {
    const error = new ApplicationError('PLUGGY_ITEM_UNAUTHORIZED', { itemId: 'item-1' })
    const { container, calls } = buildContainer(
      async () => ({}),
      async () => ({ error }),
    )
    const errors: unknown[] = []

    loadPluggyItemInBackground(container, 7, 'item-1', (err) => errors.push(err))
    await flushMicrotasks()

    expect(calls).toEqual(['sync', 'history'])
    expect(errors).toEqual([error])
  })

  it('rejeição da promise (falha inesperada) também chama onError, nunca escapa como unhandled rejection', async () => {
    const container = {
      createScope: () => ({
        register: () => {},
        resolve: (key: string) => {
          if (key === 'logger') return { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} }
          return { execute: async () => Promise.reject(new Error('conexão caiu')) }
        },
      }),
    } as unknown as AppContainerInstance
    const errors: unknown[] = []

    loadPluggyItemInBackground(container, 7, 'item-1', (err) => errors.push(err))
    await flushMicrotasks()

    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('conexão caiu')
  })

  it('falha síncrona ao criar o escopo/resolver o interactor chama onError, nunca lança', () => {
    const container = {
      createScope: () => {
        throw new Error('container quebrado')
      },
    } as unknown as AppContainerInstance
    const errors: unknown[] = []

    expect(() => loadPluggyItemInBackground(container, 7, 'item-1', (err) => errors.push(err))).not.toThrow()
    expect(errors).toHaveLength(1)
  })

  it('cria um escopo próprio a cada chamada — nunca reaproveita um já existente', async () => {
    let scopesCreated = 0
    const container = {
      createScope: () => {
        scopesCreated++
        return {
          register: () => {},
          resolve: (key: string) => {
            if (key === 'logger') return { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} }
            return { execute: async () => ({}) }
          },
        }
      },
    } as unknown as AppContainerInstance

    loadPluggyItemInBackground(container, 7, 'item-1', () => {})
    loadPluggyItemInBackground(container, 7, 'item-2', () => {})
    await flushMicrotasks()

    expect(scopesCreated).toBe(2)
  })
})
