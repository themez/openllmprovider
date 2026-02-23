// Provider (main API)
export { createProvider, getLanguageModel, getSDK } from './provider/index.js'
export type { ProviderConfig, ProviderState, ProviderInstance, ProviderFactory } from './provider/index.js'
export { BUNDLED_PROVIDERS } from './provider/index.js'

// Catalog
export { createCatalog, Catalog } from './catalog/index.js'
export type {
  CatalogOptions,
  CatalogProvider,
  ExtendConfig,
  ExtendProviderConfig,
  ExtendModelConfig,
  RefreshResult,
} from './catalog/index.js'

// Auth
export {
  createAuthStore,
  createSecretResolver,
  discoverCredentials,
  DEFAULT_SCANNERS,
  createNodeScanContext,
  runDiskScanners,
} from './auth/index.js'
export type {
  AuthStore,
  AuthStoreOptions,
  DiscoveredCredential,
  DiscoverOptions,
  DiskScanner,
  DiskScanResult,
  ScanContext,
} from './auth/index.js'

// Plugin
export { registerPlugin, getPlugins, getPluginForProvider, loadPluginOptions } from './plugin/index.js'
export { copilotPlugin } from './plugin/copilot.js'
export { codexPlugin } from './plugin/codex.js'

// Storage
export { MemoryStorage, FileStorage, createDefaultStorage } from './storage/index.js'
export type { StorageAdapter } from './storage/index.js'

// Types
export type {
  LanguageModel,
  LanguageModelV3,
  SecretRef,
  SecretResolver,
  ProviderDefinition,
  ProviderUserConfig,
  ModelDefinition,
  ModelAlias,
  AuthHook,
  AuthMethod,
  AuthCredential,
  ProviderInfo,
} from './types/index.js'

// Logger
export { createLogger } from './logger.js'
