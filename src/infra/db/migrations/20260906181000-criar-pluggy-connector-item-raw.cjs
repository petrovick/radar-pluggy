// Log append-only do payload bruto de `GET /items/{id}` (change pluggy-complete-data-capture, spec
// pluggy-raw-payload-audit): capturado junto do insert/update principal, sem chave única — cada
// sincronização grava uma linha nova, mesmo idêntica à anterior.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_item_raw', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      raw_payload: { type: Sequelize.JSON, allowNull: false },
      captured_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex('pluggy_connector_item_raw', ['item_id'], {
      name: 'idx_pluggy_connector_item_raw_item',
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('pluggy_connector_item_raw', 'idx_pluggy_connector_item_raw_item')
    await queryInterface.dropTable('pluggy_connector_item_raw')
  },
}
