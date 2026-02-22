import { z } from 'zod'
import type { ModelDefinition } from '../types/model.js'

const ModelsDevModelSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    family: z.string().optional(),

    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    temperature: z.boolean().optional(),
    attachment: z.boolean().optional(),
    streaming: z.boolean().optional(),
    system_message: z.boolean().optional(),

    modalities: z
      .object({
        input: z.array(z.string()),
        output: z.array(z.string()),
      })
      .passthrough(),

    limit: z
      .object({
        context: z.number(),
        output: z.number(),
        input_images: z.number().optional(),
      })
      .passthrough(),

    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
      })
      .passthrough()
      .optional(),

    status: z.enum(['stable', 'beta', 'deprecated']).optional(),
    knowledge: z.string().optional(),
  })
  .passthrough()

const ModelsDevProviderSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    env: z.array(z.string()).optional(),
    api: z.string().optional(),
    npm: z.string().optional(),
    doc: z.string().optional(),
    models: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export function mapModelsDevToModelDefinition(
  modelId: string,
  raw: unknown,
  provenance?: 'snapshot' | 'remote'
): ModelDefinition | null {
  const parsed = ModelsDevModelSchema.safeParse(raw)
  if (!parsed.success) return null

  const { id: _id, knowledge, ...rest } = parsed.data

  const result: Record<string, unknown> = {
    ...rest,
    modelId,
  }

  if (knowledge !== undefined) {
    result.knowledgeCutoff = knowledge
  }

  if (provenance !== undefined) {
    result.provenance = provenance
  }

  return result as unknown as ModelDefinition
}

export function mapModelsDevProvider(
  providerId: string,
  raw: unknown,
  provenance?: 'snapshot' | 'remote'
): {
  provider: { id: string; name: string; env?: string[]; api?: string; doc?: string }
  models: ModelDefinition[]
} {
  const parsed = ModelsDevProviderSchema.safeParse(raw)
  const name = parsed.success ? (parsed.data.name ?? providerId) : providerId
  const rawModels = parsed.success ? (parsed.data.models ?? {}) : {}

  const models: ModelDefinition[] = []
  for (const [modelId, modelRaw] of Object.entries(rawModels)) {
    const mapped = mapModelsDevToModelDefinition(modelId, modelRaw, provenance)
    if (mapped) models.push(mapped)
  }

  return {
    provider: {
      id: providerId,
      name,
      ...(parsed.success && parsed.data.env !== undefined ? { env: parsed.data.env } : {}),
      ...(parsed.success && parsed.data.api !== undefined ? { api: parsed.data.api } : {}),
      ...(parsed.success && parsed.data.doc !== undefined ? { doc: parsed.data.doc } : {}),
    },
    models,
  }
}

export function mapModelsDevProviderMetadata(
  providerId: string,
  raw: unknown
): { id: string; name: string; env?: string[]; api?: string; doc?: string } {
  const parsed = ModelsDevProviderSchema.safeParse(raw)

  return {
    id: providerId,
    name: parsed.success ? (parsed.data.name ?? providerId) : providerId,
    ...(parsed.success && parsed.data.env !== undefined ? { env: parsed.data.env } : {}),
    ...(parsed.success && parsed.data.api !== undefined ? { api: parsed.data.api } : {}),
    ...(parsed.success && parsed.data.doc !== undefined ? { doc: parsed.data.doc } : {}),
  }
}
