import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha, coluna a coluna, as migrations de pluggy_connector_positions (criação e precisão) — ver
// teste de contrato em tests/infra/db/models/pluggy-position-model.contract.test.ts. Atributos em
// snake_case, iguais à coluna: a tradução para camelCase acontece só no repositório (modelagem-de-dados).
export interface PluggyPositionRow {
  id: number
  item_id: string
  investment_id: string
  type: string
  subtype: string | null
  name: string
  code: string | null
  isin: string | null
  currency_code: string
  balance: string
  quantity: string | null
  amount_original: string | null
  value: string | null
  amount: string | null
  taxes: string | null
  taxes2: string | null
  status: string | null
  institution_name: string | null
  institution_number: string | null
  quota_date: Date
  created_at: Date
  updated_at: Date
}

export function definePluggyPositionModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyPositionRow>>(
    'PluggyPosition',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      investment_id: { type: DataTypes.STRING(36), allowNull: false },
      type: { type: DataTypes.STRING(20), allowNull: false },
      subtype: { type: DataTypes.STRING(30), allowNull: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      code: { type: DataTypes.STRING(60), allowNull: true },
      isin: { type: DataTypes.STRING(12), allowNull: true },
      currency_code: { type: DataTypes.STRING(3), allowNull: false },
      balance: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
      quantity: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      amount_original: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      value: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      amount: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      taxes: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      taxes2: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: true },
      institution_name: { type: DataTypes.STRING(255), allowNull: true },
      institution_number: { type: DataTypes.STRING(30), allowNull: true },
      quota_date: { type: DataTypes.DATE(3), allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_positions',
      timestamps: false,
    },
  )
}
