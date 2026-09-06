module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_history_sync_states', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      last_completed_item_updated_at: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex('pluggy_connector_history_sync_states', ['item_id'], {
      name: 'uq_pluggy_connector_history_sync_states_item',
      unique: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'pluggy_connector_history_sync_states',
      'uq_pluggy_connector_history_sync_states_item',
    )
    await queryInterface.dropTable('pluggy_connector_history_sync_states')
  },
}
