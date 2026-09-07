// Histórico append-only de toda chamada real deste serviço à Pluggy (design.md D24, capability
// pluggy-call-history): auditoria, análise de frequência e anomalia — nunca lock, lease ou contador
// de quota. Registro nunca é atualizado depois de criado, por isso não existe `updated_at`.
//
// Nunca persiste corpo de requisição/resposta, saldo, valor monetário, descrição de transação,
// segredo de cliente, api key, token nem cursor opaco de paginação.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('radar_pluggy_calls', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: true },
      connector_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      operation: { type: Sequelize.STRING(50), allowNull: false },
      http_method: { type: Sequelize.STRING(10), allowNull: true },
      // Ex.: `/items/{id}` — nunca a URL com o id real interpolado.
      route_template: { type: Sequelize.STRING(100), allowNull: true },
      call_scope: { type: Sequelize.STRING(30), allowNull: false },
      // `trigger` é palavra reservada do MySQL — Sequelize sempre a referencia entre crases, então o
      // nome de coluna é seguro; qualquer SQL bruto escrito à mão precisa fazer o mesmo.
      trigger: { type: Sequelize.STRING(50), allowNull: false },
      resource_type: { type: Sequelize.STRING(30), allowNull: true },
      resource_id: { type: Sequelize.STRING(64), allowNull: true },
      request_correlation_id: { type: Sequelize.STRING(36), allowNull: false },
      webhook_event_id: { type: Sequelize.STRING(64), allowNull: true },
      // Cursor-based: contador local particionado por operação+recurso (CallContext, D2/D24), nunca o
      // cursor opaco da Pluggy. Numérico: o argumento de página real já usado pelo gateway.
      page_ordinal: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      page_size: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      started_at: { type: Sequelize.DATE(3), allowNull: false },
      completed_at: { type: Sequelize.DATE(3), allowNull: false },
      duration_ms: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      http_status: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      outcome: { type: Sequelize.STRING(20), allowNull: false },
      failure_kind: { type: Sequelize.STRING(30), allowNull: true },
      error_code: { type: Sequelize.STRING(100), allowNull: true },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex('radar_pluggy_calls', ['item_id', 'started_at'], {
      name: 'idx_radar_pluggy_calls_item_started',
    })
    await queryInterface.addIndex('radar_pluggy_calls', ['item_id', 'operation', 'started_at'], {
      name: 'idx_radar_pluggy_calls_item_operation_started',
    })
    await queryInterface.addIndex('radar_pluggy_calls', ['connector_id', 'operation', 'started_at'], {
      name: 'idx_radar_pluggy_calls_connector_operation_started',
    })
    await queryInterface.addIndex('radar_pluggy_calls', ['trigger', 'started_at'], {
      name: 'idx_radar_pluggy_calls_trigger_started',
    })
    await queryInterface.addIndex('radar_pluggy_calls', ['request_correlation_id'], {
      name: 'idx_radar_pluggy_calls_correlation',
    })
    await queryInterface.addIndex('radar_pluggy_calls', ['webhook_event_id'], {
      name: 'idx_radar_pluggy_calls_webhook_event',
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('radar_pluggy_calls', 'idx_radar_pluggy_calls_webhook_event')
    await queryInterface.removeIndex('radar_pluggy_calls', 'idx_radar_pluggy_calls_correlation')
    await queryInterface.removeIndex('radar_pluggy_calls', 'idx_radar_pluggy_calls_trigger_started')
    await queryInterface.removeIndex('radar_pluggy_calls', 'idx_radar_pluggy_calls_connector_operation_started')
    await queryInterface.removeIndex('radar_pluggy_calls', 'idx_radar_pluggy_calls_item_operation_started')
    await queryInterface.removeIndex('radar_pluggy_calls', 'idx_radar_pluggy_calls_item_started')
    await queryInterface.dropTable('radar_pluggy_calls')
  },
}
