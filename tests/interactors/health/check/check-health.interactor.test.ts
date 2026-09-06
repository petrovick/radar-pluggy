import { describe, expect, it, vi } from 'vitest'
import { CheckHealthInteractor } from '../../../../src/interactors/health/check/check-health.interactor.js'
import type { CheckHealthGateway } from '../../../../src/interactors/health/check/check-health.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

function buildGateway(overrides: Partial<CheckHealthGateway> = {}): CheckHealthGateway {
  return {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    checkDatabaseConnection: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function buildInteractor(gateway: CheckHealthGateway): CheckHealthInteractor {
  return new CheckHealthInteractor({ checkHealthImpl: gateway } as unknown as AppContainer)
}

describe('CheckHealthInteractor', () => {
  it('devolve running quando o banco responde', async () => {
    const gateway = buildGateway()

    const { data, error } = await buildInteractor(gateway).execute()

    expect(gateway.checkDatabaseConnection).toHaveBeenCalled()
    expect(error).toBeUndefined()
    expect(data).toEqual({ running: true })
  })

  it('banco indisponível recusa nomeado, nunca escapa por throw', async () => {
    const gateway = buildGateway({
      checkDatabaseConnection: vi.fn().mockRejectedValue(new Error('conexão recusada')),
    })

    const { data, error } = await buildInteractor(gateway).execute()

    expect(data).toBeUndefined()
    expect(error).toBeInstanceOf(ApplicationError)
    expect(error?.errorType).toBe('PLUGGY_CONNECTOR_DATABASE_UNAVAILABLE')
  })
})
