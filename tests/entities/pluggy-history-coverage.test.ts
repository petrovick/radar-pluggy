import { describe, expect, it } from 'vitest'
import { ObservedHistoryScan, PluggyHistoryCoverage } from '../../src/entities/pluggy-history-coverage.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function validCoverageProps() {
  return {
    itemId: 'item-1',
    referenceId: 'acc-1',
    referenceType: 'ACCOUNT' as const,
    observedTransactionCount: 10,
    oldestObservedTransactionAt: new Date('2026-01-01T00:00:00.000Z'),
    newestObservedTransactionAt: new Date('2026-06-01T00:00:00.000Z'),
    sourceUpdatedAt: new Date('2026-06-01T12:00:00.000Z'),
    lastCompletedScanAt: new Date('2026-09-03T10:00:00.000Z'),
  }
}

describe('PluggyHistoryCoverage', () => {
  it('cria cobertura com sucesso para varredura com movimentações', () => {
    const cov = PluggyHistoryCoverage.create(validCoverageProps())
    expect(cov.getItemId()).toBe('item-1')
    expect(cov.getReferenceType()).toBe('ACCOUNT')
    expect(cov.getReferenceId()).toBe('acc-1')
    expect(cov.getObservedTransactionCount()).toBe(10)
    expect(cov.getOldestObservedTransactionAt()).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(cov.getNewestObservedTransactionAt()).toEqual(new Date('2026-06-01T00:00:00.000Z'))
  })

  it('varredura vazia guarda contagem zero e datas nulas (não inventa período)', () => {
    const cov = PluggyHistoryCoverage.create({
      itemId: 'item-1',
      referenceId: 'inv-1',
      referenceType: 'INVESTMENT',
      observedTransactionCount: 0,
      lastCompletedScanAt: new Date('2026-09-03T10:00:00.000Z'),
    })
    expect(cov.getObservedTransactionCount()).toBe(0)
    expect(cov.getOldestObservedTransactionAt()).toBeUndefined()
    expect(cov.getNewestObservedTransactionAt()).toBeUndefined()
  })

  it('recusa criação quando contagem é zero mas datas vêm preenchidas', () => {
    expect(() =>
      PluggyHistoryCoverage.create({
        ...validCoverageProps(),
        observedTransactionCount: 0,
      }),
    ).toThrowError(ApplicationError)
  })

  it('recusa criação quando oldest > newest', () => {
    expect(() =>
      PluggyHistoryCoverage.create({
        ...validCoverageProps(),
        oldestObservedTransactionAt: new Date('2026-07-01T00:00:00.000Z'),
        newestObservedTransactionAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).toThrowError(ApplicationError)
  })

  it('recusa tipo de referência inválido', () => {
    expect(() =>
      PluggyHistoryCoverage.create({
        ...validCoverageProps(),
        referenceType: 'CREDIT' as unknown as 'ACCOUNT',
      }),
    ).toThrowError(ApplicationError)
  })

  it('recusa campo inesperado em runtime', () => {
    expect(() =>
      PluggyHistoryCoverage.create({
        ...validCoverageProps(),
        unexpected: true,
      } as unknown as Parameters<typeof PluggyHistoryCoverage.create>[0]),
    ).toThrowError(ApplicationError)
  })
})

describe('ObservedHistoryScan', () => {
  it('varredura sem nenhuma página é contagem zero sem datas', () => {
    const scan = ObservedHistoryScan.empty()

    expect(scan.getCount()).toBe(0)
    expect(scan.getOldestAt()).toBeUndefined()
    expect(scan.getNewestAt()).toBeUndefined()
  })

  it('acumula contagem e alarga o intervalo conforme as páginas chegam, em qualquer ordem', () => {
    const scan = ObservedHistoryScan.empty()
      .observe({ count: 2, oldestAt: new Date('2026-03-10T00:00:00Z'), newestAt: new Date('2026-03-20T00:00:00Z') })
      .observe({ count: 3, oldestAt: new Date('2026-01-05T00:00:00Z'), newestAt: new Date('2026-02-01T00:00:00Z') })
      .observe({ count: 1, oldestAt: new Date('2026-04-01T00:00:00Z'), newestAt: new Date('2026-04-01T00:00:00Z') })

    expect(scan.getCount()).toBe(6)
    expect(scan.getOldestAt()).toEqual(new Date('2026-01-05T00:00:00Z'))
    expect(scan.getNewestAt()).toEqual(new Date('2026-04-01T00:00:00Z'))
  })

  it('página vazia não mexe no intervalo já observado', () => {
    const comDados = ObservedHistoryScan.empty().observe({
      count: 2,
      oldestAt: new Date('2026-03-10T00:00:00Z'),
      newestAt: new Date('2026-03-20T00:00:00Z'),
    })

    const depois = comDados.observe({ count: 0, oldestAt: undefined, newestAt: undefined })

    expect(depois.getCount()).toBe(2)
    expect(depois.getOldestAt()).toEqual(new Date('2026-03-10T00:00:00Z'))
  })

  it('é imutável: observar devolve outra varredura e não altera a anterior', () => {
    const original = ObservedHistoryScan.empty()

    const depois = original.observe({
      count: 1,
      oldestAt: new Date('2026-03-10T00:00:00Z'),
      newestAt: new Date('2026-03-10T00:00:00Z'),
    })

    expect(original.getCount()).toBe(0)
    expect(depois.getCount()).toBe(1)
  })

  it('recusa página com movimentação mas sem datas — o invariante vale a cada página, não só no fim', () => {
    expect(() =>
      ObservedHistoryScan.empty().observe({ count: 3, oldestAt: undefined, newestAt: undefined }),
    ).toThrowError(ApplicationError)
  })

  it('recusa página com datas mas contagem zero', () => {
    expect(() =>
      ObservedHistoryScan.empty().observe({
        count: 0,
        oldestAt: new Date('2026-03-10T00:00:00Z'),
        newestAt: new Date('2026-03-10T00:00:00Z'),
      }),
    ).toThrowError(ApplicationError)
  })

  it('recusa contagem negativa ou fracionária', () => {
    expect(() => ObservedHistoryScan.empty().observe({ count: -1, oldestAt: undefined, newestAt: undefined })).toThrowError(
      ApplicationError,
    )
    expect(() => ObservedHistoryScan.empty().observe({ count: 1.5, oldestAt: undefined, newestAt: undefined })).toThrowError(
      ApplicationError,
    )
  })
})
