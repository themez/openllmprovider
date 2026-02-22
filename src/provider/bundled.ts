import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertex } from '@ai-sdk/google-vertex'
import { createGroq } from '@ai-sdk/groq'
import { createMistral } from '@ai-sdk/mistral'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createXai } from '@ai-sdk/xai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

export interface ProviderInstance {
  languageModel(modelId: string): LanguageModelV3
}

export type ProviderFactory = (options: Record<string, unknown>) => ProviderInstance

export const BUNDLED_PROVIDERS: Record<string, ProviderFactory> = {
  '@ai-sdk/anthropic': createAnthropic as unknown as ProviderFactory,
  '@ai-sdk/openai': createOpenAI as unknown as ProviderFactory,
  '@ai-sdk/google': createGoogleGenerativeAI as unknown as ProviderFactory,
  '@ai-sdk/google-vertex': createVertex as unknown as ProviderFactory,
  '@ai-sdk/amazon-bedrock': createAmazonBedrock as unknown as ProviderFactory,
  '@ai-sdk/azure': createAzure as unknown as ProviderFactory,
  '@ai-sdk/openai-compatible': createOpenAICompatible as unknown as ProviderFactory,
  '@ai-sdk/xai': createXai as unknown as ProviderFactory,
  '@ai-sdk/mistral': createMistral as unknown as ProviderFactory,
  '@ai-sdk/groq': createGroq as unknown as ProviderFactory,
  '@openrouter/ai-sdk-provider': createOpenRouter as unknown as ProviderFactory,
}
