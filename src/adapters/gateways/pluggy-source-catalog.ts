// Quatro vocabulários descrevem os mesmos cinco recursos, e não coincidem entre si (design.md D32):
// `ProductType` do SDK (`ACCOUNTS`, `TRANSACTIONS`, `INVESTMENTS`, `INVESTMENTS_TRANSACTIONS` — com
// "S" em Investments e em Transactions —, `LOANS`), a chave de `Item.statusDetail` (`accounts`,
// `transactions`, `investments`, `investmentTransactions` — sem "S" em Investments —, `loans`), o
// vocabulário de domínio deste serviço (`ACCOUNTS`, `ACCOUNT_TRANSACTIONS`, `INVESTMENTS`,
// `INVESTMENT_TRANSACTIONS` — singular em Investment —, `LOANS`), e a chave camelCase do DTO de
// `GET /credentials/status` (`accounts`, `accountTransactions`, `investments`,
// `investmentTransactions`, `loans` — só esta usa "account"/"investment" por extenso nas duas
// fontes, distinta de `statusDetailKey`). Espalhar essa tradução em vários arquivos foi como a
// divergência `investmentsTransactions`/`investmentTransactions` aconteceu da primeira vez (D7) —
// este módulo é o único lugar que conhece a correspondência entre os quatro.
export type PluggySource = 'ACCOUNTS' | 'ACCOUNT_TRANSACTIONS' | 'INVESTMENTS' | 'INVESTMENT_TRANSACTIONS' | 'LOANS'

interface CatalogRow {
  source: PluggySource
  productType: string
  statusDetailKey: string
  dtoKey: string
}

const CATALOG: readonly CatalogRow[] = [
  { source: 'ACCOUNTS', productType: 'ACCOUNTS', statusDetailKey: 'accounts', dtoKey: 'accounts' },
  { source: 'ACCOUNT_TRANSACTIONS', productType: 'TRANSACTIONS', statusDetailKey: 'transactions', dtoKey: 'accountTransactions' },
  { source: 'INVESTMENTS', productType: 'INVESTMENTS', statusDetailKey: 'investments', dtoKey: 'investments' },
  {
    source: 'INVESTMENT_TRANSACTIONS',
    productType: 'INVESTMENTS_TRANSACTIONS',
    statusDetailKey: 'investmentTransactions',
    dtoKey: 'investmentTransactions',
  },
  { source: 'LOANS', productType: 'LOANS', statusDetailKey: 'loans', dtoKey: 'loans' },
]

export const PLUGGY_SOURCES: readonly PluggySource[] = CATALOG.map((row) => row.source)

export function sourceFromProductType(productType: string): PluggySource | undefined {
  return CATALOG.find((row) => row.productType === productType)?.source
}

export function sourceFromStatusDetailKey(key: string): PluggySource | undefined {
  return CATALOG.find((row) => row.statusDetailKey === key)?.source
}

export function statusDetailKeyFromSource(source: PluggySource): string {
  // `find` nunca falha aqui: `PluggySource` é um union fechado sobre as próprias linhas do catálogo.
  return CATALOG.find((row) => row.source === source)!.statusDetailKey
}

export function productTypeFromSource(source: PluggySource): string {
  return CATALOG.find((row) => row.source === source)!.productType
}

export function dtoKeyFromSource(source: PluggySource): string {
  return CATALOG.find((row) => row.source === source)!.dtoKey
}

// `ACCOUNTS` é a única fonte com mais de um produto de origem (revisão do PR #14): `GET /accounts`
// devolve contas `BANK` e `CREDIT` juntas, na mesma chamada, e cada tipo é habilitado por um produto
// SEPARADO do SDK (`ACCOUNTS` para `BANK`, `CREDIT_CARDS` para cartão de crédito — com
// `statusDetail.creditCards` correspondente). Um Item pode ter só `CREDIT_CARDS` habilitado, sem
// `ACCOUNTS`, e ainda assim ter conta de cartão para descobrir — por isso a elegibilidade e a
// utilizabilidade de `ACCOUNTS` precisam considerar os dois produtos, nunca só o principal. As
// outras quatro fontes continuam 1:1 (só o produto principal).
const ACCOUNTS_DISCOVERY_PRODUCT_TYPES = ['ACCOUNTS', 'CREDIT_CARDS']
const ACCOUNTS_DISCOVERY_STATUS_DETAIL_KEYS = ['accounts', 'creditCards']

export function discoveryProductTypesFor(source: PluggySource): string[] {
  return source === 'ACCOUNTS' ? ACCOUNTS_DISCOVERY_PRODUCT_TYPES : [productTypeFromSource(source)]
}

export function discoveryStatusDetailKeysFor(source: PluggySource): string[] {
  return source === 'ACCOUNTS' ? ACCOUNTS_DISCOVERY_STATUS_DETAIL_KEYS : [statusDetailKeyFromSource(source)]
}
