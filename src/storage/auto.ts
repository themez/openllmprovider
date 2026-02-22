import { createLogger } from '../logger.js'
import { MemoryStorage } from './memory.js'

const log = createLogger('storage')

function defaultNodeDir(): string {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
  const xdg = g.process?.env?.XDG_DATA_HOME
  if (xdg) return `${xdg}/openllmprovider/storage`

  const home = g.process?.env?.HOME
  if (home) return `${home}/.openllmprovider/storage`

  return '.openllmprovider/storage'
}

export interface DefaultStorageOptions {
  directory?: string
}

export async function createDefaultStorage(options: DefaultStorageOptions = {}) {
  const directory = options.directory ?? defaultNodeDir()
  try {
    const { FileStorage } = await import('./file.js')
    const storage = new FileStorage({ directory })
    log('using FileStorage at %s', directory)
    return storage
  } catch (err) {
    log('FileStorage unavailable, falling back to MemoryStorage: %o', err)
    return new MemoryStorage()
  }
}
