import type { StorageAdapter } from './index.js'

export class MemoryStorage implements StorageAdapter {
  private store: Map<string, string> = new Map()

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null)
  }

  set(key: string, value: string): Promise<void> {
    this.store.set(key, value)
    return Promise.resolve()
  }

  remove(key: string): Promise<void> {
    this.store.delete(key)
    return Promise.resolve()
  }

  list(): Promise<string[]> {
    return Promise.resolve([...this.store.keys()])
  }
}
