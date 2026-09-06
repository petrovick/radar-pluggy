import { DataTypes, Model, type Sequelize } from 'sequelize'

export interface PluggyAccountRow {
  id: number
  item_id: string
  account_id: string
  type: string
  subtype: string | null
  number: string
  name: string
  marketing_name: string | null
  balance: string
  currency_code: string
  owner: string | null
  provider_created_at: Date
  provider_updated_at: Date
  level: string | null
  brand: string | null
  brand_additional_info: string | null
  balance_close_date: Date | null
  balance_due_date: Date | null
  available_credit_limit: string | null
  balance_foreign_currency: string | null
  minimum_payment: string | null
  credit_limit: string | null
  is_limit_flexible: boolean | null
  status: string | null
  holder_type: string | null
  created_at: Date
  updated_at: Date
}

export function definePluggyAccountModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyAccountRow>>(
    'PluggyAccount',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      account_id: { type: DataTypes.STRING(36), allowNull: false },
      type: { type: DataTypes.STRING(30), allowNull: false },
      subtype: { type: DataTypes.STRING(30), allowNull: true },
      number: { type: DataTypes.STRING(50), allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      marketing_name: { type: DataTypes.STRING(255), allowNull: true },
      balance: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
      currency_code: { type: DataTypes.STRING(3), allowNull: false },
      owner: { type: DataTypes.STRING(255), allowNull: true },
      provider_created_at: { type: DataTypes.DATE(3), allowNull: false },
      provider_updated_at: { type: DataTypes.DATE(3), allowNull: false },
      level: { type: DataTypes.STRING(30), allowNull: true },
      brand: { type: DataTypes.STRING(30), allowNull: true },
      brand_additional_info: { type: DataTypes.STRING(255), allowNull: true },
      balance_close_date: { type: DataTypes.DATE(3), allowNull: true },
      balance_due_date: { type: DataTypes.DATE(3), allowNull: true },
      available_credit_limit: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      balance_foreign_currency: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      minimum_payment: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      credit_limit: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      is_limit_flexible: { type: DataTypes.BOOLEAN, allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: true },
      holder_type: { type: DataTypes.STRING(20), allowNull: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_accounts',
      timestamps: false,
    },
  )
}
