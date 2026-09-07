// Sucede `radar_pluggy_history_sync_states` (design.md D4, D5, D12): marca d'água por Item, por
// CONSUMIDOR (`POSITION_SYNC`/`HISTORY_LOAD`) e por FONTE real (`ACCOUNTS`, `ACCOUNT_TRANSACTIONS`,
// `INVESTMENTS`, `INVESTMENT_TRANSACTIONS`, `LOANS`) — três dimensões, não duas. `INVESTMENTS` é
// acompanhada pelos dois consumidores, cada um com sua própria linha.
//
// Drop de `radar_pluggy_history_sync_states` na mesma migration: seguro porque a tabela está vazia em
// todos os ambientes consultados (design.md Migration Plan, passo 3) — sem dado real a migrar.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('radar_pluggy_sync_progress', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      consumer: { type: Sequelize.STRING(30), allowNull: false },
      source: { type: Sequelize.STRING(30), allowNull: false },
      // "Até qual versão da execução este consumidor processou com sucesso para esta fonte" (D12) —
      // nunca "o lastUpdatedAt real daquela fonte na Pluggy".
      last_completed_version_at: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex('radar_pluggy_sync_progress', ['item_id', 'consumer', 'source'], {
      name: 'uq_radar_pluggy_sync_progress_item_consumer_source',
      unique: true,
    })

    await queryInterface.dropTable('radar_pluggy_history_sync_states')
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.createTable('radar_pluggy_history_sync_states', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      last_completed_item_updated_at: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })
    await queryInterface.addIndex('radar_pluggy_history_sync_states', ['item_id'], {
      name: 'uq_radar_pluggy_history_sync_states_item',
      unique: true,
    })

    await queryInterface.removeIndex(
      'radar_pluggy_sync_progress',
      'uq_radar_pluggy_sync_progress_item_consumer_source',
    )
    await queryInterface.dropTable('radar_pluggy_sync_progress')
  },
}
