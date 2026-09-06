import { DataTypes, UniqueConstraintError, type QueryInterface } from 'sequelize'

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

  // Sem SELECT-then-INSERT: dois arquivos de teste chamam esta fixture em paralelo (vitest roda
  // arquivos em workers concorrentes) — um `SELECT` prévio teria essa mesma corrida, só que mais
  // larga. A garantia de unicidade real é a constraint do banco; `UniqueConstraintError` aqui
  // significa "outro worker já inseriu", não um erro de verdade.
  try {
    await queryInterface.bulkInsert('people', [{ id: 1, username: 'usuario-teste' }])
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) {
      throw error
    }
  }
}
