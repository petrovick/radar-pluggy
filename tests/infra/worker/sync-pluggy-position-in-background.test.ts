import { describe, expect, it } from 'vitest'
import { syncPluggyPositionInBackground } from '../../../src/infra/worker/sync-pluggy-position-in-background.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../src/shared/application-error.js'

// Mesma disciplina de teste de `webhook-drainer.test.ts`: o container fake só precisa suportar
// `createScope()` (usado pelo `createScope` real de `scope.ts`) e `resolve('logger'|'syncPluggyPositionInteractor')`.
function buildContainer(execute: () => Promise<{ error?: ApplicationError }>) {
  const scope = {
    register: () => {},
    resolve: (key: string) => {
      if (key === 'logger') {
        return { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} }
      }
      return { execute }
    },
  }
  return { createScope: () => scope } as unknown as AppContainerInstance
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('syncPluggyPositionInBackground', () => {
  it('nunca lança de forma síncrona — devolve antes de a promise interna resolver', () => {
    const container = buildContainer(async () => ({}))

    expect(() => syncPluggyPositionInBackground(container, 'item-1', () => {})).not.toThrow()
  })

  it('sucesso não chama onError', async () => {
    const container = buildContainer(async () => ({}))
    const errors: unknown[] = []

    syncPluggyPositionInBackground(container, 'item-1', (err) => errors.push(err))
    await flushMicrotasks()

    expect(errors).toEqual([])
  })

  it('erro de negócio do interactor chama onError com o ApplicationError', async () => {
    const error = new ApplicationError('PLUGGY_CONSENT_REVOKED', { itemId: 'item-1' })
    const container = buildContainer(async () => ({ error }))
    const errors: unknown[] = []

    syncPluggyPositionInBackground(container, 'item-1', (err) => errors.push(err))
    await flushMicrotasks()

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

    syncPluggyPositionInBackground(container, 'item-1', (err) => errors.push(err))
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

    expect(() => syncPluggyPositionInBackground(container, 'item-1', (err) => errors.push(err))).not.toThrow()
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

    syncPluggyPositionInBackground(container, 'item-1', () => {})
    syncPluggyPositionInBackground(container, 'item-2', () => {})
    await flushMicrotasks()

    expect(scopesCreated).toBe(2)
  })
})
