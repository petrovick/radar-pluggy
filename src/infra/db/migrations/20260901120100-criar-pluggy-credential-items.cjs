module.exports = {
  async up(queryInterface, Sequelize) {
    // credential_id referencia pluggy_credentials, tabela própria deste serviço — FK real permitida
    // (modelagem-de-dados regra 1: só é proibida FK de saída para tabela de outro dono).
    await queryInterface.createTable('pluggy_credential_items', {
      id: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false, autoIncrement: true, primaryKey: true },
      credential_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: false,
        references: { model: 'pluggy_credentials', key: 'id' },
        onDelete: 'CASCADE',
      },
      item_id: { type: Sequelize.STRING(36), allowNull: false },
      created_at: { type: Sequelize.DATE(3), allowNull: false },
      updated_at: { type: Sequelize.DATE(3), allowNull: false },
    })

    // Um itemId só existe através de uma Application específica (design.md D5,
    // configuracao-credenciais-pluggy) — nunca pertence a mais de uma credencial.
    await queryInterface.addIndex('pluggy_credential_items', ['item_id'], {
      name: 'uq_pluggy_credential_items_item_id',
      unique: true,
    })

    await queryInterface.addIndex('pluggy_credential_items', ['credential_id'], {
      name: 'idx_pluggy_credential_items_credential',
    })
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pluggy_credential_items')
  },
}
