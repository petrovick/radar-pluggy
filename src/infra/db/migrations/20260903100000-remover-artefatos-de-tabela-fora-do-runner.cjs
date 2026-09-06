// Reparo de estado, não mudança de schema. Roda ANTES das migrations 20260903110000+ (é por isso que
// o timestamp é 100000) e devolve o banco ao estado que elas esperam encontrar.
//
// Por que existe: os testes de contrato deste repositório criam a tabela quando ela não existe
// (`if (!tables.includes(...)) await migration.up(...)`). Isso cria tabela FORA do runner, sem
// registro no `SequelizeMeta` — e quando a migration correspondente é reescrita depois, a tabela
// física fica com a forma antiga e ninguém percebe. Foi o que aconteceu com `history_coverage`,
// `history_sync_states` e `account_transactions`.
//
// Em banco que nunca passou por isso — produção incluída — é no-op: nada existe para remover, o custo
// é um `SHOW TABLES` e alguns `describeTable`.
const TABELAS_CRIADAS_POR_TESTE = [
  'pluggy_connector_position_snapshots',
  'pluggy_connector_accounts',
  'pluggy_connector_account_transactions',
  'pluggy_connector_investment_transactions',
  'pluggy_connector_history_coverage',
  'pluggy_connector_history_sync_states',
]

// Colunas que a 20260903110000 adiciona em `pluggy_connector_positions`: se já estiverem lá, foram
// postas fora do runner e o `addColumn` dela falharia com duplicate column.
const COLUNAS_ADICIONADAS_PELA_110000 = ['value', 'amount', 'taxes', 'taxes2']

// Precisão original da tabela (20260901130000), para a 110000 poder aplicar o `changeColumn` dela.
const PRECISAO_ORIGINAL = {
  balance: { tipo: (Sequelize) => Sequelize.DECIMAL(14, 2), allowNull: false },
  quantity: { tipo: (Sequelize) => Sequelize.DECIMAL(14, 8), allowNull: true },
  amount_original: { tipo: (Sequelize) => Sequelize.DECIMAL(14, 2), allowNull: true },
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const tabelas = await queryInterface.showAllTables()

    for (const tabela of TABELAS_CRIADAS_POR_TESTE) {
      if (tabelas.includes(tabela)) {
        await queryInterface.dropTable(tabela)
      }
    }

    if (!tabelas.includes('pluggy_connector_positions')) {
      return
    }

    const colunas = await queryInterface.describeTable('pluggy_connector_positions')

    for (const coluna of COLUNAS_ADICIONADAS_PELA_110000) {
      if (colunas[coluna]) {
        await queryInterface.removeColumn('pluggy_connector_positions', coluna)
      }
    }

    for (const [coluna, esperado] of Object.entries(PRECISAO_ORIGINAL)) {
      const atual = colunas[coluna]
      if (atual && String(atual.type).toUpperCase().includes('(20,')) {
        await queryInterface.changeColumn('pluggy_connector_positions', coluna, {
          type: esperado.tipo(Sequelize),
          allowNull: esperado.allowNull,
        })
      }
    }
  },

  // Sem `down`: esta migration remove estado que nunca deveria ter existido (tabela criada fora do
  // runner). Recriar esse estado no rollback seria recriar o defeito — as tabelas legítimas são
  // criadas e desfeitas pelas migrations 20260903110000+, cada uma com o `down` dela.
  async down() {},
}
