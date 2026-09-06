import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha, coluna a coluna, a migration de pluggy_connector_loan_snapshots — ver teste de contrato em
// tests/infra/db/models/pluggy-loan-snapshot-model.contract.test.ts.
export interface PluggyLoanSnapshotRow {
  id: number
  loan_id: string
  item_id: string
  outstanding_balance: string | null
  total_installments: number | null
  paid_installments: number | null
  due_installments: number | null
  past_due_installments: number | null
  currency_code: string
  synced_at: Date
  created_at: Date
}

export function definePluggyLoanSnapshotModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyLoanSnapshotRow>>(
    'PluggyLoanSnapshot',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      loan_id: { type: DataTypes.STRING(36), allowNull: false },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      outstanding_balance: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      total_installments: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      paid_installments: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      due_installments: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      past_due_installments: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      currency_code: { type: DataTypes.STRING(3), allowNull: false },
      synced_at: { type: DataTypes.DATE(3), allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_loan_snapshots',
      timestamps: false,
    },
  )
}
