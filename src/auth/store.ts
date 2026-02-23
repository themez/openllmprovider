import { createLogger } from '../logger.js'
import type { AuthCredential } from '../types/plugin.js'
import type { DiskScanner, ScanContext } from './scanners.js'
import { DEFAULT_SCANNERS, createNodeScanContext, runDiskScanners } from './scanners.js'

const log = createLogger('auth')

interface FsLike {
  readFile(path: string, encoding: string): Promise<string>
  writeFile(path: string, data: string, options: { encoding: string; mode: number }): Promise<void>
  mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>
  chmod(path: string, mode: number): Promise<void>
}

interface PathLike {
  join(...paths: string[]): string
  dirname(path: string): string
}

async function getFs(): Promise<FsLike> {
  return (await import('node:fs/promises')) as unknown as FsLike
}

async function getPath(): Promise<PathLike> {
  return await import('node:path')
}

function getDefaultAuthPath(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME
  if (xdgDataHome) {
    return `${xdgDataHome}/openllmprovider/auth.json`
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''

  if (process.platform === 'darwin') {
    return `${home}/Library/Application Support/openllmprovider/auth.json`
  }

  return `${home}/.local/share/openllmprovider/auth.json`
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}

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
}

export interface AuthStoreOptions {
  path?: string
  data?: Record<string, AuthCredential>
}

export interface AuthStore {
  all(): Promise<Record<string, AuthCredential>>
  get(providerId: string): Promise<AuthCredential | null>
  set(providerId: string, credential: AuthCredential): Promise<void>
  remove(providerId: string): Promise<void>
  discover(options?: DiscoverOptions): Promise<DiscoveredCredential[]>
}

export function createAuthStore(options?: AuthStoreOptions): AuthStore {
  const externalData = options?.data
  const filePath = options?.path ?? getDefaultAuthPath()
  const discoveredCredentials = new Map<string, AuthCredential>()

  log('auth store created, path=%s, external=%s', filePath, externalData !== undefined)

  async function readFile(): Promise<Record<string, AuthCredential>> {
    if (externalData !== undefined) {
      log('using external data, skipping file read')
      return { ...externalData }
    }

    const fs = await getFs()
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        log('auth.json is malformed, returning empty store')
        return {}
      }
      log('read auth.json with %d entries', Object.keys(parsed).length)
      return parsed as Record<string, AuthCredential>
    } catch (err: unknown) {
      if (isEnoent(err)) {
        log('auth.json not found, returning empty store')
        return {}
      }
      throw err
    }
  }

  async function writeFile(data: Record<string, AuthCredential>): Promise<void> {
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

    const fs = await getFs()
    const path = await getPath()
    const dir = path.dirname(filePath)

    await fs.mkdir(dir, { recursive: true })
    const content = JSON.stringify(data, null, 2)
    await fs.writeFile(filePath, content, { encoding: 'utf-8', mode: 0o600 })

    try {
      await fs.chmod(filePath, 0o600)
    } catch {
      // chmod is best-effort; some filesystems don't support it
    }

    log('wrote auth.json with %d entries', Object.keys(data).length)
  }

  function mergeWithDiscovered(fileData: Record<string, AuthCredential>): Record<string, AuthCredential> {
    if (discoveredCredentials.size === 0) return fileData
    const merged = { ...fileData }
    for (const [pid, cred] of discoveredCredentials) {
      if (merged[pid] === undefined) {
        merged[pid] = cred
      }
    }
    log(
      'merged %d discovered credentials with %d file entries',
      discoveredCredentials.size,
      Object.keys(fileData).length
    )
    return merged
  }

  return {
    async all(): Promise<Record<string, AuthCredential>> {
      return mergeWithDiscovered(await readFile())
    },

    async get(providerId: string): Promise<AuthCredential | null> {
      const store = mergeWithDiscovered(await readFile())
      const credential = store[providerId]
      if (credential === undefined) {
        log('get(%s): not found', providerId)
        return null
      }
      log('get(%s): found type=%s', providerId, credential.type)
      return credential
    },

    async set(providerId: string, credential: AuthCredential): Promise<void> {
      const store = await readFile()
      store[providerId] = credential
      await writeFile(store)
      log('set(%s): type=%s', providerId, credential.type)
    },

    async remove(providerId: string): Promise<void> {
      const store = await readFile()
      if (!(providerId in store)) {
        log('remove(%s): not found, no-op', providerId)
        return
      }
      delete store[providerId]
      await writeFile(store)
      log('remove(%s): done', providerId)
    },

    async discover(discoverOptions?: DiscoverOptions): Promise<DiscoveredCredential[]> {
      const results: DiscoveredCredential[] = []
      const seen = new Set<string>()

      if (!discoverOptions?.skipEnvScan) {
        for (const [envVar, providerId] of ENV_HINTS) {
          const value = process.env[envVar]
          if (value) {
            seen.add(providerId)
            discoveredCredentials.set(providerId, { type: 'api', key: value })
            results.push({ providerId, source: 'env', key: value })
            log('discover: %s via env (%s)', providerId, envVar)
          }
        }
      }

      if (!discoverOptions?.skipDiskScan) {
        const scanners = discoverOptions?.scanners ?? DEFAULT_SCANNERS
        const ctx = discoverOptions?.scanContext ?? createNodeScanContext()
        const diskResults = await runDiskScanners(scanners, ctx)
        log('discover: disk scan found %d results', diskResults.length)

        for (const disk of diskResults) {
          const credType = disk.credentialType ?? 'api'
          if (!seen.has(disk.providerId)) {
            seen.add(disk.providerId)
            results.push({
              providerId: disk.providerId,
              source: 'disk',
              key: disk.key,
              location: disk.source,
            })
            if (disk.key !== undefined) {
              discoveredCredentials.set(disk.providerId, { type: credType, key: disk.key })
            }
            log('discover: %s via disk (%s), hasKey=%s', disk.providerId, disk.source, disk.key !== undefined)
          } else if (disk.key !== undefined && !discoveredCredentials.has(disk.providerId)) {
            // Earlier scanner found this provider without a key; upgrade with this key
            discoveredCredentials.set(disk.providerId, { type: credType, key: disk.key })
            log('discover: %s upgraded with key from %s', disk.providerId, disk.source)
          }
        }
      }
      let authData: Record<string, AuthCredential>
      try {
        authData = await readFile()
      } catch (err: unknown) {
        log('discover: failed to read auth.json: %s', err instanceof Error ? err.message : String(err))
        authData = {}
      }

      for (const [providerId, credential] of Object.entries(authData)) {
        if (!seen.has(providerId)) {
          seen.add(providerId)
          results.push({ providerId, source: 'auth', credential })
          log('discover: %s via auth.json', providerId)
        }
      }

      log('discover: complete, %d providers found', results.length)
      return results
    },
  }
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
