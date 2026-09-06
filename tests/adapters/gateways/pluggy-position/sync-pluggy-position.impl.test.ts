import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import SequelizeLib, { type Transaction } from 'sequelize'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import SyncPluggyPositionImpl from '../../../../src/adapters/gateways/pluggy-position/sync-pluggy-position.impl.js'
import { PluggyPositionRep } from '../../../../src/adapters/repositories/pluggy-position.rep.js'
import { PluggyPositionSnapshotRep } from '../../../../src/adapters/repositories/pluggy-position-snapshot.rep.js'
import { PluggyLoanRep } from '../../../../src/adapters/repositories/pluggy-loan.rep.js'
import { PluggyLoanSnapshotRep } from '../../../../src/adapters/repositories/pluggy-loan-snapshot.rep.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { DB_NAMES } from '../../../../src/infra/db/models.js'
import { definePluggyPositionModel } from '../../../../src/infra/db/models/pluggy-position-model.js'
import { definePluggyPositionSnapshotModel } from '../../../../src/infra/db/models/pluggy-position-snapshot-model.js'
import { definePluggyLoanModel } from '../../../../src/infra/db/models/pluggy-loan-model.js'
import { definePluggyLoanSnapshotModel } from '../../../../src/infra/db/models/pluggy-loan-snapshot-model.js'
import type { AppContainer } from '../../../../src/infra/bootstrap/register.js'
import type {
  PluggyInvestmentInput,
  PluggyLoanInput,
} from '../../../../src/interactors/pluggy-position/sync/sync-pluggy-position.types.js'
import { ApplicationError } from '../../../../src/shared/application-error.js'

// Requer MySQL alcançável — este é o teste que prova a atomicidade de D11 de verdade, com transação
// real: nenhum fake de transação demonstraria rollback. Foi a ausência deste teste que deixou passar
// a fotografia sendo gravada fora da transação.
describe('SyncPluggyPositionImpl.savePositionsWithSnapshots', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const positionModel = definePluggyPositionModel(sequelize)
  const snapshotModel = definePluggyPositionSnapshotModel(sequelize)
  const itemIdsToCleanup: string[] = []

  // Mesmo detentor de transação por escopo que `infra/bootstrap/scope.ts` registra em produção.
  function buildContainer(snapshotRepOverride?: { save: () => Promise<never> }) {
    const transactions = new Map<string, Transaction | null>()

    const container = {
      db: {
        Sequelize: SequelizeLib,
        connections: { [DB_NAMES.MAIN]: sequelize },
        models: { pluggyPosition: positionModel, pluggyPositionSnapshot: snapshotModel },
      },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: (name: string) => transactions.get(name) ?? null,
      setTransaction: (name: string, transaction: Transaction | null) => {
        transactions.set(name, transaction)
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggyPositionRep = new PluggyPositionRep(container)
    mutable.pluggyPositionSnapshotRep = snapshotRepOverride ?? new PluggyPositionSnapshotRep(container)

    return container
  }

  function investment(itemId: string, investmentId: string): PluggyInvestmentInput {
    return {
      investmentId,
      itemId,
      type: 'EQUITY',
      subtype: 'STOCK',
      name: 'VIVT3',
      code: 'VIVT3',
      isin: 'BRVIVTACNOR0',
      currencyCode: 'BRL',
      balance: new Decimal('304.50'),
      quantity: new Decimal('10'),
      amountOriginal: undefined,
      value: new Decimal('30.45'),
      amount: new Decimal('304.50'),
      status: 'ACTIVE',
      institutionName: undefined,
      institutionNumber: undefined,
      quotaDate: new Date('2026-09-03T03:00:00.000Z'),
    }
  }

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await positionModel.destroy({ where: { item_id: itemId } })
      await snapshotModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('grava fotografia e snapshot na mesma unidade, ambos visíveis depois do commit', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(buildContainer())
    await impl.savePositionsWithSnapshots([investment(itemId, investmentId)], new Date())

    expect(await positionModel.count({ where: { item_id: itemId } })).toBe(1)
    expect(await snapshotModel.count({ where: { item_id: itemId } })).toBe(1)
  })

  it('falha ao gravar o snapshot desfaz a fotografia da mesma sincronização (D11)', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(
      buildContainer({
        save: async () => {
          throw new ApplicationError('PLUGGY_POSITION_SNAPSHOT_WRITE_FAILED', { itemId })
        },
      }),
    )

    await expect(impl.savePositionsWithSnapshots([investment(itemId, investmentId)], new Date())).rejects.toBeInstanceOf(
      ApplicationError,
    )

    // A fotografia não pode ter sobrado: se este número for 1, a escrita aconteceu fora da transação.
    expect(await positionModel.count({ where: { item_id: itemId } })).toBe(0)
    expect(await snapshotModel.count({ where: { item_id: itemId } })).toBe(0)
  })
})

// Mesma disciplina de D11, agora para o lado passivo (empréstimo): transação própria, aberta e
// comitada dentro de `saveLoansWithSnapshots`, sem relação com a transação de investimentos (são
// chamadas em sequência, cada uma sua própria unidade atômica — ver comentário no impl).
describe('SyncPluggyPositionImpl.saveLoansWithSnapshots', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const loanModel = definePluggyLoanModel(sequelize)
  const loanSnapshotModel = definePluggyLoanSnapshotModel(sequelize)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const { Sequelize } = await import('sequelize')

    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_loans')) {
      const migration = require('../../../../src/infra/db/migrations/20260905100000-criar-pluggy-connector-loans.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
    if (!tables.includes('pluggy_connector_loan_snapshots')) {
      const migration = require('../../../../src/infra/db/migrations/20260905100100-criar-pluggy-connector-loan-snapshots.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
  })

  function buildContainer(snapshotRepOverride?: { save: () => Promise<never> }) {
    const transactions = new Map<string, Transaction | null>()

    const container = {
      db: {
        Sequelize: SequelizeLib,
        connections: { [DB_NAMES.MAIN]: sequelize },
        models: { pluggyLoan: loanModel, pluggyLoanSnapshot: loanSnapshotModel },
      },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: (name: string) => transactions.get(name) ?? null,
      setTransaction: (name: string, transaction: Transaction | null) => {
        transactions.set(name, transaction)
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggyLoanRep = new PluggyLoanRep(container)
    mutable.pluggyLoanSnapshotRep = snapshotRepOverride ?? new PluggyLoanSnapshotRep(container)

    return container
  }

  function loan(itemId: string, loanId: string): PluggyLoanInput {
    return {
      loanId,
      itemId,
      contractNumber: '12345',
      productName: 'Crédito Pessoal',
      type: 'CREDITO_PESSOAL_SEM_CONSIGNACAO',
      kind: 'LOAN',
      collectedAt: new Date('2026-09-03T03:00:00.000Z'),
      contractDate: new Date('2026-01-01T00:00:00.000Z'),
      settlementDate: undefined,
      contractAmount: new Decimal('10000.00'),
      currencyCode: 'BRL',
      dueDate: new Date('2028-01-01T00:00:00.000Z'),
      totalInstallments: 24,
      paidInstallments: 5,
      dueInstallments: 19,
      pastDueInstallments: 0,
      outstandingBalance: new Decimal('8000.00'),
    }
  }

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await loanModel.destroy({ where: { item_id: itemId } })
      await loanSnapshotModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('grava fotografia e snapshot de empréstimo na mesma unidade, ambos visíveis depois do commit', async () => {
    const itemId = randomUUID()
    const loanId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(buildContainer())
    await impl.saveLoansWithSnapshots([loan(itemId, loanId)], new Date())

    expect(await loanModel.count({ where: { item_id: itemId } })).toBe(1)
    expect(await loanSnapshotModel.count({ where: { item_id: itemId } })).toBe(1)
  })

  it('falha ao gravar o snapshot desfaz a fotografia do empréstimo da mesma sincronização', async () => {
    const itemId = randomUUID()
    const loanId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(
      buildContainer({
        save: async () => {
          throw new ApplicationError('PLUGGY_LOAN_SNAPSHOT_WRITE_FAILED', { itemId })
        },
      }),
    )

    await expect(impl.saveLoansWithSnapshots([loan(itemId, loanId)], new Date())).rejects.toBeInstanceOf(
      ApplicationError,
    )

    expect(await loanModel.count({ where: { item_id: itemId } })).toBe(0)
    expect(await loanSnapshotModel.count({ where: { item_id: itemId } })).toBe(0)
  })
})
