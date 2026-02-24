import { createLogger } from '../logger.js'
import { type StorageAdapter, createDefaultStorage } from '../storage/index.js'
import type { AuthCredential } from '../types/plugin.js'
import type { DiskScanResult, DiskScanner, ScanContext } from './scanners.js'
import { DEFAULT_SCANNERS, createNodeScanContext, runDiskScanners } from './scanners.js'

const log = createLogger('auth')

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
  skipEnvScan?: boolean
  persist?: boolean
}

export interface AuthStoreOptions {
  storage?: StorageAdapter
  data?: Record<string, AuthCredential>
}

export interface AuthStore {
  all(): Promise<Record<string, AuthCredential>>
  get(providerId: string): Promise<AuthCredential | null>
  set(providerId: string, credential: AuthCredential): Promise<void>
  remove(providerId: string): Promise<void>
  discover(options?: DiscoverOptions): Promise<DiscoveredCredential[]>
  getPreferred?(providerId: string, prefer: 'api' | 'oauth'): Promise<AuthCredential | null>
}

function pickBestCredential(creds: AuthCredential[], prefer: 'api' | 'oauth' = 'api'): AuthCredential | undefined {
  if (creds.length === 0) return undefined
  const preferred = creds.find((c) => c.type === prefer && c.key !== undefined)
  if (preferred !== undefined) return preferred
  const withKey = creds.find((c) => c.key !== undefined)
  if (withKey !== undefined) return withKey
  return creds[0]
}

export function createAuthStore(options?: AuthStoreOptions): AuthStore {
  const externalData = options?.data
  let storagePromise: Promise<StorageAdapter> | undefined
  const discoveredCredentials = new Map<string, AuthCredential[]>()

  log('auth store created, external=%s', externalData !== undefined)

  function getStorage(): Promise<StorageAdapter> {
    if (storagePromise === undefined) {
      storagePromise = options?.storage ? Promise.resolve(options.storage) : createDefaultStorage()
    }
    return storagePromise
  }

  async function readAuthState(): Promise<Record<string, AuthCredential>> {
    if (externalData !== undefined) {
      log('using external data, skipping file read')
      return { ...externalData }
    }

    const storage = await getStorage()
    const raw = await storage.get(AUTH_STORE_KEY)
    if (raw === null) {
      log('auth store not found, returning empty store')
      return {}
    }

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      log('auth store payload is malformed, returning empty store')
      return {}
    }

    const normalized = normalizeAuthState(parsed as Record<string, unknown>)
    log('read auth store with %d entries', Object.keys(normalized).length)
    return normalized
  }

  async function writeAuthState(data: Record<string, AuthCredential>): Promise<void> {
    if (externalData !== undefined) {
      for (const [k, v] of Object.entries(data)) {
        externalData[k] = v
      }
      for (const k of Object.keys(externalData)) {
        if (!(k in data)) {
          delete externalData[k]
        }
      }
      log('updated external data, %d entries', Object.keys(externalData).length)
      return
    }

    const content = JSON.stringify(data, null, 2)
    const storage = await getStorage()
    await storage.set(AUTH_STORE_KEY, content)

    log('wrote auth store with %d entries', Object.keys(data).length)
  }

  function mergeWithDiscovered(fileData: Record<string, AuthCredential>): Record<string, AuthCredential> {
    if (discoveredCredentials.size === 0) return fileData
    const merged = { ...fileData }
    for (const [pid, creds] of discoveredCredentials) {
      if (merged[pid] === undefined || !merged[pid].key) {
        const best = pickBestCredential(creds, 'api')
        if (best !== undefined) {
          merged[pid] = best
        }
      }
    }
    log(
      'merged %d discovered credentials with %d file entries',
      discoveredCredentials.size,
      Object.keys(fileData).length
    )
    return merged
  }

  function pushDiscoveredCredential(providerId: string, credential: AuthCredential): void {
    const arr = discoveredCredentials.get(providerId) ?? []
    arr.push(credential)
    discoveredCredentials.set(providerId, arr)
  }

  function pushDiscoveredResultOnce(
    seen: Set<string>,
    results: DiscoveredCredential[],
    result: DiscoveredCredential
  ): boolean {
    if (seen.has(result.providerId)) return false
    seen.add(result.providerId)
    results.push(result)
    return true
  }

  function buildCredentialFromEnv(envVar: string, key: string): AuthCredential {
    return buildCredential({ type: 'api', key, location: `env:${envVar}` })
  }

  function buildCredentialFromDisk(result: DiskScanResult): AuthCredential | undefined {
    if (result.key === undefined) return undefined
    return buildCredential({
      type: result.credentialType ?? 'api',
      key: result.key,
      location: result.source,
      refresh: result.refresh,
      accountId: result.accountId,
      expires: result.expires,
    })
  }

  return {
    async all(): Promise<Record<string, AuthCredential>> {
      return mergeWithDiscovered(await readAuthState())
    },

    async get(providerId: string): Promise<AuthCredential | null> {
      const store = mergeWithDiscovered(await readAuthState())
      const credential = store[providerId]
      if (credential === undefined) {
        log('get(%s): not found', providerId)
        return null
      }
      log('get(%s): found type=%s', providerId, credential.type)
      return credential
    },

    async set(providerId: string, credential: AuthCredential): Promise<void> {
      const store = await readAuthState()
      store[providerId] = credential
      await writeAuthState(store)
      log('set(%s): type=%s', providerId, credential.type)
    },

    async remove(providerId: string): Promise<void> {
      const store = await readAuthState()
      if (!(providerId in store)) {
        log('remove(%s): not found, no-op', providerId)
        return
      }
      delete store[providerId]
      await writeAuthState(store)
      log('remove(%s): done', providerId)
    },

    async discover(discoverOptions?: DiscoverOptions): Promise<DiscoveredCredential[]> {
      const results: DiscoveredCredential[] = []
      const seen = new Set<string>()

      if (!discoverOptions?.skipEnvScan) {
        for (const [envVar, providerId] of ENV_HINTS) {
          const value = process.env[envVar]
          if (value) {
            pushDiscoveredCredential(providerId, buildCredentialFromEnv(envVar, value))
            pushDiscoveredResultOnce(seen, results, { providerId, source: 'env', key: value })
            log('discover: %s [api] from env:%s', providerId, envVar)
          }
        }
      }

      if (!discoverOptions?.skipDiskScan) {
        const scanners = discoverOptions?.scanners ?? DEFAULT_SCANNERS
        const ctx = discoverOptions?.scanContext ?? createNodeScanContext()
        const diskResults = await runDiskScanners(scanners, ctx)

        for (const disk of diskResults) {
          const credType = disk.credentialType ?? 'api'
          pushDiscoveredResultOnce(seen, results, {
            providerId: disk.providerId,
            source: 'disk',
            key: disk.key,
            location: disk.source,
          })
          const cred = buildCredentialFromDisk(disk)
          if (cred !== undefined) {
            pushDiscoveredCredential(disk.providerId, cred)
            log('discover: %s [%s] from %s', disk.providerId, credType, disk.source)
          }
        }
      }

      if (discoverOptions?.persist === true) {
        const persistedCount = await persistDiscoveredCredentials()
        log('discover: persisted %d providers to auth store', persistedCount)
      }

      let authData: Record<string, AuthCredential>
      try {
        authData = await readAuthState()
      } catch (err: unknown) {
        log('discover: failed to read auth store: %s', err instanceof Error ? err.message : String(err))
        authData = {}
      }

      for (const [providerId, credential] of Object.entries(authData)) {
        const added = pushDiscoveredResultOnce(seen, results, { providerId, source: 'auth', credential })
        if (added) log('discover: %s via auth store', providerId)
      }

      log('discover: complete, %d providers found', results.length)
      return results
    },

    async getPreferred(providerId: string, prefer: 'api' | 'oauth'): Promise<AuthCredential | null> {
      const creds = discoveredCredentials.get(providerId)
      if (creds !== undefined && creds.length > 0) {
        const best = pickBestCredential(creds, prefer)
        if (best !== undefined) return best
      }
      const store = mergeWithDiscovered(await readAuthState())
      const credential = store[providerId]
      return credential ?? null
    },
  }

  async function persistDiscoveredCredentials(): Promise<number> {
    if (discoveredCredentials.size === 0) return 0

    const store = await readAuthState()
    let changed = 0

    for (const [providerId, creds] of discoveredCredentials) {
      const existing = store[providerId]
      if (existing?.key) {
        continue
      }

      const best = pickBestCredential(creds, 'api')
      if (best === undefined) {
        continue
      }

      store[providerId] = best
      changed += 1
    }

    if (changed > 0) {
      await writeAuthState(store)
    }

    return changed
  }
}

const AUTH_STORE_KEY = 'auth:store'

interface CredentialBuildInput {
  type: 'api' | 'oauth' | 'wellknown'
  key?: string
  location?: string
  refresh?: string
  accountId?: string
  expires?: number
}

function buildCredential(input: CredentialBuildInput): AuthCredential {
  const credential: AuthCredential = {
    type: input.type,
    key: input.key,
    location: input.location,
  }

  if (input.refresh !== undefined) credential.refresh = input.refresh
  if (input.accountId !== undefined) credential.accountId = input.accountId
  if (input.expires !== undefined) credential.expires = input.expires

  return credential
}

function normalizeAuthState(input: Record<string, unknown>): Record<string, AuthCredential> {
  const normalized: Record<string, AuthCredential> = {}

  for (const [providerId, rawCredential] of Object.entries(input)) {
    const credential = normalizeCredential(rawCredential)
    if (credential !== undefined) {
      normalized[providerId] = credential
    }
  }

  return normalized
}

function normalizeCredential(rawCredential: unknown): AuthCredential | undefined {
  if (typeof rawCredential !== 'object' || rawCredential === null || Array.isArray(rawCredential)) {
    return undefined
  }

  const typed = rawCredential as Record<string, unknown>
  const type =
    typed.type === 'api' || typed.type === 'oauth' || typed.type === 'wellknown' ? typed.type : ('api' as const)

  const key = typeof typed.key === 'string' && typed.key.length > 0 ? typed.key : undefined
  return {
    ...typed,
    type,
    key,
  } as AuthCredential
}

const ENV_HINTS: Array<[string, string]> = [
  ['ANTHROPIC_API_KEY', 'anthropic'],
  ['OPENAI_API_KEY', 'openai'],
  ['GOOGLE_GENERATIVE_AI_API_KEY', 'google'],
  ['GOOGLE_API_KEY', 'google'],
  ['AZURE_API_KEY', 'azure'],
  ['XAI_API_KEY', 'xai'],
  ['MISTRAL_API_KEY', 'mistral'],
  ['GROQ_API_KEY', 'groq'],
  ['OPENROUTER_API_KEY', 'openrouter'],
]
