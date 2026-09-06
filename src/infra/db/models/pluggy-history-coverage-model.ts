import { DataTypes, Model, type Sequelize } from 'sequelize'

export interface PluggyHistoryCoverageRow {
  id: number
  item_id: string
  reference_id: string
  reference_type: string
  oldest_observed_transaction_at: Date | null
  newest_observed_transaction_at: Date | null
  observed_transaction_count: number
  source_updated_at: Date | null
  last_completed_scan_at: Date
  created_at: Date
  updated_at: Date
}

export function definePluggyHistoryCoverageModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyHistoryCoverageRow>>(
    'PluggyHistoryCoverage',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      reference_id: { type: DataTypes.STRING(36), allowNull: false },
      reference_type: { type: DataTypes.STRING(20), allowNull: false },
      oldest_observed_transaction_at: { type: DataTypes.DATE(3), allowNull: true },
      newest_observed_transaction_at: { type: DataTypes.DATE(3), allowNull: true },
      observed_transaction_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      source_updated_at: { type: DataTypes.DATE(3), allowNull: true },
      last_completed_scan_at: { type: DataTypes.DATE(3), allowNull: false },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_history_coverage',
      timestamps: false,
    },
  )
}
