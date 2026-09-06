import type { Decimal } from 'decimal.js'
import { ApplicationError } from '../shared/application-error.js'

// Único ponto de entrada de dado externo (gateway de investimentos): o guard roda em runtime porque o
// excess-property check do TS não pega objeto montado dinamicamente, mesmo padrão de pluggy-item.ts.
const ALLOWED_CREATE_FIELDS = new Set([
  'investmentId',
  'itemId',
  'type',
  'subtype',
  'name',
  'code',
  'isin',
  'currencyCode',
  'balance',
  'quantity',
  'amountOriginal',
  'value',
  'amount',
  'taxes',
  'taxes2',
  'status',
  'institutionName',
  'institutionNumber',
  'quotaDate',
  'issuerCnpj',
  'number',
  'amountWithdrawal',
  'amountProfit',
  'dueDate',
  'issuer',
  'issueDate',
  'purchaseDate',
  'rate',
  'rateType',
  'fixedAnnualRate',
  'lastMonthRate',
  'annualRate',
  'lastTwelveMonthsRate',
  'owner',
  'metadata',
])

// `InvestmentMetadata` do schema da Pluggy — objeto pequeno e fechado, carregado inteiro (change
// pluggy-complete-data-capture, spec pluggy-position-sync).
export interface PluggyPositionMetadata {
  taxRegime: string | undefined
  proposalNumber: string | undefined
  processNumber: string | undefined
}

interface CreatePluggyPositionProps {
  investmentId: string
  itemId: string
  type: string
  subtype?: string
  name: string
  code?: string
  isin?: string
  currencyCode: string
  balance: Decimal
  quantity?: Decimal
  amountOriginal?: Decimal
  // Capturados a partir desta entrega (design.md D10/D11): `value`/`amount` vieram em 100% e
  // `taxes`/`taxes2` em ~25% do dump real — opcionais no schema da Pluggy, nunca default.
  value?: Decimal
  amount?: Decimal
  taxes?: Decimal
  taxes2?: Decimal
  status?: string
  institutionName?: string
  institutionNumber?: string
  quotaDate: Date
  // Campos do schema `Investment` capturados na change pluggy-complete-data-capture (spec
  // pluggy-position-sync) — antes descartados no gateway antes de chegar aqui. Todos opcionais: a
  // ausência reflete o investimento não ter aquele atributo, não um dado incompleto.
  issuerCnpj?: string
  number?: string
  amountWithdrawal?: Decimal
  amountProfit?: Decimal
  dueDate?: Date
  issuer?: string
  issueDate?: Date
  purchaseDate?: Date
  rate?: Decimal
  rateType?: string
  fixedAnnualRate?: Decimal
  lastMonthRate?: Decimal
  annualRate?: Decimal
  lastTwelveMonthsRate?: Decimal
  owner?: string
  metadata?: PluggyPositionMetadata
}

// Campos obrigatórios/opcionais espelham o que a Pluggy documenta como obrigatório/opcional no schema
// `Investment` (design.md D3, sincronizacao-posicao-pluggy) — opcional ausente aqui nunca é erro, é o
// investimento genuinamente não ter aquele atributo.
//
// Construtor recebe `props` por nome, não por posição: com sete campos `Decimal | undefined`
// consecutivos (`amountWithdrawal`, `amountProfit`, `rate`, `fixedAnnualRate`, `lastMonthRate`,
// `annualRate`, `lastTwelveMonthsRate`), um construtor posicional deixaria uma transposição entre
// dois parâmetros compilar sem erro e gravar dado financeiro trocado em silêncio — mesmo raciocínio
// de `pluggy-account.ts`.
export class PluggyPosition {
  private readonly investmentId: string
  private readonly itemId: string
  private readonly type: string
  private readonly subtype: string | undefined
  private readonly name: string
  private readonly code: string | undefined
  private readonly isin: string | undefined
  private readonly currencyCode: string
  private readonly balance: Decimal
  private readonly quantity: Decimal | undefined
  private readonly amountOriginal: Decimal | undefined
  private readonly value: Decimal | undefined
  private readonly amount: Decimal | undefined
  private readonly taxes: Decimal | undefined
  private readonly taxes2: Decimal | undefined
  private readonly status: string | undefined
  private readonly institutionName: string | undefined
  private readonly institutionNumber: string | undefined
  private readonly quotaDate: Date
  private readonly issuerCnpj: string | undefined
  private readonly number: string | undefined
  private readonly amountWithdrawal: Decimal | undefined
  private readonly amountProfit: Decimal | undefined
  private readonly dueDate: Date | undefined
  private readonly issuer: string | undefined
  private readonly issueDate: Date | undefined
  private readonly purchaseDate: Date | undefined
  private readonly rate: Decimal | undefined
  private readonly rateType: string | undefined
  private readonly fixedAnnualRate: Decimal | undefined
  private readonly lastMonthRate: Decimal | undefined
  private readonly annualRate: Decimal | undefined
  private readonly lastTwelveMonthsRate: Decimal | undefined
  private readonly owner: string | undefined
  private readonly metadata: PluggyPositionMetadata | undefined

  private constructor(props: CreatePluggyPositionProps) {
    this.investmentId = props.investmentId
    this.itemId = props.itemId
    this.type = props.type
    this.subtype = props.subtype
    this.name = props.name
    this.code = props.code
    this.isin = props.isin
    this.currencyCode = props.currencyCode
    this.balance = props.balance
    this.quantity = props.quantity
    this.amountOriginal = props.amountOriginal
    this.value = props.value
    this.amount = props.amount
    this.taxes = props.taxes
    this.taxes2 = props.taxes2
    this.status = props.status
    this.institutionName = props.institutionName
    this.institutionNumber = props.institutionNumber
    this.quotaDate = props.quotaDate
    this.issuerCnpj = props.issuerCnpj
    this.number = props.number
    this.amountWithdrawal = props.amountWithdrawal
    this.amountProfit = props.amountProfit
    this.dueDate = props.dueDate
    this.issuer = props.issuer
    this.issueDate = props.issueDate
    this.purchaseDate = props.purchaseDate
    this.rate = props.rate
    this.rateType = props.rateType
    this.fixedAnnualRate = props.fixedAnnualRate
    this.lastMonthRate = props.lastMonthRate
    this.annualRate = props.annualRate
    this.lastTwelveMonthsRate = props.lastTwelveMonthsRate
    this.owner = props.owner
    this.metadata = props.metadata
  }

  static create(props: CreatePluggyPositionProps): PluggyPosition {
    assertNoUnexpectedFields(props)
    assertPresent(props.investmentId, 'PLUGGY_POSITION_INVESTMENT_ID_MISSING')
    assertPresent(props.itemId, 'PLUGGY_POSITION_ITEM_ID_MISSING')
    assertPresent(props.type, 'PLUGGY_POSITION_TYPE_MISSING')
    assertPresent(props.name, 'PLUGGY_POSITION_NAME_MISSING')
    assertPresent(props.currencyCode, 'PLUGGY_POSITION_CURRENCY_CODE_MISSING')
    if (props.balance === undefined || props.balance === null) {
      throw new ApplicationError('PLUGGY_POSITION_BALANCE_MISSING', { investmentId: props.investmentId })
    }
    if (props.quotaDate === undefined || props.quotaDate === null) {
      throw new ApplicationError('PLUGGY_POSITION_QUOTA_DATE_MISSING', { investmentId: props.investmentId })
    }

    return new PluggyPosition(props)
  }

  // Reconstrói a partir de uma linha já persistida (fronteira model → entity do repositório).
  static reconstitute(props: CreatePluggyPositionProps): PluggyPosition {
    return new PluggyPosition(props)
  }

  getInvestmentId(): string {
    return this.investmentId
  }

  getItemId(): string {
    return this.itemId
  }

  getType(): string {
    return this.type
  }

  getSubtype(): string | undefined {
    return this.subtype
  }

  getName(): string {
    return this.name
  }

  getCode(): string | undefined {
    return this.code
  }

  getIsin(): string | undefined {
    return this.isin
  }

  getCurrencyCode(): string {
    return this.currencyCode
  }

  getBalance(): Decimal {
    return this.balance
  }

  getQuantity(): Decimal | undefined {
    return this.quantity
  }

  getAmountOriginal(): Decimal | undefined {
    return this.amountOriginal
  }

  getValue(): Decimal | undefined {
    return this.value
  }

  getAmount(): Decimal | undefined {
    return this.amount
  }

  getTaxes(): Decimal | undefined {
    return this.taxes
  }

  getTaxes2(): Decimal | undefined {
    return this.taxes2
  }

  getStatus(): string | undefined {
    return this.status
  }

  getInstitutionName(): string | undefined {
    return this.institutionName
  }

  getInstitutionNumber(): string | undefined {
    return this.institutionNumber
  }

  getQuotaDate(): Date {
    return this.quotaDate
  }

  getIssuerCnpj(): string | undefined {
    return this.issuerCnpj
  }

  getNumber(): string | undefined {
    return this.number
  }

  getAmountWithdrawal(): Decimal | undefined {
    return this.amountWithdrawal
  }

  getAmountProfit(): Decimal | undefined {
    return this.amountProfit
  }

  getDueDate(): Date | undefined {
    return this.dueDate
  }

  getIssuer(): string | undefined {
    return this.issuer
  }

  getIssueDate(): Date | undefined {
    return this.issueDate
  }

  getPurchaseDate(): Date | undefined {
    return this.purchaseDate
  }

  getRate(): Decimal | undefined {
    return this.rate
  }

  getRateType(): string | undefined {
    return this.rateType
  }

  getFixedAnnualRate(): Decimal | undefined {
    return this.fixedAnnualRate
  }

  getLastMonthRate(): Decimal | undefined {
    return this.lastMonthRate
  }

  getAnnualRate(): Decimal | undefined {
    return this.annualRate
  }

  getLastTwelveMonthsRate(): Decimal | undefined {
    return this.lastTwelveMonthsRate
  }

  getOwner(): string | undefined {
    return this.owner
  }

  getMetadata(): PluggyPositionMetadata | undefined {
    return this.metadata
  }
}

function assertPresent(value: string | undefined, errorType: string): void {
  if (!value || value.trim().length === 0) {
    throw new ApplicationError(errorType)
  }
}

function assertNoUnexpectedFields(props: object): void {
  const forbidden = Object.keys(props).filter((key) => !ALLOWED_CREATE_FIELDS.has(key))
  if (forbidden.length > 0) {
    throw new ApplicationError('PLUGGY_POSITION_UNEXPECTED_FIELD', { fields: forbidden })
  }
}
