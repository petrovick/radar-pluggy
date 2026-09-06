import { randomUUID } from 'node:crypto'
import { Decimal } from 'decimal.js'
import SequelizeLib, { type Transaction } from 'sequelize'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import SyncPluggyPositionImpl from '../../../../src/adapters/gateways/pluggy-position/sync-pluggy-position.impl.js'
import { PluggyPositionRep } from '../../../../src/adapters/repositories/pluggy-position.rep.js'
import { PluggyPositionSnapshotRep } from '../../../../src/adapters/repositories/pluggy-position-snapshot.rep.js'
import { PluggyPositionRawRep } from '../../../../src/adapters/repositories/pluggy-position-raw.rep.js'
import { PluggyLoanRep } from '../../../../src/adapters/repositories/pluggy-loan.rep.js'
import { PluggyLoanSnapshotRep } from '../../../../src/adapters/repositories/pluggy-loan-snapshot.rep.js'
import { PluggyLoanRawRep } from '../../../../src/adapters/repositories/pluggy-loan-raw.rep.js'
import { PluggyConsentRep } from '../../../../src/adapters/repositories/pluggy-consent.rep.js'
import { PluggyConsentRawRep } from '../../../../src/adapters/repositories/pluggy-consent-raw.rep.js'
import { PluggyItemRep } from '../../../../src/adapters/repositories/pluggy-item.rep.js'
import { PluggyItemRawRep } from '../../../../src/adapters/repositories/pluggy-item-raw.rep.js'
import { createDatabaseConnection } from '../../../../src/infra/db/database.js'
import { testDatabaseConfig } from '../../../support/test-database-config.js'
import { DB_NAMES } from '../../../../src/infra/db/models.js'
import { definePluggyPositionModel } from '../../../../src/infra/db/models/pluggy-position-model.js'
import { definePluggyPositionSnapshotModel } from '../../../../src/infra/db/models/pluggy-position-snapshot-model.js'
import { definePluggyPositionRawModel } from '../../../../src/infra/db/models/pluggy-position-raw-model.js'
import { definePluggyLoanModel } from '../../../../src/infra/db/models/pluggy-loan-model.js'
import { definePluggyLoanSnapshotModel } from '../../../../src/infra/db/models/pluggy-loan-snapshot-model.js'
import { definePluggyLoanRawModel } from '../../../../src/infra/db/models/pluggy-loan-raw-model.js'
import { definePluggyConsentModel } from '../../../../src/infra/db/models/pluggy-consent-model.js'
import { definePluggyConsentRawModel } from '../../../../src/infra/db/models/pluggy-consent-raw-model.js'
import { definePluggyItemModel } from '../../../../src/infra/db/models/pluggy-item-model.js'
import { definePluggyItemRawModel } from '../../../../src/infra/db/models/pluggy-item-raw-model.js'
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
  const positionRawModel = definePluggyPositionRawModel(sequelize)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const cols = await queryInterface.describeTable('pluggy_connector_positions')
    if (!cols.due_date) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../../src/infra/db/migrations/20260906180000-adicionar-campos-completos-em-pluggy-connector-positions.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_position_raw')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const rawMigration = require('../../../../src/infra/db/migrations/20260906181200-criar-pluggy-connector-position-raw.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await rawMigration.up(queryInterface, Sequelize)
    }
  })

  // Mesmo detentor de transação por escopo que `infra/bootstrap/scope.ts` registra em produção.
  function buildContainer(snapshotRepOverride?: { save: () => Promise<never> }) {
    const transactions = new Map<string, Transaction | null>()

    const container = {
      db: {
        Sequelize: SequelizeLib,
        connections: { [DB_NAMES.MAIN]: sequelize },
        models: { pluggyPosition: positionModel, pluggyPositionSnapshot: snapshotModel, pluggyPositionRaw: positionRawModel },
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
    mutable.pluggyPositionRawRep = new PluggyPositionRawRep(container)

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
      issuerCnpj: undefined,
      number: undefined,
      amountWithdrawal: undefined,
      amountProfit: undefined,
      dueDate: undefined,
      issuer: undefined,
      issueDate: undefined,
      purchaseDate: undefined,
      rate: undefined,
      rateType: undefined,
      fixedAnnualRate: undefined,
      lastMonthRate: undefined,
      annualRate: undefined,
      lastTwelveMonthsRate: undefined,
      owner: undefined,
      metadata: undefined,
      raw: {},
    }
  }

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await positionModel.destroy({ where: { item_id: itemId } })
      await snapshotModel.destroy({ where: { item_id: itemId } })
      await positionRawModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('grava fotografia, snapshot e log bruto na mesma unidade, todos visíveis depois do commit', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(buildContainer())
    await impl.savePositionsWithSnapshots([investment(itemId, investmentId)], new Date())

    expect(await positionModel.count({ where: { item_id: itemId } })).toBe(1)
    expect(await snapshotModel.count({ where: { item_id: itemId } })).toBe(1)
    expect(await positionRawModel.count({ where: { item_id: itemId } })).toBe(1)
  })

  it('falha ao gravar o snapshot desfaz a fotografia e o log bruto da mesma sincronização (D11)', async () => {
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
    expect(await positionRawModel.count({ where: { item_id: itemId } })).toBe(0)
  })

  // Change pluggy-complete-data-capture, spec pluggy-raw-payload-audit: log é append-only, sem
  // chave de unicidade — duas capturas idênticas geram duas linhas, nunca deduplicam.
  it('duas sincronizações sem mudança geram duas linhas no log bruto', async () => {
    const itemId = randomUUID()
    const investmentId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(buildContainer())
    await impl.savePositionsWithSnapshots([investment(itemId, investmentId)], new Date())
    await impl.savePositionsWithSnapshots([investment(itemId, investmentId)], new Date())

    expect(await positionModel.count({ where: { item_id: itemId } })).toBe(1)
    expect(await positionRawModel.count({ where: { item_id: itemId } })).toBe(2)
  })
})

// Mesma disciplina de D11, agora para o lado passivo (empréstimo): transação própria, aberta e
// comitada dentro de `saveLoansWithSnapshots`, sem relação com a transação de investimentos (são
// chamadas em sequência, cada uma sua própria unidade atômica — ver comentário no impl).
describe('SyncPluggyPositionImpl.saveLoansWithSnapshots', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const loanModel = definePluggyLoanModel(sequelize)
  const loanSnapshotModel = definePluggyLoanSnapshotModel(sequelize)
  const loanRawModel = definePluggyLoanRawModel(sequelize)
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
    if (!tables.includes('pluggy_connector_loan_raw')) {
      const migration = require('../../../../src/infra/db/migrations/20260906181600-criar-pluggy-connector-loan-raw.cjs') as {
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
        models: { pluggyLoan: loanModel, pluggyLoanSnapshot: loanSnapshotModel, pluggyLoanRaw: loanRawModel },
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
    mutable.pluggyLoanRawRep = new PluggyLoanRawRep(container)

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
      ipocCode: undefined,
      disbursementDates: undefined,
      firstInstallmentDueDate: undefined,
      cet: undefined,
      installmentPeriodicity: undefined,
      installmentPeriodicityAdditionalInfo: undefined,
      amortizationScheduled: undefined,
      amortizationScheduledAdditionalInfo: undefined,
      cnpjConsignee: undefined,
      interestRates: undefined,
      contractedFees: undefined,
      contractedFinanceCharges: undefined,
      warranties: undefined,
      installments: undefined,
      payments: undefined,
      raw: {},
    }
  }

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await loanModel.destroy({ where: { item_id: itemId } })
      await loanSnapshotModel.destroy({ where: { item_id: itemId } })
      await loanRawModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('grava fotografia, snapshot e log bruto de empréstimo na mesma unidade, todos visíveis depois do commit', async () => {
    const itemId = randomUUID()
    const loanId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(buildContainer())
    await impl.saveLoansWithSnapshots([loan(itemId, loanId)], new Date())

    expect(await loanModel.count({ where: { item_id: itemId } })).toBe(1)
    expect(await loanSnapshotModel.count({ where: { item_id: itemId } })).toBe(1)
    expect(await loanRawModel.count({ where: { item_id: itemId } })).toBe(1)
  })

  it('falha ao gravar o snapshot desfaz a fotografia e o log bruto do empréstimo da mesma sincronização', async () => {
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
    expect(await loanRawModel.count({ where: { item_id: itemId } })).toBe(0)
  })
})

// `saveConsentStatus` não tinha transação própria antes desta change (change
// pluggy-complete-data-capture) — é o ponto de maior risco de fiação errada, por isso precisa de
// teste com transação real, não só do mock total usado no teste do interactor.
describe('SyncPluggyPositionImpl.saveConsentStatus', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const consentModel = definePluggyConsentModel(sequelize)
  const consentRawModel = definePluggyConsentRawModel(sequelize)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const cols = await queryInterface.describeTable('pluggy_connector_consents')
    if (!cols.products) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const migration = require('../../../../src/infra/db/migrations/20260906180300-adicionar-escopo-em-pluggy-connector-consents.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await migration.up(queryInterface, Sequelize)
    }
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_consent_raw')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const rawMigration = require('../../../../src/infra/db/migrations/20260906181100-criar-pluggy-connector-consent-raw.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await rawMigration.up(queryInterface, Sequelize)
    }
  })

  function buildContainer(rawRepOverride?: { save: () => Promise<never> }) {
    const transactions = new Map<string, Transaction | null>()

    const container = {
      db: {
        Sequelize: SequelizeLib,
        connections: { [DB_NAMES.MAIN]: sequelize },
        models: { pluggyConsent: consentModel, pluggyConsentRaw: consentRawModel },
      },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: (name: string) => transactions.get(name) ?? null,
      setTransaction: (name: string, transaction: Transaction | null) => {
        transactions.set(name, transaction)
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggyConsentRep = new PluggyConsentRep(container)
    mutable.pluggyConsentRawRep = rawRepOverride ?? new PluggyConsentRawRep(container)

    return container
  }

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await consentModel.destroy({ where: { item_id: itemId } })
      await consentRawModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('grava consentimento e log bruto na mesma unidade', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(buildContainer())
    await impl.saveConsentStatus(itemId, {
      kind: 'ACTIVE',
      consentId: randomUUID(),
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: undefined,
      revokedAt: undefined,
      products: ['ACCOUNTS'],
      openFinancePermissionsGranted: ['ACCOUNTS_READ'],
      raw: { id: 'consent-1' },
    })

    expect(await consentModel.count({ where: { item_id: itemId } })).toBe(1)
    expect(await consentRawModel.count({ where: { item_id: itemId } })).toBe(1)
  })

  it('falha ao gravar o log bruto desfaz o consentimento da mesma chamada', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(
      buildContainer({
        save: async () => {
          throw new ApplicationError('PLUGGY_CONSENT_RAW_WRITE_FAILED', { itemId })
        },
      }),
    )

    await expect(
      impl.saveConsentStatus(itemId, {
        kind: 'ACTIVE',
        consentId: randomUUID(),
        grantedAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: undefined,
        revokedAt: undefined,
        products: undefined,
        openFinancePermissionsGranted: undefined,
        raw: { id: 'consent-1' },
      }),
    ).rejects.toBeInstanceOf(ApplicationError)

    expect(await consentModel.count({ where: { item_id: itemId } })).toBe(0)
    expect(await consentRawModel.count({ where: { item_id: itemId } })).toBe(0)
  })
})

// `saveSyncedItemState` não tinha transação própria antes desta change — mesmo motivo do bloco
// acima, agora para o item.
describe('SyncPluggyPositionImpl.saveSyncedItemState', () => {
  const sequelize = createDatabaseConnection(testDatabaseConfig())
  const itemModel = definePluggyItemModel(sequelize)
  const itemRawModel = definePluggyItemRawModel(sequelize)
  const itemIdsToCleanup: string[] = []

  beforeAll(async () => {
    const queryInterface = sequelize.getQueryInterface()
    const tables = await queryInterface.showAllTables()
    if (!tables.includes('pluggy_connector_item_raw')) {
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.url)
      const { Sequelize } = await import('sequelize')
      const rawMigration = require('../../../../src/infra/db/migrations/20260906181000-criar-pluggy-connector-item-raw.cjs') as {
        up: (queryInterface: unknown, sequelizeLib: typeof Sequelize) => Promise<void>
      }
      await rawMigration.up(queryInterface, Sequelize)
    }
  })

  function buildContainer(personId: number, rawRepOverride?: { save: () => Promise<never> }) {
    const transactions = new Map<string, Transaction | null>()

    const container = {
      db: {
        Sequelize: SequelizeLib,
        connections: { [DB_NAMES.MAIN]: sequelize },
        models: { pluggyItem: itemModel, pluggyItemRaw: itemRawModel },
      },
      logger: { addContext: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      getTransaction: (name: string) => transactions.get(name) ?? null,
      setTransaction: (name: string, transaction: Transaction | null) => {
        transactions.set(name, transaction)
      },
      pluggyItemCredentialResolver: {
        credentialFor: async () => ({ getPersonId: () => personId }),
      },
    } as unknown as AppContainer

    const mutable = container as unknown as Record<string, unknown>
    mutable.pluggyItemRep = new PluggyItemRep(container)
    mutable.pluggyItemRawRep = rawRepOverride ?? new PluggyItemRawRep(container)

    return container
  }

  afterEach(async () => {
    const itemId = itemIdsToCleanup.pop()
    if (itemId !== undefined) {
      await itemModel.destroy({ where: { item_id: itemId } })
      await itemRawModel.destroy({ where: { item_id: itemId } })
    }
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('grava item e log bruto na mesma unidade', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(buildContainer(1))
    await impl.saveSyncedItemState({
      itemId,
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      lastUpdatedAt: new Date('2026-09-03T04:40:14.026Z'),
      raw: { status: 'UPDATED' },
    })

    expect(await itemModel.count({ where: { item_id: itemId } })).toBe(1)
    expect(await itemRawModel.count({ where: { item_id: itemId } })).toBe(1)
  })

  it('falha ao gravar o log bruto desfaz o item da mesma chamada', async () => {
    const itemId = randomUUID()
    itemIdsToCleanup.push(itemId)

    const impl = new SyncPluggyPositionImpl(
      buildContainer(1, {
        save: async () => {
          throw new ApplicationError('PLUGGY_ITEM_RAW_WRITE_FAILED', { itemId })
        },
      }),
    )

    await expect(
      impl.saveSyncedItemState({
        itemId,
        status: 'UPDATED',
        executionStatus: 'SUCCESS',
        lastUpdatedAt: new Date('2026-09-03T04:40:14.026Z'),
        raw: { status: 'UPDATED' },
      }),
    ).rejects.toBeInstanceOf(ApplicationError)

    expect(await itemModel.count({ where: { item_id: itemId } })).toBe(0)
    expect(await itemRawModel.count({ where: { item_id: itemId } })).toBe(0)
  })
})
