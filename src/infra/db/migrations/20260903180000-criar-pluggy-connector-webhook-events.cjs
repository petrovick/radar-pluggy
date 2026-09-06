// Inbox durável de evento de webhook (design.md D7, tasks.md 7.2). Existe porque a Pluggy exige 2xx
// em menos de 5 segundos e reentrega o mesmo evento até 9 vezes: responder rápido só é seguro se o
// trabalho já estiver persistido antes da resposta.
//
// `event_id` único é a idempotência (fronteira-pluggy, regra 10): reentrega não executa a carga duas
// vezes, e a garantia é constraint de banco, não comparação de timestamp.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pluggy_connector_webhook_events', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      event_id: { type: Sequelize.STRING(64), allowNull: false },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      event: { type: Sequelize.STRING(50), allowNull: false },
      state: { type: Sequelize.STRING(20), allowNull: false },
      // Lease do worker: até quando este processo pode continuar processando o evento. Vencido, o
      // evento volta a ser elegível — é assim que crash depois do claim não deixa trabalho preso.
      lease_until: { type: Sequelize.DATE(3), allowNull: true },
      attempts: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      last_attempt_at: { type: Sequelize.DATE(3), allowNull: true },
      // Só a mensagem resumida do erro: payload e identificador reais não entram em log nem em
      // coluna de erro (design.md, Risks).
      error_summary: { type: Sequelize.STRING(500), allowNull: true },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    await queryInterface.addIndex('pluggy_connector_webhook_events', ['event_id'], {
      name: 'uq_pluggy_connector_webhook_events_event_id',
      unique: true,
    })

    // Drenagem busca por estado e serializa por item (tasks.md 7.2).
    await queryInterface.addIndex('pluggy_connector_webhook_events', ['state', 'item_id'], {
      name: 'idx_pluggy_connector_webhook_events_state_item',
    })
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'pluggy_connector_webhook_events',
      'idx_pluggy_connector_webhook_events_state_item',
    )
    await queryInterface.removeIndex('pluggy_connector_webhook_events', 'uq_pluggy_connector_webhook_events_event_id')
    await queryInterface.dropTable('pluggy_connector_webhook_events')
  },
}
