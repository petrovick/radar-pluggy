import { DataTypes, Model, type Sequelize } from 'sequelize'

// Espelha, coluna a coluna, migrations/<...>-criar-pluggy-credentials.cjs — ver teste de contrato em
// tests/infra/db/models/pluggy-credential-model.contract.test.ts. `client_secret` é o texto cifrado
// (design.md D6, configuracao-credenciais-pluggy) — a cifra/decifra acontece na fronteira do
// repositório, nunca aqui.
export interface PluggyCredentialRow {
  id: number
  person_id: number
  client_id: string
  client_secret: string
  webhook_secret: string | null
  webhook_id: string | null
  webhook_url: string | null
  webhook_event: string | null
  created_at: Date
  updated_at: Date
}

export function definePluggyCredentialModel(sequelize: Sequelize) {
  return sequelize.define<Model<PluggyCredentialRow>>(
    'PluggyCredential',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      person_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      client_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      client_secret: { type: DataTypes.STRING(512), allowNull: false },
      webhook_secret: { type: DataTypes.STRING(512), allowNull: true },
      webhook_id: { type: DataTypes.STRING(36), allowNull: true },
      webhook_url: { type: DataTypes.STRING(255), allowNull: true },
      webhook_event: { type: DataTypes.STRING(50), allowNull: true },
      created_at: { type: DataTypes.DATE(3), allowNull: false },
      updated_at: { type: DataTypes.DATE(3), allowNull: false },
    },
    {
      tableName: 'pluggy_connector_credentials',
      timestamps: false,
    },
  )
}
