import { DataTypes, Model, type Sequelize } from 'sequelize'

// Log append-only do payload bruto de cada item de `GET /loans` (change
// pluggy-complete-data-capture, spec pluggy-raw-payload-audit). Sem chave única.
export interface PluggyLoanRawRow {
  id: number
  item_id: string
  loan_id: string
  raw_payload: Record<string, unknown>
  captured_at: Date
}

export function definePluggyLoanRawModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyLoanRawRow>>(
    'PluggyLoanRaw',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      loan_id: { type: DataTypes.STRING(36), allowNull: false },
      raw_payload: { type: DataTypes.JSON, allowNull: false },
      captured_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_loan_raw',
      timestamps: false,
    },
  )
}
