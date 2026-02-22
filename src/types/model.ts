import { z } from 'zod'

export interface ModelDefinition {
  modelId: string
  name?: string
  family?: string
  type?: 'chat' | 'embedding' | 'image'
  reasoning?: boolean
  tool_call?: boolean
  structured_output?: boolean
  temperature?: boolean
  attachment?: boolean
  streaming?: boolean
  system_message?: boolean
  modalities: {
    input: Array<'text' | 'image' | 'audio' | 'video' | 'pdf'>
    output: Array<'text' | 'image' | 'audio'>
  }
  limit: {
    context: number
    output: number
    input_images?: number
  }
  cost?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
  }
  status?: 'stable' | 'beta' | 'deprecated'
  knowledgeCutoff?: string
  provenance?: 'snapshot' | 'remote' | 'user-override'
}

export const ModelDefinitionSchema = z
  .object({
    modelId: z.string(),
    name: z.string().optional(),
    family: z.string().optional(),
    type: z.enum(['chat', 'embedding', 'image']).optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    temperature: z.boolean().optional(),
    attachment: z.boolean().optional(),
    streaming: z.boolean().optional(),
    system_message: z.boolean().optional(),
    modalities: z
      .object({
        input: z.array(z.enum(['text', 'image', 'audio', 'video', 'pdf'])),
        output: z.array(z.enum(['text', 'image', 'audio'])),
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
    knowledgeCutoff: z.string().optional(),
    provenance: z.enum(['snapshot', 'remote', 'user-override']).optional(),
  })
  .passthrough()

export interface ModelAlias {
  alias: string
  provider: string
  model: string
}

export const ModelAliasSchema = z
  .object({
    alias: z.string(),
    provider: z.string(),
    model: z.string(),
  })
  .passthrough()
