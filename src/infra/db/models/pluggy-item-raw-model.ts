import { DataTypes, Model, type Sequelize } from 'sequelize'

// Log append-only do payload bruto de `GET /items/{id}`, capturado antes de qualquer validação e
// inserido junto do registro principal, na mesma transação (change pluggy-complete-data-capture,
// spec pluggy-raw-payload-audit). Sem chave única — cada sincronização grava uma linha nova.
export interface PluggyItemRawRow {
  id: number
  item_id: string
  raw_payload: Record<string, unknown>
  captured_at: Date
}

export function definePluggyItemRawModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyItemRawRow>>(
    'PluggyItemRaw',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: DataTypes.STRING(36), allowNull: false },
      raw_payload: { type: DataTypes.JSON, allowNull: false },
      captured_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_item_raw',
      timestamps: false,
    },
  )
}
