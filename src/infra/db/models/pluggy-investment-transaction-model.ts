import { DataTypes, Model, type Sequelize } from 'sequelize'

export interface PluggyInvestmentTransactionRow {
  id: number
  item_id: string
  investment_id: string
  transaction_id: string
  type: string
  movement_type: string | null
  quantity: string | null
  value: string | null
  amount: string | null
  net_amount: string | null
  price_factor: string | null
  indexer_percentage: string | null
  agreed_rate: string | null
  date: Date
  trade_date: Date | null
  description: string | null
  brokerage_number: string | null
  service_tax: string | null
  brokerage_fee: string | null
  income_tax: string | null
  trading_assets_notice_fee: string | null
  maintenance_fee: string | null
  settlement_fee: string | null
  clearing_fee: string | null
  stock_exchange_fee: string | null
  custody_fee: string | null
  operating_fee: string | null
  other: string | null
  iof: string | null
  iof_provision: string | null
  created_at: Date
  updated_at: Date
}

export function definePluggyInvestmentTransactionModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyInvestmentTransactionRow>>(
    'PluggyInvestmentTransaction',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      investment_id: { type: DataTypes.STRING(36), allowNull: false },
      transaction_id: { type: DataTypes.STRING(36), allowNull: false },
      type: { type: DataTypes.STRING(30), allowNull: false },
      movement_type: { type: DataTypes.STRING(30), allowNull: true },
      quantity: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      value: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      amount: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      net_amount: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      price_factor: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      indexer_percentage: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      agreed_rate: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      date: { type: DataTypes.DATE(3), allowNull: false },
      trade_date: { type: DataTypes.DATE(3), allowNull: true },
      description: { type: DataTypes.STRING(255), allowNull: true },
      brokerage_number: { type: DataTypes.STRING(50), allowNull: true },
      service_tax: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      brokerage_fee: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      income_tax: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      trading_assets_notice_fee: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      maintenance_fee: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      settlement_fee: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      clearing_fee: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      stock_exchange_fee: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      custody_fee: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      operating_fee: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      other: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      iof: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      iof_provision: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_investment_transactions',
      timestamps: false,
    },
  )
}
