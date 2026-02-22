export interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  list(): Promise<string[]>
}

export { MemoryStorage } from './memory.js'
export { FileStorage, type FileStorageOptions } from './file.js'
export { createDefaultStorage, type DefaultStorageOptions } from './auto.js'
