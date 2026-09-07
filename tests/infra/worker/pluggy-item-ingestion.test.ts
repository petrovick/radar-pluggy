import { describe, expect, it, vi } from 'vitest'
import { runPluggyItemIngestion } from '../../../src/infra/worker/pluggy-item-ingestion.js'
import type { AppContainerInstance } from '../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../src/shared/application-error.js'
import { currentCallContext, runWithCallContext } from '../../../src/infra/tools/call-context.js'

type LeaseCalls = {
  tryAcquire: { itemId: string; trigger: string; ttlMs: number }[]
  renew: { itemId: string; fencingToken: number; ttlMs: number }[]
  release: { itemId: string; fencingToken: number }[]
}

function buildContainer(options: {
  tryAcquireReturns?: number | undefined
  positionExecute?: (input?: { leaseGuard?: { isLost(): boolean } }) => Promise<{ error?: ApplicationError }>
  historyExecute?: (input?: { leaseGuard?: { isLost(): boolean } }) => Promise<{ error?: ApplicationError }>
  renewImpl?: (itemId: string, fencingToken: number, ttlMs: number) => Promise<boolean>
  logCalls?: { level: string; message: string; extra?: unknown }[]
}): { container: AppContainerInstance; leaseCalls: LeaseCalls } {
  const leaseCalls: LeaseCalls = { tryAcquire: [], renew: [], release: [] }
  const leaseRep = {
    tryAcquire: async (itemId: string, trigger: string, ttlMs: number) => {
      leaseCalls.tryAcquire.push({ itemId, trigger, ttlMs })
      return options.tryAcquireReturns
    },
    renew: async (itemId: string, fencingToken: number, ttlMs: number) => {
      leaseCalls.renew.push({ itemId, fencingToken, ttlMs })
      return options.renewImpl ? options.renewImpl(itemId, fencingToken, ttlMs) : true
    },
    release: async (itemId: string, fencingToken: number) => {
      leaseCalls.release.push({ itemId, fencingToken })
      return true
    },
  }

  const scope = {
    register: () => {},
    resolve: (key: string) => {
      if (key === 'logger') {
        return {
          addContext: () => {},
          info: () => {},
          warn: (message: string, extra?: unknown) => options.logCalls?.push({ level: 'warn', message, extra }),
          error: () => {},
        }
      }
      if (key === 'pluggyItemIngestionLeaseRep') return leaseRep
      if (key === 'syncPluggyPositionInteractor') return { execute: options.positionExecute ?? (async () => ({})) }
      if (key === 'loadPluggyHistoryInteractor') return { execute: options.historyExecute ?? (async () => ({})) }
      throw new Error(`chave inesperada: ${key}`)
    },
  }

  const container = { createScope: () => scope } as unknown as AppContainerInstance
  return { container, leaseCalls }
}

describe('runPluggyItemIngestion', () => {
  it('lease ocupado: não executa Position nem History, devolve attempted false', async () => {
    const { container, leaseCalls } = buildContainer({ tryAcquireReturns: undefined })

    const result = await runPluggyItemIngestion(container, 'item-1', 'WEBHOOK')

    expect(result).toEqual({ attempted: false, positionOk: false, historyOk: false })
    expect(leaseCalls.release).toEqual([])
  })

  it('lease livre: adquire com o trigger recebido, executa os dois e libera com o mesmo fencing_token', async () => {
    const { container, leaseCalls } = buildContainer({ tryAcquireReturns: 7 })

    const result = await runPluggyItemIngestion(container, 'item-1', 'CREDENTIAL_REGISTRATION_PRELOAD')

    expect(result).toEqual({ attempted: true, positionOk: true, historyOk: true })
    expect(leaseCalls.tryAcquire).toEqual([{ itemId: 'item-1', trigger: 'CREDENTIAL_REGISTRATION_PRELOAD', ttlMs: 600_000 }])
    expect(leaseCalls.release).toEqual([{ itemId: 'item-1', fencingToken: 7 }])
  })

  it('preAcquiredFencingToken: nunca chama tryAcquire, usa o token recebido para liberar', async () => {
    const { container, leaseCalls } = buildContainer({ tryAcquireReturns: 999 })

    const result = await runPluggyItemIngestion(container, 'item-1', 'WEBHOOK', 42)

    expect(leaseCalls.tryAcquire).toEqual([])
    expect(result.attempted).toBe(true)
    expect(leaseCalls.release).toEqual([{ itemId: 'item-1', fencingToken: 42 }])
  })

  it('falha de posição não impede a carga de histórico (D15)', async () => {
    const error = new ApplicationError('PLUGGY_CONSENT_REVOKED', { itemId: 'item-1' })
    const { container } = buildContainer({ tryAcquireReturns: 1, positionExecute: async () => ({ error }) })

    const result = await runPluggyItemIngestion(container, 'item-1', 'WEBHOOK')

    expect(result).toEqual({ attempted: true, positionOk: false, historyOk: true })
  })

  it('falha de histórico não impede a sincronização de posição (D15)', async () => {
    const error = new ApplicationError('PLUGGY_HISTORY_LOAD_FAILED', { itemId: 'item-1' })
    const { container } = buildContainer({ tryAcquireReturns: 1, historyExecute: async () => ({ error }) })

    const result = await runPluggyItemIngestion(container, 'item-1', 'WEBHOOK')

    expect(result).toEqual({ attempted: true, positionOk: true, historyOk: false })
  })

  it('exceção inesperada de um lado ainda permite o outro rodar, e ainda assim libera o lease', async () => {
    const { container, leaseCalls } = buildContainer({
      tryAcquireReturns: 5,
      positionExecute: async () => {
        throw new Error('conexão caiu')
      },
    })

    const result = await runPluggyItemIngestion(container, 'item-1', 'WEBHOOK')

    expect(result).toEqual({ attempted: true, positionOk: false, historyOk: true })
    expect(leaseCalls.release).toEqual([{ itemId: 'item-1', fencingToken: 5 }])
  })

  it('renova o lease periodicamente enquanto o trabalho está em andamento, e para depois de concluir', async () => {
    vi.useFakeTimers()
    try {
      let resolveHistory: (() => void) | undefined
      const historyPromise = new Promise<{ error?: ApplicationError }>((resolve) => {
        resolveHistory = () => resolve({})
      })

      const { container, leaseCalls } = buildContainer({
        tryAcquireReturns: 3,
        historyExecute: () => historyPromise,
      })

      const ingestion = runPluggyItemIngestion(container, 'item-1', 'MANUAL_HISTORY_LOAD')

      // Período do heartbeat é ttl/3 = 200_000ms (ttl fixo de 600_000ms) — avança duas vezes.
      await vi.advanceTimersByTimeAsync(200_000)
      await vi.advanceTimersByTimeAsync(200_000)

      expect(leaseCalls.renew.length).toBeGreaterThanOrEqual(2)
      expect(leaseCalls.renew.every((call) => call.fencingToken === 3)).toBe(true)
      expect(leaseCalls.release).toEqual([])

      resolveHistory?.()
      await ingestion

      const renewedBeforeRelease = leaseCalls.renew.length
      await vi.advanceTimersByTimeAsync(400_000)

      expect(leaseCalls.release).toEqual([{ itemId: 'item-1', fencingToken: 3 }])
      // Depois de liberado, o heartbeat não deveria renovar mais.
      expect(leaseCalls.renew.length).toBe(renewedBeforeRelease)
    } finally {
      vi.useRealTimers()
    }
  })

  it('revisão PR #14: renew() === false marca o guard como perdido, logado com segurança', async () => {
    vi.useFakeTimers()
    try {
      let renewShouldSucceed = true
      let leaseGuardSeenByHistory: { isLost(): boolean } | undefined
      const logCalls: { level: string; message: string; extra?: unknown }[] = []

      let resolveHistory: (() => void) | undefined
      const historyPromise = new Promise<{ error?: ApplicationError }>((resolve) => {
        resolveHistory = () => resolve({})
      })

      const { container } = buildContainer({
        tryAcquireReturns: 3,
        renewImpl: async () => renewShouldSucceed,
        historyExecute: (input) => {
          leaseGuardSeenByHistory = input?.leaseGuard
          return historyPromise
        },
        logCalls,
      })

      const ingestion = runPluggyItemIngestion(container, 'item-1', 'MANUAL_HISTORY_LOAD')

      // Primeiro heartbeat renova normalmente.
      await vi.advanceTimersByTimeAsync(200_000)
      expect(leaseGuardSeenByHistory?.isLost()).toBe(false)

      // A partir daqui, outro trigger já assumiu o lease vencido — renew() passa a devolver false.
      renewShouldSucceed = false
      await vi.advanceTimersByTimeAsync(200_000)

      expect(leaseGuardSeenByHistory?.isLost()).toBe(true)
      expect(logCalls.some((call) => call.level === 'warn')).toBe(true)

      resolveHistory?.()
      await ingestion
    } finally {
      vi.useRealTimers()
    }
  })

  it('revisão PR #14: renew() que rejeita marca o guard como perdido, sem unhandled rejection', async () => {
    vi.useFakeTimers()
    try {
      let leaseGuardSeenByHistory: { isLost(): boolean } | undefined
      const logCalls: { level: string; message: string; extra?: unknown }[] = []

      let resolveHistory: (() => void) | undefined
      const historyPromise = new Promise<{ error?: ApplicationError }>((resolve) => {
        resolveHistory = () => resolve({})
      })

      const { container } = buildContainer({
        tryAcquireReturns: 3,
        renewImpl: async () => {
          throw new Error('conexão com o banco caiu')
        },
        historyExecute: (input) => {
          leaseGuardSeenByHistory = input?.leaseGuard
          return historyPromise
        },
        logCalls,
      })

      const ingestion = runPluggyItemIngestion(container, 'item-1', 'MANUAL_HISTORY_LOAD')

      // Se a rejeição escapasse sem tratamento, o processo de teste falharia com unhandled rejection.
      await vi.advanceTimersByTimeAsync(200_000)

      expect(leaseGuardSeenByHistory?.isLost()).toBe(true)
      expect(logCalls.some((call) => call.level === 'warn')).toBe(true)

      resolveHistory?.()
      await ingestion
    } finally {
      vi.useRealTimers()
    }
  })

  it('tasks.md 8.8: sem contexto ativo, abre um novo com o trigger recebido', async () => {
    let triggerSeen: string | undefined
    const { container } = buildContainer({
      tryAcquireReturns: 1,
      positionExecute: async () => {
        triggerSeen = currentCallContext()?.trigger
        return {}
      },
    })

    await runPluggyItemIngestion(container, 'item-1', 'CREDENTIAL_REGISTRATION_PRELOAD')

    expect(triggerSeen).toBe('CREDENTIAL_REGISTRATION_PRELOAD')
  })

  it('tasks.md 8.8: com contexto já ativo (drenador de webhook), reaproveita — nunca sobrepõe o webhookEventId', async () => {
    let contextSeen: { trigger: string | undefined; webhookEventId: string | undefined } | undefined
    const { container } = buildContainer({
      tryAcquireReturns: 1,
      positionExecute: async () => {
        const ctx = currentCallContext()
        contextSeen = { trigger: ctx?.trigger, webhookEventId: ctx?.webhookEventId }
        return {}
      },
    })

    await runWithCallContext({ trigger: 'WEBHOOK', webhookEventId: '99' }, () =>
      runPluggyItemIngestion(container, 'item-1', 'WEBHOOK'),
    )

    expect(contextSeen).toEqual({ trigger: 'WEBHOOK', webhookEventId: '99' })
  })
})
