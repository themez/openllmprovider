import type { AuthCredential } from '../types/plugin.js'
import { createLogger } from '../logger.js'

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

export interface AuthStoreOptions {
  path?: string
  data?: Record<string, AuthCredential>
}

export interface AuthStore {
  all(): Promise<Record<string, AuthCredential>>
  get(providerId: string): Promise<AuthCredential | null>
  set(providerId: string, credential: AuthCredential): Promise<void>
  remove(providerId: string): Promise<void>
}

export function createAuthStore(options?: AuthStoreOptions): AuthStore {
  const externalData = options?.data
  const filePath = options?.path ?? getDefaultAuthPath()

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

  return {
    async all(): Promise<Record<string, AuthCredential>> {
      return readFile()
    },

    async get(providerId: string): Promise<AuthCredential | null> {
      const store = await readFile()
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
  }
}
