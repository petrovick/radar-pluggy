// Correção de convenção (achado de auditoria de segurança externa, ver
// openspec/changes/renomear-tabelas-radar-pluggy): o prefixo físico correto deste serviço é
// `radar_pluggy_`, não `pluggy_connector_`. Migration nova, nunca editando as originais já aplicadas
// (modelagem-de-dados: "Nunca edite migration já aplicada"). Nomes de tabela e de índice vêm de `SHOW
// TABLES`/`SHOW INDEX` reais no banco de dev, não do código-fonte das migrations antigas.
const RENAMES = [
  {
    from: 'pluggy_connector_accounts',
    to: 'radar_pluggy_accounts',
    indexes: [['uq_pluggy_connector_accounts_item_account', 'uq_radar_pluggy_accounts_item_account']],
  },
  {
    from: 'pluggy_connector_account_transactions',
    to: 'radar_pluggy_account_transactions',
    indexes: [
      [
        'uq_pluggy_connector_account_transactions_item_account_tx',
        'uq_radar_pluggy_account_transactions_item_account_tx',
      ],
      [
        'idx_pluggy_connector_account_transactions_item_account_date',
        'idx_radar_pluggy_account_transactions_item_account_date',
      ],
    ],
  },
  {
    from: 'pluggy_connector_consents',
    to: 'radar_pluggy_consents',
    indexes: [
      ['uq_pluggy_connector_consents_item_id', 'uq_radar_pluggy_consents_item_id'],
      ['uq_pluggy_connector_consents_consent_id', 'uq_radar_pluggy_consents_consent_id'],
    ],
  },
  {
    from: 'pluggy_connector_credential_items',
    to: 'radar_pluggy_credential_items',
    indexes: [
      ['uq_pluggy_connector_credential_items_item_id', 'uq_radar_pluggy_credential_items_item_id'],
      [
        'idx_pluggy_connector_credential_items_credential',
        'idx_radar_pluggy_credential_items_credential',
      ],
    ],
  },
  {
    from: 'pluggy_connector_credentials',
    to: 'radar_pluggy_credentials',
    indexes: [
      ['uq_pluggy_connector_credentials_client_id', 'uq_radar_pluggy_credentials_client_id'],
      ['idx_pluggy_connector_credentials_person', 'idx_radar_pluggy_credentials_person'],
    ],
  },
  {
    from: 'pluggy_connector_history_coverage',
    to: 'radar_pluggy_history_coverage',
    indexes: [
      [
        'uq_pluggy_connector_history_coverage_item_reference',
        'uq_radar_pluggy_history_coverage_item_reference',
      ],
    ],
  },
  {
    from: 'pluggy_connector_history_sync_states',
    to: 'radar_pluggy_history_sync_states',
    indexes: [
      ['uq_pluggy_connector_history_sync_states_item', 'uq_radar_pluggy_history_sync_states_item'],
    ],
  },
  {
    from: 'pluggy_connector_investment_transactions',
    to: 'radar_pluggy_investment_transactions',
    indexes: [
      [
        'uq_pluggy_connector_inv_transactions_item_inv_tx',
        'uq_radar_pluggy_inv_transactions_item_inv_tx',
      ],
      [
        'idx_pluggy_connector_inv_transactions_item_inv_date',
        'idx_radar_pluggy_inv_transactions_item_inv_date',
      ],
    ],
  },
  {
    from: 'pluggy_connector_items',
    to: 'radar_pluggy_items',
    indexes: [
      ['uq_pluggy_connector_items_item_id', 'uq_radar_pluggy_items_item_id'],
      ['idx_pluggy_connector_items_person', 'idx_radar_pluggy_items_person'],
    ],
  },
  {
    from: 'pluggy_connector_loans',
    to: 'radar_pluggy_loans',
    indexes: [
      ['uq_pluggy_connector_loans_loan_id', 'uq_radar_pluggy_loans_loan_id'],
      ['idx_pluggy_connector_loans_item', 'idx_radar_pluggy_loans_item'],
    ],
  },
  {
    from: 'pluggy_connector_loan_snapshots',
    to: 'radar_pluggy_loan_snapshots',
    indexes: [
      [
        'uq_pluggy_connector_loan_snapshots_item_loan_synced',
        'uq_radar_pluggy_loan_snapshots_item_loan_synced',
      ],
      ['idx_pluggy_connector_loan_snapshots_item_synced', 'idx_radar_pluggy_loan_snapshots_item_synced'],
    ],
  },
  {
    from: 'pluggy_connector_positions',
    to: 'radar_pluggy_positions',
    indexes: [
      ['uq_pluggy_connector_positions_item_investment', 'uq_radar_pluggy_positions_item_investment'],
    ],
  },
  {
    from: 'pluggy_connector_position_snapshots',
    to: 'radar_pluggy_position_snapshots',
    indexes: [
      [
        'uq_pluggy_connector_position_snapshots_item_investment_date',
        'uq_radar_pluggy_position_snapshots_item_investment_date',
      ],
      [
        'idx_pluggy_connector_position_snapshots_item_date',
        'idx_radar_pluggy_position_snapshots_item_date',
      ],
    ],
  },
  {
    from: 'pluggy_connector_webhook_events',
    to: 'radar_pluggy_webhook_events',
    indexes: [
      ['uq_pluggy_connector_webhook_events_event_id', 'uq_radar_pluggy_webhook_events_event_id'],
      ['idx_pluggy_connector_webhook_events_state_item', 'idx_radar_pluggy_webhook_events_state_item'],
    ],
  },
  {
    from: 'pluggy_connector_account_raw',
    to: 'radar_pluggy_account_raw',
    indexes: [
      ['idx_pluggy_connector_account_raw_item_account', 'idx_radar_pluggy_account_raw_item_account'],
    ],
  },
  {
    from: 'pluggy_connector_account_transaction_raw',
    to: 'radar_pluggy_account_transaction_raw',
    indexes: [
      [
        'idx_pluggy_connector_account_tx_raw_item_account_tx',
        'idx_radar_pluggy_account_tx_raw_item_account_tx',
      ],
    ],
  },
  {
    from: 'pluggy_connector_consent_raw',
    to: 'radar_pluggy_consent_raw',
    indexes: [
      ['idx_pluggy_connector_consent_raw_item_consent', 'idx_radar_pluggy_consent_raw_item_consent'],
    ],
  },
  {
    from: 'pluggy_connector_investment_transaction_raw',
    to: 'radar_pluggy_investment_transaction_raw',
    indexes: [
      [
        'idx_pluggy_connector_inv_tx_raw_item_investment_tx',
        'idx_radar_pluggy_inv_tx_raw_item_investment_tx',
      ],
    ],
  },
  {
    from: 'pluggy_connector_item_raw',
    to: 'radar_pluggy_item_raw',
    indexes: [['idx_pluggy_connector_item_raw_item', 'idx_radar_pluggy_item_raw_item']],
  },
  {
    from: 'pluggy_connector_loan_raw',
    to: 'radar_pluggy_loan_raw',
    indexes: [['idx_pluggy_connector_loan_raw_item_loan', 'idx_radar_pluggy_loan_raw_item_loan']],
  },
  {
    from: 'pluggy_connector_position_raw',
    to: 'radar_pluggy_position_raw',
    indexes: [
      [
        'idx_pluggy_connector_position_raw_item_investment',
        'idx_radar_pluggy_position_raw_item_investment',
      ],
    ],
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
