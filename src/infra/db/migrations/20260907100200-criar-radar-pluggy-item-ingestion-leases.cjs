// Lease de ingestão por Item (design.md D16): no máximo uma ingestão (Position+History) por Item por
// vez, qualquer que seja o trigger. `fencing_token` — contador monotônico, nunca timestamp — é a
// prova de posse: `tryAcquire`/`renew`/`release` decidem tudo por `UPDATE ... WHERE`, nunca por
// leitura prévia em memória (mesmo idioma de `PluggyWebhookEventRep`).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('radar_pluggy_item_ingestion_leases', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      trigger: { type: Sequelize.STRING(50), allowNull: false },
      lease_until: { type: Sequelize.DATE(3), allowNull: false },
      fencing_token: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      acquired_at: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex('radar_pluggy_item_ingestion_leases', ['item_id'], {
      name: 'uq_radar_pluggy_item_ingestion_leases_item_id',
      unique: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'radar_pluggy_item_ingestion_leases',
      'uq_radar_pluggy_item_ingestion_leases_item_id',
    )
    await queryInterface.dropTable('radar_pluggy_item_ingestion_leases')
  },
}
