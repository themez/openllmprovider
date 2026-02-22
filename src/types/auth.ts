import { z } from 'zod'

export type SecretRef =
  | { type: 'plain'; value: string }
  | { type: 'env'; name: string }
  | { type: 'storage'; key: string }
  | string

export interface SecretResolver {
  resolve(ref: SecretRef): Promise<string>
}

export const SecretRefSchema: z.ZodType<SecretRef> = z.union([
  z.object({ type: z.literal('plain'), value: z.string() }),
  z.object({ type: z.literal('env'), name: z.string() }),
  z.object({ type: z.literal('storage'), key: z.string() }),
  z.string(),
])
