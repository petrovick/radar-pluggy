module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_history_coverage', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      reference_id: { type: Sequelize.STRING(36), allowNull: false },
      reference_type: { type: Sequelize.STRING(20), allowNull: false },
      oldest_observed_transaction_at: { type: Sequelize.DATE(3), allowNull: true },
      newest_observed_transaction_at: { type: Sequelize.DATE(3), allowNull: true },
      observed_transaction_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      source_updated_at: { type: Sequelize.DATE(3), allowNull: true },
      last_completed_scan_at: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex(
      'pluggy_connector_history_coverage',
      ['item_id', 'reference_type', 'reference_id'],
      {
        name: 'uq_pluggy_connector_history_coverage_item_reference',
        unique: true,
      },
    )
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'pluggy_connector_history_coverage',
      'uq_pluggy_connector_history_coverage_item_reference',
    )
    await queryInterface.dropTable('pluggy_connector_history_coverage')
  },
}
