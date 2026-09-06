// Convenção nova (modelagem-de-dados): toda tabela própria deste serviço nasce com o prefixo físico
// `pluggy_connector_` — só no banco. Entity e model TypeScript continuam com o nome atual
// (PluggyItem, PluggyCredential, ...), a tradução acontece inteiramente na fronteira model→entity.
// Migration nova, nunca editando as originais já aplicadas (modelagem-de-dados: "Nunca edite
// migration já aplicada").
const RENAMES = [
  {
    from: 'pluggy_items',
    to: 'pluggy_connector_items',
    indexes: [
      ['uq_pluggy_items_item_id', 'uq_pluggy_connector_items_item_id'],
      ['idx_pluggy_items_person', 'idx_pluggy_connector_items_person'],
    ],
  },
  {
    from: 'pluggy_credentials',
    to: 'pluggy_connector_credentials',
    indexes: [
      ['uq_pluggy_credentials_client_id', 'uq_pluggy_connector_credentials_client_id'],
      ['idx_pluggy_credentials_person', 'idx_pluggy_connector_credentials_person'],
    ],
  },
  {
    from: 'pluggy_credential_items',
    to: 'pluggy_connector_credential_items',
    indexes: [
      ['uq_pluggy_credential_items_item_id', 'uq_pluggy_connector_credential_items_item_id'],
      ['idx_pluggy_credential_items_credential', 'idx_pluggy_connector_credential_items_credential'],
    ],
  },
  {
    from: 'pluggy_positions',
    to: 'pluggy_connector_positions',
    indexes: [['uq_pluggy_positions_item_investment', 'uq_pluggy_connector_positions_item_investment']],
  },
]

module.exports = {
  async up(queryInterface) {
    for (const { from, to, indexes } of RENAMES) {
      await queryInterface.renameTable(from, to)
      for (const [oldName, newName] of indexes) {
        await queryInterface.sequelize.query(`ALTER TABLE \`${to}\` RENAME INDEX \`${oldName}\` TO \`${newName}\``)
      }
    }
  },

  async down(queryInterface) {
    for (const { from, to, indexes } of [...RENAMES].reverse()) {
      for (const [oldName, newName] of indexes) {
        await queryInterface.sequelize.query(`ALTER TABLE \`${to}\` RENAME INDEX \`${newName}\` TO \`${oldName}\``)
      }
      await queryInterface.renameTable(to, from)
    }
  },
}
