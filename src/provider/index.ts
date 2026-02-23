import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { AuthStore } from '../auth/store.js'
import { createAuthStore } from '../auth/store.js'
import type { CatalogProvider, ExtendConfig } from '../catalog/catalog.js'
import { Catalog } from '../catalog/catalog.js'
import { createLogger } from '../logger.js'
import { anthropicPlugin } from '../plugin/anthropic.js'
import { codexPlugin } from '../plugin/codex.js'
import { copilotPlugin } from '../plugin/copilot.js'
import { googlePlugin } from '../plugin/google.js'
import { registerPlugin } from '../plugin/index.js'
import type { ModelDefinition } from '../types/model.js'
import type { ProviderUserConfig } from '../types/provider.js'
import { isProviderInstalled, loadProvider } from './bundled.js'
import { buildProviderState } from './state.js'

export type { ProviderInstance, ProviderFactory } from './bundled.js'
export { loadProvider, isProviderInstalled, getAllProviderPackages } from './bundled.js'

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

export interface ProviderListOptions {
  includeUnavailable?: boolean
}

export interface ModelListOptions {
  includeUnavailable?: boolean
}

export interface GetModelOptions {
  includeUnavailable?: boolean
}

export interface ProviderStore {
  getLanguageModel(providerId: string, modelId: string): Promise<LanguageModelV3>
  extend(config: ExtendConfig): void
  listProviders(options?: ProviderListOptions): Promise<CatalogProvider[]>
  listModels(providerId?: string, options?: ModelListOptions): Promise<ModelDefinition[]>
  getModel(providerId: string, modelId: string, options?: GetModelOptions): Promise<ModelDefinition | undefined>
}

export function createProviderStore(authStore: AuthStore, config?: ProviderStoreConfig): ProviderStore {
  const catalog = new Catalog()
  registerPlugin(copilotPlugin)
  registerPlugin(codexPlugin)
  registerPlugin(googlePlugin)
  registerPlugin(anthropicPlugin)
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
  let catalogRefreshTask: Promise<void> | null = null

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

  async function ensureCatalogEnriched(): Promise<void> {
    if (catalogRefreshTask === null) {
      catalogRefreshTask = (async () => {
        const result = await catalog.refresh()
        if (!result.success) {
          log('catalog refresh failed: %s', result.error?.message ?? 'unknown error')
          return
        }
        log('catalog refreshed with %d providers', result.updatedProviders.length)
        invalidateState()
      })()
    }
    await catalogRefreshTask
  }

  function hasProviderAuth(state: Record<string, import('./state.js').ProviderState>, providerId: string): boolean {
    const providerState = state[providerId]
    return providerState !== undefined && providerState.source !== 'none'
  }

  async function checkProviderUsable(providerId: string): Promise<boolean> {
    const catalogProvider = catalog.getProvider(providerId)
    const bundledKey = resolveBundledProviderKey(providerId, catalogProvider)
    if (bundledKey === undefined) return false
    return isProviderInstalled(bundledKey)
  }

  return {
    async getLanguageModel(providerId: string, modelId: string): Promise<LanguageModelV3> {
      await ensureCatalogEnriched()
      const state = await getState()
      const providerState = state[providerId]

      log(
        'getLanguageModel(%s, %s) — auth: source=%s, location=%s',
        providerId,
        modelId,
        providerState?.source ?? 'none',
        providerState?.location ?? 'unknown'
      )
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

      const factory = await loadProvider(bundledKey)

      if (factory === undefined) {
        throw new Error(`Provider package not available: ${bundledKey}. Install it with: npm install ${bundledKey}`)
      }

      log('creating SDK for %s using %s', providerId, bundledKey)

      const sdkOptions = { ...providerState.options }
      if (providerState.key !== undefined) {
        sdkOptions.apiKey = providerState.key
      }
      // authToken and apiKey must not coexist (e.g. @ai-sdk/anthropic rejects both)
      if (sdkOptions.authToken !== undefined) {
        sdkOptions.apiKey = undefined
      }

      const sdk = factory(sdkOptions)
      log('calling sdk.languageModel(%s)', modelId)
      return sdk.languageModel(modelId)
    },

    extend(extendConfig: ExtendConfig): void {
      catalog.extend(extendConfig)
      invalidateState()
    },

    async listProviders(options?: ProviderListOptions): Promise<CatalogProvider[]> {
      await ensureCatalogEnriched()
      const allProviders = catalog.listProviders()

      const usabilityChecks = await Promise.all(
        allProviders.map(async (p) => ({ provider: p, usable: await checkProviderUsable(p.id) }))
      )
      const installedProviders = usabilityChecks.filter((r) => r.usable).map((r) => r.provider)

      if (options?.includeUnavailable === true) {
        return installedProviders
      }
      const state = await getState()
      return installedProviders.filter((provider) => hasProviderAuth(state, provider.id))
    },

    async listModels(providerId?: string, options?: ModelListOptions): Promise<ModelDefinition[]> {
      await ensureCatalogEnriched()
      if (options?.includeUnavailable === true) {
        return catalog.listModels(providerId)
      }

      const state = await getState()
      if (providerId !== undefined) {
        if (!hasProviderAuth(state, providerId)) {
          return []
        }
        return catalog.listModels(providerId)
      }

      const allProviders = catalog.listProviders()
      const usabilityChecks = await Promise.all(
        allProviders.map(async (p) => ({
          provider: p,
          usable: (await checkProviderUsable(p.id)) && hasProviderAuth(state, p.id),
        }))
      )

      const results: ModelDefinition[] = []
      for (const { provider, usable } of usabilityChecks) {
        if (usable) {
          results.push(...catalog.listModels(provider.id))
        }
      }
      return results
    },

    async getModel(
      providerId: string,
      modelId: string,
      options?: GetModelOptions
    ): Promise<ModelDefinition | undefined> {
      await ensureCatalogEnriched()
      if (options?.includeUnavailable !== true) {
        const state = await getState()
        if (!hasProviderAuth(state, providerId)) {
          return undefined
        }
      }
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
