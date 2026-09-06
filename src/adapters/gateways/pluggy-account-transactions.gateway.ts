import { Decimal } from 'decimal.js'
import { ApplicationError } from '../../shared/application-error.js'
import { pluggySdkError, toDateOrUndefined, type PluggyConnectorClient } from './pluggy-client.gateway.js'


export interface PluggyAccountTransactionDto {
  transactionId: string
  accountId: string
  description: string
  descriptionRaw: string | undefined
  currencyCode: string
  amount: Decimal
  amountInAccountCurrency: Decimal | undefined
  balance: Decimal | undefined
  date: Date
  transactionType: string
  status: string
  categoryId: string | undefined
  category: string | undefined
  operationType: string | undefined
  operationTypeAdditionalInfo: string | undefined
  providerCode: string | undefined
  providerId: string | undefined
  sourceOrder: number | undefined
  merchant: Record<string, unknown> | undefined
  paymentData: Record<string, unknown> | undefined
  providerCreatedAt: Date
  providerUpdatedAt: Date
  // `CreditCardMetadata` inteiro (change pluggy-complete-data-capture, spec
  // pluggy-transaction-history) — antes nunca lido aqui.
  creditCardMetadata: Record<string, unknown> | undefined
  // Payload bruto, exatamente como recebido, capturado antes desta validação (change
  // pluggy-complete-data-capture, spec pluggy-raw-payload-audit).
  raw: Record<string, unknown>
}

export interface PluggyAccountTransactionsPageDto {
  results: PluggyAccountTransactionDto[]
  next: string | null
}

interface PluggyAccountTransactionsResponse {
  results?: unknown
  next?: unknown
}

// `GET /v2/transactions` pelo `pluggy-sdk`. A paginação é por cursor, e o cursor trafega como
// **parâmetro** `after`, nunca como URL a seguir: por isso a validação anti-SSRF que este arquivo
// tinha deixou de existir. Ela protegia contra `next` apontando para outro endpoint (`/identity`
// via travessia) quando montávamos a URL à mão; agora o caminho é sempre `v2/transactions` e só o
// token opaco vem do payload. Defesa por construção, não por validação (padroes-de-engenharia, 3b.1).
export class PluggyAccountTransactionsGateway {

  async fetchTransactionsPage(
    accountId: string,
    client: PluggyConnectorClient,
    after?: string,
    from?: string,
    to?: string,
  ): Promise<PluggyAccountTransactionsPageDto> {
    let data: PluggyAccountTransactionsResponse
    try {
      data = (await client.fetchTransactionsCursor(accountId, {
        ...(after === undefined ? {} : { after }),
        ...(from === undefined ? {} : { dateFrom: from }),
        ...(to === undefined ? {} : { dateTo: to }),
      })) as unknown as PluggyAccountTransactionsResponse
    } catch (error) {
      throw pluggySdkError(
        error,
        {
          timeout: 'PLUGGY_TRANSACTIONS_TIMEOUT',
          unavailable: 'PLUGGY_TRANSACTIONS_UNAVAILABLE',
          upstream: 'PLUGGY_TRANSACTIONS_UPSTREAM_ERROR',
        },
        { accountId },
      )
    }

    return this.parseTransactionsPage(accountId, data)
  }

  // Uma página por vez, entregue na hora — ver a nota em `pluggy-accounts.gateway.ts#fetchAccountPages`.
  // Aqui a paginação é por cursor, então o laço também guarda os cursores já visitados: `next`
  // repetido é ciclo e recusa nomeada, nunca varredura infinita (tasks.md 3.3).
  async *fetchTransactionPages(
    accountId: string,
    client: PluggyConnectorClient,
    from?: string,
    to?: string,
  ): AsyncGenerator<PluggyAccountTransactionsPageDto> {
    const visitedCursors = new Set<string>()
    let cursor: string | undefined

    for (;;) {
      const page: PluggyAccountTransactionsPageDto = await this.fetchTransactionsPage(
        accountId,
        client,
        cursor,
        from,
        to,
      )
      yield page

      if (!page.next) {
        return
      }
      if (visitedCursors.has(page.next)) {
        throw new ApplicationError('PLUGGY_TRANSACTIONS_CURSOR_CYCLE', { accountId, cursor: page.next })
      }
      visitedCursors.add(page.next)
      cursor = page.next
    }
  }

  private parseTransactionsPage(
    accountId: string,
    data: PluggyAccountTransactionsResponse,
  ): PluggyAccountTransactionsPageDto {
    if (!Array.isArray(data.results)) {
      throw new ApplicationError('PLUGGY_TRANSACTIONS_RESPONSE_INVALID', { accountId, field: 'results' })
    }

    // `next` vem da Pluggy como link; o que nos interessa, e o único pedaço dele que sai daqui, é o
    // token `after`. Guardar o link inteiro convidaria alguém a segui-lo como URL.
    let next: string | null = null
    if (data.next !== undefined && data.next !== null) {
      if (typeof data.next !== 'string') {
        throw new ApplicationError('PLUGGY_TRANSACTIONS_RESPONSE_INVALID', { accountId, field: 'next' })
      }
      next = extractAfterCursor(accountId, data.next)
    }

    const results = data.results.map((raw, index) => this.toDto(accountId, index, raw))

    return {
      results,
      next,
    }
  }

  private toDto(accountId: string, index: number, raw: unknown): PluggyAccountTransactionDto {
    if (typeof raw !== 'object' || raw === null) {
      throw new ApplicationError('PLUGGY_TRANSACTION_RESPONSE_INVALID', { accountId, index, field: 'root' })
    }
    const tx = raw as Record<string, unknown>

    const transactionId = requireString(tx.id, accountId, index, 'id')
    const rawAccountId = requireString(tx.accountId, accountId, index, 'accountId')
    if (rawAccountId !== accountId) {
      throw new ApplicationError('PLUGGY_TRANSACTIONS_ACCOUNT_ID_MISMATCH', {
        expectedAccountId: accountId,
        receivedAccountId: rawAccountId,
        index,
      })
    }

    const description = requireString(tx.description, accountId, index, 'description')
    const currencyCode = requireString(tx.currencyCode, accountId, index, 'currencyCode')
    const amount = requireDecimal(tx.amount, accountId, index, 'amount')
    const date = requireDate(tx.date, accountId, index, 'date')
    const transactionType = requireString(tx.type, accountId, index, 'type')
    const status = requireString(tx.status, accountId, index, 'status')
    const providerCreatedAt = requireDate(tx.createdAt, accountId, index, 'createdAt')
    const providerUpdatedAt = requireDate(tx.updatedAt, accountId, index, 'updatedAt')

    return {
      transactionId,
      accountId,
      description,
      currencyCode,
      amount,
      date,
      transactionType,
      status,
      providerCreatedAt,
      providerUpdatedAt,
      descriptionRaw: optionalString(tx.descriptionRaw, accountId, index, 'descriptionRaw'),
      amountInAccountCurrency: optionalDecimal(tx.amountInAccountCurrency, accountId, index, 'amountInAccountCurrency'),
      balance: optionalDecimal(tx.balance, accountId, index, 'balance'),
      categoryId: optionalString(tx.categoryId, accountId, index, 'categoryId'),
      category: optionalString(tx.category, accountId, index, 'category'),
      operationType: optionalString(tx.operationType, accountId, index, 'operationType'),
      operationTypeAdditionalInfo: optionalString(tx.operationTypeAdditionalInfo, accountId, index, 'operationTypeAdditionalInfo'),
      providerCode: optionalString(tx.providerCode, accountId, index, 'providerCode'),
      providerId: optionalString(tx.providerId, accountId, index, 'providerId'),
      sourceOrder: optionalInteger(tx.order, accountId, index, 'order'),
      merchant: optionalObject(tx.merchant, accountId, index, 'merchant'),
      paymentData: optionalObject(tx.paymentData, accountId, index, 'paymentData'),
      creditCardMetadata: optionalObject(tx.creditCardMetadata, accountId, index, 'creditCardMetadata'),
      raw: tx,
    }
  }
}

function requireString(value: unknown, accountId: string, index: number, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApplicationError('PLUGGY_TRANSACTION_RESPONSE_INVALID', { accountId, index, field })
  }
  return value
}

function requireDecimal(value: unknown, accountId: string, index: number, field: string): Decimal {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ApplicationError('PLUGGY_TRANSACTION_RESPONSE_INVALID', { accountId, index, field })
  }
  return new Decimal(String(value))
}

function requireDate(value: unknown, accountId: string, index: number, field: string): Date {
  // Aceita as duas formas: o SDK converte para `Date` só quando a string tinha
  // milissegundo (padroes-de-engenharia, 3b.1). Ilegível recusa, nunca vira `undefined`.
  const date = toDateOrUndefined(value)
  if (date === undefined) {
    throw new ApplicationError('PLUGGY_TRANSACTION_RESPONSE_INVALID', { accountId, index, field })
  }
  return date
}

function optionalString(value: unknown, accountId: string, index: number, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApplicationError('PLUGGY_TRANSACTION_RESPONSE_INVALID', { accountId, index, field })
  }
  return value
}

function optionalDecimal(value: unknown, accountId: string, index: number, field: string): Decimal | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ApplicationError('PLUGGY_TRANSACTION_RESPONSE_INVALID', { accountId, index, field })
  }
  return new Decimal(String(value))
}

function optionalInteger(value: unknown, accountId: string, index: number, field: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ApplicationError('PLUGGY_TRANSACTION_RESPONSE_INVALID', { accountId, index, field })
  }
  return value
}

function optionalObject(value: unknown, accountId: string, index: number, field: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ApplicationError('PLUGGY_TRANSACTION_RESPONSE_INVALID', { accountId, index, field })
  }
  return value as Record<string, unknown>
}

// Cursor de próxima página: só o parâmetro `after` do link que a Pluggy devolveu. `next` presente sem
// `after`, ou ilegível como URL, é resposta mal formada — recusa nomeada, nunca "acabou a paginação"
// em silêncio, que gravaria histórico incompleto como se estivesse completo.
function extractAfterCursor(accountId: string, next: string): string {
  let after: string | null
  try {
    after = new URL(next, 'https://api.pluggy.ai').searchParams.get('after')
  } catch {
    throw new ApplicationError('PLUGGY_TRANSACTIONS_CURSOR_INVALID', { accountId, cursor: next })
  }
  if (after === null || after.length === 0) {
    throw new ApplicationError('PLUGGY_TRANSACTIONS_CURSOR_INVALID', { accountId, cursor: next })
  }
  return after
}
