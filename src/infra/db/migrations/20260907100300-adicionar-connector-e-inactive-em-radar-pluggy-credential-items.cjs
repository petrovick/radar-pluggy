// Identidade do connector (design.md D8/D19) e marcador de item terminal (D28/D29) no vínculo
// credencial↔item. Todas nullable: vínculos legados (2 linhas confirmadas nos bancos consultados,
// design.md Risks) nascem sem connector e são preenchidos na próxima observação aceita — sem script
// de backfill.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('radar_pluggy_credential_items', 'connector_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
    })
    await queryInterface.addColumn('radar_pluggy_credential_items', 'connector_name', {
      type: Sequelize.STRING(120),
      allowNull: true,
    })
    await queryInterface.addColumn('radar_pluggy_credential_items', 'connector_image_url', {
      type: Sequelize.STRING(500),
      allowNull: true,
    })
    await queryInterface.addColumn('radar_pluggy_credential_items', 'connector_primary_color', {
      type: Sequelize.STRING(10),
      allowNull: true,
    })
    // Capability da instituição (D19) — nunca inferido do que já foi observado em statusDetail.
    await queryInterface.addColumn('radar_pluggy_credential_items', 'connector_products', {
      type: Sequelize.JSON,
      allowNull: true,
    })
    // `item/deleted` (D28/D29): presente marca o vínculo terminal — connectionStatus vira
    // DISCONNECTED sem depender de nenhuma observação nova.
    await queryInterface.addColumn('radar_pluggy_credential_items', 'inactive_at', {
      type: Sequelize.DATE(3),
      allowNull: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('radar_pluggy_credential_items', 'inactive_at')
    await queryInterface.removeColumn('radar_pluggy_credential_items', 'connector_products')
    await queryInterface.removeColumn('radar_pluggy_credential_items', 'connector_primary_color')
    await queryInterface.removeColumn('radar_pluggy_credential_items', 'connector_image_url')
    await queryInterface.removeColumn('radar_pluggy_credential_items', 'connector_name')
    await queryInterface.removeColumn('radar_pluggy_credential_items', 'connector_id')
  },
}
