import { DataTypes, Model, type Sequelize } from 'sequelize'

// Tabela de outro dono (oplab-radar-api) — leitura apenas (fronteira-pluggy regra 13,
// arquitetura-camadas): sem migration correspondente neste repositório, sem `sync()`, sem FK de
// saída. Só as colunas que este serviço precisa — resolver personId a partir do username (sub do
// JWT) — não o schema inteiro de `people`.
export interface PersonRow {
  id: number
  username: string
}

export function definePersonModel(sequelize: Sequelize) {
  return sequelize.define<Model<PersonRow>>(
    'Person',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, primaryKey: true },
      username: { type: DataTypes.STRING(255), allowNull: false },
    },
    {
      tableName: 'people',
      timestamps: false,
    },
  )
}
