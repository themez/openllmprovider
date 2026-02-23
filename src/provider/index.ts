import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { AuthStore } from '../auth/store.js'
import { createAuthStore } from '../auth/store.js'
import type { CatalogProvider, ExtendConfig } from '../catalog/catalog.js'
import { Catalog } from '../catalog/catalog.js'
import { createLogger } from '../logger.js'
import { copilotPlugin } from '../plugin/copilot.js'
import { registerPlugin } from '../plugin/index.js'
import type { ModelDefinition } from '../types/model.js'
import type { ProviderUserConfig } from '../types/provider.js'
import { BUNDLED_PROVIDERS } from './bundled.js'
import { buildProviderState } from './state.js'

export type { ProviderInstance, ProviderFactory } from './bundled.js'
export { BUNDLED_PROVIDERS } from './bundled.js'

const log = createLogger('provider')

const DEFAULT_PROVIDERS: Record<string, { name: string; env: string[]; bundledProvider: string }> = {
  anthropic: { name: 'Anthropic', env: ['ANTHROPIC_API_KEY'], bundledProvider: '@ai-sdk/anthropic' },
  openai: { name: 'OpenAI', env: ['OPENAI_API_KEY'], bundledProvider: '@ai-sdk/openai' },
  google: {
    name: 'Google AI',
    env: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
    bundledProvider: '@ai-sdk/google',
  },
  'google-vertex': { name: 'Google Vertex AI', env: [], bundledProvider: '@ai-sdk/google-vertex' },
  'amazon-bedrock': { name: 'Amazon Bedrock', env: [], bundledProvider: '@ai-sdk/amazon-bedrock' },
  azure: { name: 'Azure OpenAI', env: ['AZURE_API_KEY'], bundledProvider: '@ai-sdk/azure' },
  xai: { name: 'xAI', env: ['XAI_API_KEY'], bundledProvider: '@ai-sdk/xai' },
  mistral: { name: 'Mistral', env: ['MISTRAL_API_KEY'], bundledProvider: '@ai-sdk/mistral' },
  groq: { name: 'Groq', env: ['GROQ_API_KEY'], bundledProvider: '@ai-sdk/groq' },
  openrouter: { name: 'OpenRouter', env: ['OPENROUTER_API_KEY'], bundledProvider: '@openrouter/ai-sdk-provider' },
  'github-copilot': { name: 'GitHub Copilot', env: [], bundledProvider: '@ai-sdk/openai-compatible' },
}

function resolveBundledProviderKey(providerId: string, catalogProvider?: CatalogProvider): string | undefined {
  if (catalogProvider?.bundledProvider !== undefined) return catalogProvider.bundledProvider
  return DEFAULT_PROVIDERS[providerId]?.bundledProvider
}

export interface ProviderStoreConfig {
  userConfig?: Record<string, ProviderUserConfig>
}

export interface ProviderStore {
  getLanguageModel(providerId: string, modelId: string): Promise<LanguageModelV3>
  extend(config: ExtendConfig): void
  listProviders(): Promise<CatalogProvider[]>
  listModels(providerId?: string): ModelDefinition[]
  getModel(providerId: string, modelId: string): ModelDefinition | undefined
}

export function createProviderStore(authStore: AuthStore, config?: ProviderStoreConfig): ProviderStore {
  const catalog = new Catalog()
  // Auto-register built-in plugins
  registerPlugin(copilotPlugin)
  catalog.extend({
    providers: Object.fromEntries(
      Object.entries(DEFAULT_PROVIDERS).map(([id, p]) => [
        id,
        { name: p.name, env: p.env, bundledProvider: p.bundledProvider },
      ])
    ),
  })
  const userConfig = config?.userConfig
  let stateCache: Promise<Record<string, import('./state.js').ProviderState>> | null = null

  function invalidateState() {
    stateCache = null
  }

  function getState() {
    if (stateCache === null) {
      log('initializing provider state')
      stateCache = buildProviderState({ catalog, authStore, userConfig })
    }
    return stateCache
  }

  return {
    async getLanguageModel(providerId: string, modelId: string): Promise<LanguageModelV3> {
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
    },

    extend(extendConfig: ExtendConfig): void {
      catalog.extend(extendConfig)
      invalidateState()
    },

    async listProviders(): Promise<CatalogProvider[]> {
      const state = await getState()
      return catalog.listProviders().filter((p) => {
        const s = state[p.id]
        return s !== undefined && s.source !== 'none'
      })
    },

    listModels(providerId?: string): ModelDefinition[] {
      return catalog.listModels(providerId)
    },

    getModel(providerId: string, modelId: string): ModelDefinition | undefined {
      return catalog.getModel(providerId, modelId)
    },
  }
}

export function getLanguageModel(
  providerId: string,
  modelId: string,
  config?: ProviderStoreConfig
): Promise<LanguageModelV3> {
  return createProviderStore(createAuthStore(), config).getLanguageModel(providerId, modelId)
}
