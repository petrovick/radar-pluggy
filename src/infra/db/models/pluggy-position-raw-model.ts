import { DataTypes, Model, type Sequelize } from 'sequelize'

// Log append-only do payload bruto de cada item de `GET /investments` (change
// pluggy-complete-data-capture, spec pluggy-raw-payload-audit). Sem chave única.
export interface PluggyPositionRawRow {
  id: number
  item_id: string
  investment_id: string
  raw_payload: Record<string, unknown>
  captured_at: Date
}

export function definePluggyPositionRawModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyPositionRawRow>>(
    'PluggyPositionRaw',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      investment_id: { type: DataTypes.STRING(36), allowNull: false },
      raw_payload: { type: DataTypes.JSON, allowNull: false },
      captured_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_position_raw',
      timestamps: false,
    },
  )
}
