import SequelizeLib, { type Sequelize } from 'sequelize'
import { createDatabaseConnection } from './database.js'
import type { DatabaseConnectionConfig } from '../config/config.js'
import { definePersonModel } from './models/person-model.js'
import { definePluggyCredentialModel } from './models/pluggy-credential-model.js'
import { definePluggyCredentialItemModel } from './models/pluggy-credential-item-model.js'
import { definePluggyItemModel } from './models/pluggy-item-model.js'
import { definePluggyPositionModel } from './models/pluggy-position-model.js'
import { definePluggyPositionSnapshotModel } from './models/pluggy-position-snapshot-model.js'
import { definePluggyLoanModel } from './models/pluggy-loan-model.js'
import { definePluggyLoanSnapshotModel } from './models/pluggy-loan-snapshot-model.js'
import { definePluggyAccountModel } from './models/pluggy-account-model.js'
import { definePluggyAccountTransactionModel } from './models/pluggy-account-transaction-model.js'
import { definePluggyInvestmentTransactionModel } from './models/pluggy-investment-transaction-model.js'
import { definePluggyHistoryCoverageModel } from './models/pluggy-history-coverage-model.js'
import { definePluggySyncProgressModel } from './models/pluggy-sync-progress-model.js'
import { definePluggyWebhookEventModel } from './models/pluggy-webhook-event-model.js'
import { definePluggyItemIngestionLeaseModel } from './models/pluggy-item-ingestion-lease-model.js'
import { definePluggyItemObservationModel } from './models/pluggy-item-observation-model.js'
import { definePluggyCallModel } from './models/pluggy-call-model.js'
import { definePluggyConsentModel } from './models/pluggy-consent-model.js'
import { definePluggyItemRawModel } from './models/pluggy-item-raw-model.js'
import { definePluggyConsentRawModel } from './models/pluggy-consent-raw-model.js'
import { definePluggyPositionRawModel } from './models/pluggy-position-raw-model.js'
import { definePluggyAccountRawModel } from './models/pluggy-account-raw-model.js'
import { definePluggyAccountTransactionRawModel } from './models/pluggy-account-transaction-raw-model.js'
import { definePluggyInvestmentTransactionRawModel } from './models/pluggy-investment-transaction-raw-model.js'
import { definePluggyLoanRawModel } from './models/pluggy-loan-raw-model.js'

// Agregado de banco do processo, no mesmo formato do `oplab-radar-api` (`infra/db/models.ts`:
// `{ Sequelize, connections, models }`) — é esse formato que `DefaultInteractorGatewayImpl` consome
// para abrir transação (`this.db.connections.main.transaction(...)`) e que os repositórios consomem
// para chegar no model. Aqui existe uma conexão só (`main`): este serviço fala com um banco físico.
export const DB_NAMES = { MAIN: 'main' } as const

export type ModelMap = {
  person: ReturnType<typeof definePersonModel>
  pluggyCredential: ReturnType<typeof definePluggyCredentialModel>
  pluggyCredentialItem: ReturnType<typeof definePluggyCredentialItemModel>
  pluggyItem: ReturnType<typeof definePluggyItemModel>
  pluggyPosition: ReturnType<typeof definePluggyPositionModel>
  pluggyPositionSnapshot: ReturnType<typeof definePluggyPositionSnapshotModel>
  pluggyLoan: ReturnType<typeof definePluggyLoanModel>
  pluggyLoanSnapshot: ReturnType<typeof definePluggyLoanSnapshotModel>
  pluggyAccount: ReturnType<typeof definePluggyAccountModel>
  pluggyAccountTransaction: ReturnType<typeof definePluggyAccountTransactionModel>
  pluggyInvestmentTransaction: ReturnType<typeof definePluggyInvestmentTransactionModel>
  pluggyHistoryCoverage: ReturnType<typeof definePluggyHistoryCoverageModel>
  pluggySyncProgress: ReturnType<typeof definePluggySyncProgressModel>
  pluggyWebhookEvent: ReturnType<typeof definePluggyWebhookEventModel>
  pluggyItemIngestionLease: ReturnType<typeof definePluggyItemIngestionLeaseModel>
  pluggyItemObservation: ReturnType<typeof definePluggyItemObservationModel>
  pluggyCall: ReturnType<typeof definePluggyCallModel>
  pluggyConsent: ReturnType<typeof definePluggyConsentModel>
  pluggyItemRaw: ReturnType<typeof definePluggyItemRawModel>
  pluggyConsentRaw: ReturnType<typeof definePluggyConsentRawModel>
  pluggyPositionRaw: ReturnType<typeof definePluggyPositionRawModel>
  pluggyAccountRaw: ReturnType<typeof definePluggyAccountRawModel>
  pluggyAccountTransactionRaw: ReturnType<typeof definePluggyAccountTransactionRawModel>
  pluggyInvestmentTransactionRaw: ReturnType<typeof definePluggyInvestmentTransactionRawModel>
  pluggyLoanRaw: ReturnType<typeof definePluggyLoanRawModel>
}

export type DB = {
  Sequelize: typeof SequelizeLib
  connections: { [name: string]: Sequelize }
  models: ModelMap
}

let db: DB | undefined

export function loadModels(config: DatabaseConnectionConfig): DB {
  if (db) {
    throw new Error('DB models already loaded')
  }

  const main = createDatabaseConnection(config)

  db = {
    Sequelize: SequelizeLib,
    connections: { [DB_NAMES.MAIN]: main },
    models: {
      person: definePersonModel(main),
      pluggyCredential: definePluggyCredentialModel(main),
      pluggyCredentialItem: definePluggyCredentialItemModel(main),
      pluggyItem: definePluggyItemModel(main),
      pluggyPosition: definePluggyPositionModel(main),
      pluggyPositionSnapshot: definePluggyPositionSnapshotModel(main),
      pluggyLoan: definePluggyLoanModel(main),
      pluggyLoanSnapshot: definePluggyLoanSnapshotModel(main),
      pluggyAccount: definePluggyAccountModel(main),
      pluggyAccountTransaction: definePluggyAccountTransactionModel(main),
      pluggyInvestmentTransaction: definePluggyInvestmentTransactionModel(main),
      pluggyHistoryCoverage: definePluggyHistoryCoverageModel(main),
      pluggySyncProgress: definePluggySyncProgressModel(main),
      pluggyWebhookEvent: definePluggyWebhookEventModel(main),
      pluggyItemIngestionLease: definePluggyItemIngestionLeaseModel(main),
      pluggyItemObservation: definePluggyItemObservationModel(main),
      pluggyCall: definePluggyCallModel(main),
      pluggyConsent: definePluggyConsentModel(main),
      pluggyItemRaw: definePluggyItemRawModel(main),
      pluggyConsentRaw: definePluggyConsentRawModel(main),
      pluggyPositionRaw: definePluggyPositionRawModel(main),
      pluggyAccountRaw: definePluggyAccountRawModel(main),
      pluggyAccountTransactionRaw: definePluggyAccountTransactionRawModel(main),
      pluggyInvestmentTransactionRaw: definePluggyInvestmentTransactionRawModel(main),
      pluggyLoanRaw: definePluggyLoanRawModel(main),
    },
  }

  return db
}

export function getModels(config: DatabaseConnectionConfig): DB {
  if (!db) {
    return loadModels(config)
  }
  return db
}
