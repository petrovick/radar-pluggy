// Consentimento Open Finance por trás de um item: uma linha por item_id, sempre o mais recente
// conhecido (fronteira-pluggy regra 3 — vazio não é zero). Não é histórico de renovações, é o
// estado atual que decide se a sincronização de posição pode prosseguir.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_consents', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      consent_id: { type: Sequelize.STRING(36), allowNull: false },
      granted_at: { type: Sequelize.DATE(3), allowNull: false },
      expires_at: { type: Sequelize.DATE(3), allowNull: true },
      revoked_at: { type: Sequelize.DATE(3), allowNull: true },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    // Unicidade de negócio: um item nunca tem duas linhas de consentimento vigente.
    await queryInterface.addIndex('pluggy_connector_consents', ['item_id'], {
      name: 'uq_pluggy_connector_consents_item_id',
      unique: true,
    })

    // Um consent_id da Pluggy nunca pertence a dois itens.
    await queryInterface.addIndex('pluggy_connector_consents', ['consent_id'], {
      name: 'uq_pluggy_connector_consents_consent_id',
      unique: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('pluggy_connector_consents', 'uq_pluggy_connector_consents_consent_id')
    await queryInterface.removeIndex('pluggy_connector_consents', 'uq_pluggy_connector_consents_item_id')
    await queryInterface.dropTable('pluggy_connector_consents')
  },
}
