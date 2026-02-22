import { z } from 'zod'
import type { SecretRef } from './auth.js'
import { SecretRefSchema } from './auth.js'
import type { ModelDefinition } from './model.js'
import { ModelDefinitionSchema } from './model.js'

export interface ProviderDefinition {
  id: string
  name: string
  bundledProvider?: string
  defaultSettings?: {
    baseURL?: string
    headers?: Record<string, string>
    options?: Record<string, unknown>
  }
  models?: ModelDefinition[]
}

export const ProviderDefinitionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    bundledProvider: z.string().optional(),
    defaultSettings: z
      .object({
        baseURL: z.string().optional(),
        headers: z.record(z.string()).optional(),
        options: z.record(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    models: z.array(ModelDefinitionSchema).optional(),
  })
  .passthrough()

export interface ProviderUserConfig {
  apiKey?: SecretRef
  baseURL?: string
  headers?: Record<string, string>
  options?: Record<string, unknown>
}

export const ProviderUserConfigSchema = z.object({
  apiKey: SecretRefSchema.optional(),
  baseURL: z.string().optional(),
  headers: z.record(z.string()).optional(),
  options: z.record(z.unknown()).optional(),
})
