import type { Catalog, CatalogProvider } from '../catalog/index.js'
import { createLogger } from '../logger.js'
import type { AuthCredential } from '../types/plugin.js'
import type { DiskScanner, ScanContext } from './scanners.js'
import { DEFAULT_SCANNERS, runDiskScanners } from './scanners.js'
import type { AuthStore } from './store.js'

const log = createLogger('auth:discover')

export interface DiscoveredCredential {
  providerId: string
  source: 'env' | 'disk' | 'auth'
  key?: string
  credential?: AuthCredential
  location?: string
}

export interface DiscoverOptions {
  scanners?: DiskScanner[]
  scanContext?: ScanContext
  skipDiskScan?: boolean
}

export async function discoverCredentials(
  catalog: Catalog,
  authStore: AuthStore,
  options?: DiscoverOptions
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

  if (!options?.skipDiskScan) {
    const scanners = options?.scanners ?? DEFAULT_SCANNERS
    const diskResults = await runDiskScanners(scanners, options?.scanContext)
    log('disk scan found %d results', diskResults.length)

    for (const diskResult of diskResults) {
      if (!result[diskResult.providerId]) {
        result[diskResult.providerId] = {
          providerId: diskResult.providerId,
          source: 'disk',
          key: diskResult.key,
          location: diskResult.source,
        }
        log('discovered %s via disk (%s)', diskResult.providerId, diskResult.source)
      }
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
