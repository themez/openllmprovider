export { createAuthStore } from './store.js'
export type { AuthStore, AuthStoreOptions } from './store.js'

export { createSecretResolver } from './resolver.js'

export type { SecretRef, SecretResolver } from '../types/auth.js'
export type { AuthCredential } from '../types/plugin.js'

export { discoverCredentials } from './discover.js'
export type { DiscoveredCredential } from './discover.js'
