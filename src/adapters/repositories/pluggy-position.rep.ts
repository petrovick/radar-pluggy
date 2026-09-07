import { Decimal } from 'decimal.js'
import { Op, type Model, type ModelStatic } from 'sequelize'
import { PluggyPosition, type PluggyPositionMetadata } from '../../entities/pluggy-position.js'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyPositionRow } from '../../infra/db/models/pluggy-position-model.js'

export interface SavePluggyPositionInput {
  investmentId: string
  itemId: string
  type: string
  subtype: string | undefined
  name: string
  code: string | undefined
  isin: string | undefined
  currencyCode: string
  balance: Decimal
  quantity: Decimal | undefined
  amountOriginal: Decimal | undefined
  value?: Decimal | undefined
  amount?: Decimal | undefined
  taxes?: Decimal | undefined
  taxes2?: Decimal | undefined
  status: string | undefined
  institutionName: string | undefined
  institutionNumber: string | undefined
  quotaDate: Date
  issuerCnpj: string | undefined
  number: string | undefined
  amountWithdrawal: Decimal | undefined
  amountProfit: Decimal | undefined
  dueDate: Date | undefined
  issuer: string | undefined
  issueDate: Date | undefined
  purchaseDate: Date | undefined
  rate: Decimal | undefined
  rateType: string | undefined
  fixedAnnualRate: Decimal | undefined
  lastMonthRate: Decimal | undefined
  annualRate: Decimal | undefined
  lastTwelveMonthsRate: Decimal | undefined
  owner: string | undefined
  metadata: PluggyPositionMetadata | undefined
}

// Formato de repositório do `oplab-radar-api` (`adapters/repositories/car.repository.ts`): recebe a bag
// do container, resolve o model dela e lê a transação vigente do escopo em cada operação. A transação
// nunca chega por parâmetro — quem a abriu foi o impl do gateway do caso de uso.
export class PluggyPositionRep {
  private readonly model: ModelStatic<Model<PluggyPositionRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyPosition
    this.getTransaction = params.getTransaction
  }

  // Upsert por (item_id, investment_id) sobre a constraint real do banco — fotografia mais recente,
  // sem histórico (design.md D2, sincronizacao-posicao-pluggy). findOrCreate + update, nunca
  // "buscar e se não achar criar" em dois passos separados (modelagem-de-dados, idempotência).
  async save(input: SavePluggyPositionInput): Promise<PluggyPosition> {
    const draft = PluggyPosition.create({
      investmentId: input.investmentId,
      itemId: input.itemId,
      type: input.type,
      name: input.name,
      currencyCode: input.currencyCode,
      balance: input.balance,
      quotaDate: input.quotaDate,
      ...withDefined({
        subtype: input.subtype,
        code: input.code,
        isin: input.isin,
        quantity: input.quantity,
        amountOriginal: input.amountOriginal,
        value: input.value,
        amount: input.amount,
        taxes: input.taxes,
        taxes2: input.taxes2,
        status: input.status,
        institutionName: input.institutionName,
        institutionNumber: input.institutionNumber,
        issuerCnpj: input.issuerCnpj,
        number: input.number,
        amountWithdrawal: input.amountWithdrawal,
        amountProfit: input.amountProfit,
        dueDate: input.dueDate,
        issuer: input.issuer,
        issueDate: input.issueDate,
        purchaseDate: input.purchaseDate,
        rate: input.rate,
        rateType: input.rateType,
        fixedAnnualRate: input.fixedAnnualRate,
        lastMonthRate: input.lastMonthRate,
        annualRate: input.annualRate,
        lastTwelveMonthsRate: input.lastTwelveMonthsRate,
        owner: input.owner,
        metadata: input.metadata,
      }),
    })
    const now = new Date()
    const transaction = this.getTransaction(DB_NAMES.MAIN)

    const [row, created] = await this.model.findOrCreate({
      where: { item_id: draft.getItemId(), investment_id: draft.getInvestmentId() },
      defaults: toRow(draft, now),
      ...(transaction ? { transaction } : {}),
    })

    if (created) {
      return draft
    }

    await row.update(toRow(draft, now), transaction ? { transaction } : {})
    return draft
  }

  // Reconciliação de fotografia atual (design.md D21): todo investimento local daquele Item cujo
  // `investmentId` não veio na leitura autoritativa atual deixa de pertencer à fotografia. Chamado
  // só quando `INVESTMENTS` é `isUsable` nesta execução. Snapshot/raw nunca são tocados aqui — são
  // histórico append-only por natureza.
  async reconcile(itemId: string, presentInvestmentIds: string[]): Promise<number> {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const where: Record<string, unknown> = { item_id: itemId }
    if (presentInvestmentIds.length > 0) {
      where.investment_id = { [Op.notIn]: presentInvestmentIds }
    }
    return this.model.destroy({ where, ...(transaction ? { transaction } : {}) })
  }

  async findByItemIds(itemIds: string[]): Promise<PluggyPosition[]> {
    if (itemIds.length === 0) {
      return []
    }
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    const rows = await this.model.findAll({
      where: { item_id: itemIds },
      ...(transaction ? { transaction } : {}),
    })
    return rows.map((row) => toEntity(row.get({ plain: true })))
  }
}

function toRow(position: PluggyPosition, now: Date): PluggyPositionRow {
  return {
    item_id: position.getItemId(),
    investment_id: position.getInvestmentId(),
    type: position.getType(),
    subtype: position.getSubtype() ?? null,
    name: position.getName(),
    code: position.getCode() ?? null,
    isin: position.getIsin() ?? null,
    currency_code: position.getCurrencyCode(),
    balance: position.getBalance().toFixed(2),
    quantity: position.getQuantity()?.toFixed(8) ?? null,
    amount_original: position.getAmountOriginal()?.toFixed(2) ?? null,
    value: position.getValue()?.toFixed(8) ?? null,
    amount: position.getAmount()?.toFixed(2) ?? null,
    taxes: position.getTaxes()?.toFixed(2) ?? null,
    taxes2: position.getTaxes2()?.toFixed(2) ?? null,
    status: position.getStatus() ?? null,
    institution_name: position.getInstitutionName() ?? null,
    institution_number: position.getInstitutionNumber() ?? null,
    quota_date: position.getQuotaDate(),
    issuer_cnpj: position.getIssuerCnpj() ?? null,
    number: position.getNumber() ?? null,
    amount_withdrawal: position.getAmountWithdrawal()?.toFixed(2) ?? null,
    amount_profit: position.getAmountProfit()?.toFixed(2) ?? null,
    due_date: position.getDueDate() ?? null,
    issuer: position.getIssuer() ?? null,
    issue_date: position.getIssueDate() ?? null,
    purchase_date: position.getPurchaseDate() ?? null,
    rate: position.getRate()?.toFixed(8) ?? null,
    rate_type: position.getRateType() ?? null,
    fixed_annual_rate: position.getFixedAnnualRate()?.toFixed(8) ?? null,
    last_month_rate: position.getLastMonthRate()?.toFixed(8) ?? null,
    annual_rate: position.getAnnualRate()?.toFixed(8) ?? null,
    last_twelve_months_rate: position.getLastTwelveMonthsRate()?.toFixed(8) ?? null,
    owner: position.getOwner() ?? null,
    metadata: (position.getMetadata() as Record<string, unknown> | undefined) ?? null,
    created_at: now,
    updated_at: now,
  } as PluggyPositionRow
}

export function toEntity(row: PluggyPositionRow): PluggyPosition {
  return PluggyPosition.reconstitute({
    investmentId: row.investment_id,
    itemId: row.item_id,
    type: row.type,
    name: row.name,
    currencyCode: row.currency_code,
    balance: new Decimal(row.balance),
    quotaDate: row.quota_date,
    ...withDefined({
      subtype: row.subtype ?? undefined,
      code: row.code ?? undefined,
      isin: row.isin ?? undefined,
      quantity: row.quantity !== null ? new Decimal(row.quantity) : undefined,
      amountOriginal: row.amount_original !== null ? new Decimal(row.amount_original) : undefined,
      value: row.value !== null ? new Decimal(row.value) : undefined,
      amount: row.amount !== null ? new Decimal(row.amount) : undefined,
      taxes: row.taxes !== null ? new Decimal(row.taxes) : undefined,
      taxes2: row.taxes2 !== null ? new Decimal(row.taxes2) : undefined,
      status: row.status ?? undefined,
      institutionName: row.institution_name ?? undefined,
      institutionNumber: row.institution_number ?? undefined,
      issuerCnpj: row.issuer_cnpj ?? undefined,
      number: row.number ?? undefined,
      amountWithdrawal: row.amount_withdrawal !== null ? new Decimal(row.amount_withdrawal) : undefined,
      amountProfit: row.amount_profit !== null ? new Decimal(row.amount_profit) : undefined,
      dueDate: row.due_date ?? undefined,
      issuer: row.issuer ?? undefined,
      issueDate: row.issue_date ?? undefined,
      purchaseDate: row.purchase_date ?? undefined,
      rate: row.rate !== null ? new Decimal(row.rate) : undefined,
      rateType: row.rate_type ?? undefined,
      fixedAnnualRate: row.fixed_annual_rate !== null ? new Decimal(row.fixed_annual_rate) : undefined,
      lastMonthRate: row.last_month_rate !== null ? new Decimal(row.last_month_rate) : undefined,
      annualRate: row.annual_rate !== null ? new Decimal(row.annual_rate) : undefined,
      lastTwelveMonthsRate:
        row.last_twelve_months_rate !== null ? new Decimal(row.last_twelve_months_rate) : undefined,
      owner: row.owner ?? undefined,
      metadata: (row.metadata as PluggyPositionMetadata | null) ?? undefined,
    }),
  })
}

// exactOptionalPropertyTypes (tsconfig) proíbe atribuir `undefined` explicitamente a uma propriedade
// opcional (`campo?: T`) — só permite a chave ausente. As entradas deste repositório (linha do banco,
// input de sincronização) sempre têm a chave, com valor possivelmente `undefined`; este helper remove
// as chaves `undefined` antes de repassar pra `PluggyPosition.create`/`reconstitute`, que declaram os
// campos opcionais no padrão `campo?: T` (mesmo padrão de `pluggy-item.ts`).
function withDefined<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}
