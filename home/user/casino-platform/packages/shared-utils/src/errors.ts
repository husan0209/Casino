export abstract class AppError extends Error {
  abstract readonly code: string
  abstract readonly httpStatus: number

  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message)
    this.name = this.constructor.name
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      context: this.context,
    }
  }
}
