import { DataTypes, type QueryInterface } from 'sequelize'

/**
 * Fixture exclusiva para ambiente de teste isolado (_test).
 * Como `people` pertence a outro serviço (oplab-radar-api), este repositório nunca cria
 * migration para ela (GEMINI.md / fronteira-pluggy regra 13).
 * Este helper garante que a estrutura mínima exista em bancos de teste descartáveis (CI/local).
 */
export async function ensureTestPeopleFixture(queryInterface: QueryInterface): Promise<void> {
  const tables = await queryInterface.showAllTables()
  if (!tables.includes('people')) {
    await queryInterface.createTable('people', {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
    })
  }

  const existing = await queryInterface.sequelize.query(
    'SELECT id FROM people LIMIT 1',
    { type: 'SELECT' }
  )

  if (!existing || (existing as unknown[]).length === 0) {
    await queryInterface.bulkInsert('people', [
      { id: 1, username: 'usuario-teste' },
    ])
  }
}
