import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha, coluna a coluna, migrations/<...>-criar-pluggy-credential-items.cjs +
// <...>-adicionar-connector-e-inactive-em-radar-pluggy-credential-items.cjs — ver teste de contrato
// em tests/infra/db/models/pluggy-credential-item-model.contract.test.ts. Vincula um itemId à
// credencial que o autenticou (design.md D5, configuracao-credenciais-pluggy) e carrega a identidade
// do connector (D8/D19) e o marcador de item terminal (D28/D29).
export interface PluggyCredentialItemRow {
  id: number
  credential_id: number
  item_id: string
  connector_id: number | null
  connector_name: string | null
  connector_image_url: string | null
  connector_primary_color: string | null
  connector_products: string[] | null
  inactive_at: Date | null
  created_at: Date
  updated_at: Date
}

export function definePluggyCredentialItemModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyCredentialItemRow>>(
    'PluggyCredentialItem',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      credential_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      item_id: { type: DataTypes.STRING(36), allowNull: false, unique: true },
      connector_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      connector_name: { type: DataTypes.STRING(120), allowNull: true },
      connector_image_url: { type: DataTypes.STRING(500), allowNull: true },
      connector_primary_color: { type: DataTypes.STRING(10), allowNull: true },
      connector_products: { type: DataTypes.JSON, allowNull: true },
      inactive_at: { type: DataTypes.DATE(3), allowNull: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'radar_pluggy_credential_items',
      timestamps: false,
    },
  )
}
