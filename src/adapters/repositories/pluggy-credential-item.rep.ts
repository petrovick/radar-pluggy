import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyCredentialItemRow } from '../../infra/db/models/pluggy-credential-item-model.js'

export class PluggyCredentialItemRep {
  private readonly model: ModelStatic<Model<PluggyCredentialItemRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyCredentialItem
    this.getTransaction = params.getTransaction
  }

  // Um itemId só existe através de uma Application específica (design.md D5,
  // configuracao-credenciais-pluggy) — a constraint de unicidade real do banco em item_id garante que
  // o vínculo nunca aponta pra mais de uma credencial.
  async linkItem(credentialId: number, itemId: string): Promise<void> {
    const now = new Date()
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.create(
      {
        credential_id: credentialId,
        item_id: itemId,
        created_at: now,
        updated_at: now,
      } as PluggyCredentialItemRow,
      transaction ? { transaction } : {},
    )
  }

  async findCredentialIdByItemId(itemId: string): Promise<number | undefined> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const row = await this.model.findOne({
      where: { item_id: itemId },
      ...(transaction ? { transaction } : {}),
    })
    return row?.get().credential_id
  }

  async findItemIdsByCredentialIds(credentialIds: number[]): Promise<string[]> {
    if (credentialIds.length === 0) {
      return []
    }
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const rows = await this.model.findAll({
      where: { credential_id: credentialIds },
      ...(transaction ? { transaction } : {}),
    })
    return rows.map((row) => row.get().item_id)
  }
}
