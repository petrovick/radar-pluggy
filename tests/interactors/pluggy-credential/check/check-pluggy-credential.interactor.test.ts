import { describe, expect, it, vi } from 'vitest'
import { CheckPluggyCredentialInteractor } from '../../../../src/interactors/pluggy-credential/check/check-pluggy-credential.interactor.js'
import type {
  CheckPluggyCredentialGateway,
  LinkedItemView,
} from '../../../../src/interactors/pluggy-credential/check/check-pluggy-credential.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

const ALL_PRODUCTS = ['ACCOUNTS', 'TRANSACTIONS', 'INVESTMENTS', 'INVESTMENTS_TRANSACTIONS', 'LOANS']

function linkedItem(overrides: Partial<LinkedItemView> = {}): LinkedItemView {
  return {
    itemId: 'item-1',
    connectorId: 201,
    connectorName: 'Banco Exemplo',
    connectorImageUrl: undefined,
    connectorPrimaryColor: undefined,
    connectorProducts: ALL_PRODUCTS,
    inactiveAt: undefined,
    observation: {
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      statusDetail: undefined,
      itemProducts: ALL_PRODUCTS,
      lastUpdatedAt: '2026-09-03T04:40:14.026Z',
      nextAutoSyncAt: undefined,
    },
    ...overrides,
  }
}

function buildGateway(overrides: Partial<CheckPluggyCredentialGateway> = {}): CheckPluggyCredentialGateway {
  return {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    readCredentialIds: vi.fn().mockResolvedValue([1]),
    readLinkedItems: vi.fn().mockResolvedValue([linkedItem()]),
    ...overrides,
  }
}

function buildInteractor(gateway: CheckPluggyCredentialGateway): CheckPluggyCredentialInteractor {
  return new CheckPluggyCredentialInteractor({
    checkPluggyCredentialImpl: gateway,
  } as unknown as AppContainer)
}

describe('CheckPluggyCredentialInteractor', () => {
  it('não recusa quando a pessoa tem credencial com ao menos um item vinculado', async () => {
    const gateway = buildGateway({
      readCredentialIds: vi.fn().mockResolvedValue([1, 2]),
      readLinkedItems: vi.fn().mockResolvedValue([linkedItem({ itemId: 'item-1' }), linkedItem({ itemId: 'item-2' })]),
    })

    const { data, error } = await buildInteractor(gateway).execute({ personId: 5 })

    expect(gateway.readCredentialIds).toHaveBeenCalledWith(5)
    expect(gateway.readLinkedItems).toHaveBeenCalledWith([1, 2])
    expect(error).toBeUndefined()
    expect(data?.items.map((item) => item.itemId)).toEqual(['item-1', 'item-2'])
  })

  it('recusa nomeando a pessoa quando ela não tem nenhuma credencial cadastrada', async () => {
    const gateway = buildGateway({ readCredentialIds: vi.fn().mockResolvedValue([]) })

    const { data, error } = await buildInteractor(gateway).execute({ personId: 9 })

    expect(data).toBeUndefined()
    expect(error).toBeInstanceOf(ApplicationError)
    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_NOT_FOUND_FOR_PERSON')
    expect(error?.details).toMatchObject({ personId: 9 })
    // A segunda leitura nem acontece: "sem credencial" já é resposta final.
    expect(gateway.readLinkedItems).not.toHaveBeenCalled()
  })

  it('recusa com outro errorType quando ela tem credencial mas nenhum itemId associado', async () => {
    const gateway = buildGateway({ readLinkedItems: vi.fn().mockResolvedValue([]) })

    const { data, error } = await buildInteractor(gateway).execute({ personId: 9 })

    expect(data).toBeUndefined()
    // As duas ausências são distinguíveis de propósito: quem chama precisa saber se falta cadastrar
    // credencial ou se falta vincular item a uma credencial que já existe.
    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_ITEM_ID_NOT_FOUND_FOR_PERSON')
    expect(error?.details).toMatchObject({ personId: 9 })
  })

  it('erro inesperado vira recusa nomeada, nunca escapa por throw', async () => {
    const gateway = buildGateway({
      readCredentialIds: vi.fn().mockRejectedValue(new Error('conexão caiu')),
    })

    const { error } = await buildInteractor(gateway).execute({ personId: 9 })

    expect(error?.errorType).toBe('PLUGGY_CREDENTIAL_CHECK_FAILED')
  })

  it('spec pluggy-credentials: pessoa com itens em estados diferentes devolve os dois, cada um com seu connectionStatus', async () => {
    const gateway = buildGateway({
      readLinkedItems: vi.fn().mockResolvedValue([
        linkedItem({ itemId: 'item-saudavel', observation: { status: 'UPDATED', executionStatus: 'SUCCESS', statusDetail: undefined, itemProducts: ALL_PRODUCTS, lastUpdatedAt: '2026-09-03T00:00:00.000Z', nextAutoSyncAt: undefined } }),
        linkedItem({ itemId: 'item-precisa-reconectar', observation: { status: 'LOGIN_ERROR', executionStatus: 'ERROR', statusDetail: undefined, itemProducts: ALL_PRODUCTS, lastUpdatedAt: undefined, nextAutoSyncAt: undefined } }),
      ]),
    })

    const { data } = await buildInteractor(gateway).execute({ personId: 5 })

    expect(data?.items).toHaveLength(2)
    expect(data?.items.find((i) => i.itemId === 'item-saudavel')?.connectionStatus).toBe('CONNECTED')
    expect(data?.items.find((i) => i.itemId === 'item-precisa-reconectar')?.connectionStatus).toBe('NEEDS_RECONNECT')
  })

  it('spec pluggy-credentials: item parcial não contamina fonte saudável com o alerta de outra', async () => {
    const gateway = buildGateway({
      readLinkedItems: vi.fn().mockResolvedValue([
        linkedItem({
          observation: {
            status: 'UPDATED',
            executionStatus: 'PARTIAL_SUCCESS',
            statusDetail: {
              accounts: { isUpdated: false, lastUpdatedAt: undefined, warnings: [] },
              investments: { isUpdated: true, lastUpdatedAt: '2026-09-05T00:00:00.000Z', warnings: [] },
            },
            itemProducts: ALL_PRODUCTS,
            lastUpdatedAt: undefined,
            nextAutoSyncAt: undefined,
          },
        }),
      ]),
    })

    const { data } = await buildInteractor(gateway).execute({ personId: 5 })

    const sources = data?.items[0]?.sources
    expect(sources?.accounts).toEqual({ supportedByConnector: true, enabledForItem: true, isUpdated: false })
    expect(sources?.investments).toEqual({
      supportedByConnector: true,
      enabledForItem: true,
      isUpdated: true,
      lastUpdatedAt: '2026-09-05T00:00:00.000Z',
    })
  })

  it('spec pluggy-credentials: fonte suportada pelo connector mas não habilitada para o Item nunca aparece elegível', async () => {
    const gateway = buildGateway({
      readLinkedItems: vi.fn().mockResolvedValue([
        linkedItem({
          connectorProducts: ALL_PRODUCTS,
          observation: {
            status: 'UPDATED',
            executionStatus: 'SUCCESS',
            statusDetail: undefined,
            itemProducts: ['ACCOUNTS', 'TRANSACTIONS'],
            lastUpdatedAt: '2026-09-03T00:00:00.000Z',
            nextAutoSyncAt: undefined,
          },
        }),
      ]),
    })

    const { data } = await buildInteractor(gateway).execute({ personId: 5 })

    expect(data?.items[0]?.sources.investments).toEqual({ supportedByConnector: true, enabledForItem: false })
  })

  it('spec pluggy-credentials: fonte não suportada pelo connector aparece marcada como tal, sem mais nada', async () => {
    const gateway = buildGateway({
      readLinkedItems: vi.fn().mockResolvedValue([linkedItem({ connectorProducts: ['ACCOUNTS', 'TRANSACTIONS'] })]),
    })

    const { data } = await buildInteractor(gateway).execute({ personId: 5 })

    expect(data?.items[0]?.sources.loans).toEqual({ supportedByConnector: false })
  })

  it('spec pluggy-credentials: habilitação do Item desconhecida (UNKNOWN) nunca vira habilitado por herança do connector', async () => {
    const gateway = buildGateway({
      readLinkedItems: vi.fn().mockResolvedValue([
        linkedItem({
          connectorProducts: ALL_PRODUCTS,
          observation: {
            status: 'UPDATED',
            executionStatus: 'SUCCESS',
            statusDetail: undefined,
            itemProducts: undefined,
            lastUpdatedAt: '2026-09-03T00:00:00.000Z',
            nextAutoSyncAt: undefined,
          },
        }),
      ]),
    })

    const { data } = await buildInteractor(gateway).execute({ personId: 5 })

    expect(data?.items[0]?.sources.investments).toEqual({ supportedByConnector: true })
  })

  it('spec pluggy-credentials: SUCCESS não exige statusDetail para responder o estado por fonte', async () => {
    const gateway = buildGateway({
      readLinkedItems: vi.fn().mockResolvedValue([
        linkedItem({
          observation: {
            status: 'UPDATED',
            executionStatus: 'SUCCESS',
            statusDetail: undefined,
            itemProducts: ALL_PRODUCTS,
            lastUpdatedAt: '2026-09-03T00:00:00.000Z',
            nextAutoSyncAt: undefined,
          },
        }),
      ]),
    })

    const { data } = await buildInteractor(gateway).execute({ personId: 5 })

    const sources = data?.items[0]?.sources
    expect(sources?.accounts).toEqual({
      supportedByConnector: true,
      enabledForItem: true,
      isUpdated: true,
      lastUpdatedAt: '2026-09-03T00:00:00.000Z',
    })
    expect(sources?.loans).toEqual({
      supportedByConnector: true,
      enabledForItem: true,
      isUpdated: true,
      lastUpdatedAt: '2026-09-03T00:00:00.000Z',
    })
  })

  it('spec pluggy-credentials: item removido pela Pluggy aparece DISCONNECTED', async () => {
    const gateway = buildGateway({
      readLinkedItems: vi.fn().mockResolvedValue([linkedItem({ inactiveAt: new Date('2026-09-06T00:00:00.000Z') })]),
    })

    const { data } = await buildInteractor(gateway).execute({ personId: 5 })

    expect(data?.items[0]?.connectionStatus).toBe('DISCONNECTED')
  })

  it('item vinculado mas nunca observado devolve UNKNOWN, sem inventar sources habilitadas', async () => {
    const gateway = buildGateway({
      readLinkedItems: vi.fn().mockResolvedValue([linkedItem({ observation: undefined })]),
    })

    const { data } = await buildInteractor(gateway).execute({ personId: 5 })

    expect(data?.items[0]?.connectionStatus).toBe('UNKNOWN')
    expect(data?.items[0]?.sources.accounts).toEqual({ supportedByConnector: true })
  })
})
