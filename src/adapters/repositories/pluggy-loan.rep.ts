import { Decimal } from 'decimal.js'
import type { Model, ModelStatic } from 'sequelize'
import { PluggyLoan } from '../../entities/pluggy-loan.js'
import type { AppContainer, GetTransaction } from '../../infra/bootstrap/register.js'
import { DB_NAMES } from '../../infra/db/models.js'
import type { PluggyLoanRow } from '../../infra/db/models/pluggy-loan-model.js'

export interface SavePluggyLoanInput {
  loanId: string
  itemId: string
  contractNumber: string | undefined
  productName: string
  type: string | undefined
  kind: string
  collectedAt: Date | undefined
  contractDate: Date | undefined
  settlementDate: Date | undefined
  contractAmount: Decimal | undefined
  currencyCode: string
  dueDate: Date | undefined
  totalInstallments: number | undefined
  paidInstallments: number | undefined
  dueInstallments: number | undefined
  pastDueInstallments: number | undefined
  outstandingBalance: Decimal | undefined
  ipocCode: string | undefined
  disbursementDates: Date[] | undefined
  firstInstallmentDueDate: Date | undefined
  cet: Decimal | undefined
  installmentPeriodicity: string | undefined
  installmentPeriodicityAdditionalInfo: string | undefined
  amortizationScheduled: string | undefined
  amortizationScheduledAdditionalInfo: string | undefined
  cnpjConsignee: string | undefined
  interestRates: Record<string, unknown>[] | undefined
  contractedFees: Record<string, unknown>[] | undefined
  contractedFinanceCharges: Record<string, unknown>[] | undefined
  warranties: Record<string, unknown>[] | undefined
  installments: Record<string, unknown> | undefined
  payments: Record<string, unknown> | undefined
}

// Mesmo formato de PluggyPositionRep: bag do container, model resolvido dela, transação vigente lida
// do escopo — nunca recebida por parâmetro.
export class PluggyLoanRep {
  private readonly model: ModelStatic<Model<PluggyLoanRow>>
  private readonly getTransaction: GetTransaction

  constructor(params: AppContainer) {
    this.model = params.db.models.pluggyLoan
    this.getTransaction = params.getTransaction
  }

  // Upsert por loan_id sobre a constraint real do banco — id do empréstimo na Pluggy já é
  // globalmente único (diferente de investimento, que só é único por item), então a fotografia é
  // "uma linha por loan_id". findOrCreate + update, nunca "buscar e se não achar, criar" em dois
  // passos separados (modelagem-de-dados, idempotência).
  async save(input: SavePluggyLoanInput): Promise<PluggyLoan> {
    const draft = PluggyLoan.create({
      loanId: input.loanId,
      itemId: input.itemId,
      productName: input.productName,
      kind: input.kind,
      currencyCode: input.currencyCode,
      ...withDefined({
        contractNumber: input.contractNumber,
        type: input.type,
        collectedAt: input.collectedAt,
        contractDate: input.contractDate,
        settlementDate: input.settlementDate,
        contractAmount: input.contractAmount,
        dueDate: input.dueDate,
        totalInstallments: input.totalInstallments,
        paidInstallments: input.paidInstallments,
        dueInstallments: input.dueInstallments,
        pastDueInstallments: input.pastDueInstallments,
        outstandingBalance: input.outstandingBalance,
        ipocCode: input.ipocCode,
        disbursementDates: input.disbursementDates,
        firstInstallmentDueDate: input.firstInstallmentDueDate,
        cet: input.cet,
        installmentPeriodicity: input.installmentPeriodicity,
        installmentPeriodicityAdditionalInfo: input.installmentPeriodicityAdditionalInfo,
        amortizationScheduled: input.amortizationScheduled,
        amortizationScheduledAdditionalInfo: input.amortizationScheduledAdditionalInfo,
        cnpjConsignee: input.cnpjConsignee,
        interestRates: input.interestRates,
        contractedFees: input.contractedFees,
        contractedFinanceCharges: input.contractedFinanceCharges,
        warranties: input.warranties,
        installments: input.installments,
        payments: input.payments,
      }),
    })
    const now = new Date()
    const transaction = this.getTransaction(DB_NAMES.MAIN)

    const [row, created] = await this.model.findOrCreate({
      where: { loan_id: draft.getLoanId() },
      defaults: toRow(draft, now),
      ...(transaction ? { transaction } : {}),
    })

    if (created) {
      return draft
    }

    await row.update(toRow(draft, now), transaction ? { transaction } : {})
    return draft
  }
}

function toRow(loan: PluggyLoan, now: Date): PluggyLoanRow {
  return {
    loan_id: loan.getLoanId(),
    item_id: loan.getItemId(),
    contract_number: loan.getContractNumber() ?? null,
    product_name: loan.getProductName(),
    type: loan.getType() ?? null,
    kind: loan.getKind(),
    collected_at: loan.getCollectedAt() ?? null,
    contract_date: loan.getContractDate() ?? null,
    settlement_date: loan.getSettlementDate() ?? null,
    contract_amount: loan.getContractAmount()?.toFixed(2) ?? null,
    currency_code: loan.getCurrencyCode(),
    due_date: loan.getDueDate() ?? null,
    total_installments: loan.getTotalInstallments() ?? null,
    paid_installments: loan.getPaidInstallments() ?? null,
    due_installments: loan.getDueInstallments() ?? null,
    past_due_installments: loan.getPastDueInstallments() ?? null,
    outstanding_balance: loan.getOutstandingBalance()?.toFixed(2) ?? null,
    ipoc_code: loan.getIpocCode() ?? null,
    disbursement_dates: loan.getDisbursementDates()?.map((d) => d.toISOString()) ?? null,
    first_installment_due_date: loan.getFirstInstallmentDueDate() ?? null,
    cet: loan.getCet()?.toFixed(8) ?? null,
    installment_periodicity: loan.getInstallmentPeriodicity() ?? null,
    installment_periodicity_additional_info: loan.getInstallmentPeriodicityAdditionalInfo() ?? null,
    amortization_scheduled: loan.getAmortizationScheduled() ?? null,
    amortization_scheduled_additional_info: loan.getAmortizationScheduledAdditionalInfo() ?? null,
    cnpj_consignee: loan.getCnpjConsignee() ?? null,
    interest_rates: loan.getInterestRates() ?? null,
    contracted_fees: loan.getContractedFees() ?? null,
    contracted_finance_charges: loan.getContractedFinanceCharges() ?? null,
    warranties: loan.getWarranties() ?? null,
    installments: loan.getInstallments() ?? null,
    payments: loan.getPayments() ?? null,
    created_at: now,
    updated_at: now,
  } as PluggyLoanRow
}

export function toEntity(row: PluggyLoanRow): PluggyLoan {
  return PluggyLoan.reconstitute({
    loanId: row.loan_id,
    itemId: row.item_id,
    productName: row.product_name,
    kind: row.kind,
    currencyCode: row.currency_code,
    ...withDefined({
      contractNumber: row.contract_number ?? undefined,
      type: row.type ?? undefined,
      collectedAt: row.collected_at ?? undefined,
      contractDate: row.contract_date ?? undefined,
      settlementDate: row.settlement_date ?? undefined,
      contractAmount: row.contract_amount !== null ? new Decimal(row.contract_amount) : undefined,
      dueDate: row.due_date ?? undefined,
      totalInstallments: row.total_installments ?? undefined,
      paidInstallments: row.paid_installments ?? undefined,
      dueInstallments: row.due_installments ?? undefined,
      pastDueInstallments: row.past_due_installments ?? undefined,
      outstandingBalance: row.outstanding_balance !== null ? new Decimal(row.outstanding_balance) : undefined,
      ipocCode: row.ipoc_code ?? undefined,
      disbursementDates: row.disbursement_dates?.map((d) => new Date(d)) ?? undefined,
      firstInstallmentDueDate: row.first_installment_due_date ?? undefined,
      cet: row.cet !== null ? new Decimal(row.cet) : undefined,
      installmentPeriodicity: row.installment_periodicity ?? undefined,
      installmentPeriodicityAdditionalInfo: row.installment_periodicity_additional_info ?? undefined,
      amortizationScheduled: row.amortization_scheduled ?? undefined,
      amortizationScheduledAdditionalInfo: row.amortization_scheduled_additional_info ?? undefined,
      cnpjConsignee: row.cnpj_consignee ?? undefined,
      interestRates: row.interest_rates ?? undefined,
      contractedFees: row.contracted_fees ?? undefined,
      contractedFinanceCharges: row.contracted_finance_charges ?? undefined,
      warranties: row.warranties ?? undefined,
      installments: row.installments ?? undefined,
      payments: row.payments ?? undefined,
    }),
  })
}

// exactOptionalPropertyTypes (tsconfig) proíbe atribuir `undefined` explicitamente a uma propriedade
// opcional — mesmo helper de pluggy-position.rep.ts.
function withDefined<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>
  }
}
