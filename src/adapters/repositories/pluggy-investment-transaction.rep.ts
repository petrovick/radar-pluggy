import { Decimal } from 'decimal.js'
import type { Model, ModelStatic } from 'sequelize'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import { PluggyInvestmentTransaction } from '../../entities/pluggy-investment-transaction.js'
import type { PluggyInvestmentTransactionRow } from '../../infra/db/models/pluggy-investment-transaction-model.js'

export interface SavePluggyInvestmentTransactionInput {
  itemId: string
  investmentId: string
  transactionId: string
  type: string
  movementType?: string | undefined
  quantity?: Decimal | undefined
  value?: Decimal | undefined
  amount?: Decimal | undefined
  netAmount?: Decimal | undefined
  priceFactor?: Decimal | undefined
  indexerPercentage?: Decimal | undefined
  agreedRate?: Decimal | undefined
  date: Date
  tradeDate?: Date | undefined
  description?: string | undefined
  brokerageNumber?: string | undefined
  serviceTax?: Decimal | undefined
  brokerageFee?: Decimal | undefined
  incomeTax?: Decimal | undefined
  tradingAssetsNoticeFee?: Decimal | undefined
  maintenanceFee?: Decimal | undefined
  settlementFee?: Decimal | undefined
  clearingFee?: Decimal | undefined
  stockExchangeFee?: Decimal | undefined
  custodyFee?: Decimal | undefined
  operatingFee?: Decimal | undefined
  other?: Decimal | undefined
  iof?: Decimal | undefined
  iofProvision?: Decimal | undefined
}

export class PluggyInvestmentTransactionRep {
  private readonly model: ModelStatic<Model<PluggyInvestmentTransactionRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyInvestmentTransaction
    this.getTransaction = params.getTransaction
  }

  // Upsert por (item_id, investment_id, transaction_id)
  async save(input: SavePluggyInvestmentTransactionInput): Promise<PluggyInvestmentTransaction> {
    const draft = PluggyInvestmentTransaction.create({
      itemId: input.itemId,
      investmentId: input.investmentId,
      transactionId: input.transactionId,
      type: input.type,
      date: input.date,
      ...withDefined({
        movementType: input.movementType,
        quantity: input.quantity,
        value: input.value,
        amount: input.amount,
        netAmount: input.netAmount,
        priceFactor: input.priceFactor,
        indexerPercentage: input.indexerPercentage,
        agreedRate: input.agreedRate,
        tradeDate: input.tradeDate,
        description: input.description,
        brokerageNumber: input.brokerageNumber,
        serviceTax: input.serviceTax,
        brokerageFee: input.brokerageFee,
        incomeTax: input.incomeTax,
        tradingAssetsNoticeFee: input.tradingAssetsNoticeFee,
        maintenanceFee: input.maintenanceFee,
        settlementFee: input.settlementFee,
        clearingFee: input.clearingFee,
        stockExchangeFee: input.stockExchangeFee,
        custodyFee: input.custodyFee,
        operatingFee: input.operatingFee,
        other: input.other,
        iof: input.iof,
        iofProvision: input.iofProvision,
      }),
    })
    const now = new Date()

    const [row, created] = await this.model.findOrCreate({
      where: {
        item_id: draft.getItemId(),
        investment_id: draft.getInvestmentId(),
        transaction_id: draft.getTransactionId(),
      },
      defaults: toRow(draft, now),
      ...this.transactionOptions(),
    })

    if (!created) {
      await row.update(toRow(draft, now), this.transactionOptions())
    }

    return draft
  }

  async saveMany(inputs: SavePluggyInvestmentTransactionInput[]): Promise<PluggyInvestmentTransaction[]> {
    const results: PluggyInvestmentTransaction[] = []
    for (const input of inputs) {
      results.push(await this.save(input))
    }
    return results
  }

  async findByInvestmentId(investmentId: string): Promise<PluggyInvestmentTransaction[]> {
    const rows = await this.model.findAll({
      where: { investment_id: investmentId },
      order: [['date', 'ASC']],
    })
    return rows.map((r) => toEntity(r.get({ plain: true })))
  }

  // Transação vigente do escopo, nunca por parâmetro (arquitetura-camadas, regra 2.4).
  private transactionOptions(): { transaction?: NonNullable<ReturnType<GetTransaction>> } {
    const transaction = this.getTransaction(DB_NAMES.MAIN)
    return transaction ? { transaction } : {}
  }
}

function toRow(tx: PluggyInvestmentTransaction, now: Date): PluggyInvestmentTransactionRow {
  return {
    item_id: tx.getItemId(),
    investment_id: tx.getInvestmentId(),
    transaction_id: tx.getTransactionId(),
    type: tx.getType(),
    movement_type: tx.getMovementType() ?? null,
    quantity: tx.getQuantity()?.toFixed(8) ?? null,
    value: tx.getValue()?.toFixed(8) ?? null,
    amount: tx.getAmount()?.toFixed(2) ?? null,
    net_amount: tx.getNetAmount()?.toFixed(2) ?? null,
    price_factor: tx.getPriceFactor()?.toFixed(8) ?? null,
    indexer_percentage: tx.getIndexerPercentage()?.toFixed(8) ?? null,
    agreed_rate: tx.getAgreedRate()?.toFixed(8) ?? null,
    date: tx.getDate(),
    trade_date: tx.getTradeDate() ?? null,
    description: tx.getDescription() ?? null,
    brokerage_number: tx.getBrokerageNumber() ?? null,
    service_tax: tx.getServiceTax()?.toFixed(2) ?? null,
    brokerage_fee: tx.getBrokerageFee()?.toFixed(2) ?? null,
    income_tax: tx.getIncomeTax()?.toFixed(2) ?? null,
    trading_assets_notice_fee: tx.getTradingAssetsNoticeFee()?.toFixed(2) ?? null,
    maintenance_fee: tx.getMaintenanceFee()?.toFixed(2) ?? null,
    settlement_fee: tx.getSettlementFee()?.toFixed(2) ?? null,
    clearing_fee: tx.getClearingFee()?.toFixed(2) ?? null,
    stock_exchange_fee: tx.getStockExchangeFee()?.toFixed(2) ?? null,
    custody_fee: tx.getCustodyFee()?.toFixed(2) ?? null,
    operating_fee: tx.getOperatingFee()?.toFixed(2) ?? null,
    other: tx.getOther()?.toFixed(2) ?? null,
    iof: tx.getIof()?.toFixed(2) ?? null,
    iof_provision: tx.getIofProvision()?.toFixed(2) ?? null,
    created_at: now,
    updated_at: now,
  } as PluggyInvestmentTransactionRow
}

export function toEntity(row: PluggyInvestmentTransactionRow): PluggyInvestmentTransaction {
  return PluggyInvestmentTransaction.reconstitute({
    itemId: row.item_id,
    investmentId: row.investment_id,
    transactionId: row.transaction_id,
    type: row.type,
    date: row.date,
    ...withDefined({
      movementType: row.movement_type ?? undefined,
      quantity: row.quantity !== null ? new Decimal(row.quantity) : undefined,
      value: row.value !== null ? new Decimal(row.value) : undefined,
      amount: row.amount !== null ? new Decimal(row.amount) : undefined,
      netAmount: row.net_amount !== null ? new Decimal(row.net_amount) : undefined,
      priceFactor: row.price_factor !== null ? new Decimal(row.price_factor) : undefined,
      indexerPercentage: row.indexer_percentage !== null ? new Decimal(row.indexer_percentage) : undefined,
      agreedRate: row.agreed_rate !== null ? new Decimal(row.agreed_rate) : undefined,
      tradeDate: row.trade_date ?? undefined,
      description: row.description ?? undefined,
      brokerageNumber: row.brokerage_number ?? undefined,
      serviceTax: row.service_tax !== null ? new Decimal(row.service_tax) : undefined,
      brokerageFee: row.brokerage_fee !== null ? new Decimal(row.brokerage_fee) : undefined,
      incomeTax: row.income_tax !== null ? new Decimal(row.income_tax) : undefined,
      tradingAssetsNoticeFee: row.trading_assets_notice_fee !== null ? new Decimal(row.trading_assets_notice_fee) : undefined,
      maintenanceFee: row.maintenance_fee !== null ? new Decimal(row.maintenance_fee) : undefined,
      settlementFee: row.settlement_fee !== null ? new Decimal(row.settlement_fee) : undefined,
      clearingFee: row.clearing_fee !== null ? new Decimal(row.clearing_fee) : undefined,
      stockExchangeFee: row.stock_exchange_fee !== null ? new Decimal(row.stock_exchange_fee) : undefined,
      custodyFee: row.custody_fee !== null ? new Decimal(row.custody_fee) : undefined,
      operatingFee: row.operating_fee !== null ? new Decimal(row.operating_fee) : undefined,
      other: row.other !== null ? new Decimal(row.other) : undefined,
      iof: row.iof !== null ? new Decimal(row.iof) : undefined,
      iofProvision: row.iof_provision !== null ? new Decimal(row.iof_provision) : undefined,
    }),
  })
}

function withDefined<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}
