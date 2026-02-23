export { createAuthStore } from './store.js'
export type { AuthStore, AuthStoreOptions } from './store.js'

export { createSecretResolver } from './resolver.js'

export type { SecretRef, SecretResolver } from '../types/auth.js'
export type { AuthCredential } from '../types/plugin.js'

export { discoverCredentials } from './discover.js'
export type { DiscoveredCredential, DiscoverOptions } from './discover.js'

export { DEFAULT_SCANNERS, createNodeScanContext, runDiskScanners } from './scanners.js'
export type { DiskScanner, DiskScanResult, ScanContext } from './scanners.js'
