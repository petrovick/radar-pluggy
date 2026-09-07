import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyCredentialItemRow } from '../../infra/db/models/pluggy-credential-item-model.js'

// Identidade do connector embutida em todo `GET /items/{id}` (design.md D8/D19) — mesmas cinco
// propriedades de `PluggyConnectorSnapshot` (`pluggy-items.gateway.ts`), redeclaradas aqui em vez de
// importadas: repositório nunca depende de gateway (arquitetura-camadas, direção de dependência).
export interface PluggyCredentialItemConnectorInput {
  connectorId: number
  name: string
  imageUrl: string | undefined
  primaryColor: string | undefined
  products: string[]
}

export interface PluggyCredentialItemInfo {
  credentialId: number
  itemId: string
  connectorId: number | undefined
  connectorName: string | undefined
  connectorImageUrl: string | undefined
  connectorPrimaryColor: string | undefined
  connectorProducts: string[] | undefined
  inactiveAt: Date | undefined
}

export class PluggyCredentialItemRep {
  private readonly model: ModelStatic<Model<PluggyCredentialItemRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyCredentialItem
    this.getTransaction = params.getTransaction
  }

  // Um itemId só existe através de uma Application específica (design.md D5,
  // configuracao-credenciais-pluggy) — a constraint de unicidade real do banco em item_id garante que
  // o vínculo nunca aponta pra mais de uma credencial. `connector` já vem do payload que validou a
  // credencial (design.md D8/pluggy-item): o vínculo nunca nasce sem identidade quando ela está
  // disponível.
  async linkItem(credentialId: number, itemId: string, connector?: PluggyCredentialItemConnectorInput): Promise<void> {
    const now = new Date()
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.create(
      {
        credential_id: credentialId,
        item_id: itemId,
        connector_id: connector?.connectorId ?? null,
        connector_name: connector?.name ?? null,
        connector_image_url: connector?.imageUrl ?? null,
        connector_primary_color: connector?.primaryColor ?? null,
        connector_products: connector?.products ?? null,
        created_at: now,
        updated_at: now,
      } as PluggyCredentialItemRow,
      transaction ? { transaction } : {},
    )
  }

  // Toda observação ACEITA (D9.1/D18) regrava a identidade do connector — mesmo connector já
  // conhecido regrava o mesmo valor (idempotente); vínculo legado (`connector_id = null`) é
  // preenchido sem script de backfill. Nunca chamado separadamente da aceitação da observação.
  async saveConnector(itemId: string, connector: PluggyCredentialItemConnectorInput): Promise<void> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.update(
      {
        connector_id: connector.connectorId,
        connector_name: connector.name,
        connector_image_url: connector.imageUrl ?? null,
        connector_primary_color: connector.primaryColor ?? null,
        connector_products: connector.products,
        updated_at: new Date(),
      } as Partial<PluggyCredentialItemRow>,
      { where: { item_id: itemId }, ...(transaction ? { transaction } : {}) },
    )
  }

  async findByItemId(itemId: string): Promise<PluggyCredentialItemInfo | undefined> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const row = await this.model.findOne({ where: { item_id: itemId }, ...(transaction ? { transaction } : {}) })
    if (!row) {
      return undefined
    }
    const data = row.get()
    return {
      credentialId: data.credential_id,
      itemId: data.item_id,
      connectorId: data.connector_id ?? undefined,
      connectorName: data.connector_name ?? undefined,
      connectorImageUrl: data.connector_image_url ?? undefined,
      connectorPrimaryColor: data.connector_primary_color ?? undefined,
      connectorProducts: data.connector_products ?? undefined,
      inactiveAt: data.inactive_at ?? undefined,
    }
  }

  async findCredentialIdByItemId(itemId: string): Promise<number | undefined> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const row = await this.model.findOne({
      where: { item_id: itemId },
      ...(transaction ? { transaction } : {}),
    })
    return row?.get().credential_id
  }

  // Usado por `/credentials/status` (D10/D20) — item inativo (`item/deleted`) continua aparecendo
  // aqui, com `inactiveAt` preenchido: quem monta a fotografia CORRENTE filtra
  // (`findActiveItemIdsByCredentialIds`), a listagem de status nunca filtra (a consulta MUST mostrar
  // o item como `DISCONNECTED`, spec pluggy-credentials).
  async findByCredentialIds(credentialIds: number[]): Promise<PluggyCredentialItemInfo[]> {
    if (credentialIds.length === 0) {
      return []
    }
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const rows = await this.model.findAll({
      where: { credential_id: credentialIds },
      ...(transaction ? { transaction } : {}),
    })
    return rows.map((row) => {
      const data = row.get()
      return {
        credentialId: data.credential_id,
        itemId: data.item_id,
        connectorId: data.connector_id ?? undefined,
        connectorName: data.connector_name ?? undefined,
        connectorImageUrl: data.connector_image_url ?? undefined,
        connectorPrimaryColor: data.connector_primary_color ?? undefined,
        connectorProducts: data.connector_products ?? undefined,
        inactiveAt: data.inactive_at ?? undefined,
      }
    })
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

  // Exclui item terminal (`item/deleted`, design.md D29) — usado só por quem monta a fotografia
  // CORRENTE (`GET /portfolio`, `GET /accounts`, via `PluggyPersonItemResolver`). `/credentials/status`
  // usa `findItemIdsByCredentialIds` (sem filtro): item inativo continua aparecendo lá, só que
  // `DISCONNECTED` — a fotografia é que exclui, não a listagem de vínculos.
  async findActiveItemIdsByCredentialIds(credentialIds: number[]): Promise<string[]> {
    if (credentialIds.length === 0) {
      return []
    }
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const rows = await this.model.findAll({
      where: { credential_id: credentialIds, inactive_at: null },
      ...(transaction ? { transaction } : {}),
    })
    return rows.map((row) => row.get().item_id)
  }

  // `item/deleted` é terminal (design.md D28/D29): marca o vínculo inativo sem tentar reler o Item.
  // Condicional (`inactive_at IS NULL`) — reentrega do mesmo evento nunca sobrescreve o instante
  // original de inativação por um mais tardio.
  async markInactive(itemId: string, inactiveAt: Date): Promise<void> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    await this.model.update(
      { inactive_at: inactiveAt, updated_at: inactiveAt } as Partial<PluggyCredentialItemRow>,
      { where: { item_id: itemId, inactive_at: null }, ...(transaction ? { transaction } : {}) },
    )
  }
}
