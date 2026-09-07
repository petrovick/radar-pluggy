import { describe, expect, it, vi } from 'vitest'
import { ReadPluggyAccountStatementInteractor } from '../../../../src/interactors/pluggy-account-transaction/read/read-pluggy-account-statement.interactor.js'
import type {
  PluggyCardStatementView,
  ReadPluggyAccountStatementGateway,
} from '../../../../src/interactors/pluggy-account-transaction/read/read-pluggy-account-statement.types.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

const BILL = { availableCreditLimit: '1000.00', creditLimit: '2000.00', minimumPayment: '150.00', dueDate: '2026-09-10T00:00:00.000Z' }
const TRANSACTION = {
  transactionId: 'txn-1',
  description: 'Loja Exemplo',
  amount: '-100.00',
  date: '2026-08-20T00:00:00.000Z',
  category: 'Compras',
  merchantName: 'Loja Exemplo',
  billForecastMonth: '2026-09',
  installment: null,
}

function buildGateway(overrides: Partial<ReadPluggyAccountStatementGateway> = {}): ReadPluggyAccountStatementGateway {
  return {
    addContext: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    assertAccountBelongsToPerson: vi.fn().mockResolvedValue(undefined),
    readBillSummary: vi.fn().mockResolvedValue(BILL),
    readTransactionsByBillMonth: vi.fn().mockResolvedValue([TRANSACTION]),
    ...overrides,
  }
}

function buildInteractor(gateway: ReadPluggyAccountStatementGateway): ReadPluggyAccountStatementInteractor {
  return new ReadPluggyAccountStatementInteractor({
    readPluggyAccountStatementImpl: gateway,
  } as unknown as AppContainer)
}

describe('ReadPluggyAccountStatementInteractor', () => {
  it('devolve bill + transações da fatura depois de confirmar que a conta é da pessoa', async () => {
    const gateway = buildGateway()

    const { data, error } = await buildInteractor(gateway).execute({
      personId: 5,
      accountId: 'acc-1',
      billMonth: '2026-09',
    })

    expect(gateway.assertAccountBelongsToPerson).toHaveBeenCalledWith('acc-1', 5)
    expect(gateway.readTransactionsByBillMonth).toHaveBeenCalledWith('acc-1', '2026-09')
    expect(error).toBeUndefined()
    expect(data).toEqual<PluggyCardStatementView>({ bill: BILL, transactions: [TRANSACTION] })
  })

  it('recusa billMonth fora do formato AAAA-MM antes de tocar o gateway', async () => {
    const gateway = buildGateway()

    const { error } = await buildInteractor(gateway).execute({
      personId: 5,
      accountId: 'acc-1',
      billMonth: '09/2026',
    })

    expect(error?.errorType).toBe('PLUGGY_ACCOUNT_STATEMENT_BILL_MONTH_INVALID')
    expect(gateway.assertAccountBelongsToPerson).not.toHaveBeenCalled()
  })

  it('conta de outra pessoa recusa antes de ler fatura ou transação', async () => {
    const gateway = buildGateway({
      assertAccountBelongsToPerson: vi.fn().mockRejectedValue(new ApplicationError('PLUGGY_ACCOUNT_UNAUTHORIZED', { accountId: 'acc-1' })),
    })

    const { error } = await buildInteractor(gateway).execute({ personId: 5, accountId: 'acc-1', billMonth: '2026-09' })

    expect(error?.errorType).toBe('PLUGGY_ACCOUNT_UNAUTHORIZED')
    expect(gateway.readBillSummary).not.toHaveBeenCalled()
    expect(gateway.readTransactionsByBillMonth).not.toHaveBeenCalled()
  })

  it('erro inesperado vira recusa nomeada, nunca escapa por throw', async () => {
    const gateway = buildGateway({
      readBillSummary: vi.fn().mockRejectedValue(new Error('conexão caiu')),
    })

    const { error } = await buildInteractor(gateway).execute({ personId: 5, accountId: 'acc-1', billMonth: '2026-09' })

    expect(error).toBeInstanceOf(ApplicationError)
    expect(error?.errorType).toBe('PLUGGY_ACCOUNT_STATEMENT_READ_FAILED')
  })
})
