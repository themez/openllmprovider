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
  location?: string
}

async function resolveSecretRef(ref: SecretRef): Promise<string | undefined> {
  if (typeof ref === 'string') return ref
  if (ref.type === 'plain') return ref.value
  if (ref.type === 'env') return process.env[ref.name]
  return undefined
}

const GOOGLE_PROVIDERS = new Set(['@ai-sdk/google', '@ai-sdk/google-vertex'])
function normalizeProviderBaseURL(providerId: string, baseURL: string): string {
  if (providerId !== 'openai') return baseURL

  try {
    const parsed = new URL(baseURL)
    const path = parsed.pathname.replace(/\/+$/, '')
    if (path === '' || path === '/') {
      parsed.pathname = '/v1'
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return baseURL
  }
}

function resolveAuthBaseURL(authCred: Record<string, unknown> | undefined): string | undefined {
  if (authCred === undefined) return undefined
  if (typeof authCred.baseURL === 'string' && authCred.baseURL.trim().length > 0) return authCred.baseURL.trim()
  if (typeof authCred.apiHost === 'string' && authCred.apiHost.trim().length > 0) return authCred.apiHost.trim()
  if (typeof authCred.host === 'string' && authCred.host.trim().length > 0) return authCred.host.trim()
  return undefined
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
    let location: string | undefined
    if (catalogProvider.baseURL !== undefined) {
      options.baseURL = normalizeProviderBaseURL(pid, catalogProvider.baseURL)
    }
    if (catalogProvider.headers !== undefined) options.headers = { ...catalogProvider.headers }
    if (catalogProvider.options !== undefined) Object.assign(options, catalogProvider.options)
    if (catalogProvider.env !== undefined) {
      for (const envVar of catalogProvider.env) {
        const val = process.env[envVar]
        if (val !== undefined) {
          key = val
          source = 'env'
          location = `env:${envVar}`
          break
        }
      }
    }
    const authCred = authCredentials[pid]
    const authBaseURL = resolveAuthBaseURL(authCred as Record<string, unknown> | undefined)
    if (authBaseURL !== undefined) {
      options.baseURL = normalizeProviderBaseURL(pid, authBaseURL)
    }
    if (authCred?.key !== undefined) {
      key = authCred.key
      source = 'auth'
      location = authCred.location
      const bp = catalogProvider.bundledProvider
      if (authCred.type === 'oauth' && bp !== undefined) {
        if (GOOGLE_PROVIDERS.has(bp)) {
          const token = authCred.key
          options.fetch = (url: string | URL | Request, init?: RequestInit) => {
            const h = new Headers(init?.headers)
            h.delete('x-goog-api-key')
            h.set('Authorization', `Bearer ${token}`)
            return globalThis.fetch(url, { ...init, headers: h })
          }
        }
      }
    }

    const getAuth = async () => {
      const preferred = await authStore.getPreferred?.(pid, 'oauth')
      return preferred ?? authCred ?? { type: 'api' as const }
    }
    const setAuth = async (credential: Parameters<AuthStore['set']>[1]) => {
      await authStore.set(pid, credential)
    }
    const pluginOpts = await loadPluginOptions(pid, getAuth, { id: pid, name: catalogProvider.name }, setAuth)
    if (pluginOpts !== undefined) {
      Object.assign(options, pluginOpts)
      const pluginKey = pluginOpts.apiKey
      if (typeof pluginKey === 'string') {
        key = pluginKey
        source = 'plugin'
      }
      // Resolve actual auth credential to track correct location
      const resolvedAuth = await getAuth()
      if (resolvedAuth.location) {
        location = resolvedAuth.location
      }
    }

    const userCfg = userConfig?.[pid]
    if (userCfg !== undefined) {
      if (userCfg.baseURL !== undefined) options.baseURL = normalizeProviderBaseURL(pid, userCfg.baseURL)
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

    if (source !== 'none') {
      log('%s: source=%s, location=%s', pid, source, location ?? 'n/a')
    }
    result[pid] = { id: pid, key, options, source, location }
  }

  log('provider state built for %d providers', Object.keys(result).length)
  return result
}
