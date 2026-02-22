import type { StorageAdapter } from '../storage/index.js'
import type { SecretRef, SecretResolver } from '../types/auth.js'
import { createLogger } from '../logger.js'

const log = createLogger('auth:resolver')

export function createSecretResolver(storage?: StorageAdapter): SecretResolver {
  log('secret resolver created, storage=%s', storage !== undefined)

  return {
    async resolve(ref: SecretRef): Promise<string> {
      if (typeof ref === 'string') {
        log('resolve: plain string')
        return ref
      }

      if (ref.type === 'plain') {
        log('resolve: plain value')
        return ref.value
      }

      if (ref.type === 'env') {
        const value = process.env[ref.name]
        if (value === undefined) {
          throw new Error(`Environment variable not set: ${ref.name}`)
        }
        log('resolve: env %s', ref.name)
        return value
      }

      if (ref.type === 'storage') {
        if (!storage) {
          throw new Error(`Storage not configured, cannot resolve key: ${ref.key}`)
        }
        const value = await storage.get(ref.key)
        if (value === null) {
          throw new Error(`Key not found in storage: ${ref.key}`)
        }
        log('resolve: storage key=%s', ref.key)
        return value
      }

      throw new Error(`Unknown SecretRef type: ${JSON.stringify(ref)}`)
    },
  }
}
