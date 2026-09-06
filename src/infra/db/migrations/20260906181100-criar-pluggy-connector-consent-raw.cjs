// Log append-only do payload bruto de cada item de `GET /consents` (change
// pluggy-complete-data-capture, spec pluggy-raw-payload-audit). Sem chave única.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_consent_raw', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      consent_id: { type: Sequelize.STRING(36), allowNull: false },
      raw_payload: { type: Sequelize.JSON, allowNull: false },
      captured_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex('pluggy_connector_consent_raw', ['item_id', 'consent_id'], {
      name: 'idx_pluggy_connector_consent_raw_item_consent',
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'pluggy_connector_consent_raw',
      'idx_pluggy_connector_consent_raw_item_consent',
    )
    await queryInterface.dropTable('pluggy_connector_consent_raw')
  },
}
