export type ErrorCode =
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'MODEL_NOT_FOUND'
  | 'CREDENTIAL_NOT_FOUND'
  | 'PROVIDER_NOT_REGISTERED'
  | 'CATALOG_SYNC_FAILED'

interface ErrorOptions {
  providerID?: string
  modelId?: string
}

interface ErrorJSON {
  code: ErrorCode
  message: string
  providerID?: string
  modelId?: string
}

export class OpenLLMProviderError extends Error {
  readonly code: ErrorCode
  readonly providerID?: string
  readonly modelId?: string

  constructor(message: string, code: ErrorCode, options?: ErrorOptions) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.providerID = options?.providerID
    this.modelId = options?.modelId
    const captureStackTrace = (
      Error as unknown as {
        captureStackTrace?: (target: Error, ctor: typeof Error) => void
      }
    ).captureStackTrace
    if (typeof captureStackTrace === 'function') {
      captureStackTrace(this, this.constructor as typeof Error)
    }
  }

  toJSON(): ErrorJSON {
    const result: ErrorJSON = {
      code: this.code,
      message: this.message,
    }
    if (this.providerID !== undefined) result.providerID = this.providerID
    if (this.modelId !== undefined) result.modelId = this.modelId
    return result
  }
}

export class AuthError extends OpenLLMProviderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'AUTH_ERROR', options)
  }
}

export class ValidationError extends OpenLLMProviderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'VALIDATION_ERROR', options)
  }
}

export class ModelNotFoundError extends OpenLLMProviderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'MODEL_NOT_FOUND', options)
  }
}

export class CredentialNotFoundError extends OpenLLMProviderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'CREDENTIAL_NOT_FOUND', options)
  }
}

export class ProviderNotRegisteredError extends OpenLLMProviderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'PROVIDER_NOT_REGISTERED', options)
  }
}

export class CatalogSyncFailedError extends OpenLLMProviderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'CATALOG_SYNC_FAILED', options)
  }
}
