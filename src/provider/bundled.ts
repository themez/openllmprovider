import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createLogger } from '../logger.js'

const log = createLogger('provider:bundled')

export interface ProviderInstance {
  languageModel(modelId: string): LanguageModelV3
}

export type ProviderFactory = (options: Record<string, unknown>) => ProviderInstance

const PROVIDER_LOADERS: Record<string, () => Promise<ProviderFactory>> = {
  '@ai-sdk/anthropic': () => import('@ai-sdk/anthropic').then((m) => m.createAnthropic as unknown as ProviderFactory),
  '@ai-sdk/openai': () => import('@ai-sdk/openai').then((m) => m.createOpenAI as unknown as ProviderFactory),
  '@ai-sdk/google': () =>
    import('@ai-sdk/google').then((m) => m.createGoogleGenerativeAI as unknown as ProviderFactory),
  '@ai-sdk/google-vertex': () =>
    import('@ai-sdk/google-vertex').then((m) => m.createVertex as unknown as ProviderFactory),
  '@ai-sdk/amazon-bedrock': () =>
    import('@ai-sdk/amazon-bedrock').then((m) => m.createAmazonBedrock as unknown as ProviderFactory),
  '@ai-sdk/azure': () => import('@ai-sdk/azure').then((m) => m.createAzure as unknown as ProviderFactory),
  '@ai-sdk/openai-compatible': () =>
    import('@ai-sdk/openai-compatible').then((m) => m.createOpenAICompatible as unknown as ProviderFactory),
  '@ai-sdk/xai': () => import('@ai-sdk/xai').then((m) => m.createXai as unknown as ProviderFactory),
  '@ai-sdk/mistral': () => import('@ai-sdk/mistral').then((m) => m.createMistral as unknown as ProviderFactory),
  '@ai-sdk/groq': () => import('@ai-sdk/groq').then((m) => m.createGroq as unknown as ProviderFactory),
  '@openrouter/ai-sdk-provider': () =>
    import('@openrouter/ai-sdk-provider').then((m) => m.createOpenRouter as unknown as ProviderFactory),
}

const loadedProviders = new Map<string, ProviderFactory>()
const unavailableProviders = new Set<string>()

export async function loadProvider(packageName: string): Promise<ProviderFactory | undefined> {
  if (loadedProviders.has(packageName)) return loadedProviders.get(packageName)
  if (unavailableProviders.has(packageName)) return undefined

  const loader = PROVIDER_LOADERS[packageName]
  if (loader === undefined) return undefined

  try {
    const factory = await loader()
    loadedProviders.set(packageName, factory)
    log('loaded provider package: %s', packageName)
    return factory
  } catch {
    unavailableProviders.add(packageName)
    log('provider package not available: %s (not installed)', packageName)
    return undefined
  }
}

export async function isProviderInstalled(packageName: string): Promise<boolean> {
  return (await loadProvider(packageName)) !== undefined
}

export function getAllProviderPackages(): string[] {
  return Object.keys(PROVIDER_LOADERS)
}
