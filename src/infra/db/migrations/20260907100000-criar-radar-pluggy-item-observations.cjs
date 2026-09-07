// Estado observado por Item (design.md D33, D9, D9.1, D18, D26, D27): atualizado em todo `fetchItem`
// válido de um Item já vinculado, independente de sincronização ter tido sucesso. Schema completo o
// bastante para responder `/credentials/status` sem chamar `fetchItem` de novo (D20).
//
// `item_id` único: uma escrita condicional por `observation_started_at` (D9.1, D17) decide se a
// observação recebida é aceita — nunca "ler, decidir em memória, escrever".
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('radar_pluggy_item_observations', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      status: { type: Sequelize.STRING(30), allowNull: false },
      execution_status: { type: Sequelize.STRING(30), allowNull: false },
      // Espelha `Item.statusDetail` — `null` quando `executionStatus` é `SUCCESS` (D12).
      status_detail: { type: Sequelize.JSON, allowNull: true },
      // Produtos habilitados NESTE Item (D26) — `null` quando `UNKNOWN`, nunca `[]` nesse caso.
      item_products: { type: Sequelize.JSON, allowNull: true },
      last_updated_at: { type: Sequelize.DATE(3), allowNull: true },
      next_auto_sync_at: { type: Sequelize.DATE(3), allowNull: true },
      // Denormalizado para consulta (D8) — nome/imagem/cor/produtos do connector vivem só no vínculo
      // credencial↔item, nunca duplicados aqui.
      connector_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      // Token de ordenação da observação (D9.1) — capturado ANTES do `fetchItem`, nunca o instante do
      // save. Condição de aceite é estritamente `>` contra o valor já persistido.
      observation_started_at: { type: Sequelize.DATE(3), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex('radar_pluggy_item_observations', ['item_id'], {
      name: 'uq_radar_pluggy_item_observations_item_id',
      unique: true,
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('radar_pluggy_item_observations', 'uq_radar_pluggy_item_observations_item_id')
    await queryInterface.dropTable('radar_pluggy_item_observations')
  },
}
