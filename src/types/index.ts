import type { LanguageModelV3 } from '@ai-sdk/provider'

export type LanguageModel = LanguageModelV3
export type { LanguageModelV3 }

export type { ProviderDefinition, ProviderUserConfig } from './provider.js'
export { ProviderDefinitionSchema, ProviderUserConfigSchema } from './provider.js'

export type { ModelDefinition, ModelAlias } from './model.js'
export { ModelDefinitionSchema, ModelAliasSchema } from './model.js'

export type { SecretRef, SecretResolver } from './auth.js'
export { SecretRefSchema } from './auth.js'

export type { AuthHook, AuthMethod, AuthCredential, ProviderInfo } from './plugin.js'

export {
  OpenLLMProviderError,
  AuthError,
  ValidationError,
  ModelNotFoundError,
  CredentialNotFoundError,
  ProviderNotRegisteredError,
  CatalogSyncFailedError,
} from './errors.js'
export type { ErrorCode } from './errors.js'
