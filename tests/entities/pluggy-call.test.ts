import { describe, expect, it } from 'vitest'
import { PluggyCall } from '../../src/entities/pluggy-call.js'
import { ApplicationError } from '../../src/shared/application-error.js'

function baseProps() {
  return {
    itemId: 'item-1',
    connectorId: 201,
    operation: 'FETCH_ITEM',
    httpMethod: 'GET',
    routeTemplate: '/items/{id}',
    callScope: 'SNAPSHOT_READ',
    trigger: 'WEBHOOK',
    resourceType: undefined,
    resourceId: undefined,
    requestCorrelationId: 'corr-1',
    webhookEventId: undefined,
    pageOrdinal: undefined,
    pageSize: undefined,
    startedAt: new Date('2026-09-01T00:00:00.000Z'),
    completedAt: new Date('2026-09-01T00:00:00.200Z'),
    httpStatus: 200,
    outcome: 'SUCCEEDED',
    failureKind: undefined,
    errorCode: undefined,
  }
}

describe('PluggyCall', () => {
  it('cria com campos válidos e deriva durationMs de started/completed', () => {
    const call = PluggyCall.create(baseProps())
    expect(call.getDurationMs()).toBe(200)
  })

  it('recusa operation fora do vocabulário fechado', () => {
    expect(() => PluggyCall.create({ ...baseProps(), operation: 'DELETE_EVERYTHING' })).toThrow(ApplicationError)
  })

  it('recusa callScope fora do vocabulário fechado', () => {
    expect(() => PluggyCall.create({ ...baseProps(), callScope: 'NOPE' })).toThrow(ApplicationError)
  })

  it('recusa trigger fora do vocabulário fechado', () => {
    expect(() => PluggyCall.create({ ...baseProps(), trigger: 'NOPE' })).toThrow(ApplicationError)
  })

  it('recusa requestCorrelationId ausente', () => {
    expect(() => PluggyCall.create({ ...baseProps(), requestCorrelationId: '' })).toThrow(ApplicationError)
  })

  it('outcome FAILED exige failureKind do vocabulário fechado', () => {
    expect(() => PluggyCall.create({ ...baseProps(), outcome: 'FAILED', failureKind: undefined })).toThrow(ApplicationError)
    expect(() => PluggyCall.create({ ...baseProps(), outcome: 'FAILED', failureKind: 'TIMEOUT' })).not.toThrow()
  })

  it('outcome SUCCEEDED nunca carrega failureKind', () => {
    expect(() => PluggyCall.create({ ...baseProps(), outcome: 'SUCCEEDED', failureKind: 'TIMEOUT' })).toThrow(ApplicationError)
  })
})
