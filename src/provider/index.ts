import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { AuthStore } from '../auth/store.js'
import { createAuthStore } from '../auth/store.js'
import type { Catalog, CatalogProvider } from '../catalog/catalog.js'
import { Catalog as CatalogClass } from '../catalog/catalog.js'
import { createLogger } from '../logger.js'
import type { ProviderUserConfig } from '../types/provider.js'
import { BUNDLED_PROVIDERS } from './bundled.js'
import { buildProviderState } from './state.js'

export type { ProviderInstance, ProviderFactory } from './bundled.js'
export { BUNDLED_PROVIDERS } from './bundled.js'
export type { ProviderState } from './state.js'
export { buildProviderState } from './state.js'

const log = createLogger('provider')

const DEFAULT_PROVIDER_MAP: Record<string, string> = {
  anthropic: '@ai-sdk/anthropic',
  openai: '@ai-sdk/openai',
  google: '@ai-sdk/google',
  'google-vertex': '@ai-sdk/google-vertex',
  'amazon-bedrock': '@ai-sdk/amazon-bedrock',
  azure: '@ai-sdk/azure',
  xai: '@ai-sdk/xai',
  mistral: '@ai-sdk/mistral',
  groq: '@ai-sdk/groq',
  openrouter: '@openrouter/ai-sdk-provider',
}

function resolveBundledProviderKey(providerId: string, catalogProvider?: CatalogProvider): string | undefined {
  if (catalogProvider?.bundledProvider !== undefined) return catalogProvider.bundledProvider
  return DEFAULT_PROVIDER_MAP[providerId]
}

export interface ProviderConfig {
  catalog?: Catalog
  authStore?: AuthStore
  userConfig?: Record<string, ProviderUserConfig>
}

export function createProvider(config?: ProviderConfig) {
  const catalog = config?.catalog ?? new CatalogClass()
  const authStore = config?.authStore ?? createAuthStore()
  const userConfig = config?.userConfig

  let stateCache: ReturnType<typeof buildProviderState> | null = null

  function getState() {
    if (stateCache === null) {
      log('initializing provider state')
      stateCache = buildProviderState({ catalog, authStore, userConfig })
    }
    return stateCache
  }

  async function getLanguageModel(providerId: string, modelId: string): Promise<LanguageModelV3> {
    log('getLanguageModel(%s, %s)', providerId, modelId)

    const state = await getState()
    const providerState = state[providerId]

    if (providerState === undefined) {
      throw new Error(`Provider not found in catalog: ${providerId}`)
    }

    const catalogProvider = catalog.getProvider(providerId)
    const bundledKey = resolveBundledProviderKey(providerId, catalogProvider)

    if (bundledKey === undefined) {
      throw new Error(
        `No bundled provider mapping found for: ${providerId}. Set bundledProvider in catalog extend() config.`
      )
    }

    const factory = BUNDLED_PROVIDERS[bundledKey]

    if (factory === undefined) {
      throw new Error(`Bundled provider not available: ${bundledKey}`)
    }

    log('creating SDK for %s using %s', providerId, bundledKey)

    const sdkOptions = { ...providerState.options }
    if (providerState.key !== undefined) {
      sdkOptions.apiKey = providerState.key
    }

    const sdk = factory(sdkOptions)
    log('calling sdk.languageModel(%s)', modelId)
    return sdk.languageModel(modelId)
  }

  return { getLanguageModel, getState }
}

export function getLanguageModel(
  providerId: string,
  modelId: string,
  config?: ProviderConfig
): Promise<LanguageModelV3> {
  return createProvider(config).getLanguageModel(providerId, modelId)
}

export function getSDK(providerId: string, config?: ProviderConfig) {
  const provider = createProvider(config)
  return {
    languageModel: (modelId: string) => provider.getLanguageModel(providerId, modelId),
  }
}
