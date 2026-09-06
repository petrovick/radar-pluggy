import { DataTypes, Model, type Sequelize } from 'sequelize'

// Log append-only do payload bruto de cada item de `GET /investments/{id}/transactions` (change
// pluggy-complete-data-capture, spec pluggy-raw-payload-audit). Sem chave única.
export interface PluggyInvestmentTransactionRawRow {
  id: number
  item_id: string
  investment_id: string
  transaction_id: string
  raw_payload: Record<string, unknown>
  captured_at: Date
}

export function definePluggyInvestmentTransactionRawModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyInvestmentTransactionRawRow>>(
    'PluggyInvestmentTransactionRaw',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      investment_id: { type: DataTypes.STRING(36), allowNull: false },
      transaction_id: { type: DataTypes.STRING(36), allowNull: false },
      raw_payload: { type: DataTypes.JSON, allowNull: false },
      captured_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_investment_transaction_raw',
      timestamps: false,
    },
  )
}
