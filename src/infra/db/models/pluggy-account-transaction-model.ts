import { DataTypes, Model, type Sequelize } from 'sequelize'

export interface PluggyAccountTransactionRow {
  id: number
  item_id: string
  account_id: string
  transaction_id: string
  description: string
  description_raw: string | null
  currency_code: string
  amount: string
  amount_in_account_currency: string | null
  balance: string | null
  date: Date
  transaction_type: string
  status: string
  category_id: string | null
  category: string | null
  operation_type: string | null
  operation_type_additional_info: string | null
  provider_code: string | null
  provider_id: string | null
  source_order: number | null
  merchant: Record<string, unknown> | null
  payment_data: Record<string, unknown> | null
  credit_card_metadata: Record<string, unknown> | null
  provider_created_at: Date
  provider_updated_at: Date
  created_at: Date
  updated_at: Date
}

export function definePluggyAccountTransactionModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyAccountTransactionRow>>(
    'PluggyAccountTransaction',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      account_id: { type: DataTypes.STRING(36), allowNull: false },
      transaction_id: { type: DataTypes.STRING(36), allowNull: false },
      description: { type: DataTypes.STRING(255), allowNull: false },
      description_raw: { type: DataTypes.STRING(255), allowNull: true },
      currency_code: { type: DataTypes.STRING(3), allowNull: false },
      amount: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
      amount_in_account_currency: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      balance: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      date: { type: DataTypes.DATE(3), allowNull: false },
      transaction_type: { type: DataTypes.STRING(30), allowNull: false },
      status: { type: DataTypes.STRING(30), allowNull: false },
      category_id: { type: DataTypes.STRING(36), allowNull: true },
      category: { type: DataTypes.STRING(100), allowNull: true },
      operation_type: { type: DataTypes.STRING(50), allowNull: true },
      operation_type_additional_info: { type: DataTypes.STRING(255), allowNull: true },
      provider_code: { type: DataTypes.STRING(50), allowNull: true },
      provider_id: { type: DataTypes.STRING(60), allowNull: true },
      source_order: { type: DataTypes.INTEGER, allowNull: true },
      merchant: { type: DataTypes.JSON, allowNull: true },
      payment_data: { type: DataTypes.JSON, allowNull: true },
      credit_card_metadata: { type: DataTypes.JSON, allowNull: true },
      provider_created_at: { type: DataTypes.DATE(3), allowNull: false },
      provider_updated_at: { type: DataTypes.DATE(3), allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_account_transactions',
      timestamps: false,
    },
  )
}
