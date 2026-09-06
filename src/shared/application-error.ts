export class ApplicationError extends Error {
  constructor(
    readonly errorType: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(errorType)
    this.name = 'ApplicationError'
  }
}
