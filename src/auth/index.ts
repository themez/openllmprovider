export { createAuthStore } from './store.js'
export type { AuthStore, AuthStoreOptions, DiscoveredCredential, DiscoverOptions } from './store.js'

export { createSecretResolver } from './resolver.js'

export type { SecretRef, SecretResolver } from '../types/auth.js'
export type { AuthCredential } from '../types/plugin.js'

export { DEFAULT_SCANNERS } from './scanners.js'
export type { DiskScanner, DiskScanResult, ScanContext } from './scanners.js'
