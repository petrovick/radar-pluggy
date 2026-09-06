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
])

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
}

// Campos obrigatórios/opcionais espelham o que a Pluggy documenta como obrigatório/opcional no schema
// `Investment` (design.md D3, sincronizacao-posicao-pluggy) — opcional ausente aqui nunca é erro, é o
// investimento genuinamente não ter aquele atributo.
export class PluggyPosition {
  private constructor(
    private readonly investmentId: string,
    private readonly itemId: string,
    private readonly type: string,
    private readonly subtype: string | undefined,
    private readonly name: string,
    private readonly code: string | undefined,
    private readonly isin: string | undefined,
    private readonly currencyCode: string,
    private readonly balance: Decimal,
    private readonly quantity: Decimal | undefined,
    private readonly amountOriginal: Decimal | undefined,
    private readonly value: Decimal | undefined,
    private readonly amount: Decimal | undefined,
    private readonly taxes: Decimal | undefined,
    private readonly taxes2: Decimal | undefined,
    private readonly status: string | undefined,
    private readonly institutionName: string | undefined,
    private readonly institutionNumber: string | undefined,
    private readonly quotaDate: Date,
  ) { }

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

    return new PluggyPosition(
      props.investmentId,
      props.itemId,
      props.type,
      props.subtype,
      props.name,
      props.code,
      props.isin,
      props.currencyCode,
      props.balance,
      props.quantity,
      props.amountOriginal,
      props.value,
      props.amount,
      props.taxes,
      props.taxes2,
      props.status,
      props.institutionName,
      props.institutionNumber,
      props.quotaDate,
    )
  }

  // Reconstrói a partir de uma linha já persistida (fronteira model → entity do repositório).
  static reconstitute(props: CreatePluggyPositionProps): PluggyPosition {
    return new PluggyPosition(
      props.investmentId,
      props.itemId,
      props.type,
      props.subtype,
      props.name,
      props.code,
      props.isin,
      props.currencyCode,
      props.balance,
      props.quantity,
      props.amountOriginal,
      props.value,
      props.amount,
      props.taxes,
      props.taxes2,
      props.status,
      props.institutionName,
      props.institutionNumber,
      props.quotaDate,
    )
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
