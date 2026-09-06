module.exports = {
  async up(queryInterface, Sequelize) {
    // person_id é coluna simples, sem `references`/`onDelete` — people pertence ao histórico de
    // migration do oplab-radar-api; uma FK física aqui imporia constraint sobre uma tabela que
    // este serviço só lê (fronteira-pluggy regra 13, modelagem-de-dados regra 1).
    await queryInterface.createTable('pluggy_items', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      person_id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false },
      execution_status: { type: Sequelize.STRING(50), allowNull: true },
      last_updated_at: { type: Sequelize.DATE(3), allowNull: true },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    // Unicidade de negócio: um item Pluggy nunca aparece duas vezes.
    await queryInterface.addIndex('pluggy_items', ['item_id'], {
      name: 'uq_pluggy_items_item_id',
      unique: true,
    })

    await queryInterface.addIndex('pluggy_items', ['person_id'], {
      name: 'idx_pluggy_items_person',
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pluggy_items')
  },
}
