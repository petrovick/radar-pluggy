import { DataTypes, Model, type Sequelize } from 'sequelize'

export interface PluggyPositionSnapshotRow {
  id: number
  item_id: string
  investment_id: string
  quota_date: Date
  balance: string
  quantity: string | null
  value: string | null
  amount: string | null
  amount_original: string | null
  taxes: string | null
  taxes2: string | null
  currency_code: string
  synced_at: Date
  created_at: Date
}

export function definePluggyPositionSnapshotModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyPositionSnapshotRow>>(
    'PluggyPositionSnapshot',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      investment_id: { type: DataTypes.STRING(36), allowNull: false },
      quota_date: { type: DataTypes.DATE(3), allowNull: false },
      balance: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
      quantity: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      value: { type: DataTypes.DECIMAL(20, 8), allowNull: true },
      amount: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      amount_original: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      taxes: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      taxes2: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
      currency_code: { type: DataTypes.STRING(3), allowNull: false },
      synced_at: { type: DataTypes.DATE(3), allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_position_snapshots',
      timestamps: false,
    },
  )
}
