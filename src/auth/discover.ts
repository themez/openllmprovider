import type { Catalog, CatalogProvider } from '../catalog/index.js'
import { createLogger } from '../logger.js'
import type { AuthCredential } from '../types/plugin.js'
import type { AuthStore } from './store.js'

const log = createLogger('auth:discover')

export interface DiscoveredCredential {
  providerId: string
  source: 'env' | 'auth'
  key?: string
  credential?: AuthCredential
}

export async function discoverCredentials(
  catalog: Catalog,
  authStore: AuthStore
): Promise<Record<string, DiscoveredCredential>> {
  const result: Record<string, DiscoveredCredential> = {}

  const providers = catalog.listProviders()
  log('scanning %d providers for env credentials', providers.length)

  for (const provider of providers) {
    const envKey = scanEnvForProvider(provider)
    if (envKey) {
      result[provider.id] = {
        providerId: provider.id,
        source: 'env',
        key: envKey,
      }
      log('discovered %s via env var', provider.id)
    }
  }

  let authData: Record<string, AuthCredential>
  try {
    authData = await authStore.all()
  } catch (err: unknown) {
    log('failed to read auth.json: %s', err instanceof Error ? err.message : String(err))
    authData = {}
  }

  for (const [providerId, credential] of Object.entries(authData)) {
    if (!result[providerId]) {
      result[providerId] = {
        providerId,
        source: 'auth',
        credential,
      }
      log('discovered %s via auth.json', providerId)
    }
  }

  log('discovery complete: %d providers found', Object.keys(result).length)
  return result
}

function scanEnvForProvider(provider: CatalogProvider): string | undefined {
  if (!provider.env || provider.env.length === 0) return undefined

  for (const envName of provider.env) {
    const value = process.env[envName]
    if (value) {
      log('found env var %s for provider %s', envName, provider.id)
      return value
    }
  }

  return undefined
}
