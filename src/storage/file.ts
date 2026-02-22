import type { StorageAdapter } from './index.js'

interface FsLike {
  readFile(path: string, encoding: string): Promise<string>
  writeFile(path: string, data: string, encoding: string): Promise<void>
  mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>
  unlink(path: string): Promise<void>
  readdir(path: string): Promise<string[]>
}

interface PathLike {
  join(...paths: string[]): string
}

async function getFs(): Promise<FsLike> {
  return (await import('node:fs/promises')) as unknown as FsLike
}

async function getPath(): Promise<PathLike> {
  return await import('node:path')
}

const UNSAFE_CHARS = /[/\\:*?"<>|]/g

function sanitizeKey(key: string): string {
  return key.replace(UNSAFE_CHARS, '_')
}

export interface FileStorageOptions {
  directory: string
}

export class FileStorage implements StorageAdapter {
  private readonly directory: string

  constructor(options: FileStorageOptions) {
    this.directory = options.directory
  }

  private async filePath(key: string): Promise<string> {
    const path = await getPath()
    return path.join(this.directory, sanitizeKey(key))
  }

  async get(key: string): Promise<string | null> {
    const fs = await getFs()
    try {
      return await fs.readFile(await this.filePath(key), 'utf-8')
    } catch (err: unknown) {
      if (isEnoent(err)) return null
      throw err
    }
  }

  async set(key: string, value: string): Promise<void> {
    const fs = await getFs()
    await fs.mkdir(this.directory, { recursive: true })
    await fs.writeFile(await this.filePath(key), value, 'utf-8')
  }

  async remove(key: string): Promise<void> {
    const fs = await getFs()
    try {
      await fs.unlink(await this.filePath(key))
    } catch (err: unknown) {
      if (isEnoent(err)) return
      throw err
    }
  }

  async list(): Promise<string[]> {
    const fs = await getFs()
    try {
      return await fs.readdir(this.directory)
    } catch (err: unknown) {
      if (isEnoent(err)) return []
      throw err
    }
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
