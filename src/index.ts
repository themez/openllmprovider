export {
  createProviderStore,
  getLanguageModel,
  loadProvider,
  isProviderInstalled,
  getAllProviderPackages,
} from './provider/index.js'
export type {
  ProviderStore,
  ProviderStoreConfig,
  ProviderListOptions,
  ModelListOptions,
  GetModelOptions,
} from './provider/index.js'

export { createAuthStore } from './auth/index.js'
export type { AuthStore, AuthStoreOptions, DiscoveredCredential, DiscoverOptions } from './auth/index.js'
export { DEFAULT_SCANNERS } from './auth/index.js'
export type { DiskScanner, DiskScanResult, ScanContext } from './auth/index.js'

export { registerPlugin, getPlugins, getPluginForProvider } from './plugin/index.js'
export { copilotPlugin } from './plugin/copilot.js'
export { codexPlugin } from './plugin/codex.js'
export { googlePlugin } from './plugin/google.js'
export { anthropicPlugin } from './plugin/anthropic.js'

export { MemoryStorage, FileStorage, createDefaultStorage } from './storage/index.js'
export type { StorageAdapter } from './storage/index.js'

export type { LanguageModel, LanguageModelV3 } from './types/index.js'
export type { ExtendConfig, ExtendProviderConfig, ExtendModelConfig, CatalogProvider } from './catalog/catalog.js'
export type { ModelDefinition } from './types/index.js'
export type { AuthHook, AuthMethod, AuthCredential, ProviderInfo } from './types/index.js'
export type { SecretRef, SecretResolver } from './types/index.js'
export type { ProviderUserConfig } from './types/index.js'

export { createLogger } from './logger.js'
