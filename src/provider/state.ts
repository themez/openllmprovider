import type { AuthStore } from '../auth/store.js'
import type { Catalog } from '../catalog/catalog.js'
import { createLogger } from '../logger.js'
import { loadPluginOptions } from '../plugin/index.js'
import type { SecretRef } from '../types/auth.js'
import type { ProviderUserConfig } from '../types/provider.js'

const log = createLogger('provider:state')

export interface ProviderState {
  id: string
  key?: string
  options: Record<string, unknown>
  source: 'env' | 'disk' | 'auth' | 'plugin' | 'config' | 'none'
}

async function resolveSecretRef(ref: SecretRef): Promise<string | undefined> {
  if (typeof ref === 'string') return ref
  if (ref.type === 'plain') return ref.value
  if (ref.type === 'env') return process.env[ref.name]
  return undefined
}

// Providers whose SDK sends x-goog-api-key header; OAuth tokens need Bearer auth instead
const BEARER_FETCH_PROVIDERS = new Set(['@ai-sdk/google', '@ai-sdk/google-vertex'])

function needsBearerFetch(bundledProvider?: string): boolean {
  return bundledProvider !== undefined && BEARER_FETCH_PROVIDERS.has(bundledProvider)
}

export async function buildProviderState(config: {
  catalog: Catalog
  authStore: AuthStore
  userConfig?: Record<string, ProviderUserConfig>
}): Promise<Record<string, ProviderState>> {
  const { catalog, authStore, userConfig } = config

  log('building provider state')

  const allProviders = catalog.listProviders()
  const authCredentials = await authStore.all()

  log('found %d catalog providers, %d auth entries', allProviders.length, Object.keys(authCredentials).length)

  const result: Record<string, ProviderState> = {}

  for (const catalogProvider of allProviders) {
    const pid = catalogProvider.id
    const options: Record<string, unknown> = {}
    let key: string | undefined
    let source: ProviderState['source'] = 'none'

    if (catalogProvider.baseURL !== undefined) options.baseURL = catalogProvider.baseURL
    if (catalogProvider.headers !== undefined) options.headers = { ...catalogProvider.headers }
    if (catalogProvider.options !== undefined) Object.assign(options, catalogProvider.options)

    if (catalogProvider.env !== undefined) {
      for (const envVar of catalogProvider.env) {
        const val = process.env[envVar]
        if (val !== undefined) {
          key = val
          source = 'env'
          log('%s: resolved key from env var %s', pid, envVar)
          break
        }
      }
    }

    const authCred = authCredentials[pid]
    if (authCred?.key !== undefined) {
      key = authCred.key
      source = 'auth'
      if (authCred.type === 'oauth' && needsBearerFetch(catalogProvider.bundledProvider)) {
        // Google SDK sends x-goog-api-key but OAuth tokens need Authorization: Bearer
        const token = authCred.key
        options.fetch = (url: string | URL | Request, init?: RequestInit) => {
          const h = new Headers(init?.headers)
          h.delete('x-goog-api-key')
          h.set('Authorization', `Bearer ${token}`)
          return globalThis.fetch(url, { ...init, headers: h })
        }
        log('%s: resolved OAuth token (Bearer fetch override)', pid)
      } else {
        log('%s: resolved key from auth (type=%s)', pid, authCred.type ?? 'api')
      }
    }

    const getAuth = async () => authCred ?? { type: 'api' as const }
    const pluginOpts = await loadPluginOptions(pid, getAuth, { id: pid, name: catalogProvider.name })
    if (pluginOpts !== undefined) {
      Object.assign(options, pluginOpts)
      const pluginKey = pluginOpts.apiKey
      if (typeof pluginKey === 'string') {
        key = pluginKey
        source = 'plugin'
        log('%s: resolved key from plugin', pid)
      }
    }

    const userCfg = userConfig?.[pid]
    if (userCfg !== undefined) {
      if (userCfg.baseURL !== undefined) options.baseURL = userCfg.baseURL
      if (userCfg.headers !== undefined) {
        const existingHeaders = options.headers
        options.headers = {
          ...(existingHeaders !== null && typeof existingHeaders === 'object' && !Array.isArray(existingHeaders)
            ? (existingHeaders as Record<string, string>)
            : {}),
          ...userCfg.headers,
        }
      }
      if (userCfg.options !== undefined) Object.assign(options, userCfg.options)
      if (userCfg.apiKey !== undefined) {
        const resolved = await resolveSecretRef(userCfg.apiKey)
        if (resolved !== undefined) {
          key = resolved
          source = 'config'
          log('%s: resolved key from user config', pid)
        }
      }
    }

    log('%s: source=%s, hasKey=%s', pid, source, key !== undefined)
    result[pid] = { id: pid, key, options, source }
  }

  log('provider state built for %d providers', Object.keys(result).length)
  return result
}
